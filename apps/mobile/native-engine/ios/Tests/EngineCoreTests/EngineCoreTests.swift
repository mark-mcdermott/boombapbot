@testable import EngineCore
import EngineRender
import XCTest

// The plug-in's engine side with no sound device: the test asks for buffers
// as the phone would. The engine's own promise that its render allocates
// nothing is held by its `test_realtime`; what the C around it does is
// read here.

private let rate = 48_000.0
private let kick: Int32 = 1
private let hat: Int32 = 2

private func knobs(_ sound: Int32) -> Sound { Sound(sound: sound, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5) }

/// An engine told a beat the way the page tells one: two sounds on two
/// tracks, a kick on every beat and a hat between, round and round.
private func engineWithABeat() throws -> Engine {
    let engine = try Engine(sampleRate: rate)
    let beat: [[String: Any]] = [
        ["type": "tempo", "bpm": 120],
        ["type": "tracks", "tracks": [
            ["track": kick, "slot": 0, "pan": 0, "chokeGroup": 0, "gain": 0.9],
            ["track": hat, "slot": 2, "pan": 0.3, "chokeGroup": 0, "gain": 0.6],
        ]],
        ["type": "mix", "plain": 0.7, "accented": 1, "master": 0.8],
        ["type": "patterns", "patterns": [["index": 0, "pattern": [
            "rows": [0, 0x1111, 0x4444], "firstLength": 16, "secondLength": 0, "stepsPerBeat": 4, "swing": 0,
        ]]]],
        ["type": "cue", "pattern": 0],
        ["type": "effect", "effect": 0, "wet": 0],
    ]
    for json in beat { XCTAssertNil(try engine.apply(try Command(json: json))) }
    for sound: Int32 in [0, 2] {
        XCTAssertEqual(try engine.apply(.synth(knobs(sound))), .sound(slot: sound))
    }
    return engine
}

private func loudest(_ samples: [Float]) -> Float { samples.reduce(0) { max($0, abs($1)) } }

final class CommandTests: XCTestCase {
    private func command(_ json: [String: Any]) throws -> Command { try Command(json: json) }

    func testReadsTheCommandsAsTheEditorWritesThem() throws {
        XCTAssertEqual(try command(["type": "synth", "sound": ["sound": 3, "tune": 0.25, "tone": 0.5, "decay": 0.75, "snappy": 1]]),
                       .synth(Sound(sound: 3, tune: 0.25, tone: 0.5, decay: 0.75, snappy: 1)))
        XCTAssertEqual(try command(["type": "tracks", "tracks": [["track": 1, "slot": 0, "pan": -0.5, "chokeGroup": 2, "gain": 0.8]]]),
                       .tracks([Track(track: 1, slot: 0, pan: -0.5, chokeGroup: 2, gain: 0.8)]))
        XCTAssertEqual(
            try command(["type": "patterns", "patterns": [["index": 2, "pattern": [
                "rows": [0, 4369, 4_294_967_295], "firstLength": 16, "secondLength": 0, "stepsPerBeat": 4, "swing": 64,
            ]]]]),
            .patterns([BankPattern(index: 2, pattern: Pattern(rows: [0, 4369, UInt32.max], firstLength: 16, secondLength: 0, stepsPerBeat: 4, swing: 64))]))
        XCTAssertEqual(
            try command(["type": "panel", "panel": ["rhythm": 3, "variation": "ab", "fillRhythm": 12, "fillVariation": "b",
                                                    "autoFill": 4, "firstBeatRule": true]]),
            .panel(Panel(rhythm: 3, variation: .ab, fillRhythm: 12, fillVariation: .b, autoFill: 4, firstBeatRule: true)))
        XCTAssertEqual(try command(["type": "mix", "plain": 0.6, "accented": 1, "master": 0.8]), .mix(plain: 0.6, accented: 1, master: 0.8))
        XCTAssertEqual(try command(["type": "tempo", "bpm": 97.5]), .tempo(97.5))
        XCTAssertEqual(try command(["type": "cue", "pattern": 1]), .cue(1))
        XCTAssertEqual(try command(["type": "effect", "effect": 9, "wet": 0.3]), .effect(9, wet: 0.3))
        XCTAssertEqual(try command(["type": "fill", "armed": true]), .fill(true))
        XCTAssertEqual(try command(["type": "song", "rhythms": [0, 1, 12], "loop": true]), .song(rhythms: [0, 1, 12], loop: true))
        XCTAssertEqual(try command(["type": "play"]), .play)
        XCTAssertEqual(try command(["type": "stop"]), .stop)
        XCTAssertEqual(try command(["type": "trigger", "track": 5, "accent": false]), .trigger(track: 5, accent: false))
    }

