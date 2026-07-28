// uc-input-helper - macOS CoreGraphics mouse primitive helper for the UC bridge.
//
// Usage:
//   uc-input-helper move --x 120 --y 240
//   uc-input-helper click --x 120 --y 240 [--button left|right] [--count 1|2]
//   uc-input-helper down --x 120 --y 240 [--button left|right]
//   uc-input-helper up --x 120 --y 240 [--button left|right]
//   uc-input-helper drag --from-x 120 --from-y 240 --to-x 600 --to-y 500 [--duration-ms 450]
//   uc-input-helper scroll --x 120 --y 240 [--delta-x 0] [--delta-y -600]
//   uc-input-helper window-proof --pid 1234
//
// Every mutating command additionally requires:
//   --expect-app NAME --expect-pid PID --expect-window-id ID
//   --expect-window-x X --expect-window-y Y
//   --expect-window-width WIDTH --expect-window-height HEIGHT
//
// Output is one JSON object on stdout. The bridge compiles this binary on startup.

import ApplicationServices
import Foundation

func jsonEscape(_ s: String) -> String {
    var out = ""
    out.reserveCapacity(s.count + 2)
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case let c where c.value < 0x20:
            out += String(format: "\\u%04x", c.value)
        default:
            out.unicodeScalars.append(ch)
        }
    }
    return "\"\(out)\""
}

func emitError(_ msg: String) -> Never {
    print("{\"ok\":false,\"error\":\(jsonEscape(msg))}")
    exit(1)
}

func emitOk(_ fields: String) -> Never {
    if fields.isEmpty {
        print("{\"ok\":true}")
    } else {
        print("{\"ok\":true,\(fields)}")
    }
    exit(0)
}

func arg(_ flag: String) -> String? {
    let args = CommandLine.arguments
    for i in 0..<args.count {
        if args[i] == flag && i + 1 < args.count {
            return args[i + 1]
        }
    }
    return nil
}

func intArg(_ flag: String, min: Int, max: Int, default def: Int? = nil) -> Int {
    guard let raw = arg(flag) else {
        if let def = def { return def }
        emitError("\(flag) required")
    }
    guard let value = Int(raw), value >= min, value <= max else {
        emitError("\(flag) must be an integer between \(min) and \(max)")
    }
    return value
}

struct NativeWindowRecord {
    let appName: String
    let pid: Int
    let windowId: UInt32
    let bounds: CGRect
    let layer: Int
    let alpha: Double
    let onScreen: Bool
}

struct NativeWindowExpectation {
    let appName: String
    let pid: Int
    let windowId: UInt32
    let bounds: CGRect
}

func boundedInt(_ value: Any?, default def: Int = 0) -> Int {
    if let number = value as? NSNumber {
        return number.intValue
    }
    if let text = value as? String, let parsed = Int(text) {
        return parsed
    }
    return def
}

