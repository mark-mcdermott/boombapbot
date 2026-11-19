// swift-tools-version: 5.9
import PackageDescription

// The engine is built for РИТМ-12 by the repository's CMake, as an
// XCFramework: `pnpm --filter @boombapbot/mobile engine:ios`.
let package = Package(
    name: "BoombapbotNativeEngine",
    platforms: [.iOS(.v15)],
    products: [
        // The name Capacitor gives `@boombapbot/native-engine`, and asks for in the app's own package.
        .library(name: "BoombapbotNativeEngine", targets: ["EnginePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .binaryTarget(name: "BoombapbotEngine", path: "ios/BoombapbotEngine.xcframework"),
        // The audio thread's part, in C, so that it uses nothing but the engine and atomics.
        .target(
            name: "EngineRender",
            dependencies: ["BoombapbotEngine"],
            path: "ios/Sources/EngineRender",
            // The engine is C++ behind its C ABI, so its runtime comes along.
            linkerSettings: [.linkedLibrary("c++")]),
        // Everything else that touches the engine. No Capacitor, so it is tested on its own.
        .target(
            name: "EngineCore",
            dependencies: ["BoombapbotEngine", "EngineRender"],
            path: "ios/Sources/EngineCore"),
        .target(
            name: "EnginePlugin",
            dependencies: [
                "EngineCore",
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/EnginePlugin"),
        .testTarget(
            name: "EngineCoreTests",
            dependencies: ["EngineCore", "EngineRender"],
            path: "ios/Tests/EngineCoreTests"),
    ]
)
