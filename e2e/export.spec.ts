import { expect, test } from '@playwright/test';
import {
  chooseKit,
  downloadBytes,
  exportVia,
  hitCount,
  lane,
  openModern,
  openSettings,
  parseMidi,
  parseWav,
  project,
  step,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openModern(page);
});

test('exports a one-bar WAV loop with audio in it', async ({ page }) => {
  const { bpm } = await project(page);
  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toBe('starter-beat.wav');
  const wav = parseWav(await downloadBytes(download));
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.bits).toBe(24);
  // One bar of 4/4 lasts 240 / bpm seconds, to the frame.
  expect(wav.frames).toBe(Math.floor((44100 * 240) / bpm + 0.5));
  expect(wav.peak).toBeGreaterThan(0.1);
  expect(wav.peak).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);

  const sixteen = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(sixteen.bits).toBe(16);
  expect(sixteen.frames).toBe(wav.frames);
  expect(sixteen.rms).toBeCloseTo(wav.rms, 3);
});

test('exports a MIDI file with tempo and drum notes on channel 10', async ({ page }) => {
  const snapshot = await project(page);
  const download = await exportVia(page, 'export-midi');
  expect(download.suggestedFilename()).toBe('starter-beat.mid');
  const midi = parseMidi(await downloadBytes(download));
  expect(midi.format).toBe(1);
  expect(midi.trackCount).toBe(2);
  expect(midi.ppq).toBe(480);
  expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / snapshot.bpm + 0.5));
  expect(midi.trackEnds).toEqual([1920, 1920]);

  const noteOns = midi.notes.filter((note) => note.on);
  expect(noteOns).toHaveLength(hitCount(snapshot));
  expect(midi.notes).toHaveLength(hitCount(snapshot) * 2);
  expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

  // Kick is General MIDI note 36. Its ticks are its steps, with the off-beat
  // sixteenths moved by the swing amount.
  const swingTicks = Math.floor(((snapshot.swing - 50) / 50) * 120 + 0.5);
  const expectedKickTicks = lane(snapshot, 'kick')
    .flatMap((velocity, index) => (velocity > 0 ? [index * 120 + (index % 2 === 1 ? swingTicks : 0)] : []));
  const kickTicks = noteOns.filter((note) => note.note === 36).map((note) => note.tick);
  expect(kickTicks).toEqual(expectedKickTicks);
  const kickVelocities = noteOns.filter((note) => note.note === 36).map((note) => note.velocity);
  expect(kickVelocities).toEqual(lane(snapshot, 'kick').filter((velocity) => velocity > 0));
});

test('exports the project as JSON and imports it back', async ({ page }) => {
  await step(page, 'cymbal', 0).click();
  await chooseKit(page, '606');
  const saved = await project(page);

  const download = await exportVia(page, 'export-project');
  expect(download.suggestedFilename()).toBe('starter-beat.boombapbot.json');
  const bytes = await downloadBytes(download);
  const document = JSON.parse(bytes.toString('utf8'));
  expect(document.format).toBe('boombapbot.project');
  expect(document.schemaVersion).toBe(1);
  expect(document.pattern).toEqual(saved.pattern);
  expect(document.kit.id).toBe('606');

  // Change the beat, then import the file to get it back.
  await openSettings(page);
  await page.getByTestId('clear').click();
  expect(hitCount(await project(page))).toBe(0);
  await page.getByTestId('import-input').setInputFiles({
    name: 'starter-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  // Importing closes settings, so the result is in view.
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toContainText('Imported');
  // The beat comes back whole. Its kit is held back, so it plays on the 808.
  const restored = await project(page);
  expect(restored.pattern).toEqual(saved.pattern);
  expect(restored.kit.id).toBe('808');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-kit', '808');
  await expect(page.getByTestId('notice')).toContainText('made on the 606 kit');
});

test('an invalid import is rejected and the current beat is untouched', async ({ page }) => {
  await step(page, 'cymbal', 3).click();
  const before = await project(page);
  const storedBefore = await page.evaluate(() => localStorage.getItem('boombapbot.draft.v1'));

  const invalid = [
    { name: 'notes.txt', buffer: Buffer.from('this is not a project') },
    { name: 'wrong.json', buffer: Buffer.from(JSON.stringify({ format: 'other', schemaVersion: 1 })) },
    {
      name: 'broken.boombapbot.json',
      buffer: Buffer.from(JSON.stringify({ ...before, format: 'boombapbot.project', schemaVersion: 1, bpm: 9000 })),
    },
  ];
  for (const file of invalid) {
    await page.getByTestId('import-input').setInputFiles({ ...file, mimeType: 'application/json' });
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'error');
    await expect(notice).toContainText(`${file.name} was not imported`);
    expect(await project(page)).toEqual(before);
  }
  expect(await page.evaluate(() => localStorage.getItem('boombapbot.draft.v1'))).toBe(storedBefore);
});