func nativeWindowRecords() -> [NativeWindowRecord] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let rows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    return rows.compactMap { row in
        let pid = boundedInt(row[kCGWindowOwnerPID as String])
        let windowNumber = boundedInt(row[kCGWindowNumber as String])
        let layer = boundedInt(row[kCGWindowLayer as String], default: Int.min)
        let alpha = (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0
        let onScreen = (row[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false
        let appName = (row[kCGWindowOwnerName as String] as? String) ?? ""
        guard
            pid > 0,
            windowNumber > 0,
            !appName.isEmpty,
            let rawBounds = row[kCGWindowBounds as String]
        else {
            return nil
        }
        let boundsDictionary = rawBounds as! CFDictionary
        guard
            let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
            bounds.width > 0,
            bounds.height > 0
        else {
            return nil
        }
        return NativeWindowRecord(
            appName: appName,
            pid: pid,
            windowId: UInt32(windowNumber),
            bounds: bounds,
            layer: layer,
            alpha: alpha,
            onScreen: onScreen
        )
    }
}

func focusedApplicationPid() -> Int? {
    let systemWide = AXUIElementCreateSystemWide()
    var rawFocusedApplication: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(
        systemWide,
        kAXFocusedApplicationAttribute as CFString,
        &rawFocusedApplication
    )
    guard
        status == .success,
        let rawFocusedApplication,
        CFGetTypeID(rawFocusedApplication) == AXUIElementGetTypeID()
    else {
        return nil
    }
    var pid: pid_t = 0
    AXUIElementGetPid(rawFocusedApplication as! AXUIElement, &pid)
    return pid > 0 ? Int(pid) : nil
}

func roundedBounds(_ bounds: CGRect) -> CGRect {
    CGRect(
        x: bounds.origin.x.rounded(),
        y: bounds.origin.y.rounded(),
        width: bounds.width.rounded(),
        height: bounds.height.rounded()
    )
}

func exactFrontmostWindowProof(pid: Int) -> NativeWindowRecord? {
    guard focusedApplicationPid() == pid else {
        return nil
    }
    return nativeWindowRecords().first { record in
        record.pid == pid
            && record.layer == 0
            && record.onScreen
            && record.alpha > 0
            && record.bounds.width >= 1
            && record.bounds.height >= 1
    }
}

func parseNativeWindowExpectation() -> NativeWindowExpectation {
    let appName = (arg("--expect-app") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard
        !appName.isEmpty,
        appName.count <= 160,
        appName.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7f })
    else {
        emitError("--expect-app must be a non-empty bounded process name")
    }
    let pid = intArg("--expect-pid", min: 1, max: Int(Int32.max))
    let windowIdValue = intArg("--expect-window-id", min: 1, max: Int(UInt32.max))
    let x = intArg("--expect-window-x", min: -32_768, max: 32_768)
    let y = intArg("--expect-window-y", min: -32_768, max: 32_768)
    let width = intArg("--expect-window-width", min: 1, max: 32_768)
    let height = intArg("--expect-window-height", min: 1, max: 32_768)
    return NativeWindowExpectation(
        appName: appName,
        pid: pid,
        windowId: UInt32(windowIdValue),
        bounds: CGRect(x: x, y: y, width: width, height: height)
    )
}

func pointIsInsideWindow(_ point: CGPoint, bounds: CGRect) -> Bool {
    point.x >= bounds.minX
        && point.y >= bounds.minY
        && point.x < bounds.maxX
        && point.y < bounds.maxY
}

func validateNativeWindowExpectation(
    _ expectation: NativeWindowExpectation,
    points: [CGPoint]
) -> String? {
    guard focusedApplicationPid() == expectation.pid else {
        return "native target guard rejected frontmost process drift"
    }
    let records = nativeWindowRecords()
    guard let exactWindow = records.first(where: { record in
        record.pid == expectation.pid && record.windowId == expectation.windowId
    }) else {
        return "native target guard rejected missing or replaced target window"
    }
    let exactBounds = roundedBounds(exactWindow.bounds)
    guard
        exactWindow.appName == expectation.appName,
        exactWindow.layer == 0,
        exactWindow.onScreen,
        exactWindow.alpha > 0,
        exactBounds.equalTo(expectation.bounds)
    else {
        return "native target guard rejected app, layer, visibility, or window-bounds drift"
    }
    for point in points {
        guard pointIsInsideWindow(point, bounds: expectation.bounds) else {
            return "native target guard rejected a point outside the exact target window"
        }
        guard let topmostAtPoint = records.first(where: { record in
            record.onScreen
                && record.alpha > 0
                && record.layer >= 0
                && pointIsInsideWindow(point, bounds: record.bounds)
        }) else {
            return "native target guard could not prove the topmost actionable window"
        }
        guard
            topmostAtPoint.pid == expectation.pid,
            topmostAtPoint.windowId == expectation.windowId,
            roundedBounds(topmostAtPoint.bounds).equalTo(expectation.bounds)
        else {
            return "native target guard rejected an overlay or topmost-window substitution"
        }
    }
    return nil
}

func requireNativeWindowExpectation(
    _ expectation: NativeWindowExpectation,
    points: [CGPoint]
) {
    if let error = validateNativeWindowExpectation(expectation, points: points) {
        emitError(error)
    }
}

func point(_ x: Int, _ y: Int) -> CGPoint {
    CGPoint(x: CGFloat(x), y: CGFloat(y))
}

enum MouseButton: String {
    case left
    case right

    var cgButton: CGMouseButton {
        switch self {
        case .left: return .left
        case .right: return .right
        }
    }

    var downType: CGEventType {
        switch self {
        case .left: return .leftMouseDown
        case .right: return .rightMouseDown
        }
    }

    var upType: CGEventType {
        switch self {
        case .left: return .leftMouseUp
        case .right: return .rightMouseUp
        }
    }
}

func parsedButton() -> MouseButton {
    let raw = (arg("--button") ?? "left").lowercased()
    guard let button = MouseButton(rawValue: raw) else {
        emitError("--button must be left or right")
    }
    return button
}

func postMove(to p: CGPoint, expectation: NativeWindowExpectation) {
    requireNativeWindowExpectation(expectation, points: [p])
    let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)
    event?.post(tap: .cghidEventTap)
}

