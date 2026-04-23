// uc-ax-helper — macOS accessibility tree walker for the UC bridge.
//
// Usage:
//   uc-ax-helper tree --app "zoom.us" [--max-depth 6] [--max-nodes 150]
//   uc-ax-helper tree --frontmost [--max-depth 6] [--max-nodes 150]
//   uc-ax-helper click --pid <pid> --path "0.2.1" [--button left|right]
//
// Output is NDJSON: exactly one `{"ok":true,...}` or `{"ok":false,"error":"..."}`
// line on stdout. Never prints to stderr on the happy path (the bridge
// streams stderr as diagnostics but doesn't treat it as data).
//
// Why Swift over Node bindings: AXUIElement is a C API that maps cleanly
// to Swift, runs in <50ms per call, and avoids pulling private frameworks
// / permissions scope issues that an npm dependency would create. The
// helper binary can be granted Accessibility once and reused across
// every bridge request.

import Cocoa
import ApplicationServices

// MARK: - JSON encoding helper (avoid JSONSerialization's non-deterministic key order)

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

// MARK: - AX value extraction

/// Read a String-ish attribute safely. Returns nil if absent or wrong type.
func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    if err != .success || value == nil { return nil }
    if let s = value as? String { return s }
    if let n = value as? NSNumber { return "\(n)" }
    return nil
}

/// Read a CGRect-ish attribute (position/size come as AXValue blobs).
func axCGRect(_ element: AXUIElement) -> CGRect? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard
        AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
        let posVal = posRef, let sizeVal = sizeRef
    else { return nil }

    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posVal as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeVal as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

/// Children of an element, in order; empty array when absent.
func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var ref: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &ref)
    if err != .success || ref == nil { return [] }
    return (ref as? [AXUIElement]) ?? []
}

// MARK: - Tree walk

/// Nodes whose role contributes noise without value (layout scaffolding we
/// don't want the model to click). We still descend into them.
let NOISE_ROLES: Set<String> = [
    "AXGroup", "AXLayoutArea", "AXLayoutItem", "AXSplitGroup", "AXScrollArea",
    "AXUnknown",
]

/// Roles that the model actually wants to target. Kept loose — the
/// pruning step filters by addressability (must have label or value).
let INTERESTING_ROLES: Set<String> = [
    "AXButton", "AXMenu", "AXMenuItem", "AXMenuBar", "AXMenuBarItem",
    "AXTextField", "AXTextArea", "AXComboBox", "AXCheckBox", "AXRadioButton",
    "AXPopUpButton", "AXLink", "AXStaticText", "AXTab", "AXTabGroup",
    "AXToolbar", "AXCell", "AXRow", "AXList", "AXOutline", "AXSlider",
    "AXWindow", "AXImage", "AXDisclosureTriangle",
]

struct Node {
    let id: String        // dotted path: "0.2.1"
    let role: String
    let label: String?
    let value: String?
    let bbox: CGRect?
    let children: [Node]
}

func readLabel(_ element: AXUIElement) -> String? {
    // Priority order: title → description → help → identifier (dev-set).
    // Value is kept separate because it represents *state* (e.g. text-field
    // contents) rather than semantic meaning.
    for attr in [kAXTitleAttribute, kAXDescriptionAttribute, "AXHelp", kAXIdentifierAttribute] {
        if let s = axString(element, attr as String), !s.isEmpty {
            return s
        }
    }
    return nil
}

func readValue(_ element: AXUIElement) -> String? {
    axString(element, kAXValueAttribute as String)
}

func walk(_ element: AXUIElement, path: String, depth: Int, maxDepth: Int, budget: inout Int) -> Node? {
    if budget <= 0 { return nil }
    budget -= 1

    let role = axString(element, kAXRoleAttribute as String) ?? "AXUnknown"
    let label = readLabel(element)
    let value = readValue(element)
    let bbox = axCGRect(element)

    var kids: [Node] = []
    if depth < maxDepth {
        var i = 0
        for child in axChildren(element) {
            if budget <= 0 { break }
            if let node = walk(child, path: "\(path).\(i)", depth: depth + 1, maxDepth: maxDepth, budget: &budget) {
                kids.append(node)
            }
            i += 1
        }
    }

    return Node(id: path, role: role, label: label, value: value, bbox: bbox, children: kids)
}

/// Drop leaves that are neither interesting nor carry label/value. Keeps
/// the tree lean for LLM consumption without losing addressable elements.
func prune(_ node: Node) -> Node? {
    let prunedChildren = node.children.compactMap { prune($0) }

    let isAddressable = (node.label != nil && !node.label!.isEmpty) ||
                        (node.value != nil && !node.value!.isEmpty)
    let isInteresting = INTERESTING_ROLES.contains(node.role)

    if prunedChildren.isEmpty && !isAddressable && !isInteresting {
        return nil
    }

    // Noise containers with exactly one child can be elided.
    if NOISE_ROLES.contains(node.role) && prunedChildren.count == 1 && !isAddressable {
        return prunedChildren[0]
    }

    return Node(
        id: node.id,
        role: node.role,
        label: node.label,
        value: node.value,
        bbox: node.bbox,
        children: prunedChildren
    )
}

// MARK: - JSON serialisation

