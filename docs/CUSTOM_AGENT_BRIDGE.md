# Custom Agent Bridge

The Circle Office can connect to more than the built-in bridges.

If you are running an agent on a Raspberry Pi, VPS, laptop, or another machine, the minimum supported bridge contract is:

## Minimum contract

- `GET /health`
  - returns `200`
  - returns JSON like:

```json
{ "ok": true, "status": "live" }
```

That is enough for the Office to:

- verify the bridge is reachable
- save the connection
- publish the agent into the Circle Office
- show that agent as connected/present

## Rich contract

If your bridge also supports the OpenSwan tool RPC surface, the Office can do more:

- session counts
- richer polling
- command/status workflows
- deeper runtime visibility

Current rich RPC entrypoint:

- `POST /tools/invoke`

with bearer auth and OpenSwan-compatible tool names such as:

- `sessions_list`
- `session_status`

## Remote agents

For agents not running on the same machine as the browser:

- expose the bridge on a reachable URL
- or tunnel it with Cloudflare / ngrok / similar
- then use that public URL in the Office setup wizard
- for the bundled Claude/Codex/Cursor/Gemini bridges, also restart the server
  with `UC_BRIDGE_ALLOWED_HOSTS=<exact tunnel host[:port]>` and
  `UC_BRIDGE_ALLOWED_ORIGINS=<exact browser origin>`; a public URL alone is not
  authorization

## Notes

- `localhost` only works when the app is running on the same machine as the bridge.
- Hosted web needs a public bridge URL for remote agents.
- Custom bridges do not need to pretend to be OpenSwan unless they want rich Office features.
