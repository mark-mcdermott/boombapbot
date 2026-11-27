import Capacitor
import StoreKit
import os

/// The App Store, for the page: the calls of `StoreBridge`
/// (packages/editor/src/upgrade/store.ts).
///
/// It sells one thing, the upgrade, and decides nothing. A purchase leaves
/// here as the App Store signed it, for the site's server to check; whether
/// the upgrade is unlocked is the server's answer, never this plug-in's.
@objc(BoombapbotStorePlugin)
public class BoombapbotStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoombapbotStorePlugin"
    public let jsName = "BoombapbotStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "product", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "owned", returnType: CAPPluginReturnPromise),
    ]

    /// The upgrade as App Store Connect names it: `STORE_UPGRADE_PRODUCT` in packages/contracts.
    private static let upgrade = "com.boombapbot.app.upgrade"
    private static let changedEvent = "changed"

    private var updates: Task<Void, Never>?
    private let log = Logger(subsystem: "com.boombapbot.store", category: "store")

    /// Purchases can arrive with nobody pressing anything: one approved by a
    /// parent, one made on another device, a refund. Each is finished here,
    /// and the page is told to ask again what is owned.
    override public func load() {
        updates = Task { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let transaction) = update { await transaction.finish() }
                self?.notifyListeners(Self.changedEvent, data: [:])
            }
        }
    }

    deinit {
        updates?.cancel()
    }

    private func listed() async throws -> Product? {
        try await Product.products(for: [Self.upgrade]).first
    }

    /// The upgrade as the store lists it, with its price in the buyer's own money, or nothing when the store has none.
    @objc func product(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await listed() else { return call.resolve([:]) }
                call.resolve(["price": product.displayPrice])
            } catch {
                log.error("The store could not list the upgrade: \(error.localizedDescription, privacy: .public)")
                call.reject("The store could not be reached.")
            }
        }
    }

    /// Asks the store to sell the upgrade. Answers with the signed purchase,
    /// or with why there is none: the buyer backed out, or it waits to be approved.
    @objc func buy(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await listed() else { return call.reject("The store has no upgrade to sell.") }
                switch try await product.purchase() {
                case .success(let result):
                    // What the phone could not verify still goes to the server, which is the one that decides.
                    if case .verified(let transaction) = result { await transaction.finish() }
                    call.resolve(["transaction": result.jwsRepresentation])
                case .userCancelled:
                    call.resolve(["stopped": "cancelled"])
                case .pending:
                    call.resolve(["stopped": "pending"])
                @unknown default:
                    call.reject("The store answered in a way this app does not know.")
                }
            } catch {
                log.error("The purchase did not finish: \(error.localizedDescription, privacy: .public)")
                call.reject("The store did not finish the purchase.")
            }
        }
    }

    /// The purchases of the upgrade the store says this buyer holds now, each
    /// as the store signed it. After a refund there are none. Asking the App
    /// Store afresh first is what "Restore purchases" means; a phone that is
    /// offline answers from what it already knows.
    @objc func owned(_ call: CAPPluginCall) {
        Task {
            if call.getBool("refresh", false) {
                do {
                    try await AppStore.sync()
                } catch {
                    log.info("The App Store was not asked afresh: \(error.localizedDescription, privacy: .public)")
                }
            }
            var transactions: [String] = []
            for await entitlement in Transaction.currentEntitlements {
                guard case .verified(let transaction) = entitlement, transaction.productID == Self.upgrade else { continue }
                transactions.append(entitlement.jwsRepresentation)
            }
            call.resolve(["transactions": transactions])
        }
    }
}
