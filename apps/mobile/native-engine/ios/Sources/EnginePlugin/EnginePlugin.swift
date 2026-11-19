import AVFoundation
import Capacitor
import EngineCore

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

    override public func load() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: session)
        center.addObserver(self, selector: #selector(servicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification,
                           object: session)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func report(_ report: Report) {
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
            self?.control.async { self?.reopen() }
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
        let wanted = output.engine.isPlaying ? Self.playingPause : Self.restingPause
        if wanted != pause {
            pause = wanted
            timer?.schedule(deadline: .now() + pause, repeating: pause, leeway: .milliseconds(1))
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
                self.reopen()
            @unknown default:
                break
            }
        }
    }

    /// Headphones pulled out stop the beat, as the phone's own players do.
    /// Any other change of route makes the engine again only if the rate
    /// changed or the sound stopped with it.
    @objc private func routeChanged(_ notice: Notification) {
        let raw = notice.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        let reason = raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
        control.async {
            guard let output = self.output else { return }
            if reason == .oldDeviceUnavailable { self.report(.ended) }
            if !output.isRunning || output.currentRate != output.engine.sampleRate { self.reopen() }
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
