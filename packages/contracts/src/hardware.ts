import { z } from 'zod';
import panel606 from '../data/panels/606.panel.json';
import panel707 from '../data/panels/707.panel.json';
import panel808 from '../data/panels/808.panel.json';
import panel909 from '../data/panels/909.panel.json';
import { KIT_IDS, type KitId } from './kit';
import { ROLE_IDS, type RoleId } from './roles';
import { STEP_COUNT } from './project';

/**
 * Hardware panel manifests: control geometry and behaviour notes for the
 * photo-based editor. All coordinates are pixels in the reference faceplate
 * image, so they scale with it. The manifest carries no pixels itself; the
 * photo is supplied separately and the panel can be drawn without it.
 */

/** [x, y, width, height] in faceplate pixels. */
const rectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
const pointSchema = z.tuple([z.number(), z.number()]);
const colourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

const knobSchema = z.object({
  cx: z.number(),
  cy: z.number(),
  /** Radius of the part that turns. */
  r: z.number().positive(),
  /** Pointer angle in the photo, in degrees clockwise from straight up. */
  photoDeg: z.number(),
});

const voicePositionSchema = z.object({
  label: z.string().min(1).max(12),
  /** Missing when the position has no equivalent in this build. */
  role: z.enum(ROLE_IDS).optional(),
  /** Pointer angle for rotary selectors. */
  deg: z.number().optional(),
  hit: rectSchema,
});

export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.enum(KIT_IDS),
  kit: z.enum(KIT_IDS),
  name: z.string().min(1).max(40),
  faceplate: z.object({
    /** File name expected in misc/assets. Never committed. */
    file: z.string().regex(/^[a-z0-9_-]+\.(jpg|png|webp)$/),
    /**
     * Size of the coordinate space every rectangle below is measured in. A
     * photo of the same framing at another resolution works unchanged.
     */
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  /** Colours for the drawn panel used when no photo is available. */
  theme: z.object({
    panel: colourSchema,
    ink: colourSchema,
    accent: colourSchema,
    button: colourSchema,
    well: colourSchema,
    led: colourSchema,
  }),
  /** Recessed areas of the drawn panel. */
  wells: z.array(rectSchema),
  steps: z
    .array(z.object({ hit: rectSchema, button: rectSchema, led: pointSchema }))
    .length(STEP_COUNT),
  ledRadius: z.number().positive(),
  /** True when the photo shows the step lamps lit, so unlit ones need dimming. */
  ledsLitInPhoto: z.boolean(),
  transport: z
    .array(
      z.object({
        action: z.enum(['toggle', 'start', 'stop']),
        label: z.string().min(1).max(16),
        hit: rectSchema,
      }),
    )
    .min(1),
  tempo: knobSchema.extend({
    label: z.string(),
    /** Pointer angles at the slowest and fastest tempo. */
    minDeg: z.number(),
    maxDeg: z.number(),
  }),
  voiceSelect: z.object({
    kind: z.enum(['rotary', 'keys']),
    label: z.string(),
    knob: knobSchema.optional(),
    positions: z.array(voicePositionSchema).min(1),
  }),
  /** Behaviour that still needs checking against the machine's manual. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelRect = z.infer<typeof rectSchema>;

export const PANELS: Readonly<Record<KitId, PanelManifest>> = {
  '606': panelManifestSchema.parse(panel606),
  '707': panelManifestSchema.parse(panel707),
  '808': panelManifestSchema.parse(panel808),
  '909': panelManifestSchema.parse(panel909),
};

export function getPanel(id: KitId): PanelManifest {
  return PANELS[id];
}

/** Roles this panel can select and program. */
export function panelRoles(panel: PanelManifest): RoleId[] {
  const roles: RoleId[] = [];
  for (const position of panel.voiceSelect.positions) {
    if (position.role && !roles.includes(position.role)) roles.push(position.role);
  }
  return roles;
}

/** Roles a beat may use that this panel has no control for. */
export function rolesOutsidePanel(panel: PanelManifest): RoleId[] {
  const onPanel = new Set(panelRoles(panel));
  return ROLE_IDS.filter((role) => !onPanel.has(role));
}
