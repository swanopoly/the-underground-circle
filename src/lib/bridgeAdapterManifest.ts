/**
 * bridgeAdapterManifest — the bridge surface as DATA, not code (Lane D).
 *
 * Adding a new bridge capability today means editing root-owned runtime code:
 * a tool schema in `openswanToolRuntime.ts`, a risk/approval branch, an
 * evidence-before/proof-after clause in `computerTaskEvidenceContract.ts`.
 * This module makes that a data problem instead. Each bridge endpoint is one
 * declarative `BridgeAdapter` row: endpoint → capability family → risk tier →
 * approval requirement → evidence-before / proof-after → floor categories.
 * A new capability becomes a new manifest entry — and that entry can even come
 * from user/data-provided JSON via `loadAdapterManifest` — with no code change.
 *
 * Grounding (real endpoints, not invented):
 *   - Browser rows mirror `browserBridge.ts` (/browser/open_url, click_role,
 *     fill, select, upload_file, press, screenshot, dom_snapshot, page_source,
 *     verification_state, close) plus the NEW primitives the browser lane is
 *     landing (download, tabs, wait_for, scroll).
 *   - Desktop rows mirror `desktopBridge.ts` (/desktop reads: running-apps,
 *     window_state, clipboard, file_list/read/search/stat, a11y_tree, tabs …;
 *     and gated acts: file_grant, launch/focus, type/paste/keys, clipboard
 *     write/clear, file rename/copy/trash/mkdir/write_text, open_url/open_path,
 *     applescript, convert_image, InDesign scripted mutations …).
 *
 * Vocabulary is borrowed from the source of truth, not re-invented:
 *   - `capabilityFamily` uses the `chatCapabilityManifest` family tokens
 *     ('browser', 'desktop', 'desktop:design', 'vault').
 *   - `evidenceBefore` / `proofAfter` phrasing echoes
 *     `computerTaskEvidenceContract` (observe-before / proof-after).
 *   - `floorCategories` are `ChatComputerConstraintCategory` values, and the
 *     always-confirm floor (pay/delete/login/grant) is enforced through
 *     `computerGrantGate`'s canonical `STICKY_FLOOR_CATEGORIES` /
 *     `STICKY_GRANTABLE_CATEGORIES` so this manifest can never drift from or
 *     weaken the floor.
 *
 * HARD INVARIANT: a data-provided entry can NEVER downgrade a floor category or
 * set `requiresApproval=false` on a gated / floor-bearing endpoint. `validate`
 * and `loadAdapterManifest` refuse or repair such entries (fail safe), so
 * malicious or buggy manifest data cannot open a floor bypass.
 *
 * Dependency-light on purpose: cross-module imports are `import type` ONLY,
 * except the pure `computerGrantGate` floor constants (no react-native in its
 * transitive deps), so tsx smoke tests load this without react-native.
 */

import type { ChatComputerConstraintCategory } from './chatComputerRequestRouter';
import {
  STICKY_FLOOR_CATEGORIES,
  STICKY_GRANTABLE_CATEGORIES,
} from './computerGrantGate';

// ─── Constraint-category vocabulary (re-anchored to the floor source) ─────────

/** All constraint categories the router understands = grantable ∪ floor. */
export const ALL_CONSTRAINT_CATEGORIES: readonly ChatComputerConstraintCategory[] = [
  ...STICKY_GRANTABLE_CATEGORIES,
  ...STICKY_FLOOR_CATEGORIES,
];

const ALL_CATEGORY_SET = new Set<ChatComputerConstraintCategory>(ALL_CONSTRAINT_CATEGORIES);
const FLOOR_CATEGORY_SET = new Set<ChatComputerConstraintCategory>(STICKY_FLOOR_CATEGORIES);

// ─── Types ────────────────────────────────────────────────────────────────────

export type BridgeSurface = 'browser' | 'desktop';

/**
 * Risk tier for one bridge endpoint:
 *   - 'read'  → observation only, no mutation / side effect; never gated.
 *   - 'low'   → a bounded, reversible mutation that still runs through approval
 *               policy but carries no floor category (e.g. clipboard write).
 *   - 'gated' → a state-changing / external-side-effect endpoint. Always
 *               `requiresApproval: true`; usually carries floor categories.
 */
export type BridgeRiskTier = 'read' | 'low' | 'gated';

