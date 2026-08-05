// uc-input-helper - guarded macOS CoreGraphics input helper for the UC bridge.
//
// Usage:
//   uc-input-helper move --x 120 --y 240
//   uc-input-helper click --x 120 --y 240 [--button left|right] [--count 1|2]
//   uc-input-helper down --x 120 --y 240 [--button left|right]
//   uc-input-helper up --x 120 --y 240 [--button left|right]
//   uc-input-helper drag --from-x 120 --from-y 240 --to-x 600 --to-y 500 [--duration-ms 450]
//   uc-input-helper scroll --x 120 --y 240 [--delta-x 0] [--delta-y -600]
//   uc-input-helper window-proof --pid 1234
//   printf %s "hello" | uc-input-helper type [exact-window expectation flags]
//   uc-input-helper key --key-code 36 [--modifiers command,shift] [exact-window expectation flags]
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

enum InputHelperErrorCode: String {
    case invalidRequest = "invalid_request"
    case uncertainUiTarget = "uncertain_ui_target"
    case permissionDenied = "permission_denied"
    case inputDispatchFailed = "input_dispatch_failed"
}

func emitError(_ msg: String, errorCode: InputHelperErrorCode = .invalidRequest) -> Never {
    print("{\"ok\":false,\"error\":\(jsonEscape(msg)),\"errorCode\":\(jsonEscape(errorCode.rawValue))}")
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
        appName.unicodeScalars.count <= 160,
        appName.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7f })
    else {
        emitError("--expect-app must be a non-empty process name of at most 160 Unicode code points without control characters")
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
    guard let frontmostNormalWindow = records.first(where: { record in
        record.pid == expectation.pid
            && record.layer == 0
            && record.onScreen
            && record.alpha > 0
            && record.bounds.width >= 1
            && record.bounds.height >= 1
    }),
        frontmostNormalWindow.windowId == expectation.windowId,
        roundedBounds(frontmostNormalWindow.bounds).equalTo(expectation.bounds)
    else {
        return "native target guard rejected frontmost-window substitution"
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
        emitError(error, errorCode: .uncertainUiTarget)
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
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) else {
        emitError("could not create mouse move event", errorCode: .inputDispatchFailed)
    }
    event.post(tap: .cghidEventTap)
}

func postClick(at p: CGPoint, button: MouseButton, count: Int, expectation: NativeWindowExpectation) {
    postMove(to: p, expectation: expectation)
    usleep(25_000)
    for i in 0..<count {
        requireNativeWindowExpectation(expectation, points: [p])
        let clickState = Int64(min(i + 1, 2))
        guard
            let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton),
            let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
        else {
            emitError("could not create mouse click events", errorCode: .inputDispatchFailed)
        }
        down.setIntegerValueField(.mouseEventClickState, value: clickState)
        up.setIntegerValueField(.mouseEventClickState, value: clickState)
        down.post(tap: .cghidEventTap)
        usleep(35_000)
        if let error = validateNativeWindowExpectation(expectation, points: [p]) {
            up.post(tap: .cghidEventTap)
            emitError(error, errorCode: .uncertainUiTarget)
        }
        up.post(tap: .cghidEventTap)
        usleep(70_000)
    }
}

func postMouseDown(at p: CGPoint, button: MouseButton, expectation: NativeWindowExpectation) {
    postMove(to: p, expectation: expectation)
    usleep(25_000)
    requireNativeWindowExpectation(expectation, points: [p])
    guard let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton) else {
        emitError("could not create mouse-down event", errorCode: .inputDispatchFailed)
    }
    down.post(tap: .cghidEventTap)
}

func postMouseUp(at p: CGPoint, button: MouseButton, expectation: NativeWindowExpectation) {
    requireNativeWindowExpectation(expectation, points: [p])
    guard let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton) else {
        emitError("could not create mouse-up event", errorCode: .inputDispatchFailed)
    }
    up.post(tap: .cghidEventTap)
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
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left) else {
        emitError("could not create drag mouse-down event", errorCode: .inputDispatchFailed)
    }
    down.post(tap: .cghidEventTap)

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
            emitError(error, errorCode: .uncertainUiTarget)
        }
        guard let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left) else {
            let emergencyUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
            emergencyUp?.post(tap: .cghidEventTap)
            emitError("could not create drag event", errorCode: .inputDispatchFailed)
        }
        drag.post(tap: .cghidEventTap)
        usleep(sleepMicros)
    }

    if let error = validateNativeWindowExpectation(expectation, points: [end]) {
        let emergencyUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
        emergencyUp?.post(tap: .cghidEventTap)
        emitError(error, errorCode: .uncertainUiTarget)
    }
    guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left) else {
        emitError("could not create drag mouse-up event", errorCode: .inputDispatchFailed)
    }
    up.post(tap: .cghidEventTap)
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
    guard let event = CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 2,
        wheel1: Int32(deltaY),
        wheel2: Int32(deltaX),
        wheel3: 0
    ) else {
        emitError("could not create scroll event", errorCode: .inputDispatchFailed)
    }
    event.post(tap: .cghidEventTap)
}

enum NativeKeyModifier: String, CaseIterable {
    case command
    case shift
    case option
    case control
    case function

    var eventFlag: CGEventFlags {
        switch self {
        case .command: return .maskCommand
        case .shift: return .maskShift
        case .option: return .maskAlternate
        case .control: return .maskControl
        case .function: return .maskSecondaryFn
        }
    }
}