func postClick(at p: CGPoint, button: MouseButton, count: Int, expectation: NativeWindowExpectation) {
    postMove(to: p, expectation: expectation)
    usleep(25_000)
    for i in 0..<count {
        requireNativeWindowExpectation(expectation, points: [p])
        let clickState = Int64(min(i + 1, 2))
        let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton)
        down?.setIntegerValueField(.mouseEventClickState, value: clickState)
        down?.post(tap: .cghidEventTap)
        usleep(35_000)
        if let error = validateNativeWindowExpectation(expectation, points: [p]) {
            let emergencyUp = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
            emergencyUp?.post(tap: .cghidEventTap)
            emitError(error)
        }
        let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
        up?.setIntegerValueField(.mouseEventClickState, value: clickState)
        up?.post(tap: .cghidEventTap)
        usleep(70_000)
    }
}

func postMouseDown(at p: CGPoint, button: MouseButton, expectation: NativeWindowExpectation) {
    postMove(to: p, expectation: expectation)
    usleep(25_000)
    requireNativeWindowExpectation(expectation, points: [p])
    let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton)
    down?.post(tap: .cghidEventTap)
}

func postMouseUp(at p: CGPoint, button: MouseButton, expectation: NativeWindowExpectation) {
    requireNativeWindowExpectation(expectation, points: [p])
    let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
    up?.post(tap: .cghidEventTap)
}

func postDrag(
    from start: CGPoint,
    to end: CGPoint,
    durationMs: Int,
    expectation: NativeWindowExpectation
) {
    let pathSamples = (0...16).map { sample -> CGPoint in
        let t = CGFloat(sample) / 16
        return CGPoint(
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t
        )
    }
    requireNativeWindowExpectation(expectation, points: pathSamples)
    postMove(to: start, expectation: expectation)
    usleep(35_000)
    requireNativeWindowExpectation(expectation, points: [start])
    let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)
    down?.post(tap: .cghidEventTap)

    let steps = max(8, min(80, durationMs / 12))
    let sleepMicros = UInt32(max(2_000, (durationMs * 1000) / max(steps, 1)))
    for step in 1...steps {
        let t = CGFloat(step) / CGFloat(steps)
        let p = CGPoint(
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t
        )
        if let error = validateNativeWindowExpectation(expectation, points: [p]) {
            let emergencyUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
            emergencyUp?.post(tap: .cghidEventTap)
            emitError(error)
        }
        let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(sleepMicros)
    }

    if let error = validateNativeWindowExpectation(expectation, points: [end]) {
        let emergencyUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
        emergencyUp?.post(tap: .cghidEventTap)
        emitError(error)
    }
    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
    up?.post(tap: .cghidEventTap)
}

