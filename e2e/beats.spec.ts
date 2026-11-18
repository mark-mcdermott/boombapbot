import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { ROW_ID, UUID, signedUp, signedUpRequest } from './account';
import { ACCOUNTS_URL } from './accounts-server';
import { project, selectTrack, stepButton, stepsOn, type ProjectSnapshot } from './helpers';

// Beats saved to an account. Like the accounts tests these run against the
// built server, with its database in memory.

const FIXTURE = 'packages/machine-808/fixtures/mixed-rhythms.project.json';
const LIMIT = 20;
const MAX_BYTES = 64 * 1024;

interface Saved {
  id: string;
  name: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

const fixture = (name = 'Fixture beat') => ({ ...JSON.parse(readFileSync(FIXTURE, 'utf8')), name }) as ProjectSnapshot;

const post = (request: APIRequestContext, body: unknown) => request.post('/api/beats', { data: body });

async function saved(response: APIResponse): Promise<Saved> {
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { beat: Saved }).beat;
}

async function listed(request: APIRequestContext): Promise<Saved[]> {
  return ((await (await request.get('/api/beats')).json()) as { beats: Saved[] }).beats;
}

async function stored(request: APIRequestContext, id: string): Promise<{ beat: Saved; project: ProjectSnapshot }> {
  return (await request.get(`/api/beats/${id}`)).json();
}

/** Saves the beat on the machine through the modal, which must be open. */
async function saveFromMachine(page: Page, name = 'Starter beat'): Promise<void> {
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-said')).toHaveText(`Saved “${name}” to your account.`);
}

async function closeAccount(page: Page): Promise<void> {
  await page.getByTestId('account-close').click();
  await expect(page.getByTestId('account-modal')).toHaveCount(0);
}

async function reopenAccount(page: Page): Promise<void> {
  await page.getByTestId('account').click();
  await expect(page.getByTestId('beats')).toBeVisible();
}

/** Changes the beat on the machine: one more step on the high tom. */
async function addHighTom(page: Page, step: number): Promise<void> {
  await selectTrack(page, 'high_tom');
  await stepButton(page, step).click();
}

test('a beat is saved to the account, listed there, and loaded back onto the machine', async ({ page }) => {
  await signedUp(page);
  await expect(page.getByTestId('beats-count')).toHaveText(`0 of ${LIMIT}`);
  await expect(page.getByTestId('beats-empty')).toContainText('Nothing saved yet');
  await expect(page.getByTestId('beats-save-hint')).toContainText('This puts a copy of “Starter beat” in your account');
  const atSave = await project(page);

  await saveFromMachine(page);
  await expect(page.getByTestId('beats-count')).toHaveText(`1 of ${LIMIT}`);
  await expect(page.getByTestId('beats-empty')).toHaveCount(0);
  const row = page.getByTestId('beat');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('beat-name-saved')).toHaveText('Starter beat');
  await expect(row).toContainText(/Saved .+ · \d+ KB/);

  // What the account holds is the project the machine had.
  const [beat] = await listed(page.request);
  expect((await stored(page.request, beat!.id)).project.rhythms).toEqual(atSave.rhythms);

  // Change the machine, then load the saved copy over it.
  await closeAccount(page);
  await addHighTom(page, 2);
  const changed = await project(page);
  expect(stepsOn(changed, 'high_tom')).toContain(2);

  await reopenAccount(page);
  await row.getByTestId('beat-load').click();
  await expect(page.getByTestId('account-modal')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toContainText(
    'Loaded “Starter beat” from your account. Undo brings back the previous beat.',
  );
  const loaded = await project(page);
  expect(loaded.rhythms).toEqual(atSave.rhythms);
  expect(loaded.rhythmTracks).toEqual(atSave.rhythmTracks);
  expect(loaded.sound).toEqual(atSave.sound);

  // Loading is one undo step, as an import is.
  await page.keyboard.press('Control+z');
  expect(await project(page)).toEqual(changed);

  // It is in the account, not only on this page.
  await page.reload();
  await reopenAccount(page);
  await expect(page.getByTestId('beat')).toHaveCount(1);
});

