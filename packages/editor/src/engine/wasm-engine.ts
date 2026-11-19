/**
 * Thin TypeScript wrapper over the engine's C ABI (engine/include/boombapbot/engine.h).
 *
 * The engine is a standalone WebAssembly module with no generated glue, so the
 * same bytes run in the AudioWorklet, on the main thread for offline export
 * and in Node for tests. Nothing here touches the DOM or the network.
 */

export const SNARE_ABI_VERSION = 3;
/** The most a pattern can swing: its off-beat steps three quarters through their pair. */
export const SNARE_SWING_MAX = 128;
const SNARE_TRACKS = 12;
const ERR_QUEUE_FULL = -1;
const BYTES_PER_EVENT = 24;
const BYTES_PER_SOUND_PARAMS = 24;
const BYTES_PER_PATTERN = 52;
const BYTES_PER_PANEL = 8;
const BYTES_PER_MEASURE = 24;
/** The longest song: twelve rhythm tracks of 64 measures. */
export const SNARE_SONG_MEASURES = 768;
/** Measures read from the log at a time. A render call rarely begins more than one. */
const MEASURE_BATCH = 16;
const PATTERN_LENGTHS_OFFSET = SNARE_TRACKS * 4;

interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc(size: number): number;
  free(pointer: number): void;
  snare_abi_version(): number;
  snare_step_ticks(stepsPerBeat: number): number;
  snare_pattern_ticks(pattern: number): number;
  snare_frames_per_tick(bpm: number, sampleRate: number): number;
  snare_tick_frame(ticks: number, bpm: number, sampleRate: number): number;
  snare_synth_frames(params: number, sampleRate: number): number;
  snare_synth_render(params: number, sampleRate: number, out: number, capacity: number): number;
  snare_sound_create(frames: number, channels: number, sampleRate: number): number;
  snare_sound_data(sound: number): number;
  snare_sound_destroy(sound: number): void;
  snare_engine_create(sampleRate: number): number;
  snare_engine_destroy(engine: number): void;
  snare_engine_set_sound(engine: number, slot: number, sound: number): number;
  snare_engine_synth_sound(engine: number, params: number): number;
  snare_engine_collect(engine: number): number;
  snare_engine_set_tempo(engine: number, bpm: number): number;
  snare_engine_set_track(engine: number, track: number, slot: number, pan: number, chokeGroup: number): number;
  snare_engine_set_track_level(engine: number, track: number, gain: number): number;
  snare_engine_set_accent(engine: number, plainGain: number, accentGain: number): number;
  snare_engine_set_master_volume(engine: number, volume: number): number;
  snare_engine_set_effect(engine: number, effect: number, wet: number): number;
  snare_effect_tail_seconds(effect: number, bpm: number): number;
  snare_engine_set_pattern(engine: number, index: number, pattern: number): number;
  snare_engine_set_step(engine: number, pattern: number, track: number, step: number, on: number): number;
  snare_engine_cue_pattern(engine: number, index: number): number;
  snare_engine_set_panel(engine: number, panel: number): number;
  snare_engine_arm_fill(engine: number, armed: number): number;
  snare_engine_set_song(engine: number, rhythms: number, count: number, loop: number): number;
  snare_song_patterns(panel: number, rhythms: number, count: number, out: number): number;
  snare_engine_play(engine: number): number;
  snare_engine_play_measures(engine: number, measures: number): number;
  snare_engine_stop(engine: number): number;
  snare_engine_trigger(engine: number, track: number, accent: number): number;
  snare_engine_render(engine: number, left: number, right: number, frames: number): void;
  snare_engine_is_playing(engine: number): number;
  snare_engine_current_step(engine: number): number;
  snare_engine_current_pattern(engine: number): number;
  snare_engine_current_measure(engine: number): number;
  snare_engine_frames_rendered(engine: number): number;
  snare_engine_stop_frame(engine: number): number;
  snare_engine_active_voices(engine: number): number;
  snare_engine_stolen_voices(engine: number): number;
  snare_engine_output_level(engine: number): number;
  snare_engine_enable_event_log(engine: number, capacity: number): number;
  snare_engine_event_count(engine: number): number;
  snare_engine_read_events(engine: number, out: number, max: number): number;
  snare_engine_read_measures(engine: number, out: number, max: number): number;
  snare_midi_export(
    patterns: number,
    patternCount: number,
    sequence: number,
    measures: number,
    trackNotes: number,
    plainVelocity: number,
    accentVelocity: number,
    bpm: number,
    out: number,
    capacity: number,
  ): number;
}

