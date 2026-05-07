#!/usr/bin/env python3
"""
update_hf_endpoint.py — Tell a Hugging Face Inference Endpoint to pull
the latest revision of its source model repo.

Called after `fuse_and_upload_v5.py` pushes fresh weights to
`cswan801/BlackSwan-v5`. Without this, the running endpoint keeps
serving whatever commit it was deployed with — so the team would
chat with stale weights even though HF has the new ones.

Behaviour:
1. POST /v2/endpoint/<namespace>/<name>/update with the HF token →
   HF queues a rebuild from the latest commit on the source repo.
2. Poll GET /v2/endpoint/<namespace>/<name> for up to ~3 min, looking
   for the state to settle into one of:
     - "running" — endpoint is up serving the new revision
     - "scaledToZero" — endpoint accepted the update; will apply on
        next wake (no billing while idle, perfect for our use case)
     - "failed" — return non-zero so the train cycle log surfaces it
3. Skips cleanly with exit 0 when HF_ENDPOINT_NAME is empty so the
   training cycle works for users who haven't paid for an Endpoint.

Env vars:
  HF_TOKEN              required when HF_ENDPOINT_NAME is set
  HF_ENDPOINT_NAMESPACE defaults to the user behind HF_TOKEN
  HF_ENDPOINT_NAME      e.g. "blackswan-v5"; empty / unset = no-op
  HF_ENDPOINT_POLL_S    poll budget in seconds (default 180)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error


ENDPOINTS_API = "https://api.endpoints.huggingface.cloud/v2/endpoint"
WHOAMI = "https://huggingface.co/api/whoami-v2"


def http(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict | None]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
        except Exception:
            err_body = {"error": e.reason}
        return e.code, err_body


def resolve_namespace(token: str) -> str | None:
    code, data = http("GET", WHOAMI, token)
    if code != 200 or not isinstance(data, dict):
        return None
    return data.get("name")


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

    namespace = (os.environ.get("HF_ENDPOINT_NAMESPACE") or "").strip()
    if not namespace:
        namespace = resolve_namespace(token) or ""
    if not namespace:
        print("[hf-endpoint] ERROR: couldn't resolve HF namespace from token. Set HF_ENDPOINT_NAMESPACE explicitly.")
        return 1

    base = f"{ENDPOINTS_API}/{namespace}/{name}"
    print(f"[hf-endpoint] Updating {namespace}/{name}…")

    code, body = http("POST", f"{base}/update", token, body={})
    if code not in (200, 202):
        print(f"[hf-endpoint] update API returned {code}: {body}")
        return 1
    state = ((body or {}).get("status") or {}).get("state", "<unknown>")
    print(f"[hf-endpoint] queued update (state now: {state})")

    # Poll. We tolerate scaledToZero as a terminal state — the new
    # revision will load on the next inference request, no GPU billing
    # in the interim.
    poll_budget = int(os.environ.get("HF_ENDPOINT_POLL_S") or "180")
    started = time.time()
    last_state = state
    while time.time() - started < poll_budget:
        code, body = http("GET", base, token)
        if code != 200 or not isinstance(body, dict):
            print(f"[hf-endpoint] status fetch returned {code}: {body}")
            time.sleep(5)
            continue
        state = (body.get("status") or {}).get("state", "<unknown>")
        if state != last_state:
            print(f"[hf-endpoint] state: {state}")
            last_state = state
        if state in ("running", "scaledToZero"):
            print(f"[hf-endpoint] OK — endpoint is {state} on the new revision.")
            return 0
        if state in ("failed", "paused"):
            msg = (body.get("status") or {}).get("message", "")
            print(f"[hf-endpoint] terminal state {state}: {msg}")
            return 1
        time.sleep(5)

    print(f"[hf-endpoint] timed out after {poll_budget}s; last state: {last_state}.")
    print("[hf-endpoint] The update is still queued — check ui.endpoints.huggingface.co.")
    return 0  # don't fail the whole cycle on a slow rollout


if __name__ == "__main__":
    sys.exit(main())