    func testRefusesWhatIsNotACommand() {
        XCTAssertThrowsError(try command(["type": "sound", "slot": 0, "pcm": []]))
        XCTAssertThrowsError(try command(["type": "tempo"]))
        XCTAssertThrowsError(try command(["type": "tempo", "bpm": true]))
        XCTAssertThrowsError(try command(["type": "fill", "armed": 1]))
        XCTAssertThrowsError(try command(["type": "cue", "pattern": 1.5]))
        XCTAssertThrowsError(try command(["type": "song", "rhythms": [300], "loop": false]))
        XCTAssertThrowsError(try Command(json: "play"))
    }

    func testWritesTheReportsAsTheEditorReadsThem() {
        func json(_ report: Report) -> NSDictionary { report.json as NSDictionary }
        XCTAssertEqual(json(.ready(sampleRate: 48000)), ["type": "ready", "sampleRate": 48000.0])
        XCTAssertEqual(json(.error("no device")), ["type": "error", "message": "no device"])
        XCTAssertEqual(json(.sound(slot: 4)), ["type": "sound", "slot": 4])
        XCTAssertEqual(json(.position(step: 3, pattern: 1, playing: true)), ["type": "position", "step": 3, "pattern": 1, "playing": true])
        XCTAssertEqual(json(.measures([Measure(frame: 96, ordinal: 1, pattern: 2, kind: .fill, position: -1)])),
                       ["type": "measures", "measures": [["frame": 96.0, "ordinal": 1, "pattern": 2, "kind": "fill", "position": -1]]])
        XCTAssertEqual(json(.ended), ["type": "ended"])
        XCTAssertEqual(json(.level(0.25)), ["type": "level", "level": 0.25])
        XCTAssertEqual(json(.stats(frames: 4800, peak: 0.5, peakEver: 0.75, voices: 2, stolen: 1)),
                       ["type": "stats", "frames": 4800.0, "peak": 0.5, "peakEver": 0.75, "voices": 2, "stolen": 1])
    }
}

final class EngineTests: XCTestCase {
    func testABufferHoldsTheBeatInStereoAndInMono() throws {
        let engine = try engineWithABeat()
        let renderer = try Renderer(engine)
        XCTAssertNil(try engine.apply(.play))

        var left = [Float](repeating: 0, count: 4800)
        var right = [Float](repeating: 0, count: 4800)
        bb_render_fill(renderer.state, &left, &right, 4800)
        let stereo = max(loudest(left), loudest(right))
        XCTAssertGreaterThan(stereo, 0.05)
        XCTAssertEqual(renderer.takePeak(), stereo, "the meter holds the largest sample written")
        XCTAssertEqual(renderer.takePeak(), 0, "and starts again from silence")

        // Longer than the scratch a mono buffer is rendered through.
        var mono = [Float](repeating: 0, count: 10_000)
        bb_render_fill(renderer.state, &mono, nil, 10_000)
        XCTAssertGreaterThan(loudest(mono), 0.01)
        XCTAssertEqual(renderer.buffers, 2)
        XCTAssertEqual(engine.framesRendered, 14_800)
    }