/**
 * One declarative bridge-endpoint capability. Adding a row here (or supplying
 * one to `loadAdapterManifest`) is the "new capability without touching code"
 * path. `id` is the stable key; `endpoint` is the wire path on the bridge.
 */
export interface BridgeAdapter {
  /** Stable id; also the tool-ish name callers key on (e.g. 'browser.open_url'). */
  id: string;
  /** Wire path on the bridge, e.g. '/browser/open_url' or '/desktop/file_grant'. */
  endpoint: string;
  surface: BridgeSurface;
  /** Capability-family token (chatCapabilityManifest vocabulary). */
  capabilityFamily: string;
  riskTier: BridgeRiskTier;
  /** True when a human approval gate applies before running the endpoint. */
  requiresApproval: boolean;
  /** Observe-before evidence the caller must gather first (evidence contract vocabulary). */
  evidenceBefore: string[];
  /** Proof-after evidence the caller must produce to claim success. */
  proofAfter: string[];
  /** Always-confirm / constraint categories this endpoint can trigger. */
  floorCategories: ChatComputerConstraintCategory[];
}

// ─── Default (code-seeded) manifest ─────────────────────────────────────────────
//
// Every entry maps to a REAL endpoint in browserBridge.ts / desktopBridge.ts,
// except the four NEW browser primitives (download/tabs/wait_for/scroll) the
// browser lane is landing — seeded here so the manifest is ready the moment they
// ship. Reads are riskTier 'read' + requiresApproval false + no floor. Mutations
// / downloads / grants are 'gated' with the right floor categories and
// evidence/proof.

const OBSERVE_URL_STATE = 'confirm URL, origin, login state, and target page title';
const OBSERVE_DOM = 'capture a fresh DOM/ARIA snapshot before each action group';
const PROOF_DOM_STATE = 'refreshed DOM/ARIA state or confirmation text';
const PROOF_URL_STATE = 'URL/title/state change when relevant';
const OBSERVE_APP_IDENTITY = 'confirm app/window identity and active document identity before mutation';
const OBSERVE_A11Y = 'capture accessibility tree, menu inventory, and screenshot before mutation';
const OBSERVE_PATH = 'resolve exact scoped folder/path and capture file_stat before mutation';
const PROOF_FILE_STAT = 'output file_stat, basename/hash, or count summary when files change';

