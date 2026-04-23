/**
 * agentTools/index — canonical import site for every registered tool.
 *
 * Import this module once (from `AgentExecutionCore` callers) to guarantee
 * every tool file's top-level `registerTool(...)` call has run. Each tool
 * is responsible for its own registration; this file is just the dependency
 * graph anchor so bundlers keep the modules alive.
 *
 * Adding a new tool: drop a file into this folder that calls `registerTool`
 * at module scope, then add a side-effect import here. Mirrors Hermes'
 * auto-discovery pattern, adapted to static bundling.
 */

export { getAvailableTools, getTool, listToolNames, registerTool, unregisterTool, _resetRegistry } from './registry';

// The canonical unification point — see docs/AGENTS_ROADMAP.md §4.
// Any caller of `agentExecutionCore.runAgent` that wants the full OpenSwan
// tool catalog should use `getOpenSwanToolsForSurface(...)`. Tools registered
// via the local `registry.ts` coexist; callers merge the two arrays before
// passing to `runAgent({ tools })`.
export { getOpenSwanToolsForSurface, getOpenSwanTool } from './openswanBridge';

// Side-effect imports — each self-registers with the LOCAL registry. These
// are add-on tools we introduced before the bridge existed. Long-term they
// should migrate into `openswanToolRuntime.ts`; until then they're fine as
// global registrations callers can merge alongside the bridge output.
import './getMemberStatus';
import './searchCircleMemory';
import './getGithubActivity';
import './viewLibrarySkill';
import './manageLibrarySkill';
import './manageUserMemory';
import './sessionSearch';
import './desktopActions';   // Phase 1b — launch/focus/type/keys on the local bridge