func postScroll(
    at p: CGPoint,
    deltaX: Int,
    deltaY: Int,
    expectation: NativeWindowExpectation
) {
    postMove(to: p, expectation: expectation)
    usleep(20_000)
    requireNativeWindowExpectation(expectation, points: [p])
    let event = CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 2,
        wheel1: Int32(deltaY),
        wheel2: Int32(deltaX),
        wheel3: 0
    )
    event?.post(tap: .cghidEventTap)
}

guard CommandLine.arguments.count >= 2 else {
    emitError("usage: uc-input-helper <window-proof|move|click|down|up|drag|scroll> ...")
}

if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt" as CFString: false] as CFDictionary) {
    emitError("Accessibility permission not granted. System Settings > Privacy & Security > Accessibility > add the bridge/helper.")
}

let subcommand = CommandLine.arguments[1]

switch subcommand {
case "window-proof":
    let pid = intArg("--pid", min: 1, max: Int(Int32.max))
    guard let proof = exactFrontmostWindowProof(pid: pid) else {
        emitError("no exact frontmost visible normal window was available for the requested pid")
    }
    let bounds = roundedBounds(proof.bounds)
    emitOk(
        "\"appName\":\(jsonEscape(proof.appName)),"
            + "\"pid\":\(proof.pid),"
            + "\"windowId\":\(proof.windowId),"
            + "\"x\":\(Int(bounds.origin.x)),"
            + "\"y\":\(Int(bounds.origin.y)),"
            + "\"width\":\(Int(bounds.width)),"
            + "\"height\":\(Int(bounds.height))"
    )
case "move":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let expectation = parseNativeWindowExpectation()
    postMove(to: point(x, y), expectation: expectation)
    emitOk("\"x\":\(x),\"y\":\(y)")
case "click":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let button = parsedButton()
    let count = intArg("--count", min: 1, max: 3, default: 1)
    let expectation = parseNativeWindowExpectation()
    postClick(at: point(x, y), button: button, count: count, expectation: expectation)
    emitOk("\"x\":\(x),\"y\":\(y),\"button\":\(jsonEscape(button.rawValue)),\"count\":\(count)")
case "down":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let button = parsedButton()
    let expectation = parseNativeWindowExpectation()
    postMouseDown(at: point(x, y), button: button, expectation: expectation)
    emitOk("\"x\":\(x),\"y\":\(y),\"button\":\(jsonEscape(button.rawValue))")
case "up":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let button = parsedButton()
    let expectation = parseNativeWindowExpectation()
    let p = point(x, y)
    postMouseUp(at: p, button: button, expectation: expectation)
    emitOk("\"x\":\(x),\"y\":\(y),\"button\":\(jsonEscape(button.rawValue))")
case "drag":
    let fromX = intArg("--from-x", min: 0, max: 20_000)
    let fromY = intArg("--from-y", min: 0, max: 20_000)
    let toX = intArg("--to-x", min: 0, max: 20_000)
    let toY = intArg("--to-y", min: 0, max: 20_000)
    let durationMs = intArg("--duration-ms", min: 50, max: 5_000, default: 450)
    let expectation = parseNativeWindowExpectation()
    postDrag(
        from: point(fromX, fromY),
        to: point(toX, toY),
        durationMs: durationMs,
        expectation: expectation
    )
    emitOk("\"fromX\":\(fromX),\"fromY\":\(fromY),\"toX\":\(toX),\"toY\":\(toY),\"durationMs\":\(durationMs)")
case "scroll":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let deltaX = intArg("--delta-x", min: -20_000, max: 20_000, default: 0)
    let deltaY = intArg("--delta-y", min: -20_000, max: 20_000, default: 0)
    if deltaX == 0 && deltaY == 0 {
        emitError("delta-x or delta-y must be non-zero")
    }
    let expectation = parseNativeWindowExpectation()
    postScroll(
        at: point(x, y),
        deltaX: deltaX,
        deltaY: deltaY,
        expectation: expectation
    )
    emitOk("\"x\":\(x),\"y\":\(y),\"deltaX\":\(deltaX),\"deltaY\":\(deltaY)")
default:
    emitError("unknown subcommand: \(subcommand)")
}
