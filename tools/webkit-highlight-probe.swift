// SPDX-License-Identifier: Apache-2.0
// Headless WKWebView colour sampler.
//
// WKWebView uses the same WebKit engine as Safari on iOS and iPadOS, which is
// the only place where the `::highlight()` descendant-painting behaviour can be
// observed without a physical device. The page under test publishes
// `window.__probes` (id + CSS-pixel rect + expected background) and this helper
// reports the dominant ink colour actually rasterised inside each rect.
//
// Usage: swift webkit-highlight-probe.swift <page.html> <snapshot.png>

import Cocoa
import WebKit

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    print("USAGE webkit-highlight-probe.swift <page.html> <snapshot.png>")
    exit(64)
}

let htmlURL = URL(fileURLWithPath: arguments[1])
let pngURL = URL(fileURLWithPath: arguments[2])
let baseDir = htmlURL.deletingLastPathComponent()

let viewWidth = 900.0
let viewHeight = 600.0

func pump(_ seconds: TimeInterval = 20, until: () -> Bool) {
    let deadline = Date().addingTimeInterval(seconds)
    while !until() && Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let configuration = WKWebViewConfiguration()
let webView = WKWebView(
    frame: NSRect(x: 0, y: 0, width: viewWidth, height: viewHeight),
    configuration: configuration
)
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: viewWidth, height: viewHeight),
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
)
window.contentView = webView
window.orderFrontRegardless()

final class Navigation: NSObject, WKNavigationDelegate {
    var finished = false
    var failure: String?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finished = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failure = error.localizedDescription
        finished = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failure = error.localizedDescription
        finished = true
    }
}

let navigation = Navigation()
webView.navigationDelegate = navigation
webView.loadFileURL(htmlURL, allowingReadAccessTo: baseDir)
pump(30) { navigation.finished }

if let failure = navigation.failure {
    print("{\"error\":\"load failed: \(failure)\"}")
    exit(2)
}

func evaluate(_ javascript: String) -> Any? {
    var value: Any?
    var done = false
    webView.evaluateJavaScript(javascript) { result, error in
        if let error = error {
            value = "JS_ERROR: \(error.localizedDescription)"
        } else {
            value = result
        }
        done = true
    }
    pump(20) { done }
    return value
}

// Give layout fonts and any promise-driven setup a chance to settle.
pump(1.5) { false }

let userAgent = evaluate("navigator.userAgent") as? String ?? "?"
let metaRaw = evaluate("JSON.stringify(window.__meta || null)") as? String

guard
    let raw = evaluate("JSON.stringify(window.__probes || null)") as? String,
    raw != "null",
    let rawData = raw.data(using: .utf8),
    let probes = try? JSONSerialization.jsonObject(with: rawData) as? [[String: Any]]
else {
    print("{\"error\":\"page did not publish window.__probes\"}")
    exit(3)
}

let snapshotConfiguration = WKSnapshotConfiguration()
snapshotConfiguration.rect = CGRect(x: 0, y: 0, width: viewWidth, height: viewHeight)

var snapshotDone = false
var payload: [String: Any] = [
    "userAgent": userAgent,
    "probeCount": probes.count,
]

if let metaRaw = metaRaw, metaRaw != "null", let data = metaRaw.data(using: .utf8),
   let meta = try? JSONSerialization.jsonObject(with: data) {
    payload["meta"] = meta
}

webView.takeSnapshot(with: snapshotConfiguration) { image, error in
    defer { snapshotDone = true }
    guard
        let image = image,
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff)
    else {
        payload["error"] = "snapshot failed: \(error?.localizedDescription ?? "unknown")"
        return
    }

    if let png = bitmap.representation(using: .png, properties: [:]) {
        try? png.write(to: pngURL)
    }

    let pixelWidth = bitmap.pixelsWide
    let pixelHeight = bitmap.pixelsHigh
    let scale = Double(pixelWidth) / viewWidth

    func components(_ hex: String) -> (CGFloat, CGFloat, CGFloat) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count >= 6 else { return (255, 255, 255) }
        let red = CGFloat(Int(value.prefix(2), radix: 16) ?? 255)
        let green = CGFloat(Int(value.dropFirst(2).prefix(2), radix: 16) ?? 255)
        let blue = CGFloat(Int(value.dropFirst(4).prefix(2), radix: 16) ?? 255)
        return (red, green, blue)
    }

    func distance(_ a: (CGFloat, CGFloat, CGFloat), _ b: (CGFloat, CGFloat, CGFloat)) -> CGFloat {
        let dr = a.0 - b.0
        let dg = a.1 - b.1
        let db = a.2 - b.2
        return (dr * dr + dg * dg + db * db).squareRoot()
    }

    var results: [[String: Any]] = []
    for probe in probes {
        guard
            let id = probe["id"] as? String,
            let left = probe["left"] as? Double,
            let top = probe["top"] as? Double,
            let width = probe["width"] as? Double,
            let height = probe["height"] as? Double
        else { continue }
        let backgroundHex = probe["background"] as? String ?? "#FFFFFF"
        let background = components(backgroundHex)

        let x0 = max(0, Int((left * scale).rounded(.down)))
        let y0 = max(0, Int((top * scale).rounded(.down)))
        let x1 = min(pixelWidth, Int(((left + width) * scale).rounded(.up)))
        let y1 = min(pixelHeight, Int(((top + height) * scale).rounded(.up)))

        var pixels: [((CGFloat, CGFloat, CGFloat), CGFloat)] = []
        var maxDistance: CGFloat = 0
        for y in y0..<max(y0, y1) {
            for x in x0..<max(x0, x1) {
                guard let colour = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                let point = (colour.redComponent * 255, colour.greenComponent * 255, colour.blueComponent * 255)
                let delta = distance(point, background)
                if delta > maxDistance { maxDistance = delta }
                pixels.append((point, delta))
            }
        }

        // Average only the glyph cores: antialiased edge pixels blend towards the
        // background and would drag the reported colour towards it.
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, count = 0
        if maxDistance > 20 {
            let threshold = maxDistance * 0.72
            for (point, delta) in pixels where delta >= threshold {
                red += point.0
                green += point.1
                blue += point.2
                count += 1
            }
        }

        let ink: [String: Any]
        if count > 0 {
            let hex = String(
                format: "#%02X%02X%02X",
                Int((red / CGFloat(count)).rounded()),
                Int((green / CGFloat(count)).rounded()),
                Int((blue / CGFloat(count)).rounded())
            )
            ink = ["hex": hex, "samples": count, "maxDistance": Int(maxDistance.rounded())]
        } else {
            ink = ["hex": NSNull(), "samples": 0, "maxDistance": Int(maxDistance.rounded())]
        }

        results.append([
            "id": id,
            "expected": probe["expected"] as? String ?? "",
            "background": backgroundHex,
            "rect": ["left": left, "top": top, "width": width, "height": height],
            "ink": ink,
        ])
    }

    payload["scale"] = scale
    payload["size"] = "\(pixelWidth)x\(pixelHeight)"
    payload["probes"] = results
}

pump(30) { snapshotDone }

if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
   let text = String(data: data, encoding: .utf8) {
    print("RESULT \(text)")
} else {
    print("{\"error\":\"unable to serialise probe results\"}")
    exit(4)
}
