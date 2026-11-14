/**
 * PCM WAV decoding and encoding.
 *
 * Kits are decoded here rather than with decodeAudioData so the result is
 * exact, independent of the audio device's sample rate, and identical in the
 * browser and in Node.
 */

export interface DecodedWav {
  /** Interleaved float samples. */
  pcm: Float32Array;
  frames: number;
  channels: number;
  sampleRate: number;
}

export const MAX_WAV_BYTES = 12 * 1024 * 1024;
export const MAX_WAV_SECONDS = 30;

export class WavError extends Error {}

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Decodes 16, 24 or 32-bit PCM and 32-bit float WAV, mono or stereo. */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength > MAX_WAV_BYTES) throw new WavError('The WAV file is too large.');
  if (buffer.byteLength < 44) throw new WavError('The file is too short to be a WAV file.');
  const view = new DataView(buffer);
  if (tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') {
    throw new WavError('The file is not a RIFF/WAVE file.');
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let position = 12;
  while (position + 8 <= view.byteLength) {
    const id = tag(view, position);
    const size = view.getUint32(position + 4, true);
    const body = position + 8;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = Math.min(size, view.byteLength - body);
    }
    position = body + size + (size & 1);
  }

  if (dataOffset < 0 || channels === 0) throw new WavError('The WAV file has no audio data.');
  if (channels > 2) throw new WavError('Only mono and stereo WAV files are supported.');
  if (sampleRate < 8000 || sampleRate > 192000) {
    throw new WavError('The WAV sample rate is not supported.');
  }
  const isFloat = format === 3 && bits === 32;
  const isPcm = format === 1 && (bits === 16 || bits === 24 || bits === 32);
  if (!isFloat && !isPcm) throw new WavError('Only PCM and 32-bit float WAV files are supported.');

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataSize / (bytesPerSample * channels));
  if (frames === 0) throw new WavError('The WAV file is empty.');
  if (frames > sampleRate * MAX_WAV_SECONDS) throw new WavError('The WAV file is too long.');

  const pcm = new Float32Array(frames * channels);
  for (let i = 0; i < pcm.length; i += 1) {
    const offset = dataOffset + i * bytesPerSample;
    if (isFloat) {
      pcm[i] = view.getFloat32(offset, true);
    } else if (bits === 16) {
      pcm[i] = view.getInt16(offset, true) / 32768;
    } else if (bits === 24) {
      const value =
        view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
      pcm[i] = value / 8388608;
    } else {
      pcm[i] = view.getInt32(offset, true) / 2147483648;
    }
  }
  return { pcm, frames, channels, sampleRate };
}

export type WavBitDepth = 16 | 24;

/** Encodes a stereo render as 16 or 24-bit PCM. */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: WavBitDepth = 24,
): Uint8Array {
  const frames = left.length;
  const bytesPerSample = bitDepth / 8;
  const dataSize = frames * 2 * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * bytesPerSample, true);
  view.setUint16(32, 2 * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);

  const scale = bitDepth === 16 ? 32767 : 8388607;
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let channel = 0; channel < 2; channel += 1) {
      const sample = channel === 0 ? left[i]! : right[i]!;
      const clamped = Math.max(-1, Math.min(1, sample));
      const value = Math.floor(clamped * scale + 0.5);
      if (bitDepth === 16) {
        view.setInt16(offset, value, true);
      } else {
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return bytes;
}