test('saving again replaces the same beat, and asks first when the copy in the account is newer', async ({ page }) => {
  await signedUp(page);
  await saveFromMachine(page);
  await expect(page.getByTestId('beats-save-hint')).toContainText('This replaces “Starter beat”');
  await expect(page.getByTestId('beat')).toHaveAttribute('aria-current', 'true');
  const [first] = await listed(page.request);

  // Saved again from this device, nothing asked: it is the same beat, changed.
  await closeAccount(page);
  await addHighTom(page, 2);
  await reopenAccount(page);
  await saveFromMachine(page);
  await expect(page.getByTestId('beats-conflict')).toHaveCount(0);
  await expect(page.getByTestId('beats-count')).toHaveText(`1 of ${LIMIT}`);
  const [second] = await listed(page.request);
  expect(second!.id).toBe(first!.id);
  expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
  const mine = await stored(page.request, second!.id);
  expect(stepsOn(mine.project, 'high_tom')).toContain(2);

  // Another device saves over it.
  await saved(
    await page.request.put(`/api/beats/${second!.id}`, {
      data: { project: { ...mine.project, name: 'From my other device' }, lastSeen: second!.updatedAt },
    }),
  );

  // Now this device is behind, so its save is held back and the page asks.
  await page.getByTestId('beats-save').click();
  const question = page.getByTestId('beats-conflict');
  await expect(question).toContainText('“From my other device” in your account was saved');
  await expect(question).toContainText('after the copy this device last had');
  await expect(page.getByTestId('beats-keep-cloud')).toBeFocused();
  expect((await stored(page.request, second!.id)).beat.name).toBe('From my other device');

  // Keeping the cloud copy changes nothing there.
  await page.getByTestId('beats-keep-cloud').click();
  await expect(question).toHaveCount(0);
  await expect(page.getByTestId('beats-said')).toContainText('I left the copy in your account as it is');
  expect((await stored(page.request, second!.id)).beat.name).toBe('From my other device');

  // Asked again, and this time told to replace it.
  await page.getByTestId('beats-save').click();
  await page.getByTestId('beats-replace').click();
  await expect(page.getByTestId('beats-said')).toHaveText('Saved “Starter beat” to your account.');
  await expect(question).toHaveCount(0);
  const replaced = await stored(page.request, second!.id);
  expect(replaced.beat.name).toBe('Starter beat');
  expect(stepsOn(replaced.project, 'high_tom')).toContain(2);
  await expect(page.getByTestId('beats-count')).toHaveText(`1 of ${LIMIT}`);

  // This device is up to date again, so the next save is not questioned.
  await saveFromMachine(page);
  await expect(question).toHaveCount(0);

  // The same beat can also be saved as a second one.
  await page.getByTestId('beats-save-new').click();
  await expect(page.getByTestId('beats-count')).toHaveText(`2 of ${LIMIT}`);
  await expect(page.getByTestId('beat')).toHaveCount(2);
});

test('a saved beat is deleted only once the question is answered', async ({ page }) => {
  await signedUp(page);
  await saveFromMachine(page);
  const row = page.getByTestId('beat');

  await row.getByTestId('beat-delete').click();
  await expect(row).toContainText('Delete it for good?');
  await expect(row.getByTestId('beat-delete-cancel')).toBeFocused();
  await row.getByTestId('beat-delete-cancel').click();
  await expect(row.getByTestId('beat-delete')).toBeFocused();
  expect(await listed(page.request)).toHaveLength(1);

  await row.getByTestId('beat-delete').click();
  await row.getByTestId('beat-delete-confirm').click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('beats-said')).toHaveText('Deleted “Starter beat” from your account.');
  await expect(page.getByTestId('beats-empty')).toBeVisible();
  await expect(page.getByTestId('beats-count')).toHaveText(`0 of ${LIMIT}`);
  expect(await listed(page.request)).toHaveLength(0);

  // The machine still has its beat, and saving it now makes a new one.
  expect((await project(page)).name).toBe('Starter beat');
  await expect(page.getByTestId('beats-save-hint')).toContainText('This puts a copy');
  await saveFromMachine(page);
  await expect(page.getByTestId('beat')).toHaveCount(1);
});

