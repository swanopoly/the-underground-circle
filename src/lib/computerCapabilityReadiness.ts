/**
 * computerCapabilityReadiness — pure capability-readiness rules split out of
 * `computerCapabilityRegistry` (which imports supabase/react-native through its
 * connection + bridge loaders) so the rules stay smoke-testable in plain Node.
 * Only pure logic here; no runtime imports.
 */

/**
 * The `agent_bridges` capability is ready when EITHER a persisted agent
 * connection is enabled OR the live local bridge health probe succeeds — the
 * bridge on :7778 (claude-bridge.js) is itself the Claude Code / Codex agent
 * transport, so a live probe means an agent bridge is reachable even when the
 * persisted connection store is empty (auto-connected bridges aren't always
 * written there). Without this, `agent_bridges` audited 'missing' while the
 * bridge was demonstrably alive, blocking unknown-app tasks (e.g. "create a
 * Notes note") with a phantom "Agent bridges missing" preflight.
 */
export function isAgentBridgeCapabilityReady(args: {
  enabledConnectionCount: number;
  bridgeAlive: boolean;
}): boolean {
  return args.enabledConnectionCount > 0 || args.bridgeAlive === true;
}
