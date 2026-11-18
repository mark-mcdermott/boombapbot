import { z } from 'zod';
import { PROJECT_FORMAT } from '@boombapbot/contracts';
import { STEPS, clampBpm, clampKnob, withStep, type Size, type VoiceId } from './machine';
import { createEmptyPatterns, createProject, forEachVoice, type ParseResult, type Pattern, type Project } from './project';

/**
 * Reads beats made before РИТМ-12, on the machine boombapbot had first, and
 * turns them into РИТМ-12 beats. Nothing else in this build knows those
 * formats: what is here is all that is read of them, and it is never written.
 *
 * Version 2 held sixteen rhythms of up to 32 steps on eleven instruments,
 * with two versions each, and tracks that strung rhythms together. Version 1
 * held one 16-step beat on eight lanes, with a velocity for every hit.
 */

const EARLIER_MACHINE = 'It was made on an earlier machine and is now a РИТМ-12 beat.';

/** Which earlier instruments each voice takes its steps from. */
const SOURCES: Record<VoiceId, readonly string[]> = {
  kick: ['kick'],
  snare: ['snare'],
  clap: ['clap'],
  closed_hat: ['closed_hat'],
  open_hat: ['open_hat'],
  tom: ['low_tom', 'mid_tom', 'high_tom'],
  rim: ['rim_shot'],
  perc: ['cowbell', 'cymbal'],
};