test('an account holds twenty beats, and says so when it is full', async ({ page }) => {
  await signedUp(page);
  await expect(page.getByTestId('beats-count')).toHaveText(`0 of ${LIMIT}`);
  const onMachine = await project(page);
  for (let number = 1; number <= LIMIT; number += 1) {
    expect((await post(page.request, { project: { ...onMachine, name: `Beat ${number}` } })).status()).toBe(201);
  }

  // The server refuses the next one, in words a person can act on.
  const refused = await post(page.request, { project: onMachine });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({
    code: 'limit',
    message: `Your account is full: it holds ${LIMIT} beats. Delete one to save another.`,
  });
  expect(await listed(page.request)).toHaveLength(LIMIT);

  // The modal was opened before the account filled up, and shows what the server said as it said it.
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-problem')).toHaveText(
    `Your account is full: it holds ${LIMIT} beats. Delete one to save another.`,
  );

  // Opened again it knows, and does not offer a save that cannot work.
  await closeAccount(page);
  await reopenAccount(page);
  await expect(page.getByTestId('beats-count')).toHaveText(`${LIMIT} of ${LIMIT}`);
  await expect(page.getByTestId('beat')).toHaveCount(LIMIT);
  await expect(page.getByTestId('beats-save')).toBeDisabled();
  await expect(page.getByTestId('beats-save-hint')).toHaveText(
    `Your account is full: it holds ${LIMIT} beats. Delete one to save another.`,
  );

  // Deleting one makes room.
  const newest = page.getByTestId('beat').first();
  await expect(newest.getByTestId('beat-name-saved')).toHaveText(`Beat ${LIMIT}`);
  await newest.getByTestId('beat-delete').click();
  await newest.getByTestId('beat-delete-confirm').click();
  await expect(page.getByTestId('beats-count')).toHaveText(`${LIMIT - 1} of ${LIMIT}`);
  await expect(page.getByTestId('beats-save')).toBeEnabled();
  await saveFromMachine(page);
  await expect(page.getByTestId('beats-count')).toHaveText(`${LIMIT} of ${LIMIT}`);
});

test('a beat over 64 KB is refused, and so is anything that is not a project', async ({ page }) => {
  await signedUp(page);
  const onMachine = await project(page);
  const tooLarge = {
    code: 'too_large',
    message: 'That beat is too large to save. I can keep beats up to 64 KB each.',
  };

  // Just over the limit once the project is weighed, and far over it.
  const weight = Buffer.byteLength(JSON.stringify({ ...onMachine, padding: '' }));
  for (const padding of [MAX_BYTES - weight + 1, 400_000]) {
    const refused = await post(page.request, { project: { ...onMachine, padding: 'x'.repeat(padding) } });
    expect(refused.status(), String(padding)).toBe(413);
    expect(await refused.json()).toEqual(tooLarge);
  }
  // Right at the limit it is weighed, found to fit, and saved without the padding the schema does not know.
  const fits = await saved(
    await post(page.request, { project: { ...onMachine, padding: 'x'.repeat(MAX_BYTES - weight) } }),
  );
  expect(fits.bytes).toBeLessThan(MAX_BYTES);
  expect((await stored(page.request, fits.id)).project).not.toHaveProperty('padding');
  expect((await page.request.delete(`/api/beats/${fits.id}`)).ok()).toBe(true);

  const notProjects: unknown[] = [
    { project: { format: 'something.else' } },
    { project: { ...onMachine, rhythms: [] } },
    { project: 'a beat' },
    {},
    'not json at all',
  ];
  for (const body of notProjects) {
    const refused = await post(page.request, body);
    expect(refused.status(), JSON.stringify(body)).toBe(400);
    expect(await refused.json()).toEqual({
      code: 'invalid',
      message: 'That is not a boombapbot project, so I did not save it.',
    });
  }
  expect(await listed(page.request)).toHaveLength(0);

  // The machine cannot make a beat that large, so the page's save is padded on its way out.
  await page.route('**/api/beats', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.continue({ postData: JSON.stringify({ project: { ...onMachine, padding: 'x'.repeat(MAX_BYTES) } }) });
  });
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-problem')).toHaveText(tooLarge.message);
  await expect(page.getByTestId('beats-save')).toBeEnabled();
  await expect(page.getByTestId('beat')).toHaveCount(0);
});

