// uc-input-helper - macOS CoreGraphics mouse primitive helper for the UC bridge.
//
// Usage:
//   uc-input-helper move --x 120 --y 240
//   uc-input-helper click --x 120 --y 240 [--button left|right] [--count 1|2]
//   uc-input-helper down --x 120 --y 240 [--button left|right]
//   uc-input-helper up [--x 120 --y 240] [--button left|right]
//   uc-input-helper drag --from-x 120 --from-y 240 --to-x 600 --to-y 500 [--duration-ms 450]
//   uc-input-helper scroll --x 120 --y 240 [--delta-x 0] [--delta-y -600]
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

func postMove(to p: CGPoint) {
    let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)
    event?.post(tap: .cghidEventTap)
}

func postClick(at p: CGPoint, button: MouseButton, count: Int) {
    postMove(to: p)
    usleep(25_000)
    for i in 0..<count {
        let clickState = Int64(min(i + 1, 2))
        let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton)
        down?.setIntegerValueField(.mouseEventClickState, value: clickState)
        down?.post(tap: .cghidEventTap)
        usleep(35_000)
        let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
        up?.setIntegerValueField(.mouseEventClickState, value: clickState)
        up?.post(tap: .cghidEventTap)
        usleep(70_000)
    }
}

func postMouseDown(at p: CGPoint, button: MouseButton) {
    postMove(to: p)
    usleep(25_000)
    let down = CGEvent(mouseEventSource: nil, mouseType: button.downType, mouseCursorPosition: p, mouseButton: button.cgButton)
    down?.post(tap: .cghidEventTap)
}

func postMouseUp(at p: CGPoint, button: MouseButton) {
    let up = CGEvent(mouseEventSource: nil, mouseType: button.upType, mouseCursorPosition: p, mouseButton: button.cgButton)
    up?.post(tap: .cghidEventTap)
}

func postDrag(from start: CGPoint, to end: CGPoint, durationMs: Int) {
    postMove(to: start)
    usleep(35_000)
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
        let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(sleepMicros)
    }

    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
    up?.post(tap: .cghidEventTap)
}

func postScroll(at p: CGPoint, deltaX: Int, deltaY: Int) {
    postMove(to: p)
    usleep(20_000)
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
    emitError("usage: uc-input-helper <move|click|down|up|drag|scroll> ...")
}

if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt" as CFString: false] as CFDictionary) {
    emitError("Accessibility permission not granted. System Settings > Privacy & Security > Accessibility > add the bridge/helper.")
}

let subcommand = CommandLine.arguments[1]

switch subcommand {
case "move":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    postMove(to: point(x, y))
    emitOk("\"x\":\(x),\"y\":\(y)")
case "click":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let button = parsedButton()
    let count = intArg("--count", min: 1, max: 3, default: 1)
    postClick(at: point(x, y), button: button, count: count)
    emitOk("\"x\":\(x),\"y\":\(y),\"button\":\(jsonEscape(button.rawValue)),\"count\":\(count)")
case "down":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let button = parsedButton()
    postMouseDown(at: point(x, y), button: button)
    emitOk("\"x\":\(x),\"y\":\(y),\"button\":\(jsonEscape(button.rawValue))")
case "up":
    let rawX = arg("--x")
    let rawY = arg("--y")
    let x = rawX != nil ? intArg("--x", min: 0, max: 20_000) : -1
    let y = rawY != nil ? intArg("--y", min: 0, max: 20_000) : -1
    let button = parsedButton()
    let p = x >= 0 && y >= 0 ? point(x, y) : CGEvent(source: nil)?.location ?? CGPoint(x: 0, y: 0)
    postMouseUp(at: p, button: button)
    emitOk("\"x\":\(Int(p.x)),\"y\":\(Int(p.y)),\"button\":\(jsonEscape(button.rawValue))")
case "drag":
    let fromX = intArg("--from-x", min: 0, max: 20_000)
    let fromY = intArg("--from-y", min: 0, max: 20_000)
    let toX = intArg("--to-x", min: 0, max: 20_000)
    let toY = intArg("--to-y", min: 0, max: 20_000)
    let durationMs = intArg("--duration-ms", min: 50, max: 5_000, default: 450)
    postDrag(from: point(fromX, fromY), to: point(toX, toY), durationMs: durationMs)
    emitOk("\"fromX\":\(fromX),\"fromY\":\(fromY),\"toX\":\(toX),\"toY\":\(toY),\"durationMs\":\(durationMs)")
case "scroll":
    let x = intArg("--x", min: 0, max: 20_000)
    let y = intArg("--y", min: 0, max: 20_000)
    let deltaX = intArg("--delta-x", min: -20_000, max: 20_000, default: 0)
    let deltaY = intArg("--delta-y", min: -20_000, max: 20_000, default: 0)
    if deltaX == 0 && deltaY == 0 {
        emitError("delta-x or delta-y must be non-zero")
    }
    postScroll(at: point(x, y), deltaX: deltaX, deltaY: deltaY)
    emitOk("\"x\":\(x),\"y\":\(y),\"deltaX\":\(deltaX),\"deltaY\":\(deltaY)")
default:
    emitError("unknown subcommand: \(subcommand)")
}
