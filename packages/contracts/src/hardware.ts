import { z } from 'zod';
import panel808 from '../data/panels/808.panel.json';
import { INSTRUMENT_IDS, PART_STEPS, SOUND_PARAMS, TRACK_IDS } from './machine';

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
  /** The track this position selects. */
  track: z.enum(TRACK_IDS),
  /** Pointer angle for rotary selectors. */
  deg: z.number().optional(),
  hit: rectSchema,
});

export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.literal('808'),
  name: z.string().min(1).max(40),
  faceplate: z.object({
    /** File name in assets/faceplates, or in misc/assets during development. */
    file: z.string().regex(/^[a-z0-9_-]+\.(jpg|png|webp|svg)$/),
    /**
     * Size of the coordinate space every rectangle below is measured in. A
     * photo of the same framing at another resolution works unchanged.
     */
    width: z.number().positive(),
    height: z.number().positive(),
    /**
     * True for artwork drawn for boombapbot by scripts/draw-faceplates.mjs. It
     * needs no credit; any other image needs one before it may ship.
     */
    original: z.boolean().optional(),
    /**
     * Who made the photograph and under what licence. Required before a
     * photograph may ship: the licences need the credit shown with the image.
     */
    credit: z
      .object({
        /** Title of the original work, as its source names it. */
        title: z.string().min(1).max(120),
        author: z.string().min(1).max(120),
        source: z.url({ protocol: /^https$/ }),
        licence: z.string().min(1).max(40),
        licenceUrl: z.url({ protocol: /^https$/ }),
        /** What was changed from the original, when the image is an adaptation. */
        changes: z.string().min(1).max(200).optional(),
      })
      .optional(),
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
    .length(PART_STEPS),
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
  /** Sound knobs the editor turns. A knob not listed here is only drawn. */
  knobs: z
    .array(
      knobSchema.extend({
        track: z.enum(INSTRUMENT_IDS),
        param: z.enum(SOUND_PARAMS),
        /** Pointer angles with the knob fully left and fully right. */
        minDeg: z.number(),
        maxDeg: z.number(),
      }),
    )
    .optional(),
  voiceSelect: z.object({
    kind: z.enum(['rotary', 'keys']),
    label: z.string(),
    knob: knobSchema.optional(),
    positions: z.array(voicePositionSchema).length(TRACK_IDS.length),
  }),
  /** Behaviour that still needs checking against the machine's manual. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelRect = z.infer<typeof rectSchema>;
export type FaceplateCredit = NonNullable<PanelManifest['faceplate']['credit']>;

/** The 808's panel. */
export const PANEL: PanelManifest = panelManifestSchema.parse(panel808);
