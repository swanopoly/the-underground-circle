#!/usr/bin/env python3
"""
update_hf_endpoint.py — Tell a Hugging Face Inference Endpoint to pull
the latest revision of its source model repo.

Called after `fuse_and_upload_v5.py` pushes fresh weights to
`cswan801/BlackSwan-v5`. Without this, the running endpoint keeps
serving whatever commit it was deployed with — so the team would
chat with stale weights even though HF has the new ones.

Behaviour:
1. Resolve the latest commit on the model repo.
2. Use huggingface_hub.HfApi.update_inference_endpoint(..., revision=sha)
   so the endpoint is explicitly pinned to that commit.
3. Poll the endpoint for up to ~3 min, looking
   for the state to settle into one of:
     - "running" — endpoint is up serving the new revision
     - "scaledToZero" — endpoint accepted the update; will apply on
        next wake (no billing while idle, perfect for our use case)
     - "failed" — return non-zero so the train cycle log surfaces it
3. Skips cleanly with exit 0 when HF_ENDPOINT_NAME is empty so the
   training cycle works for users who haven't paid for an Endpoint.

Env vars:
  HF_TOKEN              required when HF_ENDPOINT_NAME is set
  HF_REPO_ID            defaults to cswan801/BlackSwan-v5
  HF_ENDPOINT_NAMESPACE defaults to the user behind HF_TOKEN
  HF_ENDPOINT_NAME      e.g. "blackswan-v5"; empty / unset = no-op
  HF_ENDPOINT_POLL_S    poll budget in seconds (default 180)
"""

import os
import sys
import time

from huggingface_hub import HfApi


DEFAULT_REPO_ID = "cswan801/BlackSwan-v5"


def resolve_namespace(api: HfApi, token: str) -> str | None:
    try:
        data = api.whoami(token=token)
    except Exception:
        return None
    return data.get("name") if isinstance(data, dict) else None


def endpoint_state(endpoint) -> str:
    raw = getattr(endpoint, "raw", {}) or {}
    return (
        getattr(endpoint, "status", None)
        or (raw.get("status") or {}).get("state")
        or "<unknown>"
    )


def endpoint_revision(endpoint) -> str:
    raw = getattr(endpoint, "raw", {}) or {}
    model = raw.get("model") or {}
    return model.get("revision") or model.get("sha") or ""


def main() -> int:
    name = (os.environ.get("HF_ENDPOINT_NAME") or "").strip()
    if not name:
        # No endpoint configured — nothing to do. Cycle continues.
        print("[hf-endpoint] HF_ENDPOINT_NAME not set; skipping.")
        return 0

    token = (os.environ.get("HF_TOKEN") or "").strip()
    if not token:
        print("[hf-endpoint] ERROR: HF_TOKEN is required when HF_ENDPOINT_NAME is set.")
        return 1

    api = HfApi(token=token)
    repo_id = (os.environ.get("HF_REPO_ID") or DEFAULT_REPO_ID).strip()
    try:
        latest_sha = api.model_info(repo_id=repo_id, token=token).sha
    except Exception as exc:
        print(f"[hf-endpoint] ERROR: couldn't resolve latest model sha for {repo_id}: {exc}")
        return 1
    if not latest_sha:
        print(f"[hf-endpoint] ERROR: {repo_id} did not return a commit sha.")
        return 1

    namespace = (os.environ.get("HF_ENDPOINT_NAMESPACE") or "").strip()
    if not namespace:
        namespace = resolve_namespace(api, token) or ""
    if not namespace:
        print("[hf-endpoint] ERROR: couldn't resolve HF namespace from token. Set HF_ENDPOINT_NAMESPACE explicitly.")
        return 1

    print(f"[hf-endpoint] Updating {namespace}/{name} to {repo_id}@{latest_sha[:12]}...")
    try:
        endpoint = api.update_inference_endpoint(
            name=name,
            namespace=namespace,
            revision=latest_sha,
            token=token,
        )
    except Exception as exc:
        print(f"[hf-endpoint] endpoint update failed: {exc}")
        return 1
    state = endpoint_state(endpoint)
    rev = endpoint_revision(endpoint)
    print(f"[hf-endpoint] queued update (state now: {state}, revision: {rev or '<pending>'})")

    # Poll. We tolerate scaledToZero as a terminal state — the new
    # revision will load on the next inference request, no GPU billing
    # in the interim.
    poll_budget = int(os.environ.get("HF_ENDPOINT_POLL_S") or "180")
    started = time.time()
    last_state = state
    while time.time() - started < poll_budget:
        try:
            endpoint = api.get_inference_endpoint(name=name, namespace=namespace, token=token)
        except Exception as exc:
            print(f"[hf-endpoint] status fetch failed: {exc}")
            time.sleep(5)
            continue
        state = endpoint_state(endpoint)
        rev = endpoint_revision(endpoint)
        if state != last_state:
            print(f"[hf-endpoint] state: {state}")
            last_state = state
        if state in ("running", "scaledToZero") and (not rev or rev == latest_sha):
            print(f"[hf-endpoint] OK — endpoint is {state} on revision {latest_sha[:12]}.")
            return 0
        if state in ("failed", "paused"):
            raw = getattr(endpoint, "raw", {}) or {}
            msg = (raw.get("status") or {}).get("message", "")
            print(f"[hf-endpoint] terminal state {state}: {msg}")
            return 1
        time.sleep(5)

    print(f"[hf-endpoint] timed out after {poll_budget}s; last state: {last_state}.")
    print("[hf-endpoint] The update is still queued — check ui.endpoints.huggingface.co.")
    return 0  # don't fail the whole cycle on a slow rollout


if __name__ == "__main__":
    sys.exit(main())