/** One synthesised sound: its number and its knob positions, each 0 to 1. */
export interface SynthSound {
  /** Sound number, which is also its slot. */
  sound: number;
  tune: number;
  tone: number;
  decay: number;
  snappy: number;
}

/** One measure, as the engine's pattern bank holds it. */
export interface EnginePattern {
  /** A bit mask per track: bit n is step n. Track 0 is the accent. */
  rows: number[];
  firstLength: number;
  secondLength: number;
  stepsPerBeat: number;
  /** How late every second step plays, from 0 to SNARE_SWING_MAX. Triplets do not swing. */
  swing: number;
}

/** How one instrument track sounds: which slot it plays, and where. */
export interface EngineTrack {
  /** Engine track, 1 to 11. */
  track: number;
  slot: number;
  pan: number;
  chokeGroup: number;
  /** Linear gain from the level knob. */
  gain: number;
}

/** The one effect on the mix, as the engine numbers them. */
export const EFFECT = {
  none: 0,
  delay: 1,
  reverb: 2,
  flanger: 3,
  chorus: 4,
  crusher: 5,
  tape: 6,
  pump: 7,
  filter: 8,
  vinyl: 9,
  phaser: 10,
} as const;
export type EffectKind = keyof typeof EFFECT;

/** The effect added to the mix, and how much of it, from 0 to 1. */
export interface EngineEffect {
  kind: EffectKind;
  wet: number;
}

/** Where a variation switch stands, as the engine numbers the positions. */
export const VARIATION = { a: 0, ab: 1, b: 2 } as const;

/** What the panel's switches ask the engine to play, measure by measure. */
export interface EnginePanel {
  /** The rhythm that plays, 0 to 15. */
  rhythm: number;
  variation: keyof typeof VARIATION;
  /** The intro/fill-in played once when armed or due. */
  fillRhythm: number;
  fillVariation: 'a' | 'b';
  /** A fill-in every this many measures; 0 for none. */
  autoFill: number;
  /** A rhythm chosen during the first beat of a measure takes over on the second. */
  firstBeatRule: boolean;
}

export type MeasureKind = 'basic' | 'fill' | 'intro';
const MEASURE_KINDS: MeasureKind[] = ['basic', 'fill', 'intro'];

/** A measure the engine began. One that changes rhythm on its second beat is reported twice. */
export interface EngineMeasure {
  frame: number;
  /** 1 for the first measure after play. */
  ordinal: number;
  pattern: number;
  kind: MeasureKind;
  /** Its measure of the song, or -1 with no song. */
  position: number;
}

export interface EngineEvent {
  frame: number;
  /** Step within the measure, or -1 for an audition. */
  step: number;
  track: number;
  accent: boolean;
  /** Pattern playing, or -1 for an audition. */
  pattern: number;
}

function buildImports(module: WebAssembly.Module): WebAssembly.Imports {
  // The module imports only emscripten_notify_memory_growth. Satisfy whatever
  // it lists with no-ops so a toolchain update cannot break instantiation.
  const imports: Record<string, Record<string, unknown>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== 'function') {
      throw new Error(`engine imports unsupported ${entry.kind} ${entry.module}.${entry.name}`);
    }
    (imports[entry.module] ??= {})[entry.name] = () => 0;
  }
  return imports as WebAssembly.Imports;
}

/** A loaded engine module. Create engines and call stateless helpers from it. */
export class SnareWasm {
  readonly exports: EngineExports;

  constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as EngineExports;
    this.exports._initialize?.();
    if (this.exports.snare_abi_version() !== SNARE_ABI_VERSION) {
      throw new Error(`unsupported engine ABI ${this.exports.snare_abi_version()}`);
    }
  }

  /** Synchronous instantiation, for the AudioWorklet and tests. */
  static fromBytes(bytes: BufferSource): SnareWasm {
    const module = new WebAssembly.Module(bytes);
    return new SnareWasm(new WebAssembly.Instance(module, buildImports(module)));
  }

  static async fromBytesAsync(bytes: BufferSource): Promise<SnareWasm> {
    const module = await WebAssembly.compile(bytes);
    return new SnareWasm(await WebAssembly.instantiate(module, buildImports(module)));
  }

  // Growing memory replaces its buffer and detaches old views, so a view is
  // reused only while the buffer is the same one. Rendering never grows
  // memory, so the audio thread does not allocate here.
  private u8: Uint8Array | null = null;
  private f32: Float32Array | null = null;

  get heapU8(): Uint8Array {
    const buffer = this.exports.memory.buffer;
    if (!this.u8 || this.u8.buffer !== buffer) this.u8 = new Uint8Array(buffer);
    return this.u8;
  }

  get heapF32(): Float32Array {
    const buffer = this.exports.memory.buffer;
    if (!this.f32 || this.f32.buffer !== buffer) this.f32 = new Float32Array(buffer);
    return this.f32;
  }

  alloc(bytes: number): number {
    const pointer = this.exports.malloc(bytes);
    if (pointer === 0) throw new Error('engine is out of memory');
    return pointer;
  }

  createEngine(sampleRate: number, blockSize = 1024): WasmEngine {
    return new WasmEngine(this, sampleRate, blockSize);
  }

  writeSoundParams(pointer: number, settings: SynthSound): void {
    const view = new DataView(this.exports.memory.buffer);
    view.setInt32(pointer, settings.sound, true);
    view.setFloat32(pointer + 4, settings.tune, true);
    view.setFloat32(pointer + 8, settings.tone, true);
    view.setFloat32(pointer + 12, settings.decay, true);
    view.setFloat32(pointer + 16, settings.snappy, true);
    view.setUint32(pointer + 20, 0, true);
  }

  writePattern(pointer: number, pattern: EnginePattern): void {
    const view = new DataView(this.exports.memory.buffer);
    for (let track = 0; track < SNARE_TRACKS; track += 1) {
      view.setUint32(pointer + track * 4, pattern.rows[track] ?? 0, true);
    }
    view.setUint8(pointer + PATTERN_LENGTHS_OFFSET, pattern.firstLength);
    view.setUint8(pointer + PATTERN_LENGTHS_OFFSET + 1, pattern.secondLength);
    view.setUint8(pointer + PATTERN_LENGTHS_OFFSET + 2, pattern.stepsPerBeat);
    view.setUint8(pointer + PATTERN_LENGTHS_OFFSET + 3, pattern.swing);
  }

  /**
   * Synthesises one sound as mono PCM. Deterministic, and never called on the
   * audio thread: the result is handed to an engine like any other sample.
   */
  synthesise(settings: SynthSound, sampleRate: number): Float32Array {
    const params = this.alloc(BYTES_PER_SOUND_PARAMS);
    try {
      this.writeSoundParams(params, settings);
      const frames = this.exports.snare_synth_frames(params, sampleRate);
      if (frames <= 0) throw new Error(`sound ${settings.sound} could not be synthesised (${frames})`);
      const out = this.alloc(frames * Float32Array.BYTES_PER_ELEMENT);
      try {
        const written = this.exports.snare_synth_render(params, sampleRate, out, frames);
        if (written !== frames) throw new Error(`sound ${settings.sound} could not be synthesised (${written})`);
        return this.heapF32.slice(out >> 2, (out >> 2) + frames);
      } finally {
        this.exports.free(out);
      }
    } finally {
      this.exports.free(params);
    }
  }

  writePanel(pointer: number, panel: EnginePanel): void {
    const view = new DataView(this.exports.memory.buffer);
    view.setUint8(pointer, panel.rhythm);
    view.setUint8(pointer + 1, VARIATION[panel.variation]);
    view.setUint8(pointer + 2, panel.fillRhythm);
    view.setUint8(pointer + 3, VARIATION[panel.fillVariation]);
    view.setUint8(pointer + 4, panel.autoFill);
    view.setUint8(pointer + 5, panel.firstBeatRule ? 1 : 0);
    view.setUint16(pointer + 6, 0, true);
  }

  /**
   * The pattern each measure of a song plays with the panel's switches as
   * they stand. The engine's own rules decide, so an export cannot disagree
   * with what is heard.
   */
  songPatterns(panel: EnginePanel, rhythms: readonly number[]): number[] {
    const count = rhythms.length;
    const memory = this.alloc(BYTES_PER_PANEL + count * 2);
    try {
      const song = memory + BYTES_PER_PANEL;
      const out = song + count;
      this.writePanel(memory, panel);
      this.heapU8.set(rhythms, song);
      const written = this.exports.snare_song_patterns(memory, song, count, out);
      if (written !== count) throw new Error(`the engine rejected a song (${written})`);
      return Array.from(this.heapU8.subarray(out, out + count));
    } finally {
      this.exports.free(memory);
    }
  }

  /** Ticks in one measure of a pattern. */
  patternTicks(pattern: EnginePattern): number {
    const pointer = this.alloc(BYTES_PER_PATTERN);
    try {
      this.writePattern(pointer, pattern);
      const ticks = this.exports.snare_pattern_ticks(pointer);
      if (ticks <= 0) throw new Error(`the engine rejected a pattern (${ticks})`);
      return ticks;
    } finally {
      this.exports.free(pointer);
    }
  }

  /** How long an effect rings on after its last hit, in seconds. */
  effectTailSeconds(kind: EffectKind, bpm: number): number {
    return this.exports.snare_effect_tail_seconds(EFFECT[kind], bpm);
  }

  /** Output frame of a tick counted from where playback started. */
  tickFrame(ticks: number, bpm: number, sampleRate: number): number {
    return this.exports.snare_tick_frame(ticks, bpm, sampleRate);
  }

  /**
   * Builds a Standard MIDI File of `sequence`, which names the pattern played
   * in each measure. `trackNotes` holds a MIDI note per track.
   */
  midiExport(
    patterns: EnginePattern[],
    sequence: number[],
    trackNotes: number[],
    velocities: { plain: number; accented: number },
    bpm: number,
  ): Uint8Array {
    const bank = this.alloc(patterns.length * BYTES_PER_PATTERN);
    const order = this.alloc(sequence.length);
    const notes = this.alloc(SNARE_TRACKS);
    try {
      patterns.forEach((pattern, index) => this.writePattern(bank + index * BYTES_PER_PATTERN, pattern));
      const heap = this.heapU8;
      sequence.forEach((pattern, measure) => {
        heap[order + measure] = pattern;
      });
      for (let track = 0; track < SNARE_TRACKS; track += 1) heap[notes + track] = trackNotes[track] ?? 0;
      const write = (out: number, capacity: number) =>
        this.exports.snare_midi_export(
          bank,
          patterns.length,
          order,
          sequence.length,
          notes,
          velocities.plain,
          velocities.accented,
          bpm,
          out,
          capacity,
        );
      const size = write(0, 0);
      if (size <= 0) throw new Error(`MIDI export failed (${size})`);
      const out = this.alloc(size);
      try {
        write(out, size);
        return this.heapU8.slice(out, out + size);
      } finally {
        this.exports.free(out);
      }
    } finally {
      this.exports.free(bank);
      this.exports.free(order);
      this.exports.free(notes);
    }
  }
}

