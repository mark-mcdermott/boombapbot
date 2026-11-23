import { expect, test } from '@playwright/test';
import { closeSettings, openSettings } from '../helpers';
import { beat, emptyPattern, openMachine, step, stepsOn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openMachine(page);
});

test('the machine is its picture, with every control inside it', async ({ page }) => {
  const frame = (await page.getByTestId('panel').boundingBox())!;
  expect(frame.width / frame.height).toBeCloseTo(2000 / 1333, 2);
  const controls = page.locator('.rt-key, .rt-knob');
  expect(await controls.count()).toBe(38 + 16);
  for (const box of await controls.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.left).toBeGreaterThanOrEqual(frame.x - 1);
    expect(box.top).toBeGreaterThanOrEqual(frame.y - 1);
    expect(box.right).toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
  // The picture and every piece laid over it came from this build.
  const images = await page.locator('.rt-stage > .rt-plate, .rt-stage > .rt-patch').evaluateAll((nodes) =>
    nodes.map((node) => ({ src: (node as HTMLImageElement).src, loaded: (node as HTMLImageElement).naturalWidth > 0 })),
  );
  expect(images.length).toBe(7 + 8 + 1);
  expect(images.every((image) => image.loaded && image.src.includes('/machines/ritm12/'))).toBe(true);
  // Each instrument key wears its drawing, whatever the controls are set to.
  const drawings = page.locator('.rt-stage > .rt-patch[src*="/patch/key-"]');
  await expect(drawings).toHaveCount(8);
  for (const drawing of await drawings.all()) await expect(drawing).toBeVisible();
});

test('step keys put hits of the selected instrument on and take them off', async ({ page }) => {
  await emptyPattern(page);
  await page.getByTestId('voice-tom').click();
  await step(page, 1).click();
  await step(page, 7).click();
  await expect(step(page, 7)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 7)).toHaveAccessibleName('Tom, step 7, on');
  expect(stepsOn((await beat(page)).patterns[2]!.steps.tom)).toEqual([1, 7]);
  await step(page, 1).click();
  expect(stepsOn((await beat(page)).patterns[2]!.steps.tom)).toEqual([7]);
  // The keys show the instrument that is selected.
  await page.getByTestId('voice-rim').click();
  await expect(step(page, 7)).toHaveAttribute('aria-pressed', 'false');
  // Undo takes back one key at a time.
  await page.keyboard.press('ControlOrMeta+z');
  expect(stepsOn((await beat(page)).patterns[2]!.steps.tom)).toEqual([1, 7]);
});

test('the write switch turns the step keys to accents, and shows its other picture', async ({ page }) => {
  await emptyPattern(page);
  const patch = page.locator('.rt-stage > .rt-patch[src*="write-accents"]');
  await expect(patch).toBeHidden();
  await page.getByTestId('write').click();
  await expect(patch).toBeVisible();
  await step(page, 5).click();
  const now = await beat(page);
  expect(now.panel.write).toBe('accents');
  expect(stepsOn(now.patterns[2]!.accents)).toEqual([5]);
  await expect(step(page, 5)).toHaveAccessibleName('Accent, step 5, on');
  await expect(step(page, 5)).toHaveAttribute('data-red', 'true');
});

test('the size switch leaves the last four steps out of a twelve-step measure', async ({ page }) => {
  await emptyPattern(page);
  await page.getByTestId('size').click();
  expect((await beat(page)).size).toBe(12);
  await expect(step(page, 13)).toHaveAttribute('aria-disabled', 'true');
  await expect(step(page, 13)).toHaveAttribute('data-unused', 'true');
  await step(page, 13).click({ force: true });
  await step(page, 12).click();
  expect(stepsOn((await beat(page)).patterns[2]!.steps.kick)).toEqual([12]);
});