let allowedNativeKeyCodes: Set<Int> = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17,
    18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
    34, 35, 36, 37, 38, 40, 43, 45, 46, 47, 48, 49, 50, 51, 53,
    96, 97, 98, 99, 100, 101, 103, 109, 111, 115, 116, 118, 119, 120,
    121, 122, 123, 124, 125, 126,
]

func parsedNativeKeyModifiers() -> [NativeKeyModifier] {
    let raw = (arg("--modifiers") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return [] }
    let parts = raw.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
    guard parts.count <= 4, parts.allSatisfy({ !$0.isEmpty }) else {
        emitError("--modifiers must contain at most four comma-separated modifiers")
    }
    var seen = Set<NativeKeyModifier>()
    for part in parts {
        guard let modifier = NativeKeyModifier(rawValue: part), seen.insert(modifier).inserted else {
            emitError("--modifiers contains an unsupported or duplicate modifier")
        }
    }
    return NativeKeyModifier.allCases.filter(seen.contains)
}

func flagsForNativeKeyModifiers(_ modifiers: [NativeKeyModifier]) -> CGEventFlags {
    modifiers.reduce(into: CGEventFlags()) { flags, modifier in
        flags.insert(modifier.eventFlag)
    }
}

func postGuardedKey(
    keyCode: Int,
    modifiers: [NativeKeyModifier],
    expectation: NativeWindowExpectation
) {
    guard allowedNativeKeyCodes.contains(keyCode) else {
        emitError("--key-code is not in the bounded supported key set")
    }
    requireNativeWindowExpectation(expectation, points: [])
    guard
        let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: false)
    else {
        emitError("could not create keyboard events", errorCode: .inputDispatchFailed)
    }
    let flags = flagsForNativeKeyModifiers(modifiers)
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(18_000)
    if let error = validateNativeWindowExpectation(expectation, points: []) {
        up.post(tap: .cghidEventTap)
        emitError(error, errorCode: .uncertainUiTarget)
    }
    up.post(tap: .cghidEventTap)
}

func boundedStdinText() -> String {
    let maxBytes = 32 * 1024
    var data = Data()
    while data.count <= maxBytes {
        let remaining = maxBytes + 1 - data.count
        let chunk = FileHandle.standardInput.readData(ofLength: min(4096, remaining))
        if chunk.isEmpty { break }
        data.append(chunk)
    }
    guard data.count <= maxBytes else {
        emitError("stdin text exceeds the 32768-byte helper limit")
    }
    guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
        emitError("stdin must contain non-empty UTF-8 text")
    }
    guard text.utf16.count <= 4_000 else {
        emitError("stdin text exceeds the 4000 UTF-16-unit helper limit")
    }
    return text
}

func unicodeInputChunks(_ text: String, maxUtf16Units: Int = 32) -> [String] {
    var chunks: [String] = []
    var current = ""
    var currentUnits = 0
    for scalar in text.unicodeScalars {
        let scalarUnits = scalar.value > 0xffff ? 2 : 1
        if currentUnits + scalarUnits > maxUtf16Units && !current.isEmpty {
            chunks.append(current)
            current = ""
            currentUnits = 0
        }
        current.unicodeScalars.append(scalar)
        currentUnits += scalarUnits
    }
    if !current.isEmpty { chunks.append(current) }
    return chunks
}

func postGuardedUnicodeText(_ text: String, expectation: NativeWindowExpectation) {
    let chunks = unicodeInputChunks(text)
    for chunk in chunks {
        requireNativeWindowExpectation(expectation, points: [])
        guard
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else {
            emitError("could not create Unicode keyboard events", errorCode: .inputDispatchFailed)
        }
        let utf16 = Array(chunk.utf16)
        utf16.withUnsafeBufferPointer { buffer in
            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
        }
        down.post(tap: .cghidEventTap)
        usleep(12_000)
        if let error = validateNativeWindowExpectation(expectation, points: []) {
            up.post(tap: .cghidEventTap)
            emitError(error, errorCode: .uncertainUiTarget)
        }
        up.post(tap: .cghidEventTap)
        usleep(4_000)
    }
}

guard CommandLine.arguments.count >= 2 else {
    emitError("usage: uc-input-helper <window-proof|move|click|down|up|drag|scroll|type|key> ...")
}

if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt" as CFString: false] as CFDictionary) {
    emitError(
        "Accessibility permission not granted. System Settings > Privacy & Security > Accessibility > add the bridge/helper.",
        errorCode: .permissionDenied
    )
}

let subcommand = CommandLine.arguments[1]

switch subcommand {
case "window-proof":
    let pid = intArg("--pid", min: 1, max: Int(Int32.max))
    guard let proof = exactFrontmostWindowProof(pid: pid) else {
        emitError(
            "no exact frontmost visible normal window was available for the requested pid",
            errorCode: .uncertainUiTarget
        )
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
case "type":
    let expectation = parseNativeWindowExpectation()
    let text = boundedStdinText()
    postGuardedUnicodeText(text, expectation: expectation)
    emitOk("\"utf16Units\":\(text.utf16.count),\"chunks\":\(unicodeInputChunks(text).count)")
case "key":
    let keyCode = intArg("--key-code", min: 0, max: 126)
    let modifiers = parsedNativeKeyModifiers()
    let expectation = parseNativeWindowExpectation()
    postGuardedKey(keyCode: keyCode, modifiers: modifiers, expectation: expectation)
    let modifierJson = modifiers.map { jsonEscape($0.rawValue) }.joined(separator: ",")
    emitOk("\"keyCode\":\(keyCode),\"modifiers\":[\(modifierJson)]")
default:
    emitError("unknown subcommand: \(subcommand)")
}
