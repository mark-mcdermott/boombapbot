import Foundation
import MediaPlayer

/// What the lock screen and Control Center show while the beat plays, with
/// a pause that stops it. Once it has stopped they show nothing: playing
/// again needs the page, which tells the engine what to play.
final class NowPlaying {
    private let center = MPRemoteCommandCenter.shared()
    private var targets: [(command: MPRemoteCommand, target: Any)] = []
    private let title: String

    /// `pause` is called on the main thread.
    init(pause: @escaping () -> Void) {
        title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "boombapbot"
        for command in [center.pauseCommand, center.togglePlayPauseCommand, center.stopCommand] {
            let target = command.addTarget { _ in
                pause()
                return .success
            }
            targets.append((command, target))
            command.isEnabled = false
        }
        center.playCommand.isEnabled = false
    }

    deinit {
        for (command, target) in targets { command.removeTarget(target) }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func show(playing: Bool) {
        DispatchQueue.main.async { [self] in
            for (command, _) in targets { command.isEnabled = playing }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = playing
                ? [
                    MPMediaItemPropertyTitle: "РИТМ-12",
                    MPMediaItemPropertyArtist: title,
                    MPNowPlayingInfoPropertyIsLiveStream: true,
                    MPNowPlayingInfoPropertyPlaybackRate: 1.0,
                ]
                : nil
        }
    }
}