    func testThePageIsToldWhatTheWorkletWouldTellIt() throws {
        let engine = try engineWithABeat()
        let renderer = try Renderer(engine)
        var watch = Watch(now: 0)
        var left = [Float](repeating: 0, count: 256)
        var right = [Float](repeating: 0, count: 256)
        func fill() { bb_render_fill(renderer.state, &left, &right, 256) }
        func reports(at now: TimeInterval) -> [Report] {
            var reports: [Report] = []
            watch.look(engine, renderer, now: now) { reports.append($0) }
            return reports
        }

        // Stopped: where the engine stands, once, and nothing after it.
        fill()
        XCTAssertEqual(reports(at: 0), [.position(step: -1, pattern: 0, playing: false)])
        XCTAssertEqual(reports(at: 0), [])

        // Playing: the measure that began and the step that sounded, each once.
        XCTAssertNil(try engine.apply(.play))
        fill()
        let started = reports(at: 0)
        XCTAssertEqual(started.count, 2)
        guard case let .measures(measures) = started.first else { return XCTFail("\(started)") }
        XCTAssertEqual(measures.map(\.ordinal), [1])
        XCTAssertEqual(measures.first?.kind, .basic)
        XCTAssertEqual(started.last, .position(step: 0, pattern: 0, playing: true))
        XCTAssertEqual(reports(at: 0), [])

        // A step is an eighth of a second at this tempo: the next one is reported when it sounds.
        for _ in 0 ..< Int(rate) / 8 / 256 + 1 { fill() }
        XCTAssertEqual(reports(at: 0), [.position(step: 1, pattern: 0, playing: true)])

        // The meter thirty times a second and the stats ten: neither before its time.
        let level = reports(at: 0.04)
        XCTAssertEqual(level.count, 1)
        guard case let .level(loudness) = level.first else { return XCTFail("\(level)") }
        XCTAssertGreaterThan(loudness, 0)
        let stats = reports(at: 0.11)
        guard stats.count == 1, case let .stats(frames, peak, peakEver, voices, stolen) = stats[0] else { return XCTFail("\(stats)") }
        XCTAssertEqual(frames, engine.framesRendered)
        XCTAssertGreaterThan(peak, 0.05)
        XCTAssertEqual(peak, peakEver)
        XCTAssertGreaterThanOrEqual(voices, 1)
        XCTAssertEqual(stolen, 0)
        XCTAssertEqual(watch.peakEver, peak)

        // The next stats start from silence, and remember the loudest so far.
        guard case let .stats(_, nextPeak, nextEver, _, _)? = reports(at: 0.22).first else { return XCTFail() }
        XCTAssertEqual(nextPeak, 0)
        XCTAssertEqual(nextEver, peak)

        XCTAssertNil(try engine.apply(.stop))
        fill()
        XCTAssertEqual(reports(at: 0.22), [.position(step: -1, pattern: 0, playing: false)])
    }

    func testACommandTheEngineCannotTakeIsRefusedInWords() throws {
        let engine = try engineWithABeat()
        func refusal(_ command: Command) -> String {
            do {
                _ = try engine.apply(command)
                return "no refusal"
            } catch {
                return String(describing: error)
            }
        }
        XCTAssertTrue(refusal(.tempo(-1)).contains("the tempo"))
        XCTAssertTrue(refusal(.cue(99)).contains("a cue"))
        XCTAssertTrue(refusal(.synth(knobs(99))).contains("Sound 99"))
        let crowded = Pattern(rows: Array(repeating: 0, count: 13), firstLength: 16, secondLength: 0, stepsPerBeat: 4, swing: 0)
        XCTAssertTrue(refusal(.patterns([BankPattern(index: 0, pattern: crowded)])).contains("13 rows"))
        XCTAssertThrowsError(try Engine(sampleRate: 1000))
    }
}