export const DEFAULT_BRIDGE_ADAPTERS: readonly BridgeAdapter[] = [
  // ── Browser: reads ─────────────────────────────────────────────────────────
  {
    id: 'browser.dom_snapshot',
    endpoint: '/browser/dom_snapshot',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_URL_STATE],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'browser.page_source',
    endpoint: '/browser/page_source',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_URL_STATE],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'browser.verification_state',
    endpoint: '/browser/verification_state',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'browser.screenshot',
    endpoint: '/browser/screenshot',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_URL_STATE],
    proofAfter: [],
    floorCategories: [],
  },
  // ── Browser: NEW primitives (browser lane) ──────────────────────────────────
  {
    id: 'browser.tabs',
    endpoint: '/browser/tabs',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'browser.wait_for',
    endpoint: '/browser/wait_for',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_DOM],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: [],
  },
  {
    id: 'browser.scroll',
    endpoint: '/browser/scroll',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_DOM],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: [],
  },
  {
    id: 'browser.toggle_target',
    endpoint: '/browser/toggle_target',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_DOM],
    proofAfter: [],
    floorCategories: [],
  },
  // ── Browser: mutations ───────────────────────────────────────────────────────
  {
    id: 'browser.open_url',
    endpoint: '/browser/open_url',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_URL_STATE],
    proofAfter: [PROOF_URL_STATE],
    floorCategories: [],
  },
  {
    id: 'browser.click_role',
    endpoint: '/browser/click_role',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM, 'locator resolves to exactly one visible, enabled target'],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: ['submit'],
  },
  {
    id: 'browser.set_toggle',
    endpoint: '/browser/set_toggle',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM, 'one exact non-consequential state control capability'],
    proofAfter: ['same-target previous/current/desired boolean state proof', PROOF_DOM_STATE],
    floorCategories: [],
  },
  {
    id: 'browser.fill',
    endpoint: '/browser/fill',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM, 'field locator resolves to exactly one editable target'],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: ['submit'],
  },
  {
    id: 'browser.select',
    endpoint: '/browser/select',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM, 'option locator resolves to exactly one target'],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: ['submit'],
  },
  {
    id: 'browser.press',
    endpoint: '/browser/press',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM],
    proofAfter: [PROOF_DOM_STATE],
    floorCategories: ['submit'],
  },
  {
    id: 'browser.upload_file',
    endpoint: '/browser/upload_file',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_DOM, 'record upload file basename and scoped file grant'],
    proofAfter: ['upload basename + size', PROOF_DOM_STATE],
    floorCategories: ['upload'],
  },
  {
    id: 'browser.download',
    endpoint: '/browser/download',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_URL_STATE, 'confirm the download trigger and destination'],
    proofAfter: ['download basename + size'],
    floorCategories: ['download'],
  },
  // ── Browser: lifecycle ───────────────────────────────────────────────────────
  {
    id: 'browser.close',
    endpoint: '/browser/close',
    surface: 'browser',
    capabilityFamily: 'browser',
    riskTier: 'low',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },

  // ── Desktop: reads ────────────────────────────────────────────────────────────
  {
    id: 'desktop.list_running_apps',
    endpoint: '/desktop/running-apps',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.window_state',
    endpoint: '/desktop/window_state',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.list_browser_tabs',
    endpoint: '/desktop/browser_tabs',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.clipboard',
    endpoint: '/desktop/clipboard',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.screenshot',
    endpoint: '/desktop/screenshot',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.a11y_tree',
    endpoint: '/desktop/a11y_tree',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.file_list',
    endpoint: '/desktop/file_list',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: ['resolve exact scoped folder/path before reading'],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.file_read',
    endpoint: '/desktop/file_read',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: ['resolve exact scoped file path before reading'],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.file_search',
    endpoint: '/desktop/file_search',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: ['resolve exact scoped root folder before searching'],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.file_stat',
    endpoint: '/desktop/file_stat',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.indesign_document_status',
    endpoint: '/desktop/indesign_document_status',
    surface: 'desktop',
    capabilityFamily: 'desktop:design',
    riskTier: 'read',
    requiresApproval: false,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: [],
    floorCategories: [],
  },

  // ── Desktop: grant (vault-family, floor) ─────────────────────────────────────
  {
    id: 'desktop.file_grant',
    endpoint: '/desktop/file_grant',
    surface: 'desktop',
    capabilityFamily: 'vault',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: ['resolve exact roots and scope (read/write) being granted'],
    proofAfter: ['granted roots, scope, and expiry'],
    floorCategories: ['grant'],
  },

  // ── Desktop: bounded / low-risk mutations ────────────────────────────────────
  {
    id: 'desktop.clipboard_write',
    endpoint: '/desktop/clipboard_write',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'low',
    requiresApproval: true,
    evidenceBefore: [],
    proofAfter: ['written character count'],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.clipboard_clear',
    endpoint: '/desktop/clipboard_clear',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'low',
    requiresApproval: true,
    evidenceBefore: [],
    proofAfter: [],
    floorCategories: [],
  },

  // ── Desktop: gated acts ──────────────────────────────────────────────────────
  {
    id: 'desktop.launch_app',
    endpoint: '/desktop/launch',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: ['confirm the target app is installed'],
    proofAfter: ['app appears in the running-app list'],
    floorCategories: [],
  },
  {
    id: 'desktop.focus_app',
    endpoint: '/desktop/focus',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: ['frontmost app is the target'],
    floorCategories: [],
  },
  {
    id: 'desktop.type',
    endpoint: '/desktop/type',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY, 'confirm the focused field before typing'],
    proofAfter: ['refreshed a11y/field value or screenshot'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.paste_text',
    endpoint: '/desktop/paste_text',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY, 'confirm the focused field before pasting'],
    proofAfter: ['refreshed a11y/field value or screenshot'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.keys',
    endpoint: '/desktop/keys',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: ['refreshed a11y/screen state'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.click_element',
    endpoint: '/desktop/click_element',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_A11Y, 'target element is uniquely identified from a fresh tree read'],
    proofAfter: ['refreshed a11y/screen state'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.set_element_value',
    endpoint: '/desktop/set_element_value',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_A11Y, 'target element is uniquely identified from a fresh tree read'],
    proofAfter: ['refreshed element value'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.click_at',
    endpoint: '/desktop/click_at',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: ['fresh screenshot before any blind coordinate click'],
    proofAfter: ['fresh screenshot after the click'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.menu_click',
    endpoint: '/desktop/menu_click',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY, 'menu path resolves in a fresh menu inventory'],
    proofAfter: ['refreshed a11y/screen state'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.open_url',
    endpoint: '/desktop/open_url',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: ['confirm the URL and scheme'],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.open_path',
    endpoint: '/desktop/open_path',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH],
    proofAfter: [],
    floorCategories: [],
  },
  {
    id: 'desktop.applescript',
    endpoint: '/desktop/applescript',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: ['script output plus refreshed app/document state'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.notes_create',
    endpoint: '/desktop/notes_create',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [],
    proofAfter: ['created note title and character count'],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.convert_image',
    endpoint: '/desktop/convert_image',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH],
    proofAfter: [PROOF_FILE_STAT],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.file_write_text',
    endpoint: '/desktop/file_write_text',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH, 'write target is unique and not broader than requested'],
    proofAfter: [PROOF_FILE_STAT],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.file_rename',
    endpoint: '/desktop/file_rename',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH],
    proofAfter: [PROOF_FILE_STAT],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.file_copy',
    endpoint: '/desktop/file_copy',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH],
    proofAfter: [PROOF_FILE_STAT],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.file_mkdir',
    endpoint: '/desktop/file_mkdir',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH],
    proofAfter: [PROOF_FILE_STAT],
    floorCategories: ['save'],
  },
  {
    id: 'desktop.file_trash',
    endpoint: '/desktop/file_trash',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_PATH, 'delete target is unique and not broader than requested'],
    proofAfter: ['trash path plus refreshed directory listing'],
    floorCategories: ['delete'],
  },
  {
    id: 'desktop.shortcuts_run',
    endpoint: '/desktop/shortcuts/run',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: ['confirm the shortcut name exists in the shortcuts list'],
    proofAfter: ['shortcut output'],
    floorCategories: ['submit'],
  },
  {
    id: 'desktop.window_manage',
    endpoint: '/desktop/window_manage',
    surface: 'desktop',
    capabilityFamily: 'desktop',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [OBSERVE_APP_IDENTITY],
    proofAfter: ['refreshed window state'],
    floorCategories: [],
  },
  {
    id: 'desktop.indesign_batch_find_change',
    endpoint: '/desktop/indesign_batch_find_change',
    surface: 'desktop',
    capabilityFamily: 'desktop:design',
    riskTier: 'gated',
    requiresApproval: true,
    evidenceBefore: [
      OBSERVE_APP_IDENTITY,
      'active document matches the staged file and target frames are identified',
    ],
    proofAfter: ['refreshed InDesign document status plus changed-entity summary'],
    floorCategories: ['save'],
  },
] as const;

