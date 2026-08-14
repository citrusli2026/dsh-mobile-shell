// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        // Vendored local copy of capacitor-swift-pm 8.5.0 (offline build;
        // see mobile/docs/decisions/ADR-0005). To return to the upstream
        // remote package: .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0")
        .package(path: "../../vendor/capacitor-swift-pm")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ]
        )
    ]
)
