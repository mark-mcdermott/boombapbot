import { deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PASSWORD, ROW_ID, signedUp, signedUpRequest } from './account';
import { ACCOUNTS_URL } from './accounts-server';

// An account's picture, against the built server (see playwright.config.ts).

const AVATAR_ADDRESS = /\/api\/avatars\/[0-9a-f-]{36}$/;
const origin = { origin: ACCOUNTS_URL };

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function chunk(name: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(name, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

/** A PNG of one colour, this wide and tall. */
function png(width: number, height: number, [red, green, blue]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([red, green, blue]))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const footerPicture = (page: Page): Locator => page.getByTestId('account').getByTestId('avatar');
const modalPicture = (page: Page): Locator => page.getByTestId('account-signed-in').getByTestId('avatar');

const pick = (page: Page, name: string, mimeType: string, buffer: Buffer) =>
  page.getByTestId('avatar-file').setInputFiles({ name, mimeType, buffer });

test('an account has a robot for a picture until it uploads one of its own', async ({ page, request }) => {
  await signedUp(page);

  // The green light is gone: the account button is the account's picture.
  await expect(footerPicture(page)).toHaveAttribute('data-kind', 'robot');
  await expect(footerPicture(page).locator('svg')).toBeVisible();
  await expect(modalPicture(page)).toHaveAttribute('data-kind', 'robot');
  await expect(page.getByTestId('avatar-upload')).toHaveText('Upload a picture');
  await expect(page.getByTestId('avatar-remove')).toHaveCount(0);

  // A wide picture is cut to its middle square and shrunk before it is sent.
  await pick(page, 'wide.png', 'image/png', png(600, 300, [255, 90, 60]));
  await expect(modalPicture(page)).toHaveAttribute('data-kind', 'uploaded');
  await expect(footerPicture(page)).toHaveAttribute('data-kind', 'uploaded');
  await expect(page.getByTestId('avatar-upload')).toHaveText('Change picture');
  const picture = modalPicture(page).locator('img');
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([256, 256]);

  // It is served as a picture and nothing else, from an address that can be kept for good.
  const address = (await picture.getAttribute('src'))!;
  expect(address).toMatch(AVATAR_ADDRESS);
  const served = await request.get(address);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/^image\/(webp|jpeg)$/);
  expect(served.headers()['cache-control']).toContain('immutable');
  expect(served.headers()['x-content-type-options']).toBe('nosniff');
  expect((await served.body()).byteLength).toBeLessThan(96 * 1024);

  // It is still the account's picture after a reload.
  await page.reload();
  await expect(footerPicture(page)).toHaveAttribute('data-kind', 'uploaded');
  await expect(footerPicture(page).locator('img')).toHaveAttribute('src', address);

  // A second picture replaces the first, at a new address, and the old one is gone.
  await page.getByTestId('account').click();
  await pick(page, 'tall.png', 'image/png', png(200, 500, [134, 217, 154]));
  await expect(modalPicture(page).locator('img')).not.toHaveAttribute('src', address);
  expect((await request.get(address)).status()).toBe(404);

  // Removing it brings the robot back.
  const second = (await modalPicture(page).locator('img').getAttribute('src'))!;
  await page.getByTestId('avatar-remove').click();
  await expect(modalPicture(page)).toHaveAttribute('data-kind', 'robot');
  await expect(footerPicture(page)).toHaveAttribute('data-kind', 'robot');
  await expect(page.getByTestId('avatar-upload')).toHaveText('Upload a picture');
  expect((await request.get(second)).status()).toBe(404);
});

test('a file that is not a picture is turned down on the page, in plain words', async ({ page }) => {
  await signedUp(page);
  await pick(page, 'notes.txt', 'text/plain', Buffer.from('four on the floor'));
  await expect(page.getByTestId('avatar-problem')).toHaveText(
    'I could not open that as a picture. Try a JPEG, a PNG or a WebP.',
  );
  await expect(modalPicture(page)).toHaveAttribute('data-kind', 'robot');
  await expect(page.getByTestId('avatar-upload')).toBeEnabled();
});

test.describe('the picture routes', () => {
  const put = { headers: { ...origin, 'content-type': 'image/png' } };

  test('keep a picture only for somebody logged in', async ({ request }) => {
    const refused = await request.put('/api/account/avatar', { ...put, data: png(8, 8, [0, 0, 0]) });
    expect(refused.status()).toBe(401);
    expect(await refused.json()).toMatchObject({ code: 'signed_out' });
    expect((await request.delete('/api/account/avatar')).status()).toBe(401);
  });

  test('read what was sent from its bytes, whatever it is called', async ({ request }) => {
    await signedUpRequest(request);
    const drawing = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const refused = await request.put('/api/account/avatar', { ...put, data: drawing });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'invalid' });

    const heavy = Buffer.concat([png(8, 8, [0, 0, 0]), Buffer.alloc(96 * 1024)]);
    const tooLarge = await request.put('/api/account/avatar', { ...put, data: heavy });
    expect(tooLarge.status()).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ code: 'too_large' });

    const session = await (await request.get('/api/auth/get-session')).json();
    expect(session.user.image ?? null).toBeNull();
  });

  test('answer with where the picture is, and never a row id', async ({ request }) => {
    await signedUpRequest(request);
    const kept = await request.put('/api/account/avatar', { ...put, data: png(16, 16, [10, 20, 30]) });
    expect(kept.status()).toBe(200);
    const text = await kept.text();
    expect(text).not.toMatch(ROW_ID);
    const { image } = JSON.parse(text) as { image: string };
    expect(image).toMatch(AVATAR_ADDRESS);
    const session = await (await request.get('/api/auth/get-session')).json();
    expect(session.user.image).toBe(image);
    const served = await request.get(image);
    expect(served.headers()['content-type']).toBe('image/png');
    expect((await served.body()).equals(png(16, 16, [10, 20, 30]))).toBe(true);

    expect((await request.get('/api/avatars/not-an-id')).status()).toBe(404);
    expect((await request.get('/api/avatars/0f8b6c1e-5a55-4d0b-9d0a-3f1f1f0b7c11')).status()).toBe(404);
  });

  test('let nobody point an account’s picture somewhere else', async ({ request }) => {
    await signedUpRequest(request);
    const refused = await request.post('/api/auth/update-user', {
      data: { image: 'https://example.com/tracker.png' },
      headers: origin,
    });
    expect(refused.status()).toBe(400);
    const session = await (await request.get('/api/auth/get-session')).json();
    expect(session.user.image ?? null).toBeNull();
  });

  test('take the picture away with the account', async ({ request }) => {
    await signedUpRequest(request);
    const kept = await request.put('/api/account/avatar', { ...put, data: png(16, 16, [1, 2, 3]) });
    const { image } = (await kept.json()) as { image: string };
    expect((await request.get(image)).status()).toBe(200);
    const deleted = await request.post('/api/auth/delete-user', { data: { password: PASSWORD }, headers: origin });
    expect(deleted.ok()).toBe(true);
    expect((await request.get(image)).status()).toBe(404);
  });
});