// ─── Validation ─────────────────────────────────────────────────────────────────

const KNOWN_SURFACES = new Set<BridgeSurface>(['browser', 'desktop']);
const KNOWN_RISK_TIERS = new Set<BridgeRiskTier>(['read', 'low', 'gated']);

export interface ManifestValidationError {
  /** The offending entry's id (or endpoint / index label when id is unusable). */
  id: string;
  reason: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: ManifestValidationError[];
}

function normalizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (text && !out.includes(text)) out.push(text.slice(0, 200));
    if (out.length >= max) break;
  }
  return out;
}

function normalizeFloorCategories(value: unknown): ChatComputerConstraintCategory[] {
  if (!Array.isArray(value)) return [];
  const out: ChatComputerConstraintCategory[] = [];
  for (const item of value) {
    const cat = String(item ?? '').trim().toLowerCase() as ChatComputerConstraintCategory;
    if (ALL_CATEGORY_SET.has(cat) && !out.includes(cat)) out.push(cat);
  }
  return out;
}

/** True when the entry mutates / has side effects (gated tier or any floor). */
function entryBearsFloorOrGate(riskTier: BridgeRiskTier, floorCategories: ChatComputerConstraintCategory[]): boolean {
  return riskTier === 'gated' || floorCategories.length > 0;
}

