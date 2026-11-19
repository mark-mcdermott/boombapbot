import AVFoundation
import Capacitor
import EngineCore
import os
import UIKit

/// The engine built natively, for the page: the calls of `NativeEngineBridge`
/// (packages/editor/src/engine/native-audio.ts) and its reports, on "report".
///
/// Every call to the engine but its render is made on one queue, `control`:
/// Capacitor's calls, the phone's notices and the watch all hop onto it.
@objc(BoombapbotEnginePlugin)
public class BoombapbotEnginePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoombapbotEnginePlugin"
    public let jsName = "BoombapbotEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkEngine", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkLose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkReport", returnType: CAPPluginReturnPromise),
    ]

    /// How often the engine is read while it plays: often enough that a step
    /// is reported within a few milliseconds of sounding.
    private static let playingPause: TimeInterval = 0.004
    /// And while it is stopped, when only the meter and the stats move.
    private static let restingPause: TimeInterval = 0.016
    private static let reportEvent = "report"

    private let control = DispatchQueue(label: "boombapbot-engine", qos: .userInteractive)
    private var output: AudioOutput?
    private var watch = Watch(now: 0)
    private var timer: DispatchSourceTimer?
    private var pause = BoombapbotEnginePlugin.restingPause
    private var configurationObserver: NSObjectProtocol?
    /// Times the engine was made again because the phone changed its sound.
    private var reopened = 0
    /// Set while the app is not in front.
    private var away: Away?
    private var nowPlaying: NowPlaying?
    /// Whether the lock screen shows the beat playing.
    private var showsPlaying = false
    private let log = Logger(subsystem: "com.boombapbot.engine", category: "engine")

    override public func load() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: session)
        center.addObserver(self, selector: #selector(servicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification,
                           object: session)
        center.addObserver(self, selector: #selector(wentAway(_:)), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(cameBack(_:)), name: UIApplication.willEnterForegroundNotification, object: nil)
        nowPlaying = NowPlaying { [weak self] in
            self?.control.async { self?.stopBeat() }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func report(_ report: Report) {
        if away?.passes(report) == false { return }
        notifyListeners(Self.reportEvent, data: report.json)
    }

    // MARK: The page's calls

    /// Opens the phone's sound and makes the engine at its rate. Whoever asks
    /// has no engine, so one still here belongs to a page that is gone.
    @objc func open(_ call: CAPPluginCall) {
        control.async {
            do {
                call.resolve(["sampleRate": try self.start()])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Hands the engine these commands, in this order.
    @objc func send(_ call: CAPPluginCall) {
        let sent = call.getArray("commands", Any.self) ?? []
        control.async {
            do {
                guard let output = self.output else { throw EngineRefused(description: "The engine is not open.") }
                for json in sent {
                    if let report = try output.engine.apply(try Command(json: json)) { self.report(report) }
                }
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        control.async {
            self.end()
            call.resolve()
        }
    }

    // MARK: The engine and its sound

    private func start() throws -> Double {
        end()
        try AudioOutput.prepareSession()
        let output = try AudioOutput()
        self.output = output
        watch = Watch(now: ProcessInfo.processInfo.systemUptime)
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: output.audioEngine, queue: nil
        ) { [weak self] _ in
            // The engine stopped itself: the phone's output is not what it was.
            self?.control.async { self?.recover() }
        }
        schedule()
        return output.engine.sampleRate
    }

    /// The render block stops first, and only then do the renderer and the engine go.
    private func end() {
        timer?.cancel()
        timer = nil
        if let observer = configurationObserver { NotificationCenter.default.removeObserver(observer) }
        configurationObserver = nil
        output?.stop()
        output = nil
        showPlaying(false)
    }

    /// Makes the engine again at the rate the phone runs at now. The page then
    /// tells the new engine the beat again, which makes its sounds at that
    /// rate, and to play on if it was playing.
    private func reopen() {
        guard output != nil else { return }
        reopened += 1
        do {
            report(.ready(sampleRate: try start()))
        } catch {
            end()
            report(.error(error.localizedDescription))
        }
    }

    private func schedule() {
        let timer = DispatchSource.makeTimerSource(queue: control)
        timer.setEventHandler { [weak self] in self?.look() }
        pause = Self.restingPause
        timer.schedule(deadline: .now() + pause, repeating: pause, leeway: .milliseconds(1))
        timer.resume()
        self.timer = timer
    }

    private func look() {
        guard let output else { return }
        watch.look(output.engine, output.renderer, now: ProcessInfo.processInfo.systemUptime) { report($0) }
        showPlaying(output.isRunning && output.engine.isPlaying)
        if away != nil, output.isRunning, !output.engine.isPlaying { sleep(output) }
        let wanted = output.engine.isPlaying ? Self.playingPause : Self.restingPause
        if wanted != pause {
            pause = wanted
            timer?.schedule(deadline: .now() + pause, repeating: pause, leeway: .milliseconds(1))
        }
    }

    /// Stops the beat without the page, which may be asleep, and tells it the beat ended.
    private func stopBeat() {
        guard let output, output.engine.isPlaying else { return }
        do {
            _ = try output.engine.apply(.stop)
        } catch {
            log.error("The beat could not be stopped: \(error.localizedDescription, privacy: .public)")
        }
        report(.ended)
    }

    private func showPlaying(_ playing: Bool) {
        guard playing != showsPlaying else { return }
        showsPlaying = playing
        nowPlaying?.show(playing: playing)
    }

    /// Nothing plays while the app is away: the phone's sound is let go, so
    /// that the phone may suspend the app. The engine stays for its return.
    private func sleep(_ output: AudioOutput) {
        do {
            try output.pause()
        } catch {
            log.error("The phone's sound could not be let go: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// After the phone changed its sound under the engine. In front, the engine
    /// is made again if the sound stopped or its rate changed, and the page
    /// tells it the beat again. Away, the page may be asleep and could not, so
    /// a beat that plays goes on with this engine, at its own rate, which
    /// AVAudioEngine's mixer converts; it is made again on the app's return.
    private func recover() {
        guard let output else { return }
        if output.isRunning && output.currentRate == output.engine.sampleRate { return }
        guard away != nil else { return reopen() }
        guard !output.isRunning, !output.isPaused, output.engine.isPlaying else { return }
        do {
            try output.resume()
        } catch {
            log.error("The beat could not go on: \(error.localizedDescription, privacy: .public)")
            report(.ended)
        }
    }

    // MARK: The app in and out of the front

    @objc private func wentAway(_ notice: Notification) {
        control.async {
            guard let output = self.output else { return }
            self.away = Away(since: ProcessInfo.processInfo.systemUptime, frames: output.engine.framesRendered)
            if !output.engine.isPlaying { self.sleep(output) }
        }
    }

    /// The page is told where the engine is, and a sound let go is taken again.
    @objc private func cameBack(_ notice: Notification) {
        control.async {
            guard let away = self.away else { return }
            self.away = nil
            guard let output = self.output else { return }
            let engine = output.engine
            let seconds = ProcessInfo.processInfo.systemUptime - away.since
            let frames = Int(engine.framesRendered - away.framesBefore)
            self.log.info("Back in front after \(seconds, format: .fixed(precision: 1), privacy: .public) s: \(frames, privacy: .public) frames rendered meanwhile, peak \(away.peak, format: .fixed(precision: 2), privacy: .public), \(engine.isPlaying ? "playing" : "stopped", privacy: .public)")
            self.report(.position(step: engine.currentStep, pattern: engine.currentPattern, playing: engine.isPlaying))
            if output.isPaused {
                do {
                    try output.resume()
                } catch {
                    self.log.error("The phone's sound could not be taken again: \(error.localizedDescription, privacy: .public)")
                    return self.reopen()
                }
            }
            self.recover()
        }
    }

    // MARK: The phone's notices

    /// A call, an alarm or another app took the sound. The phone has stopped
    /// it, so the page is told the beat ended. When it is given back, the
    /// engine is made again at the rate the phone runs at then, and the
    /// beat waits for the person to play it.
    @objc private func interrupted(_ notice: Notification) {
        guard let raw = notice.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        control.async {
            guard self.output != nil else { return }
            switch type {
            case .began:
                self.output?.stop()
                self.report(.ended)
            case .ended:
                // Away, the engine is made again on the app's return.
                if self.away == nil { self.reopen() }
            @unknown default:
                break
            }
        }
    }

    /// Headphones pulled out stop the beat, as the phone's own players do,
    /// here rather than by the page, which may be asleep. Any other change of
    /// route is recovered from.
    @objc private func routeChanged(_ notice: Notification) {
        let raw = notice.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        let reason = raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
        control.async {
            if reason == .oldDeviceUnavailable { self.stopBeat() }
            self.recover()
        }
    }

    /// The phone's audio started over: everything is set up again.
    @objc private func servicesReset(_ notice: Notification) {
        control.async { self.reopen() }
    }


    // MARK: The run that checks itself

    /// Set in a check run, by whoever launches the app (see apps/mobile/README.md).
    private static let checkVariable = "BOOMBAPBOT_CHECK"
    private static var checkMode: String? {
        ProcessInfo.processInfo.environment[checkVariable].flatMap { $0.isEmpty ? nil : $0 }
    }

    @objc func checkMode(_ call: CAPPluginCall) {
        call.resolve(["mode": Self.checkMode ?? NSNull()])
    }

    /// What the engine and the phone's sound say of themselves now.
    @objc func checkEngine(_ call: CAPPluginCall) {
        guard Self.checkMode != nil else { return call.reject("This is not a check run.") }
        control.async {
            guard let output = self.output else { return call.resolve(["open": false]) }
            call.resolve([
                "open": true,
                "device": [
                    "name": output.routeName,
                    "sampleRate": output.engine.sampleRate,
                    "bufferFrames": output.bufferFrames,
                    "running": output.isRunning,
                ] as [String: Any],
                "playing": output.engine.isPlaying,
                "framesRendered": output.engine.framesRendered,
                "buffers": Int(output.renderer.buffers),
                "outputLevel": output.engine.outputLevel,
                "peakEver": Double(self.watch.peakEver),
                "reopened": self.reopened,
            ])
        }
    }

    /// As if the phone had changed its sound under the engine.
    @objc func checkLose(_ call: CAPPluginCall) {
        guard Self.checkMode != nil else { return call.reject("This is not a check run.") }
        control.async {
            self.reopen()
            call.resolve()
        }
    }

    /// Prints what the page found, on a line of its own for whoever launched
    /// the app to find, and closes the app with 0 if the check passed.
    @objc func checkReport(_ call: CAPPluginCall) {
        guard Self.checkMode != nil else { return call.reject("This is not a check run.") }
        let report = call.getObject("report") ?? [:]
        let passed = report["ok"] as? Bool ?? false
        let line = (try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        print("BOOMBAPBOT_CHECK \(line)")
        fflush(stdout)
        call.resolve()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(passed ? 0 : 1) }
    }
}
