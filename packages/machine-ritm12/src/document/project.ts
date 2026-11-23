import { z } from 'zod';
import { PROJECT_FORMAT, type ParseResult as DocumentParseResult } from '@boombapbot/contracts';
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_LEVEL,
  EMPTY_ROW,
  PATTERN_COUNT,
  STEPS,
  VOICE_IDS,
  type VoiceId,
} from './machine';
import { createStarterPatterns } from './starter';

/**
 * РИТМ-12's project document: what its four patterns hold and where every
 * knob and switch stands.
 */
export const MACHINE_ID = 'ritm12';
export const PROJECT_SCHEMA_VERSION = 4;
/**
 * The version before a beat could name an effect of the upgrade. Nothing
 * else differs: everything such a beat holds means what it means now.
 */
const SCHEMA_VERSION_BEFORE_UPGRADE_EFFECTS = 3;

/** The effects the machine has for anyone. */
export const FREE_EFFECT_KINDS = ['delay', 'reverb', 'flanger', 'chorus'] as const;
/** The effects that come with the upgrade. A beat can name one whoever opens it; only the upgrade plays it. */
export const PAID_EFFECT_KINDS = ['crusher', 'tape', 'pump', 'filter', 'vinyl', 'phaser'] as const;
export const EFFECT_KINDS = [...FREE_EFFECT_KINDS, ...PAID_EFFECT_KINDS] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export function isPaidEffect(kind: EffectKind): boolean {
  return (PAID_EFFECT_KINDS as readonly EffectKind[]).includes(kind);
}

/** The effects the selector reaches, in its order: the six of the upgrade follow the four only for whoever holds it. */
export function reachableEffects(upgraded: boolean): readonly EffectKind[] {
  return upgraded ? EFFECT_KINDS : FREE_EFFECT_KINDS;
}

/** What the step keys write: hits of the selected voice, or the pattern's accents. */
export const WRITE_MODES = ['hits', 'accents'] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

const knobSchema = z.number().min(0).max(1);
const rowSchema = z.string().regex(new RegExp(`^[.x]{${STEPS}}$`), `a row is ${STEPS} steps of "x" or "."`);

const patternSchema = z.object({
  steps: z.record(z.enum(VOICE_IDS), rowSchema),
  accents: rowSchema,
});

const voiceKnobsSchema = z.object({ pitch: knobSchema, decay: knobSchema, tone: knobSchema });

const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  machine: z.literal(MACHINE_ID),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Beats a minute. */
  tempo: z.number().int().min(BPM_MIN).max(BPM_MAX),
  swing: knobSchema,
  size: z.union([z.literal(16), z.literal(12)]),
  patterns: z.array(patternSchema).length(PATTERN_COUNT),
  mix: z.object({
    volume: knobSchema,
    accent: knobSchema,
    levels: z.record(z.enum(VOICE_IDS), knobSchema),
    mutes: z.record(z.enum(VOICE_IDS), z.boolean()),
  }),
  voices: z.record(z.enum(VOICE_IDS), voiceKnobsSchema),
  effect: z.object({ kind: z.enum(EFFECT_KINDS), mix: knobSchema }),
  panel: z.object({
    selected: z.enum(VOICE_IDS),
    pattern: z.number().int().min(0).max(PATTERN_COUNT - 1),
    write: z.enum(WRITE_MODES),
  }),
});

export type Pattern = z.infer<typeof patternSchema>;
export type VoiceKnobs = z.infer<typeof voiceKnobsSchema>;
export type VoiceKnob = keyof VoiceKnobs;
export type Project = z.infer<typeof projectSchema>;
export type ParseResult = DocumentParseResult<Project>;

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** A project of the version before this one as this version has it. Nothing is lost on the way. */
function broughtUpToDate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const { schemaVersion } = input as { schemaVersion?: unknown };
  return schemaVersion === SCHEMA_VERSION_BEFORE_UPGRADE_EFFECTS ? { ...input, schemaVersion: PROJECT_SCHEMA_VERSION } : input;
}

/** Validates a РИТМ-12 project, bringing one of the version before up to date. Never throws. */
export function parseProject(input: unknown): ParseResult {
  const result = projectSchema.safeParse(broughtUpToDate(input));
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };
  return { ok: true, project: result.data, changes: [] };
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}

export function forEachVoice<Value>(value: (id: VoiceId) => Value): Record<VoiceId, Value> {
  return Object.fromEntries(VOICE_IDS.map((id) => [id, value(id)])) as Record<VoiceId, Value>;
}

export function createEmptyPattern(): Pattern {
  return { steps: forEachVoice(() => EMPTY_ROW), accents: EMPTY_ROW };
}

export function createEmptyPatterns(): Pattern[] {
  return Array.from({ length: PATTERN_COUNT }, createEmptyPattern);
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  bpm?: number;
  patterns?: Pattern[];
}

/** A new project with every knob at rest. It gets the starter patterns unless it is given others. */
export function createProject(options: NewProjectOptions): Project {
  const timestamp = options.now.toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    machine: MACHINE_ID,
    id: options.id,
    name: options.name ?? 'Untitled beat',
    createdAt: timestamp,
    updatedAt: timestamp,
    tempo: options.bpm ?? 104,
    swing: 0,
    size: 16,
    patterns: options.patterns ?? createStarterPatterns(),
    mix: {
      volume: 0.8,
      accent: 0.6,
      levels: forEachVoice(() => DEFAULT_LEVEL),
      mutes: forEachVoice(() => false),
    },
    voices: forEachVoice(() => ({ pitch: 0.5, decay: 0.5, tone: 0.5 })),
    effect: { kind: 'delay', mix: 0 },
    panel: { selected: 'kick', pattern: 0, write: 'hits' },
  };
}

/** Hits a pattern holds, across every voice. Accents are not hits. */
export function countHits(pattern: Pattern): number {
  return VOICE_IDS.reduce((sum, id) => sum + [...pattern.steps[id]].filter((mark) => mark === 'x').length, 0);
}

export function isEmptyPattern(pattern: Pattern): boolean {
  return countHits(pattern) === 0 && pattern.accents === EMPTY_ROW;
}