/** One engine instance: a scheduler, a voice pool and a mix bus. */
export class WasmEngine {
  readonly sampleRate: number;
  readonly blockSize: number;
  private readonly wasm: SnareWasm;
  private handle: number;
  private readonly left: number;
  private readonly right: number;
  /** Scratch for one pattern or one set of sound parameters. */
  private readonly scratch: number;
  private readonly measures: number;
  private readonly song: number;

  constructor(wasm: SnareWasm, sampleRate: number, blockSize: number) {
    this.wasm = wasm;
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.handle = wasm.exports.snare_engine_create(sampleRate);
    if (this.handle === 0) throw new Error(`engine rejected sample rate ${sampleRate}`);
    this.left = wasm.alloc(blockSize * 4);
    this.right = wasm.alloc(blockSize * 4);
    this.scratch = wasm.alloc(Math.max(BYTES_PER_PATTERN, BYTES_PER_SOUND_PARAMS, BYTES_PER_PANEL));
    this.measures = wasm.alloc(BYTES_PER_MEASURE * MEASURE_BATCH);
    this.song = wasm.alloc(SNARE_SONG_MEASURES);
  }

  private get x(): EngineExports {
    return this.wasm.exports;
  }

  /**
   * Queues a control message. If the queue is full because audio is not being
   * pulled (for example while the context is suspended), drain it with a
   * zero-length render and try again. Safe here because WebAssembly runs the
   * control and render calls on one thread.
   */
  private send(call: () => number): void {
    let result = call();
    if (result === ERR_QUEUE_FULL) {
      this.x.snare_engine_render(this.handle, this.left, this.right, 0);
      result = call();
    }
    if (result !== 0) throw new Error(`engine rejected a control message (${result})`);
  }

