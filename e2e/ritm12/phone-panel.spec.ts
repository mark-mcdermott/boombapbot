import { expect, test, type Page } from '@playwright/test';
import { closeSettings, openSettings, scanner } from '../helpers';
import { beat, holdTheRender, step, stepsOn } from './helpers';

// A screen as narrow as a phone's gets the phone's panel. These run on a phone-sized touch screen.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  // Firefox cannot pretend to be a phone; there this is a touch screen of a phone's size.
  isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'),
});

async function openPhonePanel(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-view', 'phone');
}

test('a phone gets the phone’s panel in place of the picture, with every part of it', async ({ page }) => {
  await openPhonePanel(page);
  await expect(page.getByTestId('plate')).toHaveCount(0);
  // It has its own keys for what the strip, the fit button and the dock stood in for.
  await expect(page.locator('.rt-touch')).toHaveCount(0);
  await expect(page.getByTestId('dock-play')).toBeHidden();
  const panel = (await page.getByTestId('panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Every part came from this build, and arrives.
  const parts = () =>
    page.getByTestId('panel').locator('img').evaluateAll((nodes) =>
      nodes.map((node) => ({ src: (node as HTMLImageElement).src, loaded: (node as HTMLImageElement).naturalWidth > 0 })),
    );
  await expect.poll(async () => (await parts()).filter((part) => !part.loaded).length).toBe(0);
  expect((await parts()).length).toBeGreaterThan(20);
  expect((await parts()).every((part) => part.src.includes('/machines/ritm12/phone/'))).toBe(true);
});

test('the panel follows the screen’s width and keeps the beat, and the address can ask for either one', async ({ page }) => {
  await openPhonePanel(page);
  await page.getByTestId('pattern-3').click();
  await page.getByTestId('voice-tom').click();
  await step(page, 6).click();

  // Wider than a tablet held upright: the picture, with the same beat on it.
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByTestId('plate')).toBeVisible();
  await expect(page.getByTestId('panel')).not.toHaveAttribute('data-view', 'phone');
  await expect(step(page, 6)).toHaveAttribute('aria-pressed', 'true');
  expect(stepsOn((await beat(page)).patterns[2]!.steps.tom)).toEqual([6]);

  // A tablet held upright gets the phone's panel, grown to use the room.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId('panel')).toHaveAttribute('data-view', 'phone');
  await expect(step(page, 6)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await page.getByTestId('panel').boundingBox())!.width).toBeGreaterThan(540);
  expect((await step(page, 6).boundingBox())!.width).toBeGreaterThanOrEqual(48);

  // Asked for by name, either view shows at any width.
  await page.goto('/?panel=picture');
  await expect(page.getByTestId('plate')).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/?panel=phone');
  await expect(page.getByTestId('panel')).toHaveAttribute('data-view', 'phone');
  await expect(page.getByTestId('plate')).toHaveCount(0);
});

test('every key of the phone’s panel is large enough for a thumb', async ({ page }) => {
  await openPhonePanel(page);
  const keys = page.getByTestId('panel').locator('.rt-ph-key:not(.rt-ph-switch):not(.rt-ph-pick), .rt-ph-tab, .rt-ph-knob');
  expect(await keys.count()).toBe(8 + 16 + 4 + 2 + 3 + 1 + 1 + 3 + 4);
  for (const box of await keys.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(38);
  }
});

