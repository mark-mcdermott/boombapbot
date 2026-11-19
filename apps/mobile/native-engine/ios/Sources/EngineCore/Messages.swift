import Foundation

// What crosses between the page and the engine, in the shapes the editor
// gives them (packages/editor/src/engine/messages.ts): the commands of
// `NativeEngineCommand` coming in, and the reports of `EngineReport` going out.

/// One sound's knobs, each from 0 to 1. Its number is also its slot.
public struct Sound: Equatable {
    public var sound: Int32
    public var tune: Float
    public var tone: Float
    public var decay: Float
    public var snappy: Float

    public init(sound: Int32, tune: Float, tone: Float, decay: Float, snappy: Float) {
        (self.sound, self.tune, self.tone, self.decay, self.snappy) = (sound, tune, tone, decay, snappy)
    }
}

public struct Track: Equatable {
    public var track: Int32
    public var slot: Int32
    public var pan: Float
    public var chokeGroup: Int32
    public var gain: Double
}

public struct Pattern: Equatable {
    /// A bit mask a track: bit n is step n. Tracks left out are empty.
    public var rows: [UInt32]
    public var firstLength: UInt8
    public var secondLength: UInt8
    public var stepsPerBeat: UInt8
    public var swing: UInt8
}

/// A pattern and its place in the engine's bank.
public struct BankPattern: Equatable {
    public var index: Int32
    public var pattern: Pattern
}

public enum Variation: String, Equatable {
    case a, ab, b
}

public struct Panel: Equatable {
    public var rhythm: UInt8
    public var variation: Variation
    public var fillRhythm: UInt8
    public var fillVariation: Variation
    public var autoFill: UInt8
    public var firstBeatRule: Bool
}

public enum Command: Equatable {
    /// The engine makes the sound itself, at its own rate, and acknowledges by slot.
    case synth(Sound)
    case tracks([Track])
    case mix(plain: Double, accented: Double, master: Double)
    case patterns([BankPattern])
    case tempo(Double)
    case panel(Panel)
    case cue(Int32)
    /// The effect by the engine's own number: this plug-in keeps no list of them.
    case effect(Int32, wet: Double)
    case fill(Bool)
    case song(rhythms: [UInt8], loop: Bool)
    case play
    case stop
    case trigger(track: Int32, accent: Bool)
}

/// Why something the page sent is not a command.
public struct NotACommand: LocalizedError, Equatable, CustomStringConvertible {
    public let description: String

    public var errorDescription: String? { description }
}

/// A JSON object as the page sends it, with what each field must be.
private struct Fields {
    let object: [String: Any]

    func value(_ key: String) throws -> Any {
        guard let value = object[key], !(value is NSNull) else {
            throw NotACommand(description: "\(object["type"] ?? "A command") has no \(key).")
        }
        return value
    }

    func number(_ key: String) throws -> NSNumber {
        // A JSON true or false is a number to Foundation too, and is not one here.
        guard let number = try value(key) as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            throw NotACommand(description: "\(key) is not a number.")
        }
        return number
    }

    func double(_ key: String) throws -> Double { try number(key).doubleValue }
    func float(_ key: String) throws -> Float { try number(key).floatValue }

    func int32(_ key: String) throws -> Int32 {
        guard let value = Int32(exactly: try double(key)) else { throw NotACommand(description: "\(key) is not a whole number.") }
        return value
    }

    func byte(_ key: String) throws -> UInt8 {
        guard let value = UInt8(exactly: try double(key)) else { throw NotACommand(description: "\(key) is not a byte.") }
        return value
    }

    func bool(_ key: String) throws -> Bool {
        guard let number = try value(key) as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw NotACommand(description: "\(key) is not true or false.")
        }
        return number.boolValue
    }

    func string(_ key: String) throws -> String {
        guard let string = try value(key) as? String else { throw NotACommand(description: "\(key) is not text.") }
        return string
    }

    func fields(_ key: String) throws -> Fields {
        guard let object = try value(key) as? [String: Any] else { throw NotACommand(description: "\(key) is not an object.") }
        return Fields(object: object)
    }

    func list(_ key: String) throws -> [Any] {
        guard let list = try value(key) as? [Any] else { throw NotACommand(description: "\(key) is not a list.") }
        return list
    }

    func objects(_ key: String) throws -> [Fields] {
        try list(key).map { item in
            guard let object = item as? [String: Any] else { throw NotACommand(description: "\(key) holds something not an object.") }
            return Fields(object: object)
        }
    }

    func variation(_ key: String) throws -> Variation {
        let name = try string(key)
        guard let variation = Variation(rawValue: name) else { throw NotACommand(description: "\(name) is not a variation.") }
        return variation
    }
}