  /**
   * Gives one slot a new sound from the next block. The samples are copied
   * once, straight into the buffer the engine will play.
   */
  setSound(slot: number, pcm: Float32Array, channels: number, sampleRate: number): void {
    const sound = this.x.snare_sound_create(pcm.length / channels, channels, sampleRate);
    if (sound === 0) throw new Error(`engine rejected a sound for slot ${slot}`);
    this.wasm.heapF32.set(pcm, this.x.snare_sound_data(sound) >> 2);
    const result = this.x.snare_engine_set_sound(this.handle, slot, sound);
    if (result !== 0) {
      this.x.snare_sound_destroy(sound);
      throw new Error(`engine rejected a sound for slot ${slot} (${result})`);
    }
  }

  /** Synthesises a sound at this engine's rate and gives it to its slot. */
  synthSound(settings: SynthSound): void {
    this.wasm.writeSoundParams(this.scratch, settings);
    const result = this.x.snare_engine_synth_sound(this.handle, this.scratch);
    if (result !== 0) throw new Error(`sound ${settings.sound} could not be synthesised (${result})`);
  }

  setTempo(bpm: number): void {
    this.send(() => this.x.snare_engine_set_tempo(this.handle, bpm));
  }

  setTrack(track: EngineTrack): void {
    this.send(() =>
      this.x.snare_engine_set_track(this.handle, track.track, track.slot, track.pan, track.chokeGroup),
    );
    this.send(() => this.x.snare_engine_set_track_level(this.handle, track.track, track.gain));
  }

  /** Gains of a hit on a plain step and on an accented one. */
  setAccent(plain: number, accented: number): void {
    this.send(() => this.x.snare_engine_set_accent(this.handle, plain, accented));
  }

  setMasterVolume(volume: number): void {
    this.send(() => this.x.snare_engine_set_master_volume(this.handle, volume));
  }

  setEffect(effect: EngineEffect): void {
    this.send(() => this.x.snare_engine_set_effect(this.handle, EFFECT[effect.kind], effect.wet));
  }

  setPattern(index: number, pattern: EnginePattern): void {
    this.wasm.writePattern(this.scratch, pattern);
    this.send(() => this.x.snare_engine_set_pattern(this.handle, index, this.scratch));
  }

  /** Loops one pattern, from the next measure or from the start when stopped. */
  cuePattern(index: number): void {
    this.send(() => this.x.snare_engine_cue_pattern(this.handle, index));
  }

  /** Plays what the panel asks for, measure by measure. A change is read at the next bar line. */
  setPanel(panel: EnginePanel): void {
    this.wasm.writePanel(this.scratch, panel);
    this.send(() => this.x.snare_engine_set_panel(this.handle, this.scratch));
  }

  /**
   * Gives the engine a song: the rhythm of each measure. Play then follows it
   * in place of the panel's rhythm, starting over at the end or stopping
   * there. An empty song removes it.
   */
  setSong(rhythms: readonly number[], loop: boolean): void {
    if (rhythms.length > SNARE_SONG_MEASURES) throw new Error(`a song holds ${SNARE_SONG_MEASURES} measures`);
    this.wasm.heapU8.set(rhythms, this.song);
    this.send(() => this.x.snare_engine_set_song(this.handle, this.song, rhythms.length, loop ? 1 : 0));
  }

  /** TAP: the panel's intro/fill-in plays once, as the intro or at the next bar line. */
  armFill(armed: boolean): void {
    this.send(() => this.x.snare_engine_arm_fill(this.handle, armed ? 1 : 0));
  }

