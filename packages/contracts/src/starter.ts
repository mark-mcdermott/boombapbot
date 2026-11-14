import { createEmptyPattern, findLane, type Pattern } from './project';
import type { RoleId } from './roles';

/** The beat a new project starts with, so the first Play is audible. */
export function createStarterPattern(): Pattern {
  const pattern = createEmptyPattern();
  const hits: Array<[RoleId, Record<number, number>]> = [
    ['kick', { 0: 127, 4: 100, 7: 80, 8: 127, 10: 90, 12: 100 }],
    ['snare', { 4: 110, 12: 110 }],
    [
      'closed_hat',
      { 0: 90, 2: 70, 4: 90, 6: 70, 8: 90, 10: 70, 12: 90, 13: 55 },
    ],
    ['open_hat', { 14: 90 }],
    ['clap', { 12: 80 }],
    ['low_tom', { 15: 85 }],
    ['high_tom', { 11: 60 }],
  ];
  for (const [role, steps] of hits) {
    const lane = findLane(pattern, role);
    for (const [step, velocity] of Object.entries(steps)) {
      lane.steps[Number(step)] = velocity;
    }
  }
  return pattern;
}