/**
 * Validate a candidate manifest (array of raw entries). Checks required fields,
 * known surfaces / risk tiers, and valid floor categories, and — critically —
 * that no floor/gate-bearing entry is left without `requiresApproval`. Pure and
 * total: it never throws. `ok` is true only when there are zero errors.
 *
 * Note: this reports what is WRONG. `loadAdapterManifest` is the tolerant path
 * that drops or repairs the bad entries; use `validate` when you want to reject
 * a whole candidate manifest outright (e.g. an admin import preview).
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ id: '(manifest)', reason: 'manifest must be an array of bridge adapters' }] };
  }
  const seenIds = new Set<string>();
  raw.forEach((item, index) => {
    const record = (item && typeof item === 'object') ? item as Record<string, unknown> : null;
    const idLabel = String(record?.id || record?.endpoint || `#${index}`).slice(0, 160);
    if (!record) {
      errors.push({ id: idLabel, reason: 'entry must be an object' });
      return;
    }
    const id = String(record.id || '').trim();
    if (!id) errors.push({ id: idLabel, reason: 'missing id' });
    else if (seenIds.has(id)) errors.push({ id: idLabel, reason: `duplicate id "${id}"` });
    else seenIds.add(id);

    const endpoint = String(record.endpoint || '').trim();
    if (!endpoint || !endpoint.startsWith('/')) {
      errors.push({ id: idLabel, reason: 'endpoint must be a non-empty path starting with "/"' });
    }

    const surface = String(record.surface || '') as BridgeSurface;
    if (!KNOWN_SURFACES.has(surface)) {
      errors.push({ id: idLabel, reason: `unknown surface "${String(record.surface || '')}" (expected browser|desktop)` });
    }

    const riskTier = String(record.riskTier || '') as BridgeRiskTier;
    if (!KNOWN_RISK_TIERS.has(riskTier)) {
      errors.push({ id: idLabel, reason: `unknown riskTier "${String(record.riskTier || '')}" (expected read|low|gated)` });
    }

    if (!String(record.capabilityFamily || '').trim()) {
      errors.push({ id: idLabel, reason: 'missing capabilityFamily' });
    }

    if (Array.isArray(record.floorCategories)) {
      const invalid = record.floorCategories
        .map((c) => String(c ?? '').trim().toLowerCase())
        .filter((c) => c && !ALL_CATEGORY_SET.has(c as ChatComputerConstraintCategory));
      if (invalid.length > 0) {
        errors.push({ id: idLabel, reason: `invalid floor categories: ${invalid.join(', ')}` });
      }
    } else if (record.floorCategories !== undefined) {
      errors.push({ id: idLabel, reason: 'floorCategories must be an array' });
    }

    // Floor invariant: a gated / floor-bearing endpoint cannot opt out of approval.
    const floorCats = normalizeFloorCategories(record.floorCategories);
    const effectiveTier: BridgeRiskTier = KNOWN_RISK_TIERS.has(riskTier) ? riskTier : 'gated';
    if (record.requiresApproval === false && entryBearsFloorOrGate(effectiveTier, floorCats)) {
      errors.push({
        id: idLabel,
        reason: 'requiresApproval cannot be false on a gated or floor-bearing endpoint',
      });
    }
    // A read-tier endpoint must not carry floor categories (that would be a
    // mislabeled mutation masquerading as an observation).
    if (riskTier === 'read' && floorCats.length > 0) {
      errors.push({
        id: idLabel,
        reason: `read-tier endpoint cannot carry floor categories: ${floorCats.join(', ')}`,
      });
    }
  });
  return { ok: errors.length === 0, errors };
}

// ─── Load / merge (the "add an adapter without touching code" path) ──────────────

export interface LoadedBridgeManifest {
  adapters: BridgeAdapter[];
  /** Data-provided entries that were dropped, with why (fail-safe audit trail). */
  dropped: ManifestValidationError[];
  /** Data-provided ids that overrode a default entry. */
  overridden: string[];
  /** Entries whose unsafe fields were repaired rather than dropped. */
  repaired: ManifestValidationError[];
}

/**
 * Coerce one raw entry into a safe, fully-typed `BridgeAdapter`, repairing the
 * floor invariant instead of trusting the caller. Returns null when the entry
 * is unsalvageable (missing/invalid required fields). `repairs` collects any
 * fail-safe adjustments made (e.g. re-forcing requiresApproval on a gated row).
 */
