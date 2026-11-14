/**
 * Thin TypeScript wrapper over the engine's C ABI (engine/include/boombapbot/engine.h).
 *
 * The engine is a standalone WebAssembly module with no generated glue, so the
 * same bytes run in the AudioWorklet, on the main thread for offline export
 * and in Node for tests. Nothing here touches the DOM or the network.
 */

export const SNARE_STEPS = 16;
export const SNARE_MAX_ROLES = 16;
const ERR_QUEUE_FULL = -1;
const BYTES_PER_EVENT = 24;

interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc(size: number): number;
  free(pointer: number): void;
  snare_abi_version(): number;
  snare_step_time(step: number, swing: number): number;
  snare_frames_per_step(bpm: number, sampleRate: number): number;
  snare_loop_frames(bpm: number, sampleRate: number, steps: number): number;
  snare_kit_create(): number;
  snare_kit_destroy(kit: number): void;
  snare_kit_set_voice(
    kit: number,
    role: number,
    pcm: number,
    frames: number,
    channels: number,
    sampleRate: number,
    gain: number,
    pan: number,
    chokeGroup: number,
  ): number;
  snare_engine_create(sampleRate: number): number;
  snare_engine_destroy(engine: number): void;
  snare_engine_commit_kit(engine: number, kit: number): number;
  snare_engine_collect(engine: number): number;
  snare_engine_set_tempo(engine: number, bpm: number): number;
  snare_engine_set_swing(engine: number, swing: number): number;
  snare_engine_set_master_gain(engine: number, gain: number): number;
  snare_engine_set_step(engine: number, role: number, step: number, velocity: number): number;
  snare_engine_set_row(engine: number, role: number, velocities: number): number;
  snare_engine_clear_pattern(engine: number): number;
  snare_engine_play(engine: number): number;
  snare_engine_play_loops(engine: number, loops: number): number;
  snare_engine_stop(engine: number): number;
  snare_engine_trigger(engine: number, role: number, velocity: number): number;
  snare_engine_render(engine: number, left: number, right: number, frames: number): void;
  snare_engine_is_playing(engine: number): number;
  snare_engine_current_step(engine: number): number;
  snare_engine_frames_rendered(engine: number): number;
  snare_engine_active_voices(engine: number): number;
  snare_engine_stolen_voices(engine: number): number;
  snare_engine_enable_event_log(engine: number, capacity: number): number;
  snare_engine_event_count(engine: number): number;
  snare_engine_read_events(engine: number, out: number, max: number): number;
  snare_midi_export(
    velocities: number,
    roles: number,
    notes: number,
    bpm: number,
    swing: number,
    out: number,
    capacity: number,
  ): number;
  snare_midi_step_tick(step: number, swing: number): number;
}

/** One voice of a kit, decoded and ready to hand to the engine. */
export interface EngineVoice {
  /** Engine role slot. */
  role: number;
  /** Interleaved float PCM. */
  pcm: Float32Array;
  frames: number;
  channels: number;
  sampleRate: number;
  gain: number;
  pan: number;
  chokeGroup: number;
}

