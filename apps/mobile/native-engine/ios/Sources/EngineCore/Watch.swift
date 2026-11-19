import Foundation

/// What the page is told about an engine at work, as often as the page's
/// own worklet tells it (packages/editor/src/engine/worklet/processor.ts):
/// every measure begun, a position only when it changes, the level thirty
/// times a second while it changes, and the stats ten times a second.
public struct Watch {
    private static let levelEvery: TimeInterval = 1.0 / 30.0
    private static let statsEvery: TimeInterval = 0.1

    private var step: Int32 = -1
    private var pattern: Int32 = -1
    private var playing = false
    private var stopFrame = -1.0
    private var level = 0.0
    private var levelDue: TimeInterval
    private var statsDue: TimeInterval
    /// The largest absolute output sample since the engine was made.
    public private(set) var peakEver: Float = 0

    /// `now` is seconds on any clock that only goes forward.
    public init(now: TimeInterval) {
        levelDue = now + Watch.levelEvery
        statsDue = now + Watch.statsEvery
    }

    /// Reads the engine and reports what is new. For the control thread.
    public mutating func look(_ engine: Engine, _ renderer: Renderer, now: TimeInterval, report: (Report) -> Void) {
        let measures = engine.takeMeasures()
        if !measures.isEmpty { report(.measures(measures)) }

        let stopFrame = engine.stopFrame
        if stopFrame != self.stopFrame {
            self.stopFrame = stopFrame
            if stopFrame >= 0 { report(.ended) }
        }

        let (step, pattern, playing) = (engine.currentStep, engine.currentPattern, engine.isPlaying)
        if step != self.step || pattern != self.pattern || playing != self.playing {
            (self.step, self.pattern, self.playing) = (step, pattern, playing)
            report(.position(step: step, pattern: pattern, playing: playing))
        }

        if now >= levelDue {
            levelDue = now + Watch.levelEvery
            let level = engine.outputLevel
            if level != self.level {
                self.level = level
                report(.level(level))
            }
        }

        if now >= statsDue {
            statsDue = now + Watch.statsEvery
            let peak = renderer.takePeak()
            peakEver = max(peakEver, peak)
            report(.stats(frames: engine.framesRendered, peak: peak, peakEver: peakEver,
                          voices: engine.activeVoices, stolen: engine.stolenVoices))
            // A sound a knob replaced is freed here, once its tail has rung out.
            engine.collect()
        }
    }
}
