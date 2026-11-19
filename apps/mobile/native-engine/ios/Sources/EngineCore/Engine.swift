import BoombapbotEngine
import EngineRender
import Foundation

/// What the engine refused, in words.
public struct EngineRefused: LocalizedError, Equatable, CustomStringConvertible {
    public let description: String

    public init(description: String) {
        self.description = description
    }

    public var errorDescription: String? { description }
}

/// The ABI the bindings here were written for (`SNARE_ABI_VERSION` in engine.h).
let abiVersion: UInt32 = 3
/// Measures read from the log at a time. A buffer rarely begins more than one.
private let measureBatch = 16
/// How long a control call waits for the audio thread to empty a full queue.
private let queueWait: TimeInterval = 0.25

/// One engine, for the one thread that makes its control calls. What the
/// audio thread gets is its `Renderer`.
public final class Engine {
    let raw: OpaquePointer
    public let sampleRate: Double

    public init(sampleRate: Double) throws {
        let abi = snare_abi_version()
        guard abi == abiVersion else {
            throw EngineRefused(description: "This plug-in was built for engine ABI \(abiVersion), and the engine in it is \(abi).")
        }
        guard let raw = snare_engine_create(sampleRate) else {
            throw EngineRefused(description: "The engine cannot run at \(Int(sampleRate)) Hz.")
        }
        self.raw = raw
        self.sampleRate = sampleRate
    }

    deinit {
        snare_engine_destroy(raw)
    }

    /// Makes a queued control call. The queue empties at every buffer the
    /// audio thread renders, so a full one is waited for briefly.
    private func ask(_ what: String, _ call: (OpaquePointer) -> Int32) throws {
        let giveUp = Date().addingTimeInterval(queueWait)
        while true {
            let code = call(raw)
            if code == Int32(SNARE_OK) { return }
            if code == Int32(SNARE_ERR_QUEUE_FULL), Date() < giveUp {
                Thread.sleep(forTimeInterval: 0.001)
                continue
            }
            throw EngineRefused(description: "The engine refused \(what) (\(code)).")
        }
    }

    /// Does what one command asks. A sound made is acknowledged by its slot.
    public func apply(_ command: Command) throws -> Report? {
        switch command {
        case let .synth(sound):
            var params = SnareSoundParams(sound: sound.sound, tune: sound.tune, tone: sound.tone, decay: sound.decay,
                                          snappy: sound.snappy, seed: 0)
            // Synthesised here, on the control thread, at this engine's rate.
            let code = snare_engine_synth_sound(raw, &params)
            guard code == Int32(SNARE_OK) else {
                throw EngineRefused(description: "Sound \(sound.sound) could not be made (\(code)).")
            }
            return .sound(slot: sound.sound)
        case let .tracks(tracks):
            for track in tracks {
                try ask("a track") { snare_engine_set_track($0, track.track, track.slot, track.pan, track.chokeGroup) }
                try ask("a track's level") { snare_engine_set_track_level($0, track.track, track.gain) }
            }
        case let .mix(plain, accented, master):
            try ask("the accent") { snare_engine_set_accent($0, plain, accented) }
            try ask("the volume") { snare_engine_set_master_volume($0, master) }
        case let .patterns(patterns):
            for entry in patterns {
                var pattern = try Engine.pattern(entry.pattern)
                try ask("a pattern") { snare_engine_set_pattern($0, entry.index, &pattern) }
            }
        case let .tempo(bpm):
            try ask("the tempo") { snare_engine_set_tempo($0, bpm) }
        case let .panel(panel):
            var panel = Engine.panel(panel)
            try ask("the panel") { snare_engine_set_panel($0, &panel) }
        case let .cue(pattern):
            try ask("a cue") { snare_engine_cue_pattern($0, pattern) }
        case let .effect(effect, wet):
            try ask("the effect") { snare_engine_set_effect($0, effect, wet) }
        case let .fill(armed):
            try ask("the fill-in") { snare_engine_arm_fill($0, armed ? 1 : 0) }
        case let .song(rhythms, loop):
            guard let count = Int32(exactly: rhythms.count) else { throw EngineRefused(description: "The song is too long.") }
            try rhythms.withUnsafeBufferPointer { song in
                try ask("a song") { snare_engine_set_song($0, song.baseAddress, count, loop ? 1 : 0) }
            }
        case .play:
            try ask("play") { snare_engine_play($0) }
        case .stop:
            try ask("stop") { snare_engine_stop($0) }
        case let .trigger(track, accent):
            try ask("a hit") { snare_engine_trigger($0, track, accent ? 1 : 0) }
        }
        return nil
    }

