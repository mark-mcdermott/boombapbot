import { z } from 'zod';
import { KIT_IDS, KITS, OFFERED_KIT_IDS, type KitId } from './kit';
import { ROLE_IDS, type RoleId } from './roles';

/**
 * The v0.1 project document: one 16-step pattern in 4/4.
 *
 * This is the plain JSON project used for local drafts and JSON import and
 * export. It is not the future portable `.boombapbot` bundle, which will carry
 * user samples alongside a manifest.
 */
export const PROJECT_FORMAT = 'boombapbot.project';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.boombapbot.json';
export const MAX_PROJECT_BYTES = 1_000_000;

export const STEP_COUNT = 16;
export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const SWING_MIN = 50;
export const SWING_MAX = 75;
export const VELOCITY_MAX = 127;
export const DEFAULT_VELOCITY = 100;
export const ACCENT_VELOCITY = 127;

const velocitySchema = z.number().int().min(0).max(VELOCITY_MAX);

export const laneSchema = z.object({
  /** Stable lane ID, kept across kit and editor switches. */
  id: z.string().min(1).max(64),
  role: z.enum(ROLE_IDS),
  /** Velocity per step. 0 is off. */
  steps: z.array(velocitySchema).length(STEP_COUNT),
});

export const patternSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  stepCount: z.literal(STEP_COUNT),
  lanes: z
    .array(laneSchema)
    .length(ROLE_IDS.length)
    .refine((lanes) => new Set(lanes.map((lane) => lane.role)).size === lanes.length, {
      message: 'each drum role must appear in exactly one lane',
    })
    .refine((lanes) => new Set(lanes.map((lane) => lane.id)).size === lanes.length, {
      message: 'lane ids must be unique',
    }),
});

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  bpm: z.number().min(BPM_MIN).max(BPM_MAX),
  /** Position of the off-beat sixteenth in its pair, in percent. 50 is straight. */
  swing: z.number().min(SWING_MIN).max(SWING_MAX),
  kit: z.object({
    id: z.enum(KIT_IDS),
    version: z.string().min(1).max(40),
  }),
  pattern: patternSchema,
});

export type Lane = z.infer<typeof laneSchema>;
export type Pattern = z.infer<typeof patternSchema>;
export type Project = z.infer<typeof projectSchema>;

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Validates an already-parsed value. Never throws. */
export function parseProject(input: unknown): ParseResult {
  if (typeof input === 'object' && input !== null) {
    const header = input as { format?: unknown; schemaVersion?: unknown };
    if (header.format !== PROJECT_FORMAT) {
      return { ok: false, errors: ['This is not a boombapbot project file.'] };
    }
    if (header.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `This project uses schema version ${String(header.schemaVersion)}. ` +
            `This build reads version ${PROJECT_SCHEMA_VERSION}.`,
        ],
      };
    }
  }
  const result = projectSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };
  return { ok: true, project: result.data };
}

/** Parses project JSON text. Never throws. */
export function parseProjectText(text: string): ParseResult {
  if (text.length > MAX_PROJECT_BYTES) {
    return { ok: false, errors: ['The file is too large to be a boombapbot project.'] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  return parseProject(value);
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}

function laneId(role: RoleId): string {
  return `lane-${role.replace(/_/g, '-')}`;
}

export function createEmptyPattern(): Pattern {
  return {
    id: 'pattern-1',
    name: 'Pattern 1',
    stepCount: STEP_COUNT,
    lanes: ROLE_IDS.map((role) => ({
      id: laneId(role),
      role,
      steps: new Array<number>(STEP_COUNT).fill(0),
    })),
  };
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  kit?: KitId;
  bpm?: number;
  swing?: number;
  pattern?: Pattern;
}

export function createProject(options: NewProjectOptions): Project {
  const kit = options.kit ?? '808';
  const timestamp = options.now.toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id,
    name: options.name ?? 'Untitled beat',
    createdAt: timestamp,
    updatedAt: timestamp,
    bpm: options.bpm ?? 120,
    swing: options.swing ?? 50,
    kit: { id: kit, version: KITS[kit].version },
    pattern: options.pattern ?? createEmptyPattern(),
  };
}

/**
 * The same beat on a kit the editor offers. A beat made on a kit that is held
 * back moves to the first one offered; steps, tempo and swing are untouched.
 */
export function onOfferedKit(project: Project): Project {
  if (OFFERED_KIT_IDS.includes(project.kit.id)) return project;
  const id = OFFERED_KIT_IDS[0]!;
  return { ...project, kit: { id, version: KITS[id].version } };
}

export function findLane(pattern: Pattern, role: RoleId): Lane {
  const lane = pattern.lanes.find((candidate) => candidate.role === role);
  if (!lane) throw new Error(`pattern has no lane for ${role}`);
  return lane;
}

/** Number of active steps in a pattern. */
export function countHits(pattern: Pattern): number {
  return pattern.lanes.reduce(
    (total, lane) => total + lane.steps.filter((velocity) => velocity > 0).length,
    0,
  );
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

export function clampSwing(swing: number): number {
  if (!Number.isFinite(swing)) return SWING_MIN;
  return Math.min(SWING_MAX, Math.max(SWING_MIN, Math.round(swing)));
}

export function clampVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0;
  return Math.min(VELOCITY_MAX, Math.max(0, Math.round(velocity)));
}