function coerceAdapter(
  record: Record<string, unknown>,
  repairs: ManifestValidationError[],
): BridgeAdapter | null {
  const id = String(record.id || '').trim();
  const endpoint = String(record.endpoint || '').trim();
  const surface = String(record.surface || '') as BridgeSurface;
  const riskTier = String(record.riskTier || '') as BridgeRiskTier;
  const capabilityFamily = String(record.capabilityFamily || '').trim();
  if (!id || !endpoint || !endpoint.startsWith('/')) return null;
  if (!KNOWN_SURFACES.has(surface) || !KNOWN_RISK_TIERS.has(riskTier)) return null;
  if (!capabilityFamily) return null;

  let floorCategories = normalizeFloorCategories(record.floorCategories);
  // Read-tier rows can never carry floor categories — strip them (fail safe).
  if (riskTier === 'read' && floorCategories.length > 0) {
    repairs.push({ id, reason: `stripped floor categories from read-tier endpoint: ${floorCategories.join(', ')}` });
    floorCategories = [];
  }

  const bearsFloorOrGate = entryBearsFloorOrGate(riskTier, floorCategories);
  let requiresApproval = record.requiresApproval === true
    || (record.requiresApproval !== false && bearsFloorOrGate);
  // HARD INVARIANT repair: a gated / floor-bearing endpoint is ALWAYS gated,
  // no matter what the data claimed. This is the line malicious data cannot cross.
  if (bearsFloorOrGate && requiresApproval !== true) {
    repairs.push({ id, reason: 'forced requiresApproval=true on a gated/floor-bearing endpoint' });
    requiresApproval = true;
  }

  return {
    id: id.slice(0, 160),
    endpoint: endpoint.slice(0, 200),
    surface,
    capabilityFamily: capabilityFamily.slice(0, 80),
    riskTier,
    requiresApproval,
    evidenceBefore: normalizeStringList(record.evidenceBefore, 10),
    proofAfter: normalizeStringList(record.proofAfter, 10),
    floorCategories,
  };
}

/**
 * Build the effective manifest: `DEFAULT_BRIDGE_ADAPTERS` merged with an
 * optional user/data-provided array. User entries ADD new adapters or OVERRIDE
 * a default by matching `id`. Every entry — default or provided — is run
 * through the same coercion so the floor invariant holds uniformly; invalid
 * entries are dropped (with a reason) and unsafe-but-salvageable ones are
 * repaired (with a reason). This is the "supply extra adapters as data, no code
 * change" seam.
 */
export function loadAdapterManifest(userProvided?: unknown): LoadedBridgeManifest {
  const dropped: ManifestValidationError[] = [];
  const repaired: ManifestValidationError[] = [];
  const overridden: string[] = [];

  // Start from the (trusted, but still coerced) defaults, keyed by id.
  const byId = new Map<string, BridgeAdapter>();
  for (const entry of DEFAULT_BRIDGE_ADAPTERS) {
    const coerced = coerceAdapter(entry as unknown as Record<string, unknown>, repaired);
    if (coerced) byId.set(coerced.id, coerced);
  }

  if (userProvided !== undefined && userProvided !== null) {
    if (!Array.isArray(userProvided)) {
      dropped.push({ id: '(userProvided)', reason: 'user-provided manifest must be an array' });
    } else {
      userProvided.forEach((item, index) => {
        const record = (item && typeof item === 'object') ? item as Record<string, unknown> : null;
        if (!record) {
          dropped.push({ id: `#${index}`, reason: 'entry must be an object' });
          return;
        }
        const coerced = coerceAdapter(record, repaired);
        if (!coerced) {
          dropped.push({ id: String(record.id || record.endpoint || `#${index}`).slice(0, 160), reason: 'invalid or incomplete adapter (missing/unknown id, endpoint, surface, riskTier, or capabilityFamily)' });
          return;
        }
        if (byId.has(coerced.id)) overridden.push(coerced.id);
        byId.set(coerced.id, coerced);
      });
    }
  }

  return {
    adapters: Array.from(byId.values()),
    dropped,
    overridden: Array.from(new Set(overridden)),
    repaired,
  };
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

/** Find an adapter by exact id or exact endpoint path. Returns null when absent. */
export function findAdapter(
  manifest: readonly BridgeAdapter[],
  idOrEndpoint: string,
): BridgeAdapter | null {
  const needle = String(idOrEndpoint || '').trim();
  if (!needle) return null;
  return manifest.find((a) => a.id === needle || a.endpoint === needle) || null;
}

/** All adapters in a capability family (case-insensitive on the family token). */
export function adaptersForFamily(
  manifest: readonly BridgeAdapter[],
  family: string,
): BridgeAdapter[] {
  const token = String(family || '').trim().toLowerCase();
  if (!token) return [];
  return manifest.filter((a) => a.capabilityFamily.toLowerCase() === token);
}

/** All adapters on a bridge surface. */
export function adaptersForSurface(
  manifest: readonly BridgeAdapter[],
  surface: BridgeSurface,
): BridgeAdapter[] {
  return manifest.filter((a) => a.surface === surface);
}