test('beats on a page of words point back to the machine', async ({ page }) => {
  await signedUp(page);
  await page.goto('/about');
  await page.getByTestId('account').click();
  const elsewhere = page.getByTestId('beats-elsewhere');
  await expect(elsewhere).toContainText('Saving and loading beats happens beside the machine.');
  await expect(elsewhere.getByRole('link', { name: 'Go to the machine' })).toHaveAttribute('href', '/');
  await expect(page.getByTestId('beats-save')).toHaveCount(0);
});

test('the machine carries on when the account server stops answering', async ({ page }) => {
  await signedUp(page);
  await saveFromMachine(page);

  // Logged in, the page still asks for no beats until the modal is opened.
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/beats')) asked.push(request.method());
  });
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('account')).toHaveAccessibleName('Account, logged in');
  await addHighTom(page, 2);
  expect(asked).toEqual([]);

  // The server goes away. The list says so and offers to try again.
  await page.route('**/api/beats**', (route) => route.abort());
  await page.getByTestId('account').click();
  await expect(page.getByTestId('beats-failed')).toContainText('I could not reach the server');
  await expect(page.getByTestId('beats-save')).toBeDisabled();
  await closeAccount(page);

  // The machine is untouched by any of it: it edits, keeps its draft and plays.
  await addHighTom(page, 5);
  const onMachine = await project(page);
  expect(stepsOn(onMachine, 'high_tom')).toEqual(expect.arrayContaining([2, 5]));
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect((await project(page)).rhythms).toEqual(onMachine.rhythms);
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await page.getByTestId('panel-toggle').click();

  // It comes back, and trying again shows the beats.
  await page.unroute('**/api/beats**');
  await page.getByTestId('account').click();
  await expect(page.getByTestId('beat')).toHaveCount(1);

  // A save that cannot get through says so and changes nothing.
  await page.route('**/api/beats**', (route) => route.abort());
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-problem')).toHaveText(
    'I could not reach the server. Check your connection and try again.',
  );
  await expect(page.getByTestId('beat')).toHaveCount(1);
  await page.unroute('**/api/beats**');
  await saveFromMachine(page);
});