test('on the phone’s panel a voice is chosen, its steps and accents are written, and the pattern plays', async ({ page }) => {
  await openPhonePanel(page);
  await page.getByTestId('pattern-3').click();
  await page.getByTestId('voice-snare').click();
  expect((await beat(page)).panel.selected).toBe('snare');
  await expect(page.getByTestId('voice-snare')).toHaveAttribute('aria-pressed', 'true');
  await step(page, 5).click();
  await step(page, 13).click();
  await expect(step(page, 13)).toHaveAccessibleName('Snare, step 13, on');
  expect(stepsOn((await beat(page)).patterns[2]!.steps.snare)).toEqual([5, 13]);

  // The knob lies flat: left, at the hits, and once pressed right, at the accents.
  // Its line is painted 65 degrees round from straight up; where that ends up is where it points.
  const knob = page.getByTestId('write').locator('.rt-ph-turn');
  const pointing = () =>
    knob.evaluate((node) => {
      const painted = (65 * Math.PI) / 180;
      const { x, y } = new DOMMatrix(getComputedStyle(node).transform).transformPoint({ x: Math.sin(painted), y: -Math.cos(painted) });
      return { x, y };
    });
  const left = await pointing();
  expect(left.x).toBeCloseTo(-1, 2);
  expect(left.y).toBeCloseTo(0, 2);

  await page.getByTestId('write').click();
  const right = await pointing();
  expect(right.x).toBeCloseTo(1, 2);
  expect(right.y).toBeCloseTo(0, 2);
  await step(page, 1).click();
  const written = await beat(page);
  expect(written.panel.write).toBe('accents');
  expect(stepsOn(written.patterns[2]!.accents)).toEqual([1]);
  await expect(step(page, 1)).toHaveAttribute('data-red', 'true');
  await expect(page.getByTestId('spoken')).toHaveText('Step keys write accents');

  await page.getByTestId('mute').click();
  expect((await beat(page)).mix.mutes.snare).toBe(true);
  await page.getByTestId('clear-pattern').click();
  expect(stepsOn((await beat(page)).patterns[2]!.steps.snare)).toEqual([]);

  await page.getByTestId('play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('the knobs of the phone’s panel are behind three tabs', async ({ page }) => {
  await openPhonePanel(page);
  const before = await beat(page);
  const turnUp = async (knob: string) => {
    await page.getByTestId(knob).focus();
    await page.keyboard.press('ArrowUp');
  };

  // Voice is open first: the selected voice's own knobs, its level among them.
  await expect(page.getByTestId('tab-voice')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tempo')).toHaveCount(0);
  await turnUp('pitch');
  await turnUp('level-kick');
  const voiced = await beat(page);
  expect(voiced.voices.kick.pitch).toBeGreaterThan(before.voices.kick.pitch);
  expect(voiced.mix.levels.kick).toBeGreaterThan(before.mix.levels.kick);
  await page.getByTestId('voice-tom').click();
  await expect(page.getByTestId('level-tom')).toBeVisible();

  await page.getByTestId('tab-tempo').click();
  await expect(page.getByTestId('pitch')).toHaveCount(0);
  await turnUp('tempo');
  await turnUp('swing');
  await page.getByTestId('size').click();
  const timed = await beat(page);
  expect(timed.tempo).toBeGreaterThan(before.tempo);
  expect(timed.swing).toBeGreaterThan(before.swing);
  expect(timed.size).toBe(12);
  await expect(step(page, 13)).toHaveAttribute('aria-disabled', 'true');

  // The arrow keys move between tabs, as they do in any row of tabs.
  await page.getByTestId('tab-tempo').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-effect')).toBeFocused();
  await expect(page.getByTestId('tab-effect')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('effect').click();
  await turnUp('mix');
  const wet = await beat(page);
  expect(wet.effect.kind).not.toBe(before.effect.kind);
  expect(wet.effect.mix).toBeGreaterThan(before.effect.mix);
  await expect(page.getByTestId('volume')).toHaveAttribute('aria-valuetext', `${Math.round(wet.mix.volume * 100)}%`);
});

test('what is lettered on the phone’s panel has the picture’s drawing for it beside it', async ({ page }) => {
  await openPhonePanel(page);
  const drawn = (within: string) => page.getByTestId('panel').locator(`${within} .rt-ph-icon`);
  const loaded = async (within: string) =>
    (await drawn(within).evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).naturalWidth > 0))).every(Boolean);

  // The step keys' heading and both positions of the write switch, mute, and each tab.
  await expect(drawn('.rt-ph-head')).toHaveCount(3);
  await expect(drawn('[data-testid="mute"]')).toHaveCount(1);
  for (const tab of ['voice', 'tempo', 'effect']) await expect(drawn(`[data-testid="tab-${tab}"]`)).toHaveCount(1);

  // Every knob and switch behind the tabs, but for the mix, which the picture marks 0 to 100%.
  await expect(drawn('.rt-ph-deck')).toHaveCount(4);
  await page.getByTestId('tab-tempo').click();
  await expect(drawn('.rt-ph-deck')).toHaveCount(4);
  await page.getByTestId('tab-effect').click();
  await expect(drawn('.rt-ph-deck')).toHaveCount(5);
  await expect(page.getByTestId('mix').locator('.rt-ph-ends i')).toHaveCount(2);
  await expect.poll(() => loaded('')).toBe(true);
});

