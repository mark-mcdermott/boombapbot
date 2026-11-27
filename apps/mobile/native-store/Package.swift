// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BoombapbotNativeStore",
    platforms: [.iOS(.v15)],
    products: [
        // The name Capacitor gives `@boombapbot/native-store`, and asks for in the app's own package.
        .library(name: "BoombapbotNativeStore", targets: ["StorePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "StorePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/StorePlugin")
    ]
)