test('the effect selector steps through its four positions and the mix knob adds it', async ({ page }) => {
  const seen: string[] = [];
  for (let press = 0; press < 4; press += 1) {
    await page.getByTestId('effect').click();
    seen.push((await beat(page)).effect.kind);
  }
  expect(seen).toEqual(['reverb', 'flanger', 'chorus', 'delay']);
  await expect(page.locator('.rt-stage > .rt-patch[src*="effect-delay"]')).toBeVisible();
  const mix = page.getByTestId('mix');
  await mix.focus();
  await page.keyboard.press('PageUp');
  await expect(mix).toHaveAttribute('aria-valuetext', '20%');
  expect((await beat(page)).effect.mix).toBeCloseTo(0.2, 5);
});

test('knobs turn by keyboard and by dragging, and say where they stand', async ({ page }) => {
  const tempo = page.getByTestId('tempo');
  await tempo.focus();
  await page.keyboard.press('End');
  await expect(tempo).toHaveAttribute('aria-valuetext', '300 beats a minute');
  await page.keyboard.press('Home');
  expect((await beat(page)).tempo).toBe(40);
  await expect(page.getByTestId('spoken')).toHaveText('Tempo: 40 beats a minute');

  const volume = page.getByTestId('volume');
  await volume.scrollIntoViewIfNeeded();
  const box = (await volume.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 300, { steps: 6 });
  await page.mouse.up();
  expect((await beat(page)).mix.volume).toBe(1);
  await volume.dblclick();
  expect((await beat(page)).mix.volume).toBe(0.8);

  // The voice knobs belong to the instrument that is selected.
  await page.getByTestId('voice-perc').click();
  await page.getByTestId('pitch').focus();
  await page.keyboard.press('ArrowUp');
  const now = await beat(page);
  expect(now.voices.perc.pitch).toBeCloseTo(0.52, 5);
  expect(now.voices.kick.pitch).toBe(0.5);
  await expect(page.getByTestId('pitch')).toHaveAccessibleName('Perc pitch');
});

test('the status readout has a box of its own, and says in English what a control is or did', async ({ page }) => {
  const readout = page.getByTestId('readout');
  const screen = (await page.getByTestId('screen').boundingBox())!;
  const needle = (await page.locator('.rt-meter').boundingBox())!;
  const strip = (await readout.boundingBox())!;
  // Its box is under the level meter's, clear of the screen and its frame, and is lettered with its name.
  expect(strip.x + strip.width).toBeLessThan(screen.x);
  expect(strip.y).toBeGreaterThan(needle.y + needle.height);
  expect(Math.abs(strip.x + strip.width / 2 - (needle.x + needle.width / 2))).toBeLessThanOrEqual(3);
  await expect(page.getByTestId('readout-name')).toHaveText('СТАТУС');
  await expect(page.locator('.rt-stage > .rt-patch[src*="/patch/status"]')).toBeVisible();

  // Left alone, it says where the machine stands rather than going blank.
  await expect(readout).toHaveAttribute('data-shown', /^PATTERN A {2}KICK {2}\d+ BPM$/);

  await page.getByTestId('voice-clap').click();
  await expect(readout).toHaveAttribute('data-text', 'Clap selected');
  await expect(page.getByTestId('spoken')).toHaveText('Clap selected');

  // Reached by keyboard, a control puts its name up for as long as it has the focus.
  await page.getByTestId('step-1').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-2')).toBeFocused();
  await expect(readout).toHaveAttribute('data-text', /^Clap, step 2, (on|off)$/);
});

