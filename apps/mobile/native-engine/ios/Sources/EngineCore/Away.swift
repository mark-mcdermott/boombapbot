import Foundation

/// The app out of the front, with the beat perhaps playing on: which reports
/// still go to the page, whose web view may be asleep, and what the engine
/// did meanwhile.
public struct Away {
    public let since: TimeInterval
    public let framesBefore: Double
    /// The loudest sample the engine made while the app was away.
    public private(set) var peak: Float = 0

    public init(since: TimeInterval, frames: Double) {
        self.since = since
        framesBefore = frames
    }

    /// Whether a report goes to the page now. What changes the machine's state
    /// goes and waits for the page to wake. What only shows it at work, the
    /// step, the meter and the stats, is let go: hundreds of them a second
    /// would pile up, and the page is told the step again on its return.
    public mutating func passes(_ report: Report) -> Bool {
        switch report {
        case let .stats(_, peak, _, _, _):
            self.peak = max(self.peak, peak)
            return false
        case .position, .level:
            return false
        case .ready, .error, .sound, .measures, .ended:
            return true
        }
    }
}
