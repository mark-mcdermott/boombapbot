import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  TRACK_IDS,
  bpmOf,
  debug,
  faceplate,
  faceplateIsCredited,
  hitCount,
  openEditor,
  project,
  selectTrack,
  stepButton,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the step buttons write the selected instrument', async ({ page }) => {
  const before = await project(page);
  const panel = page.getByTestId('panel');
  await expect(panel.locator('[data-panel-step]')).toHaveCount(16);
  // The selector starts on the bass drum.
  await expect(page.getByTestId('panel-voice-kick')).toHaveAttribute('aria-checked', 'true');

  await selectTrack(page, 'snare');
  expect(stepsOn(before, 'snare')).toEqual([4, 12]);
  await expect(stepButton(page, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepButton(page, 4)).toHaveAccessibleName('Snare Drum, step 5, on');
  await stepButton(page, 6).click();
  await stepButton(page, 4).click();
  await expect(stepButton(page, 6)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepButton(page, 4)).toHaveAttribute('aria-pressed', 'false');

  const after = await project(page);
  expect(stepsOn(after, 'snare')).toEqual([6, 12]);
  for (const track of TRACK_IDS.filter((id) => id !== 'snare')) {
    expect(stepsOn(after, track)).toEqual(stepsOn(before, track));
  }
  // Only Basic Rhythm 1 changed.
  expect(after.rhythms.slice(1)).toEqual(before.rhythms.slice(1));
  expect(after.rhythms[0]!.b).toEqual(before.rhythms[0]!.b);
});

test('the accent is a track of its own, and makes no sound when selected', async ({ page }) => {
  await selectTrack(page, 'accent');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  expect(stepsOn(await project(page), 'accent')).toEqual([0, 8]);
  await expect(stepButton(page, 8)).toHaveAttribute('aria-pressed', 'true');
  const hits = hitCount(await project(page));
  await stepButton(page, 4).click();
  const after = await project(page);
  expect(stepsOn(after, 'accent')).toEqual([0, 4, 8]);
  // An accent is not a hit.
  expect(hitCount(after)).toBe(hits);

  // Offline, the same hits fall on the same steps, and the new accent is marked.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(render.events).toHaveLength(hits);
  const accented = [...new Set(render.events.filter((event) => event.accent).map((event) => event.step))];
  expect(accented).toEqual([0, 4, 8]);
});

test('the panel runs the transport and sets tempo', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'false');

  const knob = page.getByTestId('panel-tempo');
  const bpm = Math.round(bpmOf(await project(page)));
  await expect(knob).toHaveAttribute('aria-valuenow', String(bpm));
  await knob.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  expect(bpmOf(await project(page))).toBeCloseTo(bpm + 11, 1);
  await expect(knob).toHaveAttribute('aria-valuenow', String(bpm + 11));
  await expect(knob).toHaveAttribute('aria-valuetext', `${bpm + 11} beats per minute`);
  // The machine runs from 40 to 300.
  await page.keyboard.press('End');
  expect(bpmOf(await project(page))).toBe(300);
  await page.keyboard.press('Home');
  expect(bpmOf(await project(page))).toBe(40);
});

test('the lamps show the steps that are on and follow the running step', async ({ page }) => {
  const panel = page.getByTestId('panel');
  const lamps = panel.locator('.sb-panel-led');
  await expect(lamps).toHaveCount(16);
  const kick = stepsOn(await project(page), 'kick');
  for (let index = 0; index < 16; index += 1) {
    await expect(lamps.nth(index)).toHaveAttribute('data-on', String(kick.includes(index)));
  }
  await expect(panel.locator('.sb-panel-led[data-now="true"]')).toHaveCount(0);

  await page.getByTestId('panel-toggle').click();
  const seen = new Set<number>();
  await expect
    .poll(
      async () => {
        const now = await lamps.evaluateAll((nodes) =>
          nodes.findIndex((node) => node.getAttribute('data-now') === 'true'),
        );
        if (now >= 0) seen.add(now);
        return seen.size;
      },
      { intervals: [40] },
    )
    .toBeGreaterThanOrEqual(6);
  await page.getByTestId('panel-toggle').click();
  await expect(panel.locator('.sb-panel-led[data-now="true"]')).toHaveCount(0);
});