func encodeNode(_ n: Node, into out: inout String) {
    out += "{"
    out += "\"id\":" + jsonEscape(n.id)
    out += ",\"role\":" + jsonEscape(n.role)
    if let l = n.label { out += ",\"label\":" + jsonEscape(l) }
    if let v = n.value { out += ",\"value\":" + jsonEscape(v) }
    if let r = n.bbox {
        out += String(format: ",\"bbox\":[%d,%d,%d,%d]",
                      Int(r.origin.x), Int(r.origin.y), Int(r.size.width), Int(r.size.height))
    }
    if !n.children.isEmpty {
        out += ",\"children\":["
        for (i, c) in n.children.enumerated() {
            if i > 0 { out += "," }
            encodeNode(c, into: &out)
        }
        out += "]"
    }
    out += "}"
}

// MARK: - App resolution

struct AppHandle {
    let pid: pid_t
    let name: String
    let axApp: AXUIElement
}

func resolveApp(byName: String?) -> AppHandle? {
    let running = NSWorkspace.shared.runningApplications
    let target: NSRunningApplication?
    if let byName = byName {
        let needle = byName.lowercased()
        target = running.first { app in
            guard let n = app.localizedName?.lowercased() else { return false }
            return n == needle || n.contains(needle)
        } ?? running.first { app in
            (app.bundleIdentifier ?? "").lowercased().contains(needle)
        }
    } else {
        target = running.first { $0.isActive }
    }
    guard let app = target, let name = app.localizedName else { return nil }
    return AppHandle(pid: app.processIdentifier, name: name, axApp: AXUIElementCreateApplication(app.processIdentifier))
}

// MARK: - Click by path

/// Resolve a dotted path ("0.2.1") back into an AXUIElement by walking
/// children from the AX app root. Returns nil when any index is out of range.
func elementAtPath(_ root: AXUIElement, path: String) -> AXUIElement? {
    let parts = path.split(separator: ".").compactMap { Int($0) }
    var current = root
    // Root path is "0"; walk the rest.
    guard let first = parts.first, first == 0 else { return nil }
    for idx in parts.dropFirst() {
        let kids = axChildren(current)
        if idx < 0 || idx >= kids.count { return nil }
        current = kids[idx]
    }
    return current
}

/// Try AXPress first (accessibility-native click); fall back to
/// synthesising a CGEvent at bbox centre when the element doesn't
/// implement Press.
func performClick(on element: AXUIElement) -> (ok: Bool, method: String, error: String?) {
    let pressErr = AXUIElementPerformAction(element, kAXPressAction as CFString)
    if pressErr == .success {
        return (true, "ax_press", nil)
    }
    // Synthetic click on centre of bounds.
    guard let rect = axCGRect(element) else {
        return (false, "none", "element has no bounds and no AXPress")
    }
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: centre, mouseButton: .left)
    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: centre, mouseButton: .left)
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
    return (true, "cg_event", nil)
}

// MARK: - CLI parsing

func arg(_ flag: String, default def: String? = nil) -> String? {
    let args = CommandLine.arguments
    for i in 0..<args.count {
        if args[i] == flag && i + 1 < args.count {
            return args[i + 1]
        }
    }
    return def
}

func flag(_ name: String) -> Bool {
    return CommandLine.arguments.contains(name)
}

func emitError(_ msg: String) {
    print("{\"ok\":false,\"error\":\(jsonEscape(msg))}")
    exit(1)
}

// MARK: - Main

guard CommandLine.arguments.count >= 2 else {
    emitError("usage: uc-ax-helper <tree|click> ...")
    exit(1)
}

let sub = CommandLine.arguments[1]

if sub == "tree" {
    // Trust check — the binary needs Accessibility. `AXIsProcessTrusted`
    // returns false if not granted; we surface a clear error.
    if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt" as CFString: false] as CFDictionary) {
        emitError("Accessibility permission not granted. System Settings → Privacy & Security → Accessibility → add the bridge.")
    }

    let appArg = arg("--app")
    let frontmostFlag = flag("--frontmost") || appArg == nil
    let maxDepth = Int(arg("--max-depth") ?? "6") ?? 6
    let maxNodes = Int(arg("--max-nodes") ?? "150") ?? 150

    guard let handle = resolveApp(byName: frontmostFlag ? nil : appArg) else {
        emitError("app not found: \(appArg ?? "<frontmost>")")
        exit(1)
    }

    var budget = maxNodes
    guard let root = walk(handle.axApp, path: "0", depth: 0, maxDepth: maxDepth, budget: &budget) else {
        emitError("could not walk \(handle.name) — app may be stuck or have no windows")
        exit(1)
    }
    let pruned = prune(root) ?? root

    var out = "{"
    out += "\"ok\":true"
    out += ",\"app\":" + jsonEscape(handle.name)
    out += ",\"pid\":\(handle.pid)"
    out += ",\"budget_used\":\(maxNodes - budget)"
    out += ",\"tree\":"
    encodeNode(pruned, into: &out)
    out += "}"
    print(out)
    exit(0)
}

if sub == "click" {
    if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt" as CFString: false] as CFDictionary) {
        emitError("Accessibility permission not granted.")
    }
    guard let pidStr = arg("--pid"), let pid = pid_t(pidStr) else {
        emitError("--pid required")
        exit(1)
    }
    guard let path = arg("--path") else {
        emitError("--path required")
        exit(1)
    }
    let axApp = AXUIElementCreateApplication(pid)
    guard let element = elementAtPath(axApp, path: path) else {
        emitError("path not found: \(path)")
        exit(1)
    }
    let result = performClick(on: element)
    if result.ok {
        print("{\"ok\":true,\"method\":\(jsonEscape(result.method))}")
        exit(0)
    } else {
        emitError(result.error ?? "click failed")
        exit(1)
    }
}

emitError("unknown subcommand: \(sub)")