const header = {
  format: z.literal(PROJECT_FORMAT),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

const knob = z.number().min(0).max(1);
const rows = z.record(z.string(), z.string());

const v2Schema = z.object({
  ...header,
  schemaVersion: z.literal(2),
  tempo: z.object({ coarse: z.number(), fine: z.number() }),
  sound: z.object({
    master: knob,
    accent: knob,
    levels: z.record(z.string(), knob),
    alternates: z.record(z.string(), z.boolean()),
  }),
  rhythms: z
    .array(z.object({ preScale: z.number(), firstLength: z.number(), secondLength: z.number(), a: rows, b: rows }))
    .min(1),
  rhythmTracks: z.array(z.array(z.number())),
  panel: z.object({ basicRhythm: z.number().int().min(0) }),
});

const v1Schema = z.object({
  ...header,
  schemaVersion: z.literal(1),
  bpm: z.number(),
  swing: z.number().min(50).max(75),
  pattern: z.object({
    lanes: z.array(z.object({ role: z.string(), steps: z.array(z.number()).length(STEPS) })),
  }),
});

/** A version 1 hit at or above this velocity was drawn and heard as an accent. */
const V1_ACCENT = 120;

function hasHits(row: string | undefined): boolean {
  return row !== undefined && row.includes('x');
}

/** The first sixteen steps of the instruments a voice is made from, laid over each other. */
function foldRows(source: Record<string, string>, names: readonly string[]): string {
  let row = '.'.repeat(STEPS);
  for (const name of names) {
    for (let step = 0; step < STEPS; step += 1) if (source[name]?.[step] === 'x') row = withStep(row, step, true);
  }
  return row;
}

function carried(base: Project, pattern: Pattern, change: Partial<Project>): Project {
  const patterns = createEmptyPatterns();
  patterns[0] = pattern;
  return { ...base, ...change, patterns };
}

function fromV2(old: z.infer<typeof v2Schema>): { project: Project; changes: string[] } {
  const chosen = old.panel.basicRhythm < old.rhythms.length ? old.panel.basicRhythm : 0;
  const rhythm = old.rhythms[chosen]!;
  // The earlier machine's step sizes: triplets, sextuplets, sixteenths, thirty-seconds.
  const size: Size = rhythm.preScale === 1 ? 12 : 16;
  const changes = [EARLIER_MACHINE, `Rhythm ${chosen + 1}, version A, is now pattern А.`];

  if (rhythm.preScale === 2) changes.push('Its steps were sextuplets. They play as sixteenths here, at two thirds of the speed.');
  if (rhythm.preScale === 4) changes.push('Its steps were thirty-second notes. They play as sixteenths here, at half the speed.');
  if (rhythm.firstLength < size) changes.push(`It was ${rhythm.firstLength} steps long. A measure here is ${size}.`);
  if (rhythm.secondLength > 0 || Object.values(rhythm.a).some((row) => hasHits(row.slice(size)))) {
    changes.push(`Only its first ${size} steps were kept.`);
  }
  if (Object.values(rhythm.b).some(hasHits)) changes.push('Its version B was left behind.');
  const others = old.rhythms.filter((other, index) => index !== chosen && [other.a, other.b].some((v) => Object.values(v).some(hasHits)));
  if (others.length > 0) {
    changes.push(`${others.length} other ${others.length === 1 ? 'rhythm was' : 'rhythms were'} left behind.`);
  }
  if (old.rhythmTracks.some((track) => track.length > 0)) changes.push('Its rhythm tracks were left behind.');
  if (['low_tom', 'mid_tom', 'high_tom'].filter((name) => hasHits(rhythm.a[name])).length > 1) {
    changes.push('Its three toms now play on the one ТОМ.');
  }
  if (hasHits(rhythm.a.cowbell) && hasHits(rhythm.a.cymbal)) changes.push('Its cowbell and cymbal now both play on ПЕРК.');
  if (Object.values(old.sound.alternates).some(Boolean)) changes.push('Its congas, claves and maracas are not on this machine.');
  changes.push('The sounds are this machine’s own, so its sound knobs start at rest.');

  const base = createProject({ id: old.id, now: new Date(old.createdAt), name: old.name });
  const level = (names: readonly string[]) => Math.max(...names.map((name) => old.sound.levels[name] ?? 0));
  const project = carried(
    base,
    { steps: forEachVoice((id) => foldRows(rhythm.a, SOURCES[id])), accents: foldRows(rhythm.a, ['accent']) },
    {
      updatedAt: old.updatedAt,
      tempo: clampBpm(40 + ((old.tempo.coarse + old.tempo.fine) * 260) / 39),
      size,
      mix: {
        ...base.mix,
        volume: old.sound.master,
        accent: old.sound.accent,
        levels: forEachVoice((id) => level(SOURCES[id])),
      },
    },
  );
  return { project, changes };
}

function fromV1(old: z.infer<typeof v1Schema>): { project: Project; changes: string[] } {
  const steps: Record<string, string> = {};
  let accents = '.'.repeat(STEPS);
  const velocities = new Set<number>();
  for (const lane of old.pattern.lanes) {
    lane.steps.forEach((velocity, step) => {
      if (velocity <= 0) return;
      velocities.add(velocity);
      steps[lane.role] = withStep(steps[lane.role] ?? '.'.repeat(STEPS), step, true);
      if (velocity >= V1_ACCENT) accents = withStep(accents, step, true);
    });
  }
  const changes = [EARLIER_MACHINE];
  if (velocities.size > 1) {
    changes.push('Each hit had its own velocity. Steps are now on or off, and the loudest ones are accented.');
  }
  if (hasHits(steps.low_tom) && hasHits(steps.high_tom)) changes.push('Its two toms now play on the one ТОМ.');
  if (hasHits(steps.cymbal)) changes.push('Its cymbal now plays on ПЕРК.');

  const base = createProject({ id: old.id, now: new Date(old.createdAt), name: old.name });
  const project = carried(
    base,
    { steps: forEachVoice((id) => foldRows(steps, SOURCES[id])), accents },
    // Swing ran from 50% (none) to 75%, which is as far as this machine's knob goes.
    { updatedAt: old.updatedAt, tempo: clampBpm(old.bpm), swing: clampKnob((old.swing - 50) / 25) },
  );
  return { project, changes };
}

/**
 * Takes over a beat from before РИТМ-12, or returns null when it is not one.
 * A beat that is one but is damaged is refused with what is wrong with it.
 */
export function adoptEarlier(input: unknown): ParseResult | null {
  if (typeof input !== 'object' || input === null) return null;
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1 && version !== 2) return null;
  const parsed = version === 2 ? v2Schema.safeParse(input) : v1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      }),
    };
  }
  const { project, changes } = parsed.data.schemaVersion === 2 ? fromV2(parsed.data) : fromV1(parsed.data);
  return { ok: true, project, changes };
}