test('a sound knob changes its own voice, in exports and while playing', async ({ page }) => {
  const decay = page.getByTestId('panel-knob-kick-decay');
  await expect(decay).toHaveAccessibleName('Bass Drum decay');
  await expect(decay).toHaveAttribute('aria-valuenow', '50');
  const before = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));

  // Keyboard: arrows, pages and the ends of its travel.
  await decay.focus();
  await page.keyboard.press('ArrowUp');
  await expect(decay).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('PageDown');
  await expect(decay).toHaveAttribute('aria-valuenow', '32');
  await page.keyboard.press('End');
  await expect(decay).toHaveAttribute('aria-valuenow', '100');
  await expect(decay).toHaveAttribute('aria-valuetext', '100%');
  expect((await project(page)).sound.knobs.kick!.decay).toBe(1);

  // A longer bass drum puts more energy into the same beat, on the same steps.
  const after = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(after.events).toEqual(before.events);
  expect(after.rms).toBeGreaterThan(before.rms * 1.1);

  // Dragging up turns it clockwise: half a unit per pixel.
  const tone = page.getByTestId('panel-knob-snare-tone');
  const box = (await tone.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  await expect(tone).toHaveAttribute('aria-valuenow', '80');

  // While the beat runs, a turned knob sends that one sound to the engine.
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  // All sixteen sounds are synthesised and taken when audio starts.
  await expect.poll(async () => (await debug(page)).soundsTaken).toBeGreaterThanOrEqual(16);
  const taken = (await debug(page)).soundsTaken;
  const snappy = page.getByTestId('panel-knob-snare-snappy');
  await snappy.focus();
  for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await debug(page)).soundsTaken).toBeGreaterThan(taken);
  await expect
    .poll(async () => {
      const snapshot = await debug(page);
      return snapshot.soundsSent - snapshot.soundsTaken;
    })
    .toBe(0);
  // Only the snare was sent again, however many presses there were.
  expect((await debug(page)).soundsTaken - taken).toBeLessThanOrEqual(5);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('every tuning, tone, decay and snappy knob on the panel turns', async ({ page }) => {
  const knobs = page.getByTestId('panel').locator('[data-testid^="panel-knob-"]');
  await expect(knobs).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const knob = knobs.nth(index);
    const [track, param] = (await knob.getAttribute('data-testid'))!.replace('panel-knob-', '').split('-') as [
      string,
      'tune' | 'tone' | 'decay' | 'snappy',
    ];
    await knob.focus();
    await page.keyboard.press('Home');
    expect((await project(page)).sound.knobs[track]![param]).toBe(0);
    await expect(knob).toHaveAttribute('aria-valuenow', '0');
  }
});

test('panel steps can be walked with the arrow keys', async ({ page }) => {
  await stepButton(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(stepButton(page, 1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(stepButton(page, 15)).toBeFocused();
  // Enter presses the step under focus.
  const before = stepsOn(await project(page), 'kick').includes(15);
  await page.keyboard.press('Enter');
  expect(stepsOn(await project(page), 'kick').includes(15)).toBe(!before);
});

test('every position of the selector programs its own track', async ({ page }) => {
  const panel = page.getByTestId('panel');
  const positions = panel.locator('[data-testid^="panel-voice-"]');
  await expect(positions).toHaveCount(TRACK_IDS.length);
  for (const track of TRACK_IDS) {
    await selectTrack(page, track);
    const before = await project(page);
    const target = Array.from({ length: 16 }, (_, index) => index).find(
      (index) => !stepsOn(before, track).includes(index),
    )!;
    await stepButton(page, target).click();
    const after = await project(page);
    expect(stepsOn(after, track)).toEqual([...stepsOn(before, track), target].sort((a, b) => a - b));
    for (const other of TRACK_IDS.filter((id) => id !== track)) {
      expect(stepsOn(after, other)).toEqual(stepsOn(before, other));
    }
  }
  expect((await project(page)).panel.selector).toBe(TRACK_IDS.length - 1);
});

test('the machine is its faceplate, with controls that stay inside it', async ({ page }) => {
  const panel = page.getByTestId('panel');
  // The panel is the faceplate image where the build ships one, and is drawn
  // from the same layout where it does not. Both must work.
  const image = await faceplate(page);
  await expect(panel).toHaveAttribute('data-photo', image ? 'photo' : 'drawn');
  if (image) {
    const photo = panel.locator('img.sb-panel-photo');
    await expect(photo).toHaveAttribute('src', new RegExp(`${image}$`));
    await expect
      .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    await expect(panel.locator('.sb-knob-photo')).not.toHaveCount(0);
    await expect(panel.locator('.sb-panel-key')).toHaveCount(0);
    // A photograph is shown with its credit. Artwork drawn for boombapbot has
    // nobody to credit.
    await expect(page.getByTestId('panel-credit')).toHaveCount(faceplateIsCredited() ? 1 : 0);
  } else {
    await expect(page.getByTestId('panel-credit')).toHaveCount(0);
    await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
  }

  // Nothing but the faceplate: the touch strip is for phones.
  await expect(page.getByTestId('strip-voice-snare')).toBeHidden();

  // Step areas stay inside the faceplate and do not overlap.
  const boxes = await panel.locator('[data-panel-step]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }),
  );
  boxes.forEach((box, index) => {
    expect(box.width).toBeGreaterThan(20);
    expect(box.height).toBeGreaterThan(20);
    if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
  });
});

test('a faceplate image that fails to load falls back to the drawn panel', async ({ page }) => {
  const image = await faceplate(page);
  test.skip(!image, 'this build ships no faceplate image');
  // The editor opens on the faceplate, so fail the image on a fresh load.
  await page.route(`**/${image}`, (route) => route.abort());
  await page.reload();
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'drawn');
  await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
  await stepButton(page, 3).click();
  await expect(stepButton(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY)).toBe(true);
});
