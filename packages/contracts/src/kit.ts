import { z } from 'zod';
import kit606 from '../data/kits/606.kit.json';
import kit707 from '../data/kits/707.kit.json';
import kit808 from '../data/kits/808.kit.json';
import kit909 from '../data/kits/909.kit.json';
import { ROLE_IDS, type RoleId } from './roles';

export const KIT_IDS = ['606', '707', '808', '909'] as const;
export type KitId = (typeof KIT_IDS)[number];

export const kitVoiceSchema = z.object({
  /** WAV file name inside the kit's asset folder. */
  file: z.string().regex(/^[a-z0-9_-]+\.wav$/),
  /** Voice name as this kit calls it. */
  label: z.string().min(1).max(40),
  short: z.string().min(1).max(4),
  gain: z.number().min(0).max(4),
  pan: z.number().min(-1).max(1),
  /** 0 is no choke. A hit in group N releases sounding voices of group N. */
  chokeGroup: z.number().int().min(0).max(15),
  /** Present when this kit has no native voice for the role. */
  substitute: z.object({ reason: z.string().min(1).max(200) }).optional(),
});

export const kitManifestSchema = z.object({
  format: z.literal('boombapbot.kit'),
  schemaVersion: z.literal(1),
  id: z.enum(KIT_IDS),
  version: z.string().min(1).max(40),
  name: z.string().min(1).max(40),
  /** Demo kits are synthesised placeholders, not recordings of hardware. */
  demo: z.boolean(),
  description: z.string().max(300),
  /** Folder under the asset root that holds this kit's files. */
  assetBase: z.string().regex(/^[a-z0-9/_-]+$/),
  sampleRate: z.number().int().positive(),
  voices: z.object(
    Object.fromEntries(ROLE_IDS.map((role) => [role, kitVoiceSchema])) as Record<
      RoleId,
      typeof kitVoiceSchema
    >,
  ),
});

export type KitVoice = z.infer<typeof kitVoiceSchema>;
export type KitManifest = z.infer<typeof kitManifestSchema>;

export function parseKitManifest(input: unknown): KitManifest {
  return kitManifestSchema.parse(input);
}

/** The four built-in kits, validated when this module loads. */
export const KITS: Readonly<Record<KitId, KitManifest>> = {
  '606': parseKitManifest(kit606),
  '707': parseKitManifest(kit707),
  '808': parseKitManifest(kit808),
  '909': parseKitManifest(kit909),
};

export function getKit(id: KitId): KitManifest {
  return KITS[id];
}

export function isKitId(value: unknown): value is KitId {
  return typeof value === 'string' && (KIT_IDS as readonly string[]).includes(value);
}

/** Roles a kit plays with a stand-in voice, for showing before a switch. */
export function substitutedRoles(kit: KitManifest): RoleId[] {
  return ROLE_IDS.filter((role) => kit.voices[role].substitute !== undefined);
}