test('the saved beats have no detectable accessibility violations', async ({ page }) => {
  await signedUp(page);
  const modal = page.getByTestId('account-modal');
  const scan = async () => {
    await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    return (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id);
  };
  // Empty.
  await expect(page.getByTestId('beats-empty')).toBeVisible();
  expect(await scan()).toEqual([]);

  // A list, with what was just done said under the button.
  await saveFromMachine(page);
  const [beat] = await listed(page.request);
  await post(page.request, { project: { ...(await project(page)), name: 'A second beat' } });
  await closeAccount(page);
  await reopenAccount(page);
  await expect(page.getByTestId('beat')).toHaveCount(2);
  expect(await scan()).toEqual([]);

  // The question before deleting.
  await page.getByTestId('beat').first().getByTestId('beat-delete').click();
  await expect(page.getByTestId('beat-delete-confirm')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.getByTestId('beat-delete-cancel').click();

  // The question when the copy in the account is newer.
  const mine = await stored(page.request, beat!.id);
  await saved(
    await page.request.put(`/api/beats/${beat!.id}`, { data: { project: mine.project, lastSeen: mine.beat.updatedAt } }),
  );
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-conflict')).toBeVisible();
  expect(await scan()).toEqual([]);
});

test.describe('what the server answers about beats', () => {
  test('nothing without a session', async ({ request }) => {
    const id = '00000000-0000-4000-8000-000000000000';
    const attempts = [
      request.get('/api/beats'),
      post(request, { project: fixture() }),
      request.get(`/api/beats/${id}`),
      request.put(`/api/beats/${id}`, { data: { project: fixture(), lastSeen: new Date().toISOString() } }),
      request.delete(`/api/beats/${id}`),
    ];
    for (const attempt of attempts) {
      const answer = await attempt;
      expect(answer.status(), answer.url()).toBe(401);
      expect(await answer.json()).toEqual({ code: 'signed_out', message: 'Log in to save beats to your account.' });
    }
  });

  test('one account cannot read, change or delete another’s beats', async ({ playwright }) => {
    const mine = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
    const theirs = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
    await signedUpRequest(mine);
    await signedUpRequest(theirs);
    const beat = await saved(await post(mine, { project: fixture('Mine alone') }));
    const notFound = { code: 'not_found', message: 'That beat is not in your account.' };

    expect(await listed(theirs)).toEqual([]);
    const attempts = [
      theirs.get(`/api/beats/${beat.id}`),
      theirs.put(`/api/beats/${beat.id}`, {
        data: { project: fixture('Taken over'), lastSeen: beat.updatedAt, overwrite: true },
      }),
      theirs.delete(`/api/beats/${beat.id}`),
    ];
    for (const attempt of attempts) {
      const answer = await attempt;
      // Answered exactly as a beat that does not exist, so it cannot be probed for.
      expect(answer.status(), answer.url()).toBe(404);
      expect(await answer.json()).toEqual(notFound);
    }
    const missing = await mine.get('/api/beats/00000000-0000-4000-8000-000000000000');
    expect([missing.status(), await missing.json()]).toEqual([404, notFound]);
    expect((await mine.get('/api/beats/not-a-uuid')).status()).toBe(404);
    expect((await mine.get('/api/beats/1')).status()).toBe(404);

    // It is still there, untouched, for the account that saved it.
    expect(await listed(mine)).toEqual([beat]);
    expect((await stored(mine, beat.id)).project.name).toBe('Mine alone');
    await mine.dispose();
    await theirs.dispose();
  });

  test('a replace is held back when the copy in the account is newer, unless told to overwrite', async ({ request }) => {
    await signedUpRequest(request);
    const first = await saved(await post(request, { project: fixture('First') }));
    const put = (body: Record<string, unknown>) => request.put(`/api/beats/${first.id}`, { data: body });

    const second = await saved(await put({ project: fixture('Second'), lastSeen: first.updatedAt }));
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));

    // A device that last saw the first copy is behind now.
    const held = await put({ project: fixture('Behind'), lastSeen: first.updatedAt });
    expect(held.status()).toBe(409);
    expect(await held.json()).toEqual({
      code: 'conflict',
      message: 'The copy in your account was saved after the one on this device.',
      updatedAt: second.updatedAt,
    });
    expect((await stored(request, first.id)).beat).toEqual(second);

    const forced = await saved(await put({ project: fixture('Behind'), lastSeen: first.updatedAt, overwrite: true }));
    expect(forced.name).toBe('Behind');
    expect((await stored(request, first.id)).project.name).toBe('Behind');

    // A replace has to say what it last saw.
    expect((await put({ project: fixture() })).status()).toBe(400);
    expect((await put({ project: fixture(), lastSeen: 'a while ago' })).status()).toBe(400);
  });

  test('row ids never leave it: a beat is known outside by its uuid', async ({ request }) => {
    await signedUpRequest(request);
    const created = await post(request, { project: fixture() });
    const beat = await saved(created);
    expect(beat.id).toMatch(UUID);
    expect(Object.keys(beat).sort()).toEqual(['bytes', 'createdAt', 'id', 'name', 'updatedAt']);

    const answers = [
      await request.get('/api/beats'),
      await request.get(`/api/beats/${beat.id}`),
      await request.put(`/api/beats/${beat.id}`, { data: { project: fixture(), lastSeen: beat.updatedAt } }),
      await request.put(`/api/beats/${beat.id}`, { data: { project: fixture(), lastSeen: beat.createdAt } }),
      await request.delete(`/api/beats/${beat.id}`),
      await request.get(`/api/beats/${beat.id}`),
    ];
    expect(answers.map((answer) => answer.status())).toEqual([200, 200, 200, 409, 200, 404]);
    for (const answer of [created, ...answers]) {
      const text = await answer.text();
      expect(text, answer.url()).not.toMatch(ROW_ID);
      expect(text, answer.url()).not.toMatch(/"(uuid|userId|user_id)"/);
    }
  });
});
