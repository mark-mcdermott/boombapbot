import AVFoundation
import EngineCore
import EngineRender

/// The phone's sound: an AVAudioEngine whose source node's render block is
/// the one caller of the engine's render, and the engine it plays, made at
/// the rate the phone's output runs at now.
final class AudioOutput {
    /// The buffer asked of the phone: short enough that a tapped hit sounds at once.
    private static let bufferFrames = 256.0

    let engine: Engine
    let renderer: Renderer
    private let audio = AVAudioEngine()
    private let source: AVAudioSourceNode
    private var stopped = false

    /// Sets the phone's sound up for playing, which the ringer switch does not silence.
    static func prepareSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setPreferredIOBufferDuration(bufferFrames / max(session.sampleRate, 44_100))
        try session.setActive(true)
    }

    init() throws {
        let rate = audio.outputNode.outputFormat(forBus: 0).sampleRate
        guard rate > 0, let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) else {
            throw EngineRefused(description: "The phone has no sound output now.")
        }
        engine = try Engine(sampleRate: rate)
        renderer = try Renderer(engine)
        // The block holds a pointer and nothing Swift counts, and calls C.
        let state = renderer.state
        source = AVAudioSourceNode(format: format) { _, _, frames, list -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(list)
            guard let left = buffers.first?.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let right = buffers.count > 1 ? buffers[1].mData?.assumingMemoryBound(to: Float.self) : nil
            bb_render_fill(state, left, right, frames)
            return noErr
        }
        audio.attach(source)
        audio.connect(source, to: audio.mainMixerNode, format: format)
        audio.prepare()
        do {
            try audio.start()
        } catch {
            throw EngineRefused(description: "The phone's sound did not start: \(error.localizedDescription)")
        }
    }

    /// The AVAudioEngine this plays through, for the notice it posts when the phone changes its sound.
    var audioEngine: AVAudioEngine { audio }

    var isRunning: Bool { audio.isRunning }

    /// The rate the phone's output runs at now, which is another once the route has changed.
    var currentRate: Double { audio.outputNode.outputFormat(forBus: 0).sampleRate }

    /// Frames in each buffer the phone asks for, by its own account.
    var bufferFrames: Int {
        let session = AVAudioSession.sharedInstance()
        return Int((session.ioBufferDuration * session.sampleRate).rounded())
    }

    var routeName: String {
        AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portName).joined(separator: ", ")
    }

    /// Stops the render block for good. Only then may the renderer and the engine go.
    func stop() {
        guard !stopped else { return }
        stopped = true
        audio.stop()
        audio.detach(source)
    }

    deinit {
        stop()
    }
}
