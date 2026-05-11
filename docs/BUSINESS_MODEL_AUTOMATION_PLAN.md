# Business-Specific Model Automation Plan

## Goal

Let a business connect its own model endpoint, choose where that model is trusted to operate, and route chat prompts into browser or desktop task execution without exposing secrets or letting a model mutate external systems without policy.

## Architecture

1. Bring-your-own business model
   - Store the API key in `user_api_keys` under `openai_compatible`.
   - Store the endpoint URL in the existing encrypted-key RPC `endpoint` field.
   - Route through `llm-proxy` using the OpenAI Chat Completions shape.
   - Use `provider/model` picker IDs such as `openai_compatible/company-agent`.

2. Business model profile
   - Store circle-level profiles in `circles.settings.businessModelProfiles`.
   - Each profile declares allowed surfaces: `chat`, `browser`, `desktop`, `files`, `apps`, `mcp`, `automation`, `code`.
   - Profiles include governance: approval requirements, credential policy, side-effect policy, allowed origins, and allowed apps.

3. Task routing
   - `computerTaskPlanner` classifies the user task.
   - `businessModelProfiles.planBusinessModelForComputerTask()` picks the best connected profile for that task surface.
   - `computerTaskDispatch` injects the business model routing block into the agent prompt.
   - Chat uses the profile model when the user is in `auto` model mode, otherwise the user’s explicit model selection wins.

4. Execution boundary
   - The business model can plan/reason.
   - Browser and desktop actions execute through approved tools: local browser bridge, Browserbase/Stagehand, desktop bridge, MCP tools, or OpenSwan tools.
   - Credentials are never pasted into chat or model context. They must flow through vault/browser-profile tooling with grants.

## Implementation Status

- `openai_compatible` provider added to app model catalog, marketplace, model picker registry, routing priority, SwanBot routing, and `llm-proxy`.
- Circle integration constraint migration added for `openai_compatible`.
- `businessModelProfiles.ts` added for profile persistence, selection, and prompt formatting.
- Computer task dispatch now includes the business model policy block.
- Chat computer tasks in `auto` mode prefer a matched business model profile when one is configured and connected.

## Next Build Targets

- Add an Office dashboard editor for business model profiles.
- Add evals per profile: browser planning, desktop planning, credential discipline, and structured output.
- Add provider adapters for non-OpenAI-compatible enterprise routes: Azure OpenAI deployment URLs, Bedrock Converse, and Vertex AI.
- Add audit log rows whenever a business model profile is selected for browser or desktop work.
