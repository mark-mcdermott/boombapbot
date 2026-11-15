import { ROLE_IDS, getRole, type KitId, type KitManifest, type SoundSettings } from '@boombapbot/contracts';
import { decodeWav } from './wav';
import type { EngineVoice, SnareWasm } from './wasm-engine';

/** A kit with its samples decoded, ready for any engine instance. */
export interface DecodedKit {
  id: KitId;
  version: string;
  voices: EngineVoice[];
}

export type FetchBytes = (url: string) => Promise<ArrayBuffer>;

/**
 * Builds a kit whose sounds the engine synthesises from their knob settings,
 * at the rate they will be played at so nothing is resampled. A role's slot
 * is also its sound number.
 */
export function synthesiseKit(
  wasm: SnareWasm,
  manifest: KitManifest,
  sampleRate: number,
  sound: SoundSettings,
): DecodedKit {
  const voices = ROLE_IDS.map((roleId): EngineVoice => {
    const voice = manifest.voices[roleId];
    const role = getRole(roleId).index;
    const pcm = wasm.synthesise({ sound: role, ...sound[roleId] }, sampleRate);
    return {
      role,
      pcm,
      frames: pcm.length,
      channels: 1,
      sampleRate,
      gain: voice.gain,
      pan: voice.pan,
      chokeGroup: voice.chokeGroup,
    };
  });
  return { id: manifest.id, version: manifest.version, voices };
}

/** Builds a decoded kit from a manifest and a way to read its files. */
export async function loadKit(
  manifest: KitManifest,
  assetRoot: string,
  fetchBytes: FetchBytes,
): Promise<DecodedKit> {
  const root = assetRoot.endsWith('/') ? assetRoot : `${assetRoot}/`;
  const voices = await Promise.all(
    ROLE_IDS.map(async (roleId): Promise<EngineVoice> => {
      const voice = manifest.voices[roleId];
      const url = `${root}${manifest.assetBase}/${voice.file}`;
      let decoded;
      try {
        decoded = decodeWav(await fetchBytes(url));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not load ${manifest.name} ${voice.label}: ${reason}`);
      }
      return {
        role: getRole(roleId).index,
        pcm: decoded.pcm,
        frames: decoded.frames,
        channels: decoded.channels,
        sampleRate: decoded.sampleRate,
        gain: voice.gain,
        pan: voice.pan,
        chokeGroup: voice.chokeGroup,
      };
    }),
  );
  return { id: manifest.id, version: manifest.version, voices };
}

export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}