test('a control touched on the phone’s panel says in English what it is on the readout under the screen', async ({ page }) => {
  await openPhonePanel(page);
  const readout = page.getByTestId('readout');
  await expect(readout).toHaveAttribute('data-text', '');

  await page.getByTestId('voice-snare').click();
  await expect(readout).toHaveAttribute('data-text', 'Snare selected');

  // A tab says what is behind it.
  await page.getByTestId('tab-tempo').click();
  await expect(readout).toHaveAttribute('data-text', 'Tempo: tempo, swing, accent and measure');

  // A knob says where it stands when it is only touched, and nothing about the beat changes.
  const before = (await beat(page)).tempo;
  const knob = (await page.getByTestId('tempo').boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(readout).toHaveAttribute('data-text', `Tempo: ${before} beats a minute`);
  expect((await beat(page)).tempo).toBe(before);

  // It sits on the screen's frame, as wide as the glass, one line tall, and goes quiet again.
  const frame = (await page.locator('.rt-ph-crt').boundingBox())!;
  const glass = (await page.locator('.rt-ph-glass').boundingBox())!;
  const strip = (await readout.boundingBox())!;
  expect(strip.y).toBeGreaterThanOrEqual(glass.y + glass.height);
  expect(strip.y + strip.height).toBeLessThanOrEqual(frame.y + frame.height);
  expect(Math.abs(strip.x - glass.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(strip.width - glass.width)).toBeLessThanOrEqual(1);
  expect(strip.height).toBeLessThan(30);
  await expect(readout).toHaveAttribute('data-text', '', { timeout: 6000 });
  // The same words reach a screen reader from the readout's live line.
  await expect(page.getByTestId('spoken')).toHaveText(`Tempo: ${before} beats a minute`);
  await expect(page.getByTestId('spoken')).toHaveAttribute('aria-live', 'polite');
});

test('the phone’s panel can be lettered in English', async ({ page }) => {
  await openPhonePanel(page);
  await openSettings(page);
  await page.getByTestId('lettering-english').click();
  await closeSettings(page);

  const lettered = (selector: string) => page.locator(selector).getAttribute('data-let');
  await expect.poll(() => lettered('[data-tab="tempo"] .rt-ph-let')).toBe('TEMPO');
  await expect(page.getByTestId('pattern-2').locator('.rt-ph-let')).toHaveAttribute('data-let', 'B.');
  await expect(page.getByTestId('voice-kick').locator('.rt-ph-let')).toHaveAttribute('data-let', 'KICK');
  await expect(page.getByTestId('tab-tempo')).toHaveAccessibleName('Tempo');
});

test('the phone’s power switch puts everything else out of reach', async ({ page }) => {
  await openPhonePanel(page);
  await page.getByTestId('power').click();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'off');
  await expect(page.locator('.rt-ph-controls')).toHaveAttribute('inert', '');
  await page.getByTestId('power').click();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'on');
  await expect(page.locator('.rt-ph-controls')).not.toHaveAttribute('inert', '');
});

test('the phone’s panel has no detectable accessibility violations, on any tab', async ({ page }) => {
  await openPhonePanel(page);
  for (const tab of ['voice', 'tempo', 'effect']) {
    await page.getByTestId(`tab-${tab}`).click();
    const results = await scanner(page).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  }
});

test('the settings sheet on a touchscreen does not list keyboard keys', async ({ page }) => {
  await openPhonePanel(page);
  await openSettings(page);
  await expect(page.getByTestId('keys-help')).toBeHidden();
});

test('on a phone the WAV export chip sits centred at the foot of the screen, over nothing it hides for long', async ({ page }) => {
  await openPhonePanel(page);
  const release = await holdTheRender(page);
  await page.getByTestId('export-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-wav').click();
  await closeSettings(page);

  const chip = page.getByTestId('wav-export-chip');
  await expect(chip).toHaveText('Rendering the WAV… 0%, open settings');
  const box = (await chip.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 390 / 2)).toBeLessThan(2);
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  release();
  await download;
  await expect(chip).toHaveText('WAV exported, open settings');
  await expect(chip).toHaveCount(0, { timeout: 10_000 });
});
