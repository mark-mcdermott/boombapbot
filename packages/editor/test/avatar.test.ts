import { describe, expect, it } from 'vitest';
import { middleSquare } from '../src/account/avatar';
import { ROBOT_ANTENNAS, ROBOT_EYES, ROBOT_GROUNDS, ROBOT_MOUTHS, robotOf } from '../src/account/default-avatar';

describe('the robot an account has for a picture', () => {
  const ids = Array.from({ length: 400 }, (_, index) => `0f8b6c1e-5a55-4d0b-9d0a-${String(index).padStart(12, '0')}`);

  it('is the same one every time for the same account', () => {
    expect(robotOf(ids[0]!)).toEqual(robotOf(ids[0]!));
  });

  it('is drawn only from the parts there are', () => {
    for (const id of ids) {
      const robot = robotOf(id);
      expect(ROBOT_GROUNDS).toContain(robot.ground);
      expect(ROBOT_ANTENNAS).toContain(robot.antenna);
      expect(ROBOT_EYES).toContain(robot.eyes);
      expect(ROBOT_MOUTHS).toContain(robot.mouth);
    }
  });

  it('differs between accounts, using every part', () => {
    const robots = ids.map(robotOf);
    const all = ROBOT_GROUNDS.length * ROBOT_ANTENNAS.length * ROBOT_EYES.length * ROBOT_MOUTHS.length;
    expect(new Set(robots.map((robot) => JSON.stringify(robot))).size).toBeGreaterThan(all / 2);
    expect(new Set(robots.map((robot) => robot.ground)).size).toBe(ROBOT_GROUNDS.length);
    expect(new Set(robots.map((robot) => robot.antenna)).size).toBe(ROBOT_ANTENNAS.length);
    expect(new Set(robots.map((robot) => robot.eyes)).size).toBe(ROBOT_EYES.length);
    expect(new Set(robots.map((robot) => robot.mouth)).size).toBe(ROBOT_MOUTHS.length);
  });
});

describe('the square cut from a picture', () => {
  it('is the middle of a wide one', () => {
    expect(middleSquare(400, 200)).toEqual({ x: 100, y: 0, side: 200 });
  });

  it('is the middle of a tall one', () => {
    expect(middleSquare(300, 900)).toEqual({ x: 0, y: 300, side: 300 });
  });

  it('is all of a square one', () => {
    expect(middleSquare(256, 256)).toEqual({ x: 0, y: 0, side: 256 });
  });
});