  /** Takes the measures begun since the last call. Returns null when there are none, without allocating. */
  takeMeasures(): EngineMeasure[] | null {
    let taken: EngineMeasure[] | null = null;
    for (;;) {
      const count = this.x.snare_engine_read_measures(this.handle, this.measures, MEASURE_BATCH);
      if (count === 0) return taken;
      const view = new DataView(this.x.memory.buffer, this.measures, count * BYTES_PER_MEASURE);
      taken ??= [];
      for (let i = 0; i < count; i += 1) {
        const offset = i * BYTES_PER_MEASURE;
        taken.push({
          frame: view.getFloat64(offset, true),
          ordinal: view.getInt32(offset + 8, true),
          pattern: view.getInt32(offset + 12, true),
          kind: MEASURE_KINDS[view.getInt32(offset + 16, true)] ?? 'basic',
          position: view.getInt32(offset + 20, true),
        });
      }
    }
  }

  play(): void {
    this.send(() => this.x.snare_engine_play(this.handle));
  }

  /** Plays `measures` measures and then stops the scheduler. Tails ring on. */
  playMeasures(measures: number): void {
    this.send(() => this.x.snare_engine_play_measures(this.handle, measures));
  }

  stop(): void {
    this.send(() => this.x.snare_engine_stop(this.handle));
  }

  /** One hit of an instrument track, outside the pattern. */
  trigger(track: number, accent: boolean): void {
    this.send(() => this.x.snare_engine_trigger(this.handle, track, accent ? 1 : 0));
  }

  /**
   * Renders up to `blockSize` frames and copies them out.
   * Allocation-free: the caller supplies the destination arrays.
   */
  render(left: Float32Array, right: Float32Array, frames = left.length): void {
    if (frames > this.blockSize) throw new Error('render block is larger than the engine block size');
    this.x.snare_engine_render(this.handle, this.left, this.right, frames);
    const heap = this.wasm.heapF32;
    const leftStart = this.left >> 2;
    const rightStart = this.right >> 2;
    for (let i = 0; i < frames; i += 1) {
      left[i] = heap[leftStart + i]!;
      right[i] = heap[rightStart + i]!;
    }
  }

  get playing(): boolean {
    return this.x.snare_engine_is_playing(this.handle) !== 0;
  }

  /** Last step that fired within its measure, or -1 while stopped. */
  get currentStep(): number {
    return this.x.snare_engine_current_step(this.handle);
  }

  get currentPattern(): number {
    return this.x.snare_engine_current_pattern(this.handle);
  }

  /** Frame at which play ended by itself (a bounded play, or a song's end), or -1 if it has not. */
  get stopFrame(): number {
    return this.x.snare_engine_stop_frame(this.handle);
  }

  get framesRendered(): number {
    return this.x.snare_engine_frames_rendered(this.handle);
  }

  get activeVoices(): number {
    return this.x.snare_engine_active_voices(this.handle);
  }

  get stolenVoices(): number {
    return this.x.snare_engine_stolen_voices(this.handle);
  }

  /** How loud the output is now, for a meter: its root mean square, from 0. */
  get outputLevel(): number {
    return this.x.snare_engine_output_level(this.handle);
  }

  /** Records hits for tests and alignment checks. Call before rendering. */
  enableEventLog(capacity: number): void {
    this.x.snare_engine_enable_event_log(this.handle, capacity);
  }

  readEvents(): EngineEvent[] {
    const count = this.x.snare_engine_event_count(this.handle);
    if (count === 0) return [];
    const pointer = this.wasm.alloc(count * BYTES_PER_EVENT);
    try {
      const read = this.x.snare_engine_read_events(this.handle, pointer, count);
      const view = new DataView(this.x.memory.buffer, pointer, read * BYTES_PER_EVENT);
      const events: EngineEvent[] = [];
      for (let i = 0; i < read; i += 1) {
        const offset = i * BYTES_PER_EVENT;
        events.push({
          frame: view.getFloat64(offset, true),
          step: view.getInt32(offset + 8, true),
          track: view.getInt32(offset + 12, true),
          accent: view.getInt32(offset + 16, true) !== 0,
          pattern: view.getInt32(offset + 20, true),
        });
      }
      return events;
    } finally {
      this.x.free(pointer);
    }
  }

  destroy(): void {
    if (this.handle === 0) return;
    this.x.snare_engine_destroy(this.handle);
    this.x.free(this.left);
    this.x.free(this.right);
    this.x.free(this.scratch);
    this.x.free(this.measures);
    this.x.free(this.song);
    this.handle = 0;
  }
}
