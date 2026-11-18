import { EMPTY_ROW, VOICE_IDS, type VoiceId } from './machine';
import type { Pattern } from './project';

/** A row from a drawing of it, with spaces to keep the beats apart. */
function row(drawing: string): string {
  return drawing.replace(/\s/g, '');
}

function pattern(accents: string, steps: Partial<Record<VoiceId, string>>): Pattern {
  return {
    accents: row(accents),
    steps: Object.fromEntries(VOICE_IDS.map((id) => [id, row(steps[id] ?? EMPTY_ROW)])) as Record<VoiceId, string>,
  };
}

/**
 * What a new project opens with: a beat on А and a busier turn of it on Б.
 * В and Г are left empty to write on. These are written for boombapbot.
 */
export function createStarterPatterns(): Pattern[] {
  return [
    pattern('x... .... x... ..x.', {
      kick: 'x... ..x. ..x. ....',
      snare: '.... x... .... x...',
      closed_hat: 'x.x. x.x. x.x. x.x.',
      open_hat: '.... ...x .... ...x',
      rim: '..x. .... .... .x..',
    }),
    pattern('x... x... x... x.x.', {
      kick: 'x..x ..x. .xx. ....',
      snare: '.... x... .... x..x',
      clap: '.... .... .... x...',
      closed_hat: 'xxx. xxx. xxx. x.x.',
      open_hat: '...x ...x ...x ...x',
      tom: '.... .... .x.. ..x.',
      perc: '.x.. ..x. ...x ....',
    }),
    pattern(EMPTY_ROW, {}),
    pattern(EMPTY_ROW, {}),
  ];
}