private func numbers<Number: FixedWidthInteger>(_ list: [Any], as _: Number.Type, _ what: String) throws -> [Number] {
    try list.map { item in
        guard let number = item as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              let value = Number(exactly: number.doubleValue)
        else { throw NotACommand(description: "\(what) holds something that is not one.") }
        return value
    }
}

extension Command {
    /// Reads one command as the editor writes it.
    public init(json: Any) throws {
        guard let object = json as? [String: Any] else { throw NotACommand(description: "A command is an object.") }
        let fields = Fields(object: object)
        switch try fields.string("type") {
        case "synth":
            let sound = try fields.fields("sound")
            self = .synth(Sound(sound: try sound.int32("sound"), tune: try sound.float("tune"), tone: try sound.float("tone"),
                                decay: try sound.float("decay"), snappy: try sound.float("snappy")))
        case "tracks":
            self = .tracks(try fields.objects("tracks").map { track in
                Track(track: try track.int32("track"), slot: try track.int32("slot"), pan: try track.float("pan"),
                      chokeGroup: try track.int32("chokeGroup"), gain: try track.double("gain"))
            })
        case "mix":
            self = .mix(plain: try fields.double("plain"), accented: try fields.double("accented"), master: try fields.double("master"))
        case "patterns":
            self = .patterns(try fields.objects("patterns").map { entry in
                let pattern = try entry.fields("pattern")
                return BankPattern(index: try entry.int32("index"),
                        pattern: Pattern(rows: try numbers(try pattern.list("rows"), as: UInt32.self, "A pattern's rows"),
                                         firstLength: try pattern.byte("firstLength"),
                                         secondLength: try pattern.byte("secondLength"),
                                         stepsPerBeat: try pattern.byte("stepsPerBeat"), swing: try pattern.byte("swing")))
            })
        case "tempo":
            self = .tempo(try fields.double("bpm"))
        case "panel":
            let panel = try fields.fields("panel")
            self = .panel(Panel(rhythm: try panel.byte("rhythm"), variation: try panel.variation("variation"),
                                fillRhythm: try panel.byte("fillRhythm"), fillVariation: try panel.variation("fillVariation"),
                                autoFill: try panel.byte("autoFill"), firstBeatRule: try panel.bool("firstBeatRule")))
        case "cue":
            self = .cue(try fields.int32("pattern"))
        case "effect":
            self = .effect(try fields.int32("effect"), wet: try fields.double("wet"))
        case "fill":
            self = .fill(try fields.bool("armed"))
        case "song":
            self = .song(rhythms: try numbers(try fields.list("rhythms"), as: UInt8.self, "A song"), loop: try fields.bool("loop"))
        case "play":
            self = .play
        case "stop":
            self = .stop
        case "trigger":
            self = .trigger(track: try fields.int32("track"), accent: try fields.bool("accent"))
        case let other:
            throw NotACommand(description: "\(other) is not a command this engine takes.")
        }
    }
}

public enum MeasureKind: String {
    case basic, fill, intro
}

public struct Measure: Equatable {
    public var frame: Double
    public var ordinal: Int32
    public var pattern: Int32
    public var kind: MeasureKind
    public var position: Int32
}

public enum Report: Equatable {
    /// The engine was made again by this plug-in, at this rate, and has been told nothing.
    case ready(sampleRate: Double)
    case error(String)
    case sound(slot: Int32)
    case position(step: Int32, pattern: Int32, playing: Bool)
    case measures([Measure])
    /// Play ended by itself, or because the phone took the sound away.
    case ended
    case level(Double)
    case stats(frames: Double, peak: Float, peakEver: Float, voices: Int32, stolen: UInt32)

    /// As the editor reads it.
    public var json: [String: Any] {
        switch self {
        case let .ready(sampleRate): return ["type": "ready", "sampleRate": sampleRate]
        case let .error(message): return ["type": "error", "message": message]
        case let .sound(slot): return ["type": "sound", "slot": Int(slot)]
        case let .position(step, pattern, playing):
            return ["type": "position", "step": Int(step), "pattern": Int(pattern), "playing": playing]
        case let .measures(measures):
            return ["type": "measures", "measures": measures.map { measure in
                ["frame": measure.frame, "ordinal": Int(measure.ordinal), "pattern": Int(measure.pattern),
                 "kind": measure.kind.rawValue, "position": Int(measure.position)] as [String: Any]
            }]
        case .ended: return ["type": "ended"]
        case let .level(level): return ["type": "level", "level": level]
        case let .stats(frames, peak, peakEver, voices, stolen):
            return ["type": "stats", "frames": frames, "peak": Double(peak), "peakEver": Double(peakEver),
                    "voices": Int(voices), "stolen": Int(stolen)]
        }
    }
}
