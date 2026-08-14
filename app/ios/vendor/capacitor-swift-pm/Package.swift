// swift-tools-version:5.3

import PackageDescription

// dsh-mobile vendored copy of ionic-team/capacitor-swift-pm @ 8.5.0.
// The upstream package fetches Capacitor/Cordova xcframework zips from
// github.com release URLs, which stall in some networks (see
// mobile/docs/decisions/ADR-0005). The xcframeworks below are the official
// 8.5.0 artifacts, sha256-verified against the upstream manifest checksums
// (357220fe…, a3dc72b5…), vendored as local binary targets so the iOS build
// needs zero network.
let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(
            name: "Capacitor",
            targets: ["Capacitor"]
        ),
        .library(
            name: "Cordova",
            targets: ["Cordova"]
        )
    ],
    dependencies: [],
    targets: [
        .binaryTarget(
            name: "Capacitor",
            path: "Capacitor.xcframework"
        ),
        .binaryTarget(
            name: "Cordova",
            path: "Cordova.xcframework"
        )
    ]
)
