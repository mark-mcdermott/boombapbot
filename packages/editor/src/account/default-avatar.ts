// The picture an account has until somebody uploads one: a small robot's
// face, drawn from the account's id, so it is the same on every device and
// two accounts seldom share one.

export const ROBOT_GROUNDS = ['#ff5a3c', '#f2b33d', '#86d99a', '#5cc8c2', '#7aa7ff', '#b79bff', '#ff8fb1'] as const;
export const ROBOT_ANTENNAS = ['ball', 'twin', 'cap'] as const;
export const ROBOT_EYES = ['round', 'square', 'visor'] as const;
export const ROBOT_MOUTHS = ['line', 'grille', 'smile'] as const;

export interface Robot {
  ground: (typeof ROBOT_GROUNDS)[number];
  antenna: (typeof ROBOT_ANTENNAS)[number];
  eyes: (typeof ROBOT_EYES)[number];
  mouth: (typeof ROBOT_MOUTHS)[number];
}

/** FNV-1a: a small, even spread of any text over 32 bits. */
function spread(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The robot an account id draws: always the same one for the same id. */
export function robotOf(id: string): Robot {
  const hash = spread(id);
  const pick = <Choice>(choices: readonly Choice[], shift: number): Choice =>
    choices[(hash >>> shift) % choices.length] as Choice;
  return {
    ground: pick(ROBOT_GROUNDS, 0),
    antenna: pick(ROBOT_ANTENNAS, 8),
    eyes: pick(ROBOT_EYES, 16),
    mouth: pick(ROBOT_MOUTHS, 24),
  };
}
