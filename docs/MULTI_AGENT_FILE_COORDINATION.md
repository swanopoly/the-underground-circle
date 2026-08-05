# Multi-Agent File Coordination — leases + content-hash CAS

> Goal: let multiple agents (this app's chat/SwanBot/OpenSwan + spawned
> subagents, AND external agents like a second Claude Code / Cursor session)
> work on the same local repo WITHOUT opening the same file at once or silently
> overwriting each other's edits. Built 2026-07-13.

## The problem (observed live)

While building this, a second agent was concurrently editing
`openswanToolRuntime.ts`, `swanbot.ts`, `chatPromptAssembly.ts`, and new
`connectedResources*` files. Two agents editing the same file, or one reading a
file and writing it back after another changed it, silently loses work. The app's
current editor (`desktop.edit_file` → `fileEditCore`) only catches this
*accidentally*: an exact-string `oldString` won't match if the file changed — but
that's not a guarantee (a `replaceAll` or a create can still clobber; and a
whole-file `file_write_text` blows away everything).

## Design principle — two independent guarantees + awareness

No single mechanism is enough, because an **external** agent (another Claude
Code / Cursor) will NOT call this app's lock API. So we layer:

### 1. Content-hash CAS — the universal safety net (protects against ANYONE)
Optimistic concurrency (the ETag / `If-Match` / DB-row-version pattern). When an
agent reads a file it records a **content hash** (the baseline). Before it writes,
we re-read the file and re-hash: if the hash changed, **refuse the write** and tell
the agent to re-read + re-apply. This needs **zero cooperation** — it catches a
conflict no matter who made the concurrent change (this app's other agent, an
external Cursor session, or the human). It is the load-bearing guarantee.

### 2. Advisory lease registry — coordination for cooperating agents
A shared registry (`.uc/agent-locks.json` at the repo root) mapping
`path → { ownerId, ownerLabel, acquiredAt, renewedAt, expiresAt, contentHash,
intent }`. Before editing, an agent **acquires a lease** (mutual exclusion); others
see the file is held and pick different work. Leases carry a **TTL + heartbeat** so
a crashed agent's lease auto-expires and is reclaimable (no permanent deadlock —
the Chubby/etcd lease model). The registry is a plain JSON file so a *cooperating*
external agent can read/respect it too.

### 3. Awareness — "who's working on what"
A `status` view of active (non-expired) leases + their intents, so agents (and the
user) self-partition work — exactly what the user did manually here. This is the
difference between "locks that block" and "coordination that helps."

## Flow (guarded edit)

```
claim(path, intent)        # acquire lease; if held-by-other → back off / pick other work
  → read(path) → baselineHash
  → apply edits (fileEditCore)
  → re-read(path) → currentHash
  → if currentHash != baselineHash: CONFLICT → refuse, re-read, retry   # CAS
  → write(path)
  → heartbeat while long-running
release(path)              # on completion, error, or timeout
```

## Failure modes & how they're handled
- **Crashed lease holder** → TTL expiry → next acquirer reclaims a stale lease.
- **Registry unavailable** (bridge offline) → fall back to **CAS-only** — still
  safe, just no cross-agent awareness. Never block work on the registry.
- **Registry read-modify-write race** (two app agents racing the JSON) → the small
  TOCTOU window is backstopped by the CAS layer (the loser's write is refused).
  A future hardening is an atomic `O_EXCL` lock-file bridge endpoint (below).
- **External agent ignores leases** → CAS still refuses the clobber.
- **Deadlock** → impossible: per-file leases, short TTL, no lock ordering; an agent
  editing N files acquires them independently and releases on finish/timeout.

## Layers implemented (pure-core-then-wire)

- `src/lib/agentFileLeaseCore.ts` (PURE, zero-import, smoke `agent-file-lease-core`):
  the state machine — `hashContent` (dependency-free FNV-1a + djb2 + length),
  `acquireLease` (grant / renew / held_by_other / reclaimed_stale), `renewLease`,
  `releaseLease`, `checkWriteConflict` (CAS clean/conflict), `pruneExpired`,
  `listActiveLeases`, `describeLease*`. Deterministic; the caller passes `now`.
- `src/lib/agentFileCoordination.ts` (runtime): persists the registry to
  `.uc/agent-locks.json` via the desktop bridge file ops, computes hashes, and
  exposes `claimFile / heartbeat / releaseFile / verifyUnchanged / listLeases /
  guardedEdit`. A stable per-session `ownerId`. Fails soft to CAS-only.

## Wiring (DONE)
`desktop.edit_file` now routes every edit through `guardedApplyEdits` (acquire an
advisory lease → read+hash → applyFileEdits → CAS re-verify unchanged → write →
release). It **refuses without writing** if another agent holds an active lease on
the file (`held_by_other`) or if the file changed on disk since it was read
(`conflict`), returning a clear message telling the model to check
`coordination.file_status`, pick another file, or re-read. The repo root for the
registry is resolved from the active codebase index (`getActiveCodebaseRoot`);
with no indexed root it falls back to the bridge-relative registry (CAS still
enforced). A new read-only `coordination.file_status` tool (pinned, `auto`)
surfaces the active leases (who is editing what + intent + time left) for
proactive planning. External agents use the `scripts/agent-coordination.ts` CLI
against the same registry. (`desktop.file_write_text` — the whole-file blob write
— is intentionally NOT auto-guarded: it has no read baseline to CAS against; the
guarded path is `desktop.edit_file`. A future step can add an optional
`baselineHash` to file_write_text.)

## Future hardening
- Atomic lock via an `O_EXCL` create endpoint on the bridge (removes the JSON
  read-modify-write race entirely) — the lease registry becomes advisory metadata
  on top of a real atomic lock.
- Git-worktree isolation per agent for heavy parallel work (the app's Agent tool
  already supports `isolation: "worktree"`); coordination is for shared-tree work.
- Broadcast active leases into the Office dashboard so humans see live agent
  territory.
