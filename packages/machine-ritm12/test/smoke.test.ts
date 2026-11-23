import { describe, expect, it } from 'vitest';
import { SMOKE, STRANDS, strandAt, strandPoint } from '../src/ui/smoke';

const moments = [0, 0.8, 3.1, 12.4, 97, 3600];

describe('the smoke off the cigarette', () => {
  it('leaves the lit end where the lit end is, whatever the moment', () => {
    for (const strand of STRANDS) {
      for (const time of moments) {
        const foot = strandPoint(strand, 0, time);
        expect(Math.abs(foot.across)).toBeLessThan(0.01);
        expect(foot.up).toBe(0);
      }
    }
  });

  it('only ever rises, and is gone by the top of its box', () => {
    for (const strand of STRANDS) {
      const points = strandAt(strand, 5.5);
      expect(points).toHaveLength(SMOKE.samples + 1);
      points.slice(1).forEach((point, index) => expect(point.up).toBeGreaterThan(points[index]!.up));
      expect(points.at(-1)!.up).toBeCloseTo(SMOKE.height);
      expect(points.at(-1)!.density).toBe(0);
    }
  });

  it('widens and wavers more the higher it gets', () => {
    for (const strand of STRANDS) {
      const swing = (age: number) => {
        const across = Array.from({ length: 400 }, (_, index) => strandPoint(strand, age, index * 0.05).across);
        return Math.max(...across) - Math.min(...across);
      };
      expect(swing(0.9)).toBeGreaterThan(swing(0.3));
      expect(swing(0.3)).toBeGreaterThan(swing(0.05));
      expect(strandPoint(strand, 0.9, 1).width).toBeGreaterThan(strandPoint(strand, 0.1, 1).width);
    }
  });

  it('stays inside its box, which is as wide as it is high', () => {
    for (const strand of STRANDS) {
      for (let time = 0; time < 200; time += 0.37) {
        for (const point of strandAt(strand, time)) expect(Math.abs(point.across) + point.width / 2).toBeLessThan(0.62);
      }
    }
  });

  it('is never the same twice in a while, but always the same at the same moment', () => {
    const [strand] = STRANDS;
    expect(strandAt(strand!, 4.2)).toEqual(strandAt(strand!, 4.2));
    const top = (time: number) => strandPoint(strand!, 0.8, time).across;
    const seen = new Set(Array.from({ length: 120 }, (_, index) => top(index * 0.5).toFixed(3)));
    expect(seen.size).toBeGreaterThan(90);
  });
});