export interface EngineEvent {
  frame: number;
  /** Pattern step, or -1 for an audition trigger. */
  step: number;
  role: number;
  velocity: number;
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
    if (this.exports.snare_abi_version() !== 1) {
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

  /** Musical time of a step in sixteenths, using the playback timeline. */
  stepTime(step: number, swing: number): number {
    return this.exports.snare_step_time(step, swing);
  }

  /** Frames in one 16-step loop. */
  loopFrames(bpm: number, sampleRate: number): number {
    return this.exports.snare_loop_frames(bpm, sampleRate, SNARE_STEPS);
  }

  midiStepTick(step: number, swing: number): number {
    return this.exports.snare_midi_step_tick(step, swing);
  }

  /**
   * Builds a Standard MIDI File. `rows` holds 16 velocities per role, in role
   * slot order, and `notes` one MIDI note per role.
   */
  midiExport(rows: ArrayLike<number>[], notes: ArrayLike<number>, bpm: number, swing: number): Uint8Array {
    const roles = rows.length;
    const velocities = this.alloc(roles * SNARE_STEPS);
    const noteTable = this.alloc(roles);
    try {
      const heap = this.heapU8;
      rows.forEach((row, role) => {
        for (let step = 0; step < SNARE_STEPS; step += 1) {
          heap[velocities + role * SNARE_STEPS + step] = row[step] ?? 0;
        }
        heap[noteTable + role] = notes[role] ?? 0;
      });
      const size = this.exports.snare_midi_export(velocities, roles, noteTable, bpm, swing, 0, 0);
      if (size <= 0) throw new Error(`MIDI export failed (${size})`);
      const out = this.alloc(size);
      try {
        this.exports.snare_midi_export(velocities, roles, noteTable, bpm, swing, out, size);
        return this.heapU8.slice(out, out + size);
      } finally {
        this.exports.free(out);
      }
    } finally {
      this.exports.free(velocities);
      this.exports.free(noteTable);
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
  private readonly row: number;

  constructor(wasm: SnareWasm, sampleRate: number, blockSize: number) {
    this.wasm = wasm;
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.handle = wasm.exports.snare_engine_create(sampleRate);
    if (this.handle === 0) throw new Error(`engine rejected sample rate ${sampleRate}`);
    this.left = wasm.alloc(blockSize * 4);
    this.right = wasm.alloc(blockSize * 4);
    this.row = wasm.alloc(SNARE_STEPS);
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

  /** Stages a kit and hands it over. It becomes active at the next block. */
  loadKit(voices: EngineVoice[]): void {
    const kit = this.x.snare_kit_create();
    for (const voice of voices) {
      const bytes = voice.pcm.length * 4;
      const pointer = this.wasm.alloc(bytes);
      this.wasm.heapF32.set(voice.pcm, pointer / 4);
      const result = this.x.snare_kit_set_voice(
        kit,
        voice.role,
        pointer,
        voice.frames,
        voice.channels,
        voice.sampleRate,
        voice.gain,
        voice.pan,
        voice.chokeGroup,
      );
      this.x.free(pointer);
      if (result !== 0) {
        this.x.snare_kit_destroy(kit);
        throw new Error(`engine rejected the sample for role ${voice.role} (${result})`);
      }
    }
    this.x.snare_engine_commit_kit(this.handle, kit);
  }

  /** Frees replaced kits whose tails have ended. Returns how many remain. */
  collect(): number {
    return this.x.snare_engine_collect(this.handle);
  }

  setRow(role: number, velocities: ArrayLike<number>): void {
    const heap = this.wasm.heapU8;
    for (let step = 0; step < SNARE_STEPS; step += 1) {
      heap[this.row + step] = velocities[step] ?? 0;
    }
    this.send(() => this.x.snare_engine_set_row(this.handle, role, this.row));
  }

  setStep(role: number, step: number, velocity: number): void {
    this.send(() => this.x.snare_engine_set_step(this.handle, role, step, velocity));
  }

  clearPattern(): void {
    this.send(() => this.x.snare_engine_clear_pattern(this.handle));
  }

  setTempo(bpm: number): void {
    this.send(() => this.x.snare_engine_set_tempo(this.handle, bpm));
  }

  setSwing(swing: number): void {
    this.send(() => this.x.snare_engine_set_swing(this.handle, swing));
  }

  setMasterGain(gain: number): void {
    this.send(() => this.x.snare_engine_set_master_gain(this.handle, gain));
  }

  play(): void {
    this.send(() => this.x.snare_engine_play(this.handle));
  }

  /** Plays `loops` bars and then stops the scheduler. Tails ring on. */
  playLoops(loops: number): void {
    this.send(() => this.x.snare_engine_play_loops(this.handle, loops));
  }

  stop(): void {
    this.send(() => this.x.snare_engine_stop(this.handle));
  }

  trigger(role: number, velocity: number): void {
    this.send(() => this.x.snare_engine_trigger(this.handle, role, velocity));
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

  /** Last step that fired, or -1 while stopped. */
  get currentStep(): number {
    return this.x.snare_engine_current_step(this.handle);
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
          role: view.getInt32(offset + 12, true),
          velocity: view.getInt32(offset + 16, true),
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
    this.x.free(this.row);
    this.handle = 0;
  }
}