    private static func pattern(_ pattern: Pattern) throws -> SnarePattern {
        let tracks = Int(SNARE_TRACKS)
        guard pattern.rows.count <= tracks else {
            throw EngineRefused(description: "A pattern has \(pattern.rows.count) rows, and the engine has \(tracks) tracks.")
        }
        var engine = SnarePattern()
        withUnsafeMutableBytes(of: &engine.rows) { rows in
            let row = rows.bindMemory(to: UInt32.self)
            for (track, bits) in pattern.rows.enumerated() { row[track] = bits }
        }
        engine.len1 = pattern.firstLength
        engine.len2 = pattern.secondLength
        engine.steps_per_beat = pattern.stepsPerBeat
        engine.swing = pattern.swing
        return engine
    }

    private static func variation(_ variation: Variation) -> UInt8 {
        switch variation {
        case .a: return 0
        case .ab: return 1
        case .b: return 2
        }
    }

    private static func panel(_ panel: Panel) -> SnarePanel {
        var engine = SnarePanel()
        engine.rhythm = panel.rhythm
        engine.variation = variation(panel.variation)
        engine.fill_rhythm = panel.fillRhythm
        engine.fill_variation = variation(panel.fillVariation)
        engine.auto_fill = panel.autoFill
        engine.first_beat_rule = panel.firstBeatRule ? 1 : 0
        return engine
    }

    /// Frees replaced sounds whose tails have finished.
    public func collect() {
        snare_engine_collect(raw)
    }

    /// Takes the measures begun since the last call, oldest first.
    public func takeMeasures() -> [Measure] {
        var taken: [Measure] = []
        var batch = [SnareMeasure](repeating: SnareMeasure(), count: measureBatch)
        while true {
            let count = Int(snare_engine_read_measures(raw, &batch, Int32(measureBatch)))
            taken += batch.prefix(max(0, min(count, measureBatch))).map { measure in
                Measure(frame: measure.frame, ordinal: measure.ordinal, pattern: measure.pattern,
                        kind: measure.kind == 1 ? .fill : measure.kind == 2 ? .intro : .basic, position: measure.position)
            }
            if count < measureBatch { return taken }
        }
    }

    public var isPlaying: Bool { snare_engine_is_playing(raw) != 0 }
    public var currentStep: Int32 { snare_engine_current_step(raw) }
    public var currentPattern: Int32 { snare_engine_current_pattern(raw) }
    public var framesRendered: Double { snare_engine_frames_rendered(raw) }
    public var stopFrame: Double { snare_engine_stop_frame(raw) }
    public var activeVoices: Int32 { snare_engine_active_voices(raw) }
    public var stolenVoices: UInt32 { snare_engine_stolen_voices(raw) }
    public var outputLevel: Double { snare_engine_output_level(raw) }
}

/// The audio thread's half of an engine: the one caller of its render. It
/// is the C of `EngineRender`, so a buffer is filled without the Swift
/// runtime, a lock or an allocation.
public final class Renderer {
    /// What a render block captures and hands back to `bb_render_fill`.
    public let state: OpaquePointer
    /// Kept so that the engine outlives its renderer.
    private let engine: Engine

    public init(_ engine: Engine) throws {
        guard let state = bb_render_create(engine.raw) else { throw EngineRefused(description: "There is no memory for the audio thread.") }
        self.state = state
        self.engine = engine
    }

    /// Only once the audio thread will not call it again.
    deinit {
        bb_render_destroy(state)
    }

    /// The peak since the last call, which starts the next one from silence.
    public func takePeak() -> Float { bb_render_take_peak(state) }
    public var buffers: UInt64 { bb_render_buffers(state) }
}