test('the picture can be lettered in English, and stays so', async ({ page }) => {
  await expect(page.getByTestId('plate-labels')).toHaveCount(0);
  await openSettings(page);
  await page.getByTestId('lettering-english').click();
  await expect(page.getByTestId('lettering-english')).toHaveAttribute('aria-checked', 'true');
  await closeSettings(page);

  const labels = page.getByTestId('plate-labels');
  await expect(labels).toBeVisible();
  await expect(labels).toHaveAttribute('aria-hidden', 'true');
  await expect(labels.getByText('SEQUENCER', { exact: true })).toBeVisible();
  await expect(page.getByTestId('voice-kick')).toHaveAccessibleName('Kick');
  // The labels are for the eye: every control is still within reach.
  await page.getByTestId('voice-tom').click();
  expect((await beat(page)).panel.selected).toBe('tom');

  await page.reload();
  await expect(page.getByTestId('plate-labels')).toBeVisible();
  await openSettings(page);
  await page.getByTestId('lettering-russian').click();
  await closeSettings(page);
  await expect(page.getByTestId('plate-labels')).toHaveCount(0);
  await expect(page.getByTestId('voice-kick')).toHaveAccessibleName('Kick (БАС)');
});

test('scrolling the page over the machine does not turn a knob', async ({ page }) => {
  const before = await beat(page);
  const box = (await page.getByTestId('tempo').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  expect((await beat(page)).tempo).toBe(before.tempo);
});

test('mute, dice and clear work on what is selected', async ({ page }) => {
  await emptyPattern(page);
  await page.getByTestId('voice-snare').click();
  await page.getByTestId('mute').click();
  await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
  expect((await beat(page)).mix.mutes).toMatchObject({ snare: true, kick: false });
  await page.getByTestId('mute').click();

  await page.getByTestId('dice').click();
  await page.getByTestId('dice').click();
  const rolled = (await beat(page)).patterns[2]!;
  expect(stepsOn(rolled.steps.kick)).toEqual([]);
  await page.getByTestId('clear-pattern').click();
  expect(stepsOn((await beat(page)).patterns[2]!.steps.snare)).toEqual([]);
  // The first pattern was never touched.
  expect(stepsOn((await beat(page)).patterns[0]!.steps.kick).length).toBeGreaterThan(0);
});

test('switched off, the machine is dark and its controls are out of reach', async ({ page }) => {
  await page.getByTestId('power').click();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'off');
  await expect(page.locator('.rt-stage > .rt-patch[src*="power-on"]')).toBeHidden();
  await expect(page.locator('.rt-controls')).toHaveAttribute('inert', '');
  const before = await beat(page);
  await step(page, 2).click({ force: true });
  expect(await beat(page)).toEqual(before);
  await page.getByTestId('power').click();
  await expect(page.locator('.rt-stage > .rt-patch[src*="power-on"]')).toBeVisible();
});

test('the desk lamp switches the room dark and lit again, and stays as it was left', async ({ page }) => {
  const lamp = page.getByRole('button', { name: 'Desk lamp' });
  const night = page.getByTestId('night');
  await expect(lamp).toHaveAttribute('aria-pressed', 'true');
  await expect(night).toHaveCSS('opacity', '0');

  await lamp.click();
  await expect(lamp).toHaveAttribute('aria-pressed', 'false');
  await expect(night).toHaveCSS('opacity', '1');
  // The dark room is the same picture and the same pieces, each over its lit one.
  const pictures = (within: string) =>
    page.locator(`${within} > .rt-plate, ${within} > .rt-patch`).evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return {
          file: (node as HTMLImageElement).src.split('/machines/ritm12/')[1]!.replace(/^night\//, ''),
          loaded: (node as HTMLImageElement).naturalWidth > 0,
          shown: getComputedStyle(node).visibility === 'visible',
          box: [x, y, width, height].map(Math.round),
        };
      }),
    );
  const dark = await pictures('[data-testid="night"]');
  expect(dark).toEqual(await pictures('.rt-stage'));
  expect(dark.every((picture) => picture.loaded)).toBe(true);
  // What the machine lights itself is not dimmed with the room.
  await expect(page.getByTestId('power')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByTestId('plate')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desk lamp' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('night')).toHaveCSS('opacity', '1');

  await page.getByRole('button', { name: 'Desk lamp' }).click();
  await expect(page.getByTestId('night')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => localStorage.getItem('boombapbot.ritm12.desk-lamp'))).toBeNull();
});
