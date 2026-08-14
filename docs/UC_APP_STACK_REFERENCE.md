# The Underground Circle - App Stack Reference

> Current app map for agents before writing code.
> Last reviewed: 2026-08-14

`AGENTS.md` and `docs/AGENTS_ROADMAP.md` own agent workflow and runtime
ownership. This file maps the app.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| AI/runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| Provider routing | `llm-proxy`, `swanbot-ai`, provider marketplace, BYOK keys |
| Local services | app 8081, OpenSwan proxy 18790, Claude bridge 7778 |

## Do-Not-Break Patterns

1. `src/lib/animationPatch.ts` must be the first import in `App.tsx`.
2. Use the frontend Supabase singleton in `src/lib/supabase.ts`.
3. Prefer `src/lib/authSession.ts` helpers for auth reads. Direct Supabase auth
   calls must be caught. `App.tsx` is the sole auth-event/session owner;
   descendants consume `AuthSessionProvider`, and the Supabase browser client
   must keep its default cross-tab Web Lock for refresh-token rotation.
4. Do not put secret values into prompts, persisted chat messages, logs, or
   activity entries.
5. React Native Web pointer behavior is uneven; use DOM listeners when local
   patterns already do.
6. Before adding a new helper path, check the roadmap owner and the worktree
   checklist in `src/lib/agentDevelopmentStandards.ts`.
7. `officeFloorLayout.ts` owns the 16px Office grid and 900×970 floor bounds;
   placement and room-kit callers pass those constants into pure helpers.
8. Netlify JavaScript must use `max-age=0, must-revalidate`. Expo/Metro entry
   chunk names are not a sufficient immutable-module-graph guarantee; a stale
   entry path table can load incompatible lazy chunks after a deployment.

## Security Baseline (2026-08-06)

The dated security evidence ledger is
[`SECURITY_REVIEW_2026-08-06.md`](./SECURITY_REVIEW_2026-08-06.md). Preserve its
three-way distinction between live production proof, source/build proof, and
flows that were not exercised.

Current live backend baseline after remediation:

- the 101-function public-schema `SECURITY DEFINER` catalog has zero
  `PUBLIC`/anonymous execute grants, full service-role access, and exactly 52
  audited authenticated signatures with no extras;
- collaboration/circle reads are RLS-scoped, public discovery/join uses safe
  projections, 13 views are security invokers, and the exposed credential key
  plus one legacy circle credential were rotated without printing values;
- reviewed privileged Edge actions reject unauthenticated requests; OAuth and
  webhook routes that bypass gateway JWT verification enforce their own user,
  single-use state, or signature boundary;
- hosted Auth uses the production site URL, explicit redirect allowlist,
  HIBP, lowercase/uppercase/digit passwords of at least eight characters, and
  recent reauthentication for password updates.

Do not overstate this baseline. Email auto-confirm is still enabled, custom
SMTP and CAPTCHA are absent, task-image objects remain publicly readable by
URL, safe claimant-bound Office invocation is not installed, and bridge pairing
is not yet device-bound. The migration ledger is drifted, so apply only one
reviewed idempotent migration at a time rather than using a broad database push.
At the review cutoff, login/OAuth/logout and strict-header frontend changes were
source/build evidence pending a production frontend deployment and live flow
verification.

## Main Surfaces

| Surface | Role |
|---|---|
| Chat | Agent conversation, model picker, automation routing, computer tasks, artifacts, thread persistence |
| Office | Live agent dashboard, local bridge visibility, activity feed, controls, approvals, and a truthful customizable addon floor |
| Feed | Goals, plans, missions, tasks, proof of work, team operating loop |
| Rooms | Project rooms, file surfaces, room chat, services, playground, task execution |
| Marketplace | Provider keys, integrations, model catalog, browser/computer providers |
| Computer Use | Browserbase sessions, local bridge tools, guarded desktop/browser actions |

A bare circle entry defaults to Office. Explicit tab routes and validated
cross-surface focus requests continue to override the default.

## Core Runtime Files

| Concern | File(s) |
|---|---|
| Office exact runtime authority and account-switch lifecycle | `src/lib/officeDashboardPersistence.ts`, `src/lib/connectionManager.ts`, `src/lib/computerTaskState.ts`, `src/lib/agentPlanPersistence.ts`, `src/lib/computerUseHistory.ts`, `src/lib/llmProviders.ts`, `src/lib/workspaceAdaptation.ts`, `src/lib/oauthConnect.ts`, `src/lib/idleBehaviors.ts`, `src/lib/officeTerminal.ts`, `src/lib/agentInvocation.ts`, `src/lib/circleOffice.ts`, `src/services/customThemes.ts`, `src/services/sharedMemory.ts`, `src/services/hitlService.ts`, `src/services/runApprovalsService.ts`, `src/components/OfficeTerminal.tsx`, `src/components/ComputerUseHistoryPanel.tsx`, `src/components/HitlApprovalBanner.tsx`, `src/components/RunApprovalBanner.tsx`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/ProfileTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/CustomizePanel.tsx`, `scripts/{computer-task-private-authority,office-customize-private-authority,workspace-adaptation-exact-authority,oauth-disconnect-authority-lifecycle,office-terminal-mutation-authority,office-invocation-exact-authority,idle-behavior-scheduler-lifecycle,circle-office-exact-auth-scope,office-dashboard-persistence-authority}-smoketest.ts` |
| Chat plan approval capability identity | `src/lib/chatPlanApprovalAuthorityCore.ts`, `src/lib/runChatAutomationPlan.ts`, `src/lib/openswanToolApprovals.ts`, `scripts/chat-plan-tool-manifest-smoketest.ts`, `scripts/openswan-runtime-approval-smoketest.ts` |
| Dependency compatibility and Expo image build boundary | `package.json`, `package-lock.json`, `scripts/dependency-override-compat-smoketest.mjs`, `scripts/expo-image-asset-guard.mjs`, `scripts/expo-image-asset-guard-smoketest.mjs`, `scripts/security-release-check.mjs` |
| Agent standards and worktree quality | `src/lib/agentDevelopmentStandards.ts`, `src/lib/openswanWorktreeConfig.ts`, `scripts/openswan-lane-report.ts`, `.github/workflows/openswan-release.yml`, `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md`, `docs/SWANBOT_OPENSWAN_AGENT_LANES_2026-06-29.md` |
| Chat classification and terminal transport | `src/lib/chatAutomationPlanner.ts`, `src/lib/chatTerminalTransportPolicy.ts` |
| Chat computer request route | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer requested-action accounting | `src/lib/chatMultiIntentCore.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/computerFileAdapter.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js`, `src/lib/chatAgentContextPack.ts`, `src/lib/chatComputerHandoffContext.ts`, `src/lib/persistedChatMetadata.ts` |
| Chat computer request UX | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Universal Computer Task Kernel plan | `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md` |
| Chat plan execution | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| Chat transcript and thread lifecycle | `src/screens/circles/tabs/ChatTab.tsx`, `src/screens/circles/tabs/chat/ChatThreadSidebar.tsx`, `src/screens/circles/tabs/chat/ChatThreadHeader.tsx`, `src/lib/chatService.ts`, `src/lib/chatMessageShape.ts`, `src/lib/circleChatThreads.ts`, `src/lib/chatComposerDraftCore.ts`, `src/lib/subscribeWithReconnect.ts` |
| Attachment and Chat-approval authority deployment, recovery, and idle-safe bridge refresh | `scripts/attachment-authority-deployment-preflight.ts`, `scripts/attachment-authority-deployment-preflight-smoketest.ts`, `scripts/chat-desktop-attachment-recovery-durability-smoketest.ts`, `scripts/desktop-bridge-safe-refresh-smoketest.ts`, `scripts/desktop-bridge-immutable-snapshot.js`, `scripts/{claude-bridge,browser-bridge,dev-stack-keepalive}.js`, `start-dev.js`, `supabase/migrations/{20260726_database_authority_guards,20260812_agent_run_artifact_integrity,20260813160000_message_attachment_link_integrity,20260813170000_message_attachment_visibility_integrity,20260813180000_device_private_run_approval_authority,20260813210000_openswan_chat_approval_resume_authority}.sql`, `docs/RUN_THIS_SQL.sql` §§28/38-41/44 |
| Chat attachment identity and visual-brief boundary | `src/lib/chatMedia.ts`, `src/lib/chatAttachments.ts`, `src/lib/attachmentPreflightCore.ts`, `src/lib/attachmentRoutingCore.ts`, `src/lib/openSwanAttachmentSourceCore.ts`, `src/lib/openSwanAttachmentTurnSources.ts`, `src/lib/openSwanDesktopAttachmentAuthority.ts`, `src/lib/chatAutomationPlanner.ts`, `src/lib/chatDesktopAttachmentRouting.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js`, `src/lib/chatVisualBriefCore.ts`, `src/lib/chatVisualBrief.ts`, `src/lib/swanbotStream.ts`, `src/lib/{openswanSessionRuntime,openswanSessionRuntimeAdapters,openswanTaskPlanner,openswanToolRuntime,swanbot}.ts`, `src/lib/openswanTools/index.ts`, `supabase/functions/chat-stream/index.ts`, `supabase/migrations/{20260813160000_message_attachment_link_integrity,20260813170000_message_attachment_visibility_integrity,20260813180000_device_private_run_approval_authority}.sql`, `docs/RUN_THIS_SQL.sql` §§39-41, `scripts/{chat-single-attachment-authority,chat-single-attachment-routing-safety,chat-desktop-attachment-open-wiring,openswan-desktop-attachment-authority,openswan-desktop-attachment-runtime,desktop-attachment-open-capability,desktop-bridge-safe-refresh,desktop-attachment-app-identity,openswan-original-user-task-egress-wiring,openswan-attachment-egress-guard,device-private-run-approval-authority}-smoketest.ts` |
| Chat connected coding-agent handoff | `src/lib/chatAgentTargets.ts`, `src/lib/customAgentBridgeDispatcher.ts`, `src/lib/bridgeTaskDispatcher.ts`, `src/lib/connectedAgentDispatch.ts`, `src/lib/terminalAgentControl.ts`, `src/lib/terminalAgentSessionLauncher.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Chat thread/message database authority | `supabase/migrations/20260805_messages_thread_rls_and_reactions.sql`, `docs/RUN_THIS_SQL.sql` §31, `scripts/messages-thread-rls-smoketest.ts` |
| SwanBot client path | `src/lib/swanbot.ts`, `src/lib/swanbotClientToolDispatcher.ts` |
| SwanBot edge path | `supabase/functions/swanbot-ai/index.ts` |
| SwanBot v2 typed loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts`, `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/swanbotV2BatchPolicy.ts`, `src/lib/swanbotV2ClientLoopFlag.ts` |
| SwanBot continuation checkpoint privacy | `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/migrations/20260726_swanbot_continuation_privacy.sql`, `docs/RUN_THIS_SQL.sql` §29 |
| SwanBot/OpenSwan default readiness | `src/lib/swanbotOpenSwanReadiness.ts`, `scripts/swanbot-openswan-readiness-report.ts`, `supabase/migrations/20260805_openswan_production_readiness_contract.sql`, `docs/RUN_THIS_SQL.sql` §32 |
| Typed agent loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan session runtime, exact resume, multi-action completion, and terminal truth | `src/lib/openswanSessionRuntime.ts`, `src/lib/openswanSessionRuntimeAdapters.ts`, `src/lib/openSwanMultiActionCompletionCore.ts`, `src/lib/toolLoopResume.ts`, `src/lib/openswanTaskPlanner.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/agentRunSystem.ts`, `src/lib/chatLaneOutcome.ts`, `src/lib/chatOutcomeSignals.ts`, `src/lib/persistedChatMetadata.ts`, `src/lib/roomMessageMetadata.ts`, `src/lib/roomChatService.ts`, `src/screens/circles/tabs/ChatTab.tsx`, `scripts/openswan-{terminal-outcome-contract,multi-action-completion-core,multi-action-report-tool,multi-action-artifact-evidence,multi-action-provider-causality,multi-action-read-evidence,multi-action-terminal-wiring,multi-action-semantic-evidence,resume-locator}-smoketest.ts`, `scripts/{agent-run-metadata-merge-cas,chat-multi-action-routing-invariants,room-chat-multi-action-persistence,room-message-reload-pagination}-smoketest.ts` |
| Room document context, reviewed edits, and GitHub submission | `src/screens/circles/tabs/RoomsTab.tsx`, `src/lib/roomChatFileContext.ts`, `src/lib/roomChatService.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/builderGithubSave.ts`, `src/lib/github.ts`, `src/lib/githubChatCommands.ts`, `src/screens/circles/tabs/chat/BuilderGithubSaveModal.tsx`, `scripts/{room-chat-file-context,room-chat-minimal-ui,room-github-submit}-smoketest.ts` |
| Owner-private Office agent → OpenSwan session binding | `src/lib/officeAgentSessionBindingCore.ts`, `src/lib/officeAgentSessionBinding.ts`, `src/lib/agentAutoConnect.ts`, `src/lib/agentAutoConnectState.ts`, `src/lib/agentInvocation.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/AgentGatewayPanels.tsx`, `supabase/migrations/20260807170000_office_agent_session_bindings.sql`, `docs/RUN_THIS_SQL.sql` §36 |
| Office dashboard truth, stable cost semantics, exact private-state lifecycle, per-circle layout, and complete floor presets | `src/lib/officeDashboardPersistence.ts`, `src/lib/officeLayoutLocalCache.ts`, `src/lib/officeLayoutSaveReceiptCore.ts`, `src/lib/officePreferenceWriteQueueCore.ts`, `src/lib/officeFloorPresetCore.ts`, `src/lib/chatAttentionQueue.ts`, `src/lib/runHistoryFilterCore.ts`, `src/lib/officeAgents.ts`, `src/lib/agentIdentity.ts`, `src/lib/agentPresence.ts`, `src/lib/agentHeartbeat.ts`, `src/lib/sessionCache.ts`, `src/lib/sessionTags.ts`, `src/lib/claudeUsage.ts`, `src/components/chat/RunHistoryDrawer.tsx`, `src/components/office/OfficeOpsBoardCards.tsx`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/AgentRunsPanel.tsx`, `src/screens/circles/tabs/office/AgentActivityPanel.tsx`, `src/screens/circles/tabs/office/Whiteboard.tsx`, `supabase/migrations/20260811120000_office_dashboard_state_and_floor_presets.sql`, `supabase/migrations/20260813140000_office_layout_exact_save_receipt.sql`, `supabase/migrations/20260813220000_office_user_preferences.sql`, `docs/RUN_THIS_SQL.sql` §§37/45, `scripts/office-layout-local-cache-smoketest.ts`, `scripts/office-layout-save-receipt-core-smoketest.ts`, `scripts/office-user-preferences-sql-parity-smoketest.ts`, `scripts/office-private-runtime-wiring-smoketest.ts`, `scripts/agent-identity-exact-authority-smoketest.ts` |
| Office addon catalog, data truth, reversible floor editor, and OAuth credential control | `src/lib/officeConfig.ts`, `src/lib/officeAddonExperienceCore.ts`, `src/lib/officeValidation.ts`, `src/lib/animationHelpers.ts`, `src/lib/oauthConnect.ts`, `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/OfficeFloor.tsx`, `src/screens/circles/tabs/office/InteractiveFurniture.tsx`, `src/screens/circles/tabs/office/AgentPanelShell.tsx`, `src/screens/circles/tabs/office/officeFloorLayout.ts`, `src/components/OfficeTerminal.tsx`, `src/components/PhoneMessenger.tsx`, `src/components/office/ConnectAllBridgesPanel.tsx`, `src/components/office/OfficeBridgeDiagPanel.tsx`, `src/components/office/OfficeBridgeReadinessStrip.tsx`, `src/components/office/StatusPicker.tsx`, `src/components/office/WorldClockBar.tsx`, `supabase/functions/email-calendar-oauth/index.ts`, `supabase/migrations/20260813190000_atomic_oauth_credential_store.sql`, `docs/RUN_THIS_SQL.sql` §42, `scripts/office-addon-registry-smoketest.ts`, `scripts/office-addon-experience-core-smoketest.ts`, `scripts/office-addon-ui-wiring-smoketest.ts`, `scripts/office-validation-smoketest.ts`, `scripts/oauth-popup-boundary-smoketest.ts`, `scripts/oauth-credential-control-sql-smoketest.ts`, `scripts/oauth-credential-control-sql-behavior-smoketest.sh`, `scripts/office-terminal-broadcast-authority-smoketest.ts`, `scripts/office-authenticated-local-e2e.mjs` |
| Personal Figma OAuth and server-only file projection | `src/lib/oauthConnect.ts`, `src/lib/oauthCallbackRelay.ts`, `src/lib/figmaBuilder.ts`, `src/screens/circles/tabs/office/CustomizePanel.tsx`, `supabase/functions/figma-oauth/index.ts`, `supabase/migrations/20260813200000_figma_oauth_credential_control.sql`, `docs/RUN_THIS_SQL.sql` §43, `scripts/figma-oauth-boundary-smoketest.ts`, `scripts/figma-oauth-credential-control-sql-smoketest.ts`, `scripts/figma-oauth-credential-control-sql-behavior-smoketest.sh` |
| Agent runtime subject identity | `src/lib/agentRuntimeSubject.ts`, `src/lib/agentIdentityKey.ts`, `src/lib/agentIdentity.ts`, `src/lib/agentInvocation.ts`, `src/lib/agentRuntime.ts`, `src/lib/swanbotV2BatchRuntimeCore.ts` |
| Agent subject display surfaces | `src/components/AutomationsPanel.tsx`, `src/components/OfficeTerminal.tsx`, `src/screens/circles/tabs/office/AgentMemoryPanel.tsx`, `src/screens/circles/tabs/office/AgentRunsPanel.tsx` |
| Tool catalog, bounded action reporter, and derived-artifact publisher | `src/lib/openswanToolRuntime.ts`, `src/lib/openswanTaskPlanner.ts`, `src/lib/openswanTools/index.ts` |
| Feed active-run truth | `src/lib/agentRunSystem.ts`, `src/lib/runHistoryFilterCore.ts`, `src/lib/officeOpsBoard.ts`, `src/screens/circles/tabs/FeedTab.tsx`, `scripts/feed-active-runs-truth-smoketest.ts` |
| Provider model resolution | `src/lib/serviceProfileSouls.ts` |
| Cross-provider routing | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime, exact programs, foreground ownership, and truthful Chat lane outcomes | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/computerForegroundOwnership.ts`, `src/lib/chatLaneOutcome.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Structured typed-loop action evidence and outer acceptance core | `src/lib/computerTaskOutcome.ts`, `src/lib/swanbot.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/agentRuntime.ts`, `src/lib/agentRunPersistence.ts` |
| Browser computer use and typed mutation handoffs | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `src/lib/useComputerUseQueue.ts`, `supabase/functions/computer-use-agent/index.ts`, `src/lib/computerUse.ts`; cloud starts require a bounded v1 policy, while legacy recorder mutations remain value-stripped typed OpenSwan handoffs |
| Agent Monitor | `src/lib/agentMonitorState.ts`, `src/components/agent-monitor/AgentMonitorHost.tsx`, `src/components/ComputerUseLiveCard.tsx` |
| Computer capability expansion | `src/lib/computerCapabilityRegistry.ts`, `src/lib/computerCapabilityExpansion.ts` |
| Local desktop awareness | `src/lib/localComputerAwarenessIntent.ts` |
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Office bridge readiness | `src/lib/bridgeHealthDiag.ts`, `src/lib/officeBridgeReadiness.ts`, `src/screens/circles/tabs/office/Whiteboard.tsx` |
| Desktop bridge authentication boundary | `scripts/desktop-bridge-security.js`, `scripts/claude-bridge.js`, `scripts/codex-bridge.js`, `scripts/cursor-bridge.js`, `scripts/gemini-bridge.js`, `src/lib/bridgeAuth.ts`, `src/lib/desktopBridge.ts` |
| App automation control surfaces | `src/lib/appAutomationControlSurfaces.ts` |
| App observation epochs and mutation receipts | `src/lib/computerAppGrounding.ts` |
| Unfamiliar-app semantic workflow | `src/lib/genericAppNavigator.ts` (`buildGenericAppSemanticWorkflow`) |
| Request-bound named-app lifecycle | `src/lib/genericAppNavigator.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/computerTaskRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/agentActionCalls.ts` |
| Exact browser semantic wait/scroll identity | `src/lib/browserPrimitives.ts`, `src/lib/browserBridge.ts`, `scripts/browser-bridge.js`, `src/lib/openswanToolRuntime.ts`, `supabase/functions/swanbot-v2-ai/index.ts` |
| Guarded browser mutation canaries | typed `browser.fill_field`, `browser.set_toggle`, and `browser.select_option` in `src/lib/openswanToolRuntime.ts`, `src/lib/browserBridge.ts`, `scripts/browser-bridge.js` |
| Narrow native semantic-press canary | typed `desktop.click_element` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts` |
| Sealed native semantic-value lane | typed `desktop.set_element_value` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js` |
| Durable exact action-call ledger | `src/lib/agentActionCalls.ts`, `supabase/migrations/20260726_agent_action_calls.sql`, `docs/RUN_THIS_SQL.sql` §26 |
| Universal computer-task root and atomic root/action gateway | `src/lib/computerTaskRoot.ts`, `src/lib/computerTaskRootStore.ts`, `supabase/migrations/20260806_universal_computer_task_roots.sql`, `docs/RUN_THIS_SQL.sql` §34, `scripts/computer-task-root-action-gateway-smoketest.ts` |
| Feature-off frontmost Photoshop root/action canary | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js`, `scripts/photoshop-root-action-canary-smoketest.ts` |
| Exact single-use approval authority, encrypted exact-call Chat continuation, and inert plan manifest | `src/lib/chatApprovalGate.ts`, `src/lib/{openswanToolApprovals,openSwanApprovalResumeAuthority,openSwanApprovalResumeOutbox,openswanToolRuntime,openswanSessionRuntime,swanbot,swanbotV2BatchRuntime,chatAutomationPlanner,approvalCardModelCore}.ts`, `src/services/runApprovalsService.ts`, `src/components/RunApprovalBanner.tsx`, `src/screens/circles/tabs/ChatTab.tsx`, `scripts/{openswan-approval-resume-binding,openswan-approval-resume-exact-authority,openswan-approval-resume-stop-race,openswan-approval-resume-encrypted-outbox,openswan-approved-unconsumed-selector,openswan-chat-approval-resume-sql-authority,chat-openswan-approval-resume,openswan-ordinary-tool-terminal-truth,approval-card-model-core}-smoketest.ts`, `scripts/chat-plan-tool-manifest-smoketest.ts`, `supabase/migrations/{20260726_database_authority_guards,20260813210000_openswan_chat_approval_resume_authority}.sql`, `docs/RUN_THIS_SQL.sql` §§28/44 |
| Scheduled external-action authority | `src/lib/scheduledActions.ts`, `supabase/functions/scheduled-action-runner/index.ts`, `supabase/migrations/20260726_scheduled_action_mutation_guard.sql` |
| Office durable command authority | `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| Engineering/CAD operation runbooks | `src/lib/engineeringCadOperationRunbooks.ts` |
| Adobe app profiles | `src/lib/adobeCreativeCloudApps.ts` |
| Design object manifest | `src/lib/designAppObjectManifest.ts` |
| Design manifest ledger | `src/lib/designAppManifestLedger.ts` |
| Design runtime manifest assembly | `src/lib/designAppRuntimeManifest.ts` |
| Design creative AI capabilities | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Design adapter gap contracts | `src/lib/designAppAdapterGaps.ts` |
| Design operation runbooks | `src/lib/designAppOperationRunbooks.ts` |
| Design proof review | `src/lib/designAppProofReview.ts` |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |

## Repo Layout

```text
src/
  screens/
    auth/
    circles/
      tabs/                 Chat, Rooms, Office, Feed, Marketplace, etc.
    profile/
    agents/
  components/
    chat/
    agent/
    computer-use/
    marketplace/
    openswan/
  lib/
    supabase.ts
    authSession.ts
    swanbot.ts
    agentExecutionCore.ts
    openswanSessionRuntime.ts
    openswanToolRuntime.ts
    chatAutomationPlanner.ts
    runChatAutomationPlan.ts
    serviceProfileSouls.ts
    crossProviderRouter.ts
    universalInvoke.ts
    computerUse.ts
    computerTaskRuntime.ts
    computerSequenceProgramCore.ts
supabase/
  functions/
    _shared/
      swanbot-continuation.ts
      swanbot-continuation-crypto.ts
    swanbot-ai/
    swanbot-v2-ai/
    llm-proxy/
    computer-use-agent/
    automation-executor/
    heartbeat-agent/
  migrations/
scripts/
  claude-bridge.js
  browser-bridge.js
  codex-bridge.js
  gemini-bridge.js
  mcp-agent-connect.js
docs/
```

## Office Addon And Editor Flow

1. `OFFICE_ADDON_TYPES` in `officeConfig.ts` is the single exhaustive list of
   all 81 placeable items. `FurnitureType` derives from it and every type maps
   to exactly one catalog entry with kind, provenance, default data state,
   primary action, interaction, configuration, readiness, motion, audio, tags,
   dimensions, category, and truthful copy.
2. Each placed item may carry `local`, `demo`, `setup`, `live`, `stale`, or
   `error` state plus a last-success timestamp. A saved link is local setup, a
   demo stays labelled demo, provider-backed data becomes live only after an
   actual successful read, and missing/aged live evidence becomes stale. A
   configuration save never fabricates playback, online members, viewers,
   participants, files, messages, or other provider state.
3. `officeAddonExperienceCore.ts` queries the canonical catalog rather than
   cloning it. Office exposes text search, category filters, and the
   Ready/Setup/Demo/Local state filters plus visible Favorites, Recent, and
   Needs Attention scopes. Favorites and the newest 20 recent types use one
   versioned, bounded, user-and-circle-scoped local preference record; malformed,
   unknown, oversized, and unsupported-version data fail closed. This is
   same-browser catalog personalization, not a second catalog or §37 server
   persistence path.
4. The same experience core owns five built-in templates: Agent Ops, Focus Lab,
   Launch Room, Review Room, and Social Lounge. `planOfficeRoomKit` builds a
   detached preview, tries the requested snapped origin, and then performs a
   deterministic bounded row-major scan. It checks canonical dimensions,
   rotation-aware collision rectangles, internal and existing-item overlap,
   bounds, capacity, and fresh ids, and distinguishes malformed, no-space, and
   scan-limit failures. `OfficeTab` supplies the canonical 16px grid and 900×970
   bounds from `officeFloorLayout.ts` before one successful plan enters history.
5. Durable layout persistence writes a verified user-and-circle local envelope
   first, then `officeLayoutSaveQueueCore.ts` serializes server work as one
   newest-snapshot drain. A flush arriving while another request is active
   latches a re-drain; active-version freshness rejects stale continuations; a
   rejected or older failed operation cannot overwrite or discard a newer
   pending snapshot; and a conflict preserves that snapshot while pausing for a
   fresh authoritative read. Local-cache operations and server reads/writes own
   deadlines, and SAVED requires the exact accepted receipt to remain both the
   newest local generation and unchanged mutation epoch. Retry refreshes the
   preserved item with the freshly checked same-user token. Optional profile
   enrichment settles independently from the authoritative layout read, and
   local bridge discovery never gates hydration. The editor is not actionable
   until both authentication and that exact scoped hydration exist; an
   unresolved null scope is never a hydrated scope.
6. Private Office preferences use user-and-circle local keys and
   `officePreferenceWriteQueueCore.ts`. The queue immutably captures bounded
   JSON plus exact user/token authority, serializes per user, rejects a retired
   account immediately before transport, and lets another account proceed when
   one user's write is stalled. Ownerless legacy Telegram, names, appearance,
   notes, budget, and idle keys are not imported. Automatic floor assignments
   retain live occupants across status-only display reorder, fill only genuine
   vacancies, and keep manual claims authoritative, preventing runtime activity
   from fabricating durable layout edits.
7. Floor editing has detached, local undo/redo history with 30 entries by
   default and a hard 60-entry bound. Placement, duplication, movement, atomic
   resize, 90-degree rotation, layer order, size reset, kits, and confirmed
   deletion enter one history seam; identical snapshots do not create history.
   Undo/redo restores layout fields without rolling current connected/game data
   backward for still-present items. A bounded per-floor item-state cache also
   preserves configuration when a newly added item is undone and later redone.
8. Mobile edit mode exposes the floor instead of replacing it with the mobile
   dashboard. On web, selected items support Enter/Space activation, one-grid
   arrow nudge, five-grid Shift+Arrow nudge, and Delete/Backspace removal.
   Accessibility actions and explicit controls provide alternatives to drag,
   resize, and destructive pointer gestures. Floor creation caps at 10 and
   opens the new floor in edit mode; floor chips expose selected state plus
   item/agent counts and support a sanitized inline rename. Delete and clear
   paths remain confirmed, save failure becomes a labelled retry action,
   operation status uses a polite live region, and nested widget controls leave
   pointer and accessibility traversal while the editor wrapper owns the item.
   Farm, Pet, and Whack-a-Mole keep their own controls without a nested outer
   button. Web move/resize captures and filters the initiating pointer; cancel,
   capture loss, window blur, and unmount restore the preview without committing
   and remove active listeners.
9. History is intentionally local and bounded. The resulting floor continues
   through the existing circle-scoped layout/cache and §37 monotonic persistence
   path; this feature creates neither a second save path nor a second catalog.
8. Edit mode hides the terminal presentation without unmounting its state or
   Realtime subscription. Read-only decorations stack behind agent sprites;
   actionable widgets and every edit-mode item remain above them. Button Panel
   and Launch Pad stage a review before any effect, use only canonical virtual
   BlackSwan or an exact enabled/connected owner UUID target, and additionally
   require a current private binding for OpenSwan. Picker and terminal keep one
   canonical selected-ID array; the persistence-boundary resolver atomically
   derives both compatible single- and multi-target columns. Stale or
   presentation-only targets fail before persistence instead of becoming
   `@all`, and no mounted dispatcher means no insert and an intact draft.
   Explicit Send awaits the durable message insert and runs launch or preset
   effects only after persistence. Realtime is an advisory wake-up: a failed
   broadcast returns the saved message receipt and is never replayed.
9. Calendar and Email async work is bound to an exact generation, circle,
   floor, item, service, and provider scope. Direct widget reads use a separate
   item/provider generation and recheck the current item and provider before
   patching; modal close, floor/circle change, provider switch, and newer reads
   invalidate stale callbacks. Provider mutations serialize; unavailable status
   is not treated as disconnected; switching provider clears the prior event or
   mail payload through the canonical widget reset; and provider-wide disconnect
   invalidates every loaded widget sharing that credential. In the Edge source,
   authorize accepts only `calendar` and `email`, unions requested access with
   stored same-provider scopes, persists that normalized union through refresh,
   and refreshes before status and provider reads. An expired or unrefreshable
   credential becomes `reconnectRequired` / client `reconnect_required`, never a
   row-exists `connected` claim; provider bodies and raw token failures remain
   server-side. This source contract is hardened, but Edge deployment and real-
   provider OAuth proof remain pending.
10. Personal Figma OAuth is separate from Calendar/Email and from the circle-
   wide Figma credential plus saved Board-link surfaces. `oauthConnect.ts` opens
   a web popup synchronously on the user gesture, then binds the exact app
   origin, popup window, provider, and per-attempt nonce through the shared
   callback relay. The Figma Edge uses PKCE S256, HTTP Basic client
   authentication for token exchange and refresh, encrypted service-only token
   storage, exact full-state and one-time callback binding, intent/revision and
   refresh-CAS fences, bounded refresh-contention recovery, stable-account
   checks, and a disconnect tombstone. A claimed callback retains its exact
   state row under a one-minute lease; the credential path self-heals only an
   exact missing or expired state, preserving active callback authority while
   recovering abandoned work. Client authorize, status, and disconnect
   operations have a 15-second total deadline. Same-generation status reads
   deduplicate, stale panel lifecycles cannot mutate current UI, and an unknown
   disconnect outcome never reports success. Transient provider failures remain
   retryable instead of fabricating a reauthorization requirement; client-
   configuration failures never erase a user's credential. A pending
   authorization suppresses background refresh rotation. Definitive
   file/refresh credential rejection invalidates only the exact rejected
   revision; newer credentials win, and an already-pending reconnect callback
   keeps its exact commit fence. Only
   `file_content:read` is accepted. `figmaBuilder.ts` sends a fresh Supabase JWT
   to the Edge and receives bounded file reference summaries with sequential
   multi-link resolution inside one five-second pre-send budget. Oversized root
   files request a specific frame/node link instead of futile retry. Every provider-derived or
   attachment-derived field is sanitized and placed inside the canonical
   readable untrusted-content fence before model use; fixed recovery guidance
   is generated separately from a trusted local enum. Figma Bearer tokens and
   raw provider bodies remain server-side. Source, Deno, 117-assertion focused
   boundary, 68-assertion SQL/parity, and disposable PostgreSQL behavior proof
   are current. Migrations `20260813190000` and `20260813200000` are not
   applied, the live `figma-oauth` endpoint currently returns 404, and Edge
   deployment/secrets plus real Figma connect, refresh, disconnect, and
   private-file reads remain pending.
11. Local and server snapshots cross one allowlisted layout sanitizer before
   render. Unknown addon types and malformed rows are dropped; dimensions,
   positions, IDs, and current-floor identity are normalized into safe bounds.
   Duplicate game/message widgets write only to the opened instance. Farm crops,
   timestamps, water, gold, harvests, upgrades, fertilizer uses, and crop history
   persist through allowlisted fields; failed OAuth revocation preserves the
   prior visible connection state and surfaces an error instead of claiming the
   provider was disconnected.
12. Focused source smokes and app typecheck are current through
   `npm run check:office-addons`. They do not prove native rendering,
   screen-reader traversal, provider or OAuth integration state, cross-device
   §37 persistence, or visible rendering
   of the dormant `StatusPicker` and `WorldClockBar` components.
13. `npm run e2e:office-authenticated-local` is a separate explicit opt-in
    canary. It preflights cleanup authority before creating a disposable signed-
    in user/circle and uses ephemeral headless system Chrome rather than the
    persistent browser bridge. Its successful 2026-08-13 receipt verified exact
    scoped-local and authenticated-server version-plus-payload convergence,
    trusted-mouse moved/resized/rotated/duplicated Desk geometry with exact
    snap and undo/redo, reload reconstruction, catalog
    personalization, edit history, floor add/rename/delete, the exact six-type
    Focus Lab placement, nested-focus isolation, compact semantic placed-item
    selection/nudge/resize, a 533px visible compact floor without horizontal
    overflow, reduced motion, zero page/server errors, and zero-record cleanup.
    It also verifies truthful setup validation, one currently connected exact
    Button Panel target, zero terminal-command writes before explicit Send, and
    an unsent terminal draft surviving an edit-mode hide/show round trip.
    This proves only that linked
    localhost path, not deployment, native UI, screen-reader traversal,
    providers/OAuth, negative RLS, or cross-device §37 behavior. In particular,
    it does not prove the current OAuth Edge source is deployed or that refresh,
    same-provider scope union, or `reconnect_required` works against a real
    Google, Microsoft, or Yahoo account.

## Chat Flow

1. User sends through `ChatTab`.
2. `chatAutomationPlanner` classifies the message and execution kind.
3. If the message asks to operate another app, browser, local file, CAD tool,
   Adobe design file, or unfamiliar desktop app, `chatComputerRequestRouter`
   builds one hidden best-path route with the selected pipeline, app strategy,
   surface order, approval reason, recommended tools, fallback pipelines, and
   completion proof before dispatch.
4. Stable plan kinds go through `runChatAutomationPlan`, which attaches both
   the user-facing Plan Card preview and one redacted, immutable
   `chatAgentContextPack`. The same pack is available to approval/transport
   handlers before execution. The real app/file/hybrid computer handler and
   both connected app-capability retry paths pass it through `AgentRunRequest`;
   `agentRuntime` injects the bounded `compactPrompt` into model context and
   saves a bounded projection in run metadata. Other non-computer
   connected-agent entrypoints are still being migrated.
   A browser-backed plan that has only produced an approval-ready Plan Card
   returns `deferred` and projects as waiting approval. Planning readiness is
   not the browser task's completion; the approval/runtime continuation remains
   the terminal owner.
   A compiler-owned exact computer program is a narrow branch inside this same
   dispatcher: its complete calls, arguments, and authorization mode are known
   before dispatch, then `computerTaskRuntime` executes the local program
   without an AI relay and accepts completion only from fresh app-native proof.
   One bounded new unsaved blank document uses the current direct request as
   authority; persistent/external work and oversized allocations stay gated.
   A separate router-owned strict named-app lifecycle branch also bypasses the
   relay. It binds the originating Chat request to an authenticated persisted
   root plus one §26 activation action, then routes one semantic `open_app` call
   into mutually exclusive conditional branches: launch/wait when initially
   stopped, or focus when already running in the background, never both. An
   explicit focus request never launches. A terminal duplicate after refresh
   cannot activate again. `ChatTab` passes the program and STOP signal through
   without converting it into a model request.
   For typed mutation-bearing computer runs, runtime-owned tool results now
   produce a bounded `ComputerTaskTurnEvidenceSummary` before SwanBot projects
   the turn to text. `getSwanBotTurnResult` carries that value-free action
   summary into `agentRuntime`; the ordinary `getSwanBotResponse` string API
   remains for compatibility. A clean terminal with successful tools and a
   correlated dispatch/verification receipt pair for every mutation is
   necessary action evidence, not whole-task acceptance. `computerTaskOutcome`
   now includes a pure runtime-owned V1 acceptance compiler/evaluator/issuer for
   exact Photoshop dimensions and named-app-frontmost predicates. It binds the
   root, exact ordered action set, an opaque WeakSet-branded next-action claim,
   fresh final evidence, and a single-use in-process receipt. Claim issuance and
   sealing reserve synchronously, so copied bindings, structural/JSON clones,
   cross-contract or out-of-order claims, reuse, and concurrent double sealing
   fail closed. No Chat/SwanBot/runtime/compiler/persistence path calls it yet.
   Generic tasks therefore remain inconclusive. Prose-only, mismatched,
   failed-final-read, capped, stopped, or outcome-unknown turns remain
   inconclusive too.
5. An image-bearing turn that needs visual understanding calls
   `chatVisualBrief.buildChatVisualBriefs` at most once. The authenticated
   `chat-stream` request uses Claude Sonnet multimodal input, and
   `chatVisualBriefCore` reduces the response to bounded basename-only,
   secret/path/URL-redacted text framed as untrusted visual data. The same
   description-only artifacts are reused for a selected connected agent,
   terminal send/launch, multi-agent dispatch, and ordinary model context.
   Raw image bytes are transient to the authenticated analyzer; bytes, object
   or signed URLs, storage keys, tenant identifiers, and local paths never
   cross the Claude Code/Codex/Cursor/Gemini bridge. Explicit selected-agent,
   named Claude Code/Codex, terminal, multi-agent, and coding/build intent owns
   the image before the broad desktop-attachment heuristic. A natural explicit
   target such as “ask Claude Code/Codex to …” reuses a manageable provider
   session or launches one managed provider session when that bridge is online;
   it does not fall back to OpenSwan or plain-model AI. Bridge-offline ends that
   requested lane with a truthful terminal error. If an image-
   dependent brief cannot be produced, connected-agent dispatch sends nothing
   and reports the bounded blocker instead of fabricating a description.
   Image-free turns do not create the analyzer request and preserve the
   original text prompt byte-for-byte. As of 2026-08-07, selected-agent,
   assigned-agent, multi-agent, and dedicated OpenSwan-session handoffs return
   one bounded receipt with status `accepted`, `drafted`, `failed`, or `unknown`. The
   receipt bounds actor, provider, session, and message fields, keeps
   `completionVerified: false`, and never derives a run id from a bridge or
   session acknowledgement. Direct terminal-session sends and managed task
   launches use this same receipt contract. Only `accepted` records a canonical
   `agent_runs` row: `surface = main_chat`, status `queued`, canonical agent
   subject metadata, and bounded external provider/session correlation. The row
   has no runtime-heartbeat opt-in because Chat does not own the provider's
   execution/finalization loop. `drafted`, `failed`, and `unknown` create no
   run. `unknown` preserves any exact external lineage when the provider cannot
   prove whether the single send/spawn began and explicitly blocks automatic
   fallback/replay. The active
   `circle_chat_threads.id` may be retained as bounded metadata only; it is not
   the unrelated legacy `chat_sessions` id expected by
   `agent_runs.chat_session_id`. The accepted receipt is rebuilt with the real
   run UUID and persists with the Chat message. Accepted/drafted/unknown transcript
   messages carry `delegatedTo` and force nonterminal `outcomeVerdict: unknown`;
   multi-agent summaries distinguish accepted work, synchronous drafts,
   uncertain dispatches, and failures instead of reporting dispatch as task
   completion.
6. Plain agent/model turns route through SwanBot/OpenSwan runtime paths. An
   OpenSwan session turn returns one authoritative prose-independent terminal
   receipt from `openswanSessionRuntimeAdapters.ts`: `succeeded`, `partial`,
   `failed`, or `cancelled`, with a bounded reason, `completionVerified`,
   `resumable`, and an optional checkpoint. `openswanSessionRuntime.ts` uses
   the same receipt for run finalization, transcript metadata, eval projection,
   and memory eligibility. Only `succeeded` with
   `completionVerified: true` may complete the canonical run or feed reusable
   and archive success-memory paths; cancellation remains cancelled, and
   incomplete cap/guard/edge outcomes cannot linger as active or be converted
   to success by model prose. Explicit failed checks become
   `verification_failed`, blocked/manual checks become `verification_blocked`,
   and a present coding receipt that reports edits without passing checks
   becomes `verification_unverified`. A missing coding receipt for ordinary
   read-only Q&A remains eligible for a clean success. When the turn delegates,
   every planned child must return both a completed typed parent summary and
   completed summary metadata; any missing/non-complete child produces
   `delegation_incomplete`, and transcript/ledger labels retain the child's
   actual status. The guarded terminal
   writer then reports whether its exact update applied, lost to cancellation,
   or could not be verified; the receipt is rebuilt so concurrent cancellation
   wins and an unverified database transition becomes `persistence_unverified`
   instead of a user-visible success. Because the database has no partial run enum,
   non-cancelled incomplete rows currently close as failed while the typed
   receipt preserves their more precise status and checkpoint.
   Ordinary required tools share that terminal truth: a failed planner-high
   call or any failed mutation-policy call becomes
   `action_coverage_failed`; blocked, manual-required, pending, or unknown
   required work becomes partial `action_coverage_incomplete`. Optional
   exploratory reads remain non-gating, and typed plus legacy tool events use
   the same runtime-owned disposition.
   `chatLaneOutcome.ts` and `chatOutcomeSignals.ts` project that receipt into
   lane health and persisted message outcome. Chat puts non-success
   status/recovery copy before any provider response and does not auto-launch a
   repair agent for a stopped turn. A resumable message exposes Continue only
   with a strict value-free locator bound to its exact circle, user, thread,
   run, source-message, and device-local checkpoint event. The click
   synchronously claims that locator once, and the runtime resolves it before
   writing a new transcript header or starting model/tool work. Supplying an
   explicit stale, mismatched, malformed, missing, or superseded locator stops;
   it never falls back to the latest checkpoint scan. Checkpoint contents stay
   in the device-local transcript and never enter persisted Chat metadata.
   Generic approved tool continuations likewise preserve the exact original
   task instead of posting a technical synthetic prompt. Chat groups only one
   run/requester/scope, builds a transient value-free approval-id/tool/digest
   binding, and forces that task plus its source ledger through OpenSwan.
   Typed, legacy, and local-batch handlers recheck the exact source run, user,
   circle, thread, digest, liveness, and atomic consume; selected-agent, Plan,
   pending-attachment, newest-row/title, and category-auto fallbacks cannot
   intercept or widen the bound turn.
   Room Chat persists bounded terminal scalars,
   Mission completion requires verified success, and Feed/Kanban uses the same
   receipt to gate task completion, proof, completion memory, XP, and dependent
   collaborative agents. Partial, failed, and cancelled children stop the
   sequence instead of handing optimistic prose to the next agent. Genuine
   two- or three-action turns bypass single-intent first-match
   handlers and enter one intact OpenSwan turn with a bounded A1-A3 completion
   ledger and grouped `and`/`then` dependencies. More than three accepted asks
   stop for one clarification and no dispatch. The planner applies the strictest
   child/whole-request risk and approval floor, and terminal transport forces authoritative-completion work
   through the batch runtime instead of ordinary talk streaming or a
   specialized single-intent mode. Specialized computer-task compilers and the
   atomic Office-agent create-and-attach path remain unchanged. That turn
   force-advertises the deferred `run.report_action_outcomes` tool, prompts it
   as the final report,
   and requires exactly one report event. The reporter is a pure structural
   acknowledgement and singleton ordering barrier: it performs no mutation or
   external I/O, makes no completion decision, and may reference only bounded
   exact earlier provider tool-use ids. `openSwanMultiActionCompletionCore.ts`
   then validates the full ledger
   against runtime-owned ordered tool events without reading provider prose.
   Evidence must use an operation-specific completion tool; mutation proof also
   requires authoritative mutation and exact target binding. For a derived
   assistant-authored text action, the turn may additionally advertise the
   deferred `run.publish_action_artifact` tool. It accepts one exact current
   A-id, one allowlisted artifact kind, and bounded redacted title/content. Its
   acknowledgement is not proof: the runtime accepts only one publisher claim
   for that action before the final report, persists the content to canonical
   `agent_run_artifacts`, requires the exact successful inserted row, and then
   lets the report cite that earlier provider tool-use id. A pure draft may use
   that durable artifact alone, but a source-grounded summary, analysis,
   comparison, or recommendation requires both exact supporting read evidence
   and the durable artifact. The supporting source result must come from a
   strictly earlier provider iteration than publication, so same-round calls
   cannot claim information the model had not received. An explicit file, SaaS, app, browser, desktop, or
   other external destination remains mutation-bound; artifact publication
   grants no mutation authority and cannot replace its operation-specific proof.
   Tool evidence plus Chat/Room A# snapshots stay value-free. Chat stores an
   opaque `canonicalArtifactId`, its canonical content digest, and a truncated
   inline display copy. It batch rehydrates only a row whose artifact id, run,
   circle, title, A-id, kind, and independently recomputed row/pointer SHA-256
   all match; completion never trusts that message copy. §38 removes
   authenticated artifact UPDATE/DELETE authority and limits INSERT to the
   exact run owner; deployment remains tracked in the roadmap SQL checklist.
   Unmapped reads,
   unsupported mutations, or derived work without the required read and/or
   durable typed receipt remain unavailable instead of borrowing nearby
   evidence. Missing, duplicated, invented, reused, future, status-mismatched,
   dependency-inverted, invalid, unavailable, pending, or blocked coverage is
   partial `action_coverage_incomplete`; an explicitly failed action is
   `action_coverage_failed`; only every action completed with semantically bound
   evidence can verify the turn. Dependent contract calls execute sequentially.
   The runtime persists only a bounded value-free action summary through a
   per-run serialized optimistic CAS with exact-row readback; missing or
   unverified persistence becomes `persistence_unverified`. Room overflow stops
   before runtime. Room messages are immutable: transient typing remains local,
   and clarification, failure, and final-answer paths each make one checked
   INSERT rather than a placeholder UPDATE. Reload selects the newest bounded
   page with timestamp/id tie-breaking and reverses it for chronological UI
   display. The focused `openswan-multi-action-artifact-evidence` and
   `openswan-multi-action-read-evidence` smokes pin publisher schema,
   persistence/readback, source-read conjunction, ordering, value-free
   projection, and fail-closed cases. This slice is
   source/typecheck/focused-smoke verified;
   no live provider, authenticated cross-surface refresh,
   cross-process resume, deployment, or database transition proof is claimed.
7. Provider choice is resolved by selected model, connected providers,
   `serviceProfileSouls`, and cross-provider routing helpers.
8. Bot output is persisted to the active chat thread with compact metadata for
   source, routing, usage, artifacts, memory refs, browser plans, runtime events,
   and the bounded connected-agent receipt/run link. Chat does not immediately
   flip an accepted agent back to `idle`; provider/session polling owns roster
   presence, while Office and canonical run telemetry own task visibility.

Office-terminal and Feed/Kanban Claude Code launches use the same nonterminal
meaning. The bridge `/spawn` acknowledgement must contain one exact provider
spawn handle; it produces `disposition = accepted` and
`completionVerified = false`, never a completed task. Office writes a queued
`office_terminal` accepted ledger row and leaves its response plus tracking task
open. Feed/Kanban leaves accepted task runs `running`. A malformed, timed-out,
or lost response is `outcome_unknown`, is not replayed, and becomes a blocked
Feed task run rather than completion or proof-of-work. Feed performs one
task-bearing provider attempt, never a wake-and-send followed by a second
adapter call. Sequential collaboration pauses at the first nonterminal or
failed child. Agent Tasks, Active Runs, run history, and the activity timeline
preserve accepted/unknown copy rather than inventing completion, failure, or
provider heartbeat freshness.

Office/Feed OpenSwan sends use the canonical structured `sendSessionMessage`
contract and require an exact `connectionId::sessionKey`. The implicit
`agent:main:main` fallback, raw tool sender, and assistant-history completion
heuristic are gone. Accepted rows stamp `externalDispatchKind = sessions_send`
and keep external connection/session/provider-run identities separate.

The published Office-agent route to that exact target is source-wired as an
explicit owner action, not inferred identity. The displayed OpenSwan session's
Agent Gateway UI lets the current owner bind, move, or clear one of their
published OpenSwan Office agents against the exact owner-owned `agents_bots`
UUID and case-sensitive session key. §36 adds the no-backfill, owner-private
`office_agent_session_bindings` table, owner-only reads, server-authorized
set/clear RPCs, and `invoke_agent_v2`. That versioned RPC composes the canonical
Office claim exactly once and returns its bound-or-missing binding snapshot;
public `circle_office_agents` rows never receive session identity or secrets.

The Office agent drawer follows the same progressive-disclosure rule as Chat's
Control Panel. Opening an agent performs no speculative imports for Terminal,
Memory, Runs, Spirit, or gateway tabs and never creates a durable Office row as
a read-side effect. The OpenSwan tab loads only its exact connection/session
snapshot and one task composer by default; a successful send remains an
accepted handoff with completion explicitly unverified. Binding, session
history/status, runtime agents, subagents, search, and Cron inventory load only
after `Advanced options` opens, so unavailable data is not presented as zero.
Closing the disclosure drops cached history, runtime inventory, and private
binding rows; reopening obtains a fresh exact snapshot.
Provider and Cron mutations are single-flight, Cron run/create actions require
confirmation, and the collapsed Office command board leaves full bridge
diagnostics dormant. Overview labels the Claude allowlist as read-only
diagnostics, never as a task/shell handoff; it does not create fake queued
activity, and its embedded summary has no second set of destructive controls.
Standalone offline/remove controls say what they actually change, require
confirmation, and scope a published row by exact UUID. Panel auth reads use the
captured exact Office user/circle/bearer authority and never recover mutable
global auth. The shell keeps one identity/status header, current work and
connection truth in the default Overview, and identity/memory preferences
behind an accessible Agent details disclosure. Centered mode owns dialog focus
and restores the exact semantic opener; docked mode remains non-modal. Compact
web always uses modal sheet semantics, stays above sticky Office controls, and
keeps 44 px action targets. The compact bridge summary performs one
generation-fenced mount probe plus manual refresh, using the shared OpenSwan
browser-proxy/native-direct endpoint order; Office auto-connect remains the
sole background poller.
Run
`npm run check:openswan-control-panels` when changing these boundaries.

The database binding is necessary but not sufficient to send. At invocation,
the pure resolver demands the exact Office UUID, exactly one local connection
whose `remoteId` equals the claimed `agents_bots` UUID, exact `openswan`
provider, enabled/connected state, a real hydrated token, and exactly one
case-sensitive session-key match on that same connection. It returns the sole
local `connectionId::sessionKey` target and ephemeral gateway config. The token
stays in device-local secret storage and is never persisted in the binding,
claim, public Office agent, or run. No agent/connection name, provider-wide,
first-connection, first-session, or main-session fallback exists. Missing,
stale, duplicate, offline, or tokenless resolution fails closed before provider
I/O in both Office and Feed; a binding does not make local credentials
cross-device available.

Chat consumes the same private binding for owner-selected published OpenSwan
agents. It never treats a public Office UUID as a session key: owner id and the
authenticated `isOwn` verdict must agree, then the resolver targets exactly one
co-fingerprinted local connection/session for send or dedicated spawn.
Non-owner OpenSwan and terminal-provider rows perform zero local provider calls.
Auto-connect and Office pollers co-publish session rows with
the producing connection's local id, private bot UUID, and normalized endpoint;
late poll results, duplicate local ids, and same-id connection replacement are
discarded before binding or dispatch.

Connected-agent Chat selection and mutation are identity-first and one-shot.
The `/assign` picker preserves an encoded immutable agent id; stale selections
become unavailable rather than falling back. Quoted, terminal-session, and
multi-agent names must resolve uniquely or dispatch nothing; production-shaped
immutable ids remain ids through planning and can select one of several
same-name agents. Only
`default::blackswan` may become the default OpenSwan target. Published custom
rows require an immutable connection id or explicit exact gateway; provider or
display-name similarity is not connection or credential authority. Custom
gateways can receive a device-local token only from an enabled exact normalized
endpoint match after `isOwn` and both nonempty owner ids agree. Missing
alleged-owner evidence cannot authorize a local token or network attempt.
Terminal and custom send/launch
results carry `transportAccepted: true | false | null`, require HTTP success,
explicit structured positive evidence, and exact selected-session echo, then
stop after response loss or an ambiguous provider response. An exact selected session is never replaced and a
launch never fans out to another provider automatically. Claude, Codex, and
Gemini terminal servers require one case-sensitive exact session id before
input and reject name, prefix, case-folded, and duplicate matches. Cursor
exact-session input fails closed until its GUI bridge can bind focus to one
verified Composer conversation. One-session launch acceptance requires one
receipt-safe exact returned session id; the receipt retains it as external
lineage, session-native targets use it as their canonical subject, and selected
DB agents retain their DB subject. Missing, unsafe, or multiple lineage remains
outcome unknown without replay or an accepted row. Office run lookup is
exact-first and falls back to a display name only for identity-less legacy
rows. Sequential Chat
chains pause until usable upstream output exists and never forward acceptance
or error prose as completed context.

An accepted direct Feed handoff appends one best-effort queued canonical
`feed_task` run linked to its exact task and task-run attempt with canonical
agent subject metadata. A ledger failure preserves acceptance and never
replays; outcome-unknown and failed attempts create no accepted row. Activity
Feed and Task Detail use only that local run UUID for the Office action, never
external connection, session, or provider-run identities.

The OpenSwan adapter consumes structured lifecycle details only. A
`sessions_spawn` acceptance retains its external run id and child session key;
`sessions_send` keeps the provider wait below the client timeout, treats a
structured response timeout as accepted/nonterminal, and never silently
replays an uncertain exact-session send into a second session. Positive
acceptance requires exact provider-run/session lineage, including an exact
requested-session echo for sends; malformed or mismatched lineage remains
outcome-unknown. Office's direct-session console uses the same service boundary
without a shorter UI timeout and labels acknowledgement with a handoff arrow,
not a task-complete checkmark. Current
`subagents action:list` `active`/`recent` buckets now populate the Office
gateway view without parsing reply/task/label prose for lifecycle authority.
Provider `done` or send `ok` remains task-unverified and does not terminalize
the canonical queued run.

Forward migration §35 keeps an `invoked` Office parent open while it has a
`streaming` handoff response; genuinely unclaimed messages and pending
responses still expire. Its table/function readiness was reported from the
target SQL Editor on 2026-08-11; live provider-finalization behavior remains
unverified.

Office and Chat recognize the exact accepted/awaiting/unverified metadata
marker. Building Now and the mobile roster say `Accepted · awaiting update`,
and the row is top-level rather than a synthetic subagent. Fresh queued rows
stay under Other alongside paused and approval-waiting rows. Only fresh
`planning` or `running` rows qualify as Active; after 30 minutes without an
update they become `Stale · Not Active`. Chat Run Trace shows no spinner, STOP, or Run
Again for this state because those local controls cannot control the external
provider session.

Feed uses the same classifier rather than treating every open row as active.
Its query requests the canonical active-only subset and its render pass
rechecks freshness so a row that crosses the 30-minute boundary disappears
from Active without a fabricated terminal rewrite. Queued, paused,
approval-waiting, timestamp-less, and stale rows remain non-active. Exact
accepted connected-agent handoffs remain separately visible under
`ACCEPTED HANDOFFS` with `COMPLETION UNVERIFIED`; they do not increase the
Active count.

Office cost presentation has one meaning per field. A bridge-reported cost is
the cumulative meter for that exact session and remains available for snapshot
delta sync; it cannot hydrate `costToday`. The daily and lifetime figures shown
on an agent come from one exact durable `circle_office_agents` row. Exact
name/DB identity wins, a provider fallback is admitted only when the provider
has one live agent and one owned DB row, and ambiguous rows receive no aggregate
instead of whichever row loaded last. Identity history may enrich lifetime cost
only. The token card and whiteboard use durable rolling 24h/7d/30d usage reads,
retain their last snapshot across transient login-time failures, and label the
windows explicitly rather than assigning a session's entire lifetime to its
last-active date.
The main Office dashboard does not repeat that telemetry in a running-cost/reset
header strip and does not mount the personal presence/status-note/timer picker;
those controls no longer compete with the workspace and operational surfaces.
`StatusPicker` has truthful save/loading/error handling and accessibility, but is
a dormant component rather than a visible dashboard claim. `WorldClockBar` is
also dormant despite its IANA/DST-safe formatting, refresh, invalid-zone
fallback, and accessible labels. The placeable `world_clock` addon is the
visible computed-time surface.

Office workspace persistence is owned by §37. Layouts are private per
authenticated user and circle, sanitize a detached snapshot, and save through
a monotonic version gate with serialized client writes; a late response cannot
overwrite a newer floor. The fast/offline cache is one versioned user-and-circle
envelope written through a serialized queue and accepted only after exact
readback. Server success likewise requires a literal accepted receipt for the
exact submitted version; equal-version divergent JSON fails closed. The old
global `profiles.office_layout` blob is ignored because it has no
circle owner and cannot safely seed a workspace. Notice dismissals are revision-keyed server rows, so the
same blocked episode stays dismissed across remounts/devices while a genuine
new run update may surface again. Old paused/waiting episodes age out of the
attention strip instead of returning forever. Complete floor presets capture
the theme, assigned agents, every furniture item, connected tool/integration
settings, labels, and interactive state; applying one keeps the destination
floor identity, mints fresh item identities, and marks the captured roster as
manual. Automatic floors reconcile only remaining live agents, so a bridge
refresh cannot overwrite a preset-owned roster. Preset loading and mutation are
also fenced to the initiating user/circle generation; mapped reads, apply, and
delete re-check circle identity, while delete requires an exact returned `id`
plus `circle_id` receipt. The original §37 objects are
catalog-ready per the user's 2026-08-12 SQL Editor result. The follow-up
`20260813140000_office_layout_exact_save_receipt.sql` migration is source-ready
but not applied to the target. It additionally makes the RPC the sole
authenticated layout mutation surface, rejects unsafe/far-future versions, and
repairs any legacy future-version poison before revoking raw writes. It removes
invalid legacy dismissals, enforces a durable run/circle foreign key, and uses
server-owned acknowledgement/expiry timestamps plus a server-clock active-read
RPC. Before that trigger lands, a bounded 30-day compatibility payload renews
expired historical rows; the trigger overwrites those browser timestamps after
migration. Authenticated localhost exact local/server
convergence and save/reload passed on 2026-08-13; negative RLS, deployed, and
cross-device behavior remain unproven.

Private Office preference state is a separate §45 authority, not part of the
peer-readable profile blob or the §37 layout document. The owner-private
`office_user_preferences (user_id,circle_id)` row allows RLS-scoped reads and
one bounded, allowlisted atomic patch RPC; authenticated direct DML is revoked.
Every client read, write, roster load, identity/cache lookup, presence join,
heartbeat, and cleanup captures the exact user, circle, access token, and auth
generation, then rejects a stale completion. The Office private subtree stays
behind exact-scope hydration so an account/circle switch cannot briefly paint
the previous user's names, appearance, notes, budget, sessions, or Telegram
state. Telegram tokens remain only in verified local secret storage; the
server receives bounded non-secret `chatId`/`botName` metadata. Legacy private
profile keys and appearances are scrubbed without projecting their values, and
narrow triggers keep older clients from restoring them. Session/tag/identity
caches are exact user/circle envelopes with no scoped fallback to ownerless
legacy records. Local queue deadlines retire only the exact scope lane until an
unabortable operation settles, while unrelated users/circles remain
independent. Migration `20260813220000_office_user_preferences.sql` is mirrored
byte-for-byte as §45 and is not applied to the target; source and disposable
PostgreSQL behavior do not substitute for live two-user negative-RLS,
account-switch, cross-device, native secret-store, or deployed UI proof.

The 2026-08-13 exact-runtime continuation layer extends that private-state gate
to the remaining Office action surfaces. Before private hydration, Office
verifies that the captured bearer belongs to the captured user and that the
same user has an exact membership row for the current circle. Cached private
state never substitutes for this proof, and a failed or empty membership read
keeps the private subtree closed.

Connection metadata and credentials no longer inherit authority from the
app-wide auto-connect singleton. Office loads and saves one captured
user/circle/token/generation lane, sanitizes its metadata, and stores each token
under a verified protected local-secret identifier. Removal deletes that exact
secret. The auto-connect manager and ownerless compatibility APIs remain
available to non-Office surfaces, but their cache/session data is not an Office
authorization input.

Office terminal sends verify the bearer subject, write with the captured token,
validate the returned circle/sender/target/status row, and mint an immutable
durable dispatch receipt. Direct dispatch and the exact listener both require
that receipt, its target fingerprint, and the still-current authority; realtime
broadcast only wakes a durable-row reload. HITL and run-approval mutations use
the same captured user/circle/token/generation boundary and validate their
pending-row resolution receipt. Exact Office approvals do not fall through to
the generic approval side-effect worker or save a broad auto-approve preference.

Calendar/Email and Figma status, popup, provider-read, and disconnect work use
the captured bearer and reject late results after a generation change. Shared
OAuth helpers retain mutable-session fallbacks for non-Office callers only. The
idle scheduler receives the captured user/circle/generation and a guard closed
over the token-bearing Office lifecycle, returns one exact cleanup for its
initial timeout and interval, and drains an in-flight retired predecessor before
replacement work. Its circle-only stop signature remains a compatibility path.
These are source-level boundaries; live two-account/two-tab switching, native
secret-store cleanup, real-provider OAuth, and deployed behavior are not
claimed.

The 2026-08-14 continuation closes more exact Office client paths. Computer-task
state, plan queues, and Profile computer-use history capture user, circle,
bearer, and generation, clear on scope retirement, and reject late results.
Provider-key and custom-theme CRUD/hooks, workspace adaptation/activity, and
hidden-agent suppression are likewise user-and-circle scoped. Phone/Messenger
configuration and provider secrets use exact user/circle storage identities,
verify the captured bearer subject, reject ownerless legacy credentials, abort
provider I/O on retirement, and unmount private message/draft state when the
generation changes. OAuth/Figma
disconnect work accepts cancellation; terminal deletion requires an exact
returned-row receipt; terminal invocation carries an abortable exact execution
scope and preserves post-dispatch ambiguity as non-replayable
`outcome_unknown`. The idle scheduler explicitly binds its captured bearer to
each database/function call and shared-memory mutation. A Realtime-backed,
periodically revalidated membership lease retires and clears the Office private
subtree when access is lost.

`chatPlanApprovalAuthorityCore.ts` is dependency-free so the app and Edge-
imported approval code use the same in-process object-capability brand; copied
or serialized plan metadata is not authority. The build uses narrow
`nanoid@3.3.18` and Jayson/xcode-only `uuid@11.1.1` overrides, plus a pre-export
bounded magic-signature scan that rejects symlinks and ICNS/JXL/HEIF/HEIC files
under repository-controlled Expo assets. The upstream `image-size` denial-of-
service advisories have no patched release and remain build-time audit debt;
the guard is defense in depth, not a dependency fix.

Source review, focused smokes, `check:office-addons`, both typecheck suites, a
clean production export, public-bundle scan, and an authenticated frozen-export
desktop/mobile canary passed on 2026-08-14. That remains local proof, not a
deployed-site, real-provider, native-secret-store, or multi-account claim. The latest
read-only audit still identifies unresolved Office P0 work in Vault server
enforcement/recent-auth, agent-connect tokens, MCP administration, and
schedules/run-history mutations. Do not describe the whole Office as exact-
authority complete.

This visual and accepted-handoff ledger is source- and focused-smoke current as
of 2026-08-07. No live bridge final-result E2E or accepted-ledger deployment is
claimed. The
updated `chat-stream` edge is deployed as production version 16; an
authenticated live image-to-Claude-Code/Codex E2E has not been claimed. Exact pixel/file access is
also intentionally absent: the next capability is an opaque, expiring,
user/thread/task/provider/session-bound file handle that a paired bridge can
re-authorize without receiving ambient paths or bearer URLs. Connected-agent
dispatch still needs durable typed started/final-result adoption. A launch/send
acknowledgement creates only the nonterminal queued ledger; it is not task
completion, and Chat must not manufacture a terminal state from it.

OpenSwan navigation stays visible across circle, private, and shared Chat
threads through `ChatThreadHeader`. The header is mounted before Chat branches
to an empty or populated transcript, clears the prior thread while a selection
resolves, and keeps `OPEN`/`OPENSWAN` plus `RUNS` available through loading,
empty, active, and thread-resolution error states. `OPEN` enters
`OpenSwanServiceMenu`, where mode and crew selection live; Control Panel owns
agent, model, approval, and tool setup; `RUNS` / Runs & recovery use ChatTab's
existing run-history callback for past, blocked, or recoverable work. Keep this
map explicit, responsive, keyboard-focusable, and semantically labeled without
duplicating runtime state or approval authority in the menu components. The
service sheet is centered, shares the Control Panel's purple/cyan palette, opens with compact
work-mode and crew selectors, expands only one selector at a time, and keeps
Skills, route guidance, Runs, and recovery behind one accessible `More options`
disclosure. Close/backdrop own dismissal instead of a bottom-sheet grabber or
redundant `Done` row. Every React Native product `Modal` under `App.tsx` / `src`
uses an explicit fade entrance; the site-wide motion smoke prevents directional
slide transitions from returning. The
Control Panel itself is task-first: its default view contains one task composer,
the exact Chat-selected agent, compact work-type/approval context, one collapsed
mode chooser, truthful launch readiness, and the launch action. Work-type
recipes, connection setup, readiness diagnostics, guardrails, saved
automations, templates, run history, tool/memory posture, and maintenance are
under one accessible `Advanced options` disclosure. Opening that disclosure is
also the activation boundary for the panel's automation subscription, recent-run
subscription, connection-token setup, and memory-detail reads; hiding controls
does not weaken the canonical launch-readiness or guardrail contract. The
cold-open boundary also covers spend breakdown, saved templates, full tool
posture, and site-wide vault readiness. Budget preflight reuses the canonical
cached circle snapshot and starts only after task entry. Automatic routing is
live while the user types: named desktop apps such as Adobe Illustrator select
Computer/Execute, overall-job words such as research or repeat win over
incidental code/browser nouns, and an explicit workflow or mode always wins
over inference. Only concrete Execute/Build/Review workflows can be held for a
task-specific capability audit. Global readiness remains advanced diagnostic
context and cannot block an unrelated planning/research turn; exact runtime
authority is still revalidated before any external mutation. Advanced
readiness waits for the capability audit before making one vault-readiness
request, avoiding the old null-audit/complete-audit duplicate.

Hosted OpenSwan remains the unattended schedule owner. A selected connected-agent
subject is retained for accountability, while device-local bridge sessions are
dispatched live only from Chat or Office when the exact connection is available.
The
composer selector also keeps availability separate from activation: normal
Chat reads `Chat · OpenSwan available`, while an enabled runtime mode reads
`<Mode> · OpenSwan active`. Advanced controls expose their expanded/selected
state. `Reset Mind` requires explicit destructive confirmation, deletes the
circle's session and current-user memories, and leaves the visible transcript
intact so the user does not mistake a local clear for message deletion. The source contracts are guarded by
`npm run smoke:openswan-chat-navigation`,
`npm run smoke:openswan-control-panel-disclosure`,
`npm run smoke:openswan-console-intent`, and
`npm run smoke:chat-agent-selector-presentation`; use
`npm run check:openswan-chat-ux` for the complete focused UX gate.

The first cross-surface entity-handle adoption is also source/focused-smoke
current as of 2026-08-07. When Chat already holds a run handle, its follow-up
and reference actions encode the same validated `office:run:<id>` into the web
`uc:switch-tab` payload or native route params. `CircleDetailScreen` decodes it,
accepts only an aligned Office/run target, records the focus request before
activating lazy Office, and forwards a request sequence so tapping the same run
again reopens the existing `RunHistoryDrawer` on that run. This path creates no
run and no alternate viewer. Thread, task, mission, agent, room, and message
focus—and non-Chat entity-handle dispatchers—remain pending. A live web/native
GUI navigation pass has not been claimed.

Thread selection is an explicit data transition, not a label change. Chat
clears the prior transcript immediately, validates the target against the
current circle and archive state, restores only that thread's draft and staged
attachments, and keeps the composer disabled until the new transcript is
ready; a failed resolution renders a real Retry state. Active runs and
in-flight uploads block a silent thread move. The compact conversation rail is
an overlay, and archive/delete/leave/member actions are labeled and confirmed.
Message and thread Realtime subscriptions reconnect with an immediate scoped
catch-up and perform a quiet heartbeat repair; the message transcript also
polls every 15 seconds only while its channel is degraded. Authoritative
message tails reconcile missed deletes without
discarding older pages, optimistic sends, or rows inserted after the read
began. Older-message pagination uses the stable `(created_at, id)` cursor, and
reply previews are hydrated in a batched parent read instead of one query per
row. Treat every Realtime payload as an advisory wake-up and re-read through
the canonical scoped query.

Every ordinary attachment-dependent Chat model turn now has one exact source
boundary: a single request receives A1 and a compound request receives bounded
A1-A3. Chat waits for the persisted user-message UUID and exact returned-row
attachment linkage before any provider, vision, connected-agent, or desktop
consumer. It then hashes exact bytes and passes one sealed private turn source
to OpenSwan outside public metadata. An exact human member mention wins every
agent alias and produces no AI dispatch after persistence; an exact connected
agent keeps ownership, with unsupported non-image file delivery blocking
instead of falling through. Continue, slash, picker-only/native, unfinished,
scope-drifted, and failed-link cases stop before consumer I/O and retain files
for recovery. Plan mode retains the exact database source-message id and bound
contract without executing it. The provider sees only value-free attachment
identity and may inspect bounded extracted text or a sanitized visual
observation only through `attachments.read_source({ attachmentId })`. That tool
accepts no URL, storage key, local path, base64, or raw-byte authority; returned
content is untrusted data and omitted from durable tool-event history. The
unmodified user request is carried separately from augmented runtime prompts,
and only literal user-authored external destinations can authorize attachment-
turn egress; loopback/private/link-local and unsafe redirects fail closed.
Completion requires the runtime-issued receipt to resolve against the exact
manifest, digest, message scope, and attachment id. Missing persistence,
unreadable content, ambiguous identity, scope drift, or filename/prose-only
claims block the whole contract. The legacy path-bearing desktop branch is
disabled. One explicit open/load/preview/show request for one safe durably
linked upload may use `desktop.open_attachment({ attachmentId })`: exact bytes
are staged behind a branded one-shot process-private capability, approval stays
solo, continuation synchronously claims the exact in-memory lease, durable
dispatch occurs once, and completion needs a runtime-issued receipt plus fresh
proof of the exact privately resolved app, process, frontmost window, and
unpredictably named active document. A user-named allowlisted app wins file-
extension defaults; the requested/resolved app and document identities remain
private fingerprints through approval, dispatch, and proof. LaunchServices
acceptance, an arbitrary title/accessibility match, an error dialog, or an
older same-extension document is never completion evidence. The bridge keeps
the staged bytes through that postcondition, then deletes them on proof,
revocation, idle expiry, or guarded crash-root cleanup. Edit/save/export/
transform, copied or expired authority, scope/hash/app/document drift, or
uncertain post-dispatch proof fails closed without replay. §§39-40 supply exact
database linkage and private metadata/Storage visibility guards; §41 makes the
canonical device-private approval row visible and mutable only to its exact
requester while retaining trusted service maintenance.

Bot output also has an explicit durability contract. `transcript` is the safe
default and can enter Postgres, model history, memory extraction, pending
recovery, and the session archive. `ephemeral` greetings, progress/routing
notices, and command/navigation help remain visible in the mounted client but
do not enter those durable or model inputs. Hydration filters the known legacy
ephemeral source surfaces so a refresh does not fossilize old progress copy;
real outcomes, blockers, and recovery evidence remain transcript messages.

## Agent Subject Metadata

`agentRuntimeSubject` normalizes Office, Chat, SwanBot, and OpenSwan agent ids
into one subject key plus aliases. Automation proposals, `/automation run/test`,
OpenSwan saved automations, specialized Chat/OpenSwan mode runs,
`automation-executor`, the Automations dashboard, Office terminal,
`AgentMemoryPanel`, and `AgentRunsPanel` preserve or display that metadata.

## Provider And Marketplace Flow

The 2026-08-12 site-wide model catalog is recorded in
`docs/CURRENT_MODEL_CHAT_MODERNIZATION_2026-08-12.md`. Exact GPT-5.6
Sol/Terra/Luna, Claude Opus/Sonnet 5, Gemini 3.6 Flash/3.5 Flash-Lite, and
current direct-provider families now agree across curated catalogs, aliases,
capabilities, context windows, cost ledgers, registry fallback,
Chat/Rooms/Office pickers, Auto ladders, and relevant Edge allowlists. For a
connected user key, the authenticated `llm-proxy` `list_models` action calls a
fixed provider-owned catalog endpoint, sanitizes and bounds the response, and
feeds a user/provider-scoped client cache. Picker hydration runs connected
providers in parallel with a bounded wait and preserves whether the result was
verified, a curated fallback, or unsupported. A verified response contributes
only supported IDs listed for that exact key; a verified empty account remains
visible as empty, while a timeout/error uses a short-cache curated fallback
that is labeled unverified and rechecked when execution starts. OpenRouter uses
this same path instead of a second browser fetch.
Before those provider requests, the client now checks the public `llm-proxy`
GET capability list once. A healthy older deployment without advertised
`list_models` support stays on the curated fallback and does not emit one
expected HTTP 400 per connected provider during Chat startup. The source Edge
health response advertises the action; deployment remains separately gated.
Background memory embedding separately preflights OpenAI key metadata. Once
the proxy reports an unreadable credential, the client persists that exact key
id/version as blocked for a bounded daily recheck; re-saving or rotating the
key changes its version, clears the block in the same runtime, and resumes the
orphan sweep without a reload. This state uses its own scheduler so it cannot
occupy the live embedding queue timer. App bootstrap likewise hands its
validated user/token authority to agent auto-connect; local bridge publication
and status writes bind that token rather than competing for the browser Auth
Web Lock during Chat startup.
The shared Chat/Rooms/Office
terminal/spawn registry and Marketplace cards render the same readiness state
and reject options without a real hosted Chat route, keeping Ollama and
arbitrary OpenAI-compatible endpoints on
their guarded OpenSwan/local-tool paths. Known retired and non-chat IDs cannot
re-enter through live or database catalogs. Curated Chat category/popular
shelves remain browsable previews but disable hosted models without an exact
ready provider/model identity; Auto ignores providers with zero ready models
and stops an unavailable resolution before provider I/O. Separate image/tool
capability models remain on their existing owners. Office removes bare hosted
provider shortcuts that could execute a different fallback than their label;
current GPT, Gemini, GLM, MiniMax, and DeepSeek choices enter through
provider-qualified account rows. Key writes/deletes invalidate the shared
cache and refresh mounted key consumers. Rooms forwards only ready catalog
providers to its OpenSwan Auto resolver, preserving account-backed routing
across the Room boundary. OpenRouter Popular is labeled live only after a live
ranking response; its current fallback and live rows both exclude retired IDs
and project-banned vendor families. Chat resolves Auto once before capability routing and
reuses that same model for transport; continuation context retains the newest
assistant answer's tail. Existing exact saved selections remain visible and
routable, while the Sonnet 4.6 default remains unchanged. This is source
compatibility, not live provider entitlement or deployed Edge proof.

- `src/lib/modelCatalogReadinessCore.ts` owns the pure exact-inventory
  projection and user-facing account-catalog readiness state.
- `src/lib/llmProviders.ts` defines provider types, curated fallback lists,
  authenticated live-catalog loading/cache invalidation, key CRUD, and
  `invokeLLMProxy`; `src/lib/integrations/modelProviderRegistry.ts` merges
  connected account catalogs into site pickers without blocking indefinitely.
  `src/lib/llmProxyErrorCore.ts` recovers the bounded `{ error, code }` body
  from non-2xx Edge responses so provider setup is not mislabeled as an
  application repair.
- `src/lib/circleIntegrations.ts` owns circle-level integrations.
- `supabase/functions/custom-api-proxy/index.ts` is the guarded server-side
  execution path for Custom API marketplace connectors; OpenSwan tools call it
  instead of exposing saved API secrets to the model/client.
- `supabase/functions/llm-proxy/index.ts` calls OpenAI-compatible providers and
  Anthropic branches with user-owned keys. Its `list_models` branch uses only
  fixed allowlisted hosts for OpenAI, Anthropic, OpenRouter, Groq, GitHub
  Models, Hugging Face, Z.AI, MiniMax, Google AI, Mistral, Cohere, Together,
  Fireworks, and DeepSeek; callers cannot inject a catalog URL. Its
  authenticated public dispatches and `chat-stream` opt into `_shared/edge.ts`
  `user_required` policy, so they never inspect or spend a platform environment
  key. Missing rows remain `key_missing`; failed stored-key lookup/decryption
  is `credential_unreadable`. Other shared-helper callers retain their explicit
  policy until migrated.
- `supabase/functions/swanbot-ai/index.ts` can relay marketplace-prefixed
  models with tools.
- `src/lib/billingPriority.ts` controls provider preference modes:
  `prefer_direct`, `prefer_openrouter`, and `cheapest`.
- `src/lib/webSearchAutoDetect.ts` owns the optional Web Search lane. A
  conversation-only turn bypasses search even with `WEB ON`; a search failure
  continues through canonical plain Chat once with a not-web-verified caveat
  and never creates an action receipt or connected-agent repair card.

Keep provider enums, model prefixes, UI cards, edge support, and the open-ended
integration provider registry aligned.

The 2026-08-06 shared Vault-key rotation originally rewrapped site credentials
but omitted seven pre-existing `user_api_keys` rows. A value-free live probe
confirmed those rows are unreadable under the current key. Source now
inventories and transactionally verifies user-key ciphertext when it shares
the rotated Vault key, but already affected ciphertext requires prior-key
recovery or credential/OAuth re-entry. Do not delete or overwrite the trading
wallet row without an independently verified private-key backup.

The 2026-08-07 Chat/Marketplace source contract makes
`claude-sonnet-4-6` the default for future or unconfigured threads without
backfilling existing rows; an explicit `auto` preference still invokes model
resolution. A `key_missing` or `credential_unreadable` response stops
same-turn stream/proxy retries and gives the user a focused Marketplace model
connect/reconnect action. Anthropic setup first probes the submitted key, then
stores it only in the signed-in user's encrypted model-key vault, and finally
probes the stored credential through `llm-proxy`; the UI reports Connected only
after both checks pass.

## Computer Use Flow

The long-term convergence contract is the Universal Computer Task Kernel in
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`. Its phased order is structured
action-evidence transport -> finish durable root identity and wire the
source-landed outer task-acceptance core around the request-bound Photoshop and
named-app lifecycle §26 canaries ->
catalog-wide mutation gateway -> durable leases/checkpoints/approval
continuation -> browser/native and capability-buildout breadth -> one cross-
surface ledger -> fault-injection and production rollout. Its policy matrix is
also the source for distinguishing
observation, lifecycle, bounded local draft, local/external mutation,
publish/send, credential/payment, destructive, coordinate fallback, and
capability-buildout actions. Current source coverage is partial; those phases
are not a claim that every app action is already supported or replay-safe.

The first shared V1 root seam is source-landed. `computerTaskRoot.ts` owns
pure deterministic request/task/root identity and transitions;
`computerTaskRootStore.ts` owns memory compatibility, the disabled durable
RPC binding, and the feature-off atomic root/action gateway. `ChatTab` admits
and rechecks the authenticated root before planner, bridge, file, approval, or
provider work. Only the strict seven-field pointer may cross browser plan,
session, cloud-request, and persisted-Chat boundaries; it is inert correlation,
not approval, dispatch authority, or proof.

Each acceptance action has one immutable dispatch-binding slot for its owning
attempt kind, exact call/policy/verifier/replay fingerprints, authorization
category, and mutation authority. Bind, foreground lease, claim, and dispatch
require the active acceptance-owning attempt. Strict hydration permits a
verified prefix, at most one action frontier, and a planned suffix; it also
enforces exact active lease ownership, proof-only `outcome_unknown -> verified`
reconciliation, and verification-only lease release. The pure Photoshop
projection still revalidates the complete exact program, collision-checks its
derived fingerprints, and emits a deeply immutable value-free requirements
artifact. The artifact is not authority and retains no raw app name, dimensions,
or receipt values.

§34 now adds `claim_computer_task_root_action_v1`,
`start_computer_task_root_action_v1`, and
`settle_computer_task_root_action_v1`. Each locks the exact root before its
action row and derives the complete §26 identity from that locked root action,
including the canonical root `runId`. One root mutation action maps to one §26
row. Claim, start, and settle advance root plus §26 transactionally; settlement
may complete/fail the root in the same transaction. The only
`outcome_unknown -> verified` path requires exact matching proof and advances
both ledgers together. Generic `finish_agent_action_call` is unchanged and
continues to treat `outcome_unknown` as immutable.

An exact refreshed `claimed` root recovers its still-live token without a root
revision bump or rotates an expired token server-side; it does not replay the
planned-to-claimed transition. Recovery revalidates the current root, active
owning attempt, immutable acceptance/dispatch requirements, and foreground
lease. Claim/start/settle use fresh post-lock database clocks, start rejects an
expired claim or foreground lease, and settle returns an exact claim-token
mismatch. TypeScript and SQL reject STOP or human override while an action is
claimed so root-only terminalization cannot strand it. This is a safety guard,
not complete STOP handling: no durable stop intent or atomic claimed-§26-fail
plus root-cancel operation exists yet.

The TypeScript gateway accepts only a runtime-issued database binding. Memory
bindings and structural/JSON clones fail closed. It issues one one-shot handler
authority only from the exact `started` disposition; duplicate/prior
dispositions and authority reuse cannot enter the mutating handler. That local
brand is a dispatch guard, not trusted server admission or signed proof. The
sole Photoshop call wrapper recomputes normalized handler arguments and
consumes the authority against exact issued database binding, root
row/run/id/fingerprint/revision, action/call/token, tool/args,
authorization/acceptance/dispatch fingerprints, and foreground lease/target
immediately before its only bridge call. Clone, drift, reuse, or cancellation
fails before that call. The bridge still cannot independently verify this
attestation.

The first runtime consumer is a feature-off Photoshop canary. It is eligible
only when Photoshop is already running and frontmost, so it projects exactly
one create mutation and one §26 action. It uses root A's canonical run id
directly and never creates child wrapper B, launches, focuses, raises, or
touches the browser. A fresh observation binds exact Photoshop identity,
positive PID, CGWindow id, and window bounds; the bridge rechecks all of them
immediately before JSX. Completion requires the app-native baseline, correlated
create receipt, and final status to agree on positive document identity,
exactly one document-count increase, and requested dimensions. Final foreground
is warning/telemetry only after exact document proof: it is excluded from the
proof digest, never triggers refocus, and cannot downgrade completion. The
runtime realizes the projection's requirement fingerprints in the immutable
acceptance/dispatch binding, fences every persisted non-admitted root before
clarifier or generic fallback, and refreshes a stale/changed same-action target
lease after new exact observation. A different action's lease fails closed.
Ambiguity after start is verification-only and never replays.

This canary requires all three flags to be exact `true`:
`EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1`,
`EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1`, and
`EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1`. They remain off. §34 is
pending/not applied, and no live Photoshop mutation, production database
application, or deployment occurred for this slice. Trusted server or signed
authorization/proof leaf attestation is insufficient until the bridge can
independently verify it. That bridge-verifiable authority and durable claimed-
action STOP/cancel are P0 blockers. A durable bridge receipt for later
`outcome_unknown` reconciliation is P1. Durable outer request acceptance,
production migration/live canary, edge reread/CAS, behavioral crash cuts,
contention/recovery, and broader lifecycle branches also remain required.

The exact §34 migration and consolidated tail are 129,820 bytes, SHA-256
`45251c1ffd2ea002a227bfdcfcbd0875dbab47127e590031f3b4bf827651e30a`.
PostgreSQL 14 syntax/catalog plus positive, rollback, injected-fault,
claimed-recovery, fresh-clock/token, STOP, and human-override guard paths
passed, exact source/tail parity passed, and disposable resources were cleaned.
This is disposable validation, not production application.

- Chat/browser tasks plan through `src/lib/computerUse.ts`.
- Chat requests that mention another app, browser, local file, CAD/engineering
  tool, Adobe design file, or unfamiliar desktop program route first through
  `src/lib/chatComputerRequestRouter.ts`. That route is hidden prompt/metadata
  context, not a verbose chat message. `src/lib/chatComputerRequestUx.ts`
  converts it into the small user notice model for approvals, bridge checks,
  proof, and blockers. `src/lib/chatComputerHandoffContext.ts` carries that
  notice into live chat and `src/lib/persistedChatMetadata.ts` compacts it for
  reload/recovery, while safe read/search work stays hidden by default. The
  same handoff metadata also carries the compact evidence contract and compact
  app route decision for recovery and refresh enforcement.
  Compound computer requests also receive one request-level action-coverage
  contract before execution. `src/lib/chatMultiIntentCore.ts` conservatively
  recognizes adjacent imperative clauses across sequence words, lists, action
  commas, sentence-separated instructions, explicit temporal gerunds, and
  ready-state transitions; task/steps preambles do not hide the first verb,
  while object lists, questions, and narrative gerunds stay intact. Polite
  gerunds are normalized only inside an explicit
  `would/do you mind` request frame. `chatComputerRequestRouter` assigns the
  accepted clauses stable `A1…An` identities and explicit `then` dependencies.
  Those identities enter `chatAgentContextPack` acceptance criteria,
  `computerTaskEvidenceContract` proof-after and fail-closed rules, the compact
  plan preview, planner telemetry, and the persisted computer handoff. The
  outer task can be completed only after every A-id has independent fresh
  target-bound proof; otherwise the runtime must report completed, blocked,
  and pending IDs and keep the whole task non-complete. Overflow or truncated
  input requires decomposition from the intact request before any mutation.
  The ledger never grants tool authority or permits replay after uncertainty.
  A typed `completed` terminal is still insufficient by itself: action coverage
  promotes to verified only with runtime-owned `taskCompletionVerified: true`.
  The compiler-owned exact Photoshop and named-app lifecycle executors now mint
  that bit only through a WeakSet-branded single-use authority after their
  target-bound proof has reached a durable verified/completed acknowledgement.
  An authenticated completed-root refresh may mint a new in-process authority
  without dispatching again; copied objects, local success without the durable
  acknowledgement, and manual-verification outcomes remain non-complete.
  Cloud/local browser and generic agent loops therefore retain and display
  their useful result while compound runs lacking the outer receipt remain
  `partial`, with every A-id `outcome_unknown` and mutation replay disabled.
  The closed-world local-file exception is compiler-owned: an uncapped two to
  eight action ledger may run directly only when every clause is one
  independent explicit `list`, exact-path `read`, `search`, or `stat` action.
  `computerFileAdapter` executes the original A-id text in order through the
  desktop bridge only, requires the bridge to echo the exact request path or
  root/query, rejects missing/stale echoes, target drift, and truncated data,
  and stops before every later action after the first blocker. A fully verified
  sequence receives the same single-use outer completion authority. A partial
  read-only sequence persists only a value-free
  `verified* -> blocked -> pending*` projection; it cannot authorize a write or
  replace whole-task proof. Conditional controls
  such as `stop if CAPTCHA` stay attached to the action they constrain instead
  of becoming an impossible extra proof item. The shared executable gate stops
  a folded, truncated, over-eight-action, or over-4,000-character request before
  either local or remote dispatch; durable Chat metadata rebuilds the coverage
  snapshot from typed canonical fields. Mismatched/truncated saved action
  counts also require decomposition. Mutations, semantic analysis/summarizing,
  multiple operations folded into one clause, pronoun/dependency targets such
  as “then read it,” MCP fallback, and unmatched compound file tasks remain in
  the authenticated agent loop rather than borrowing this direct authority.
  The one-action shortcut uses the same explicit-operation, exact request-echo,
  non-truncation, and single-use outer-authority boundary; a generic MCP success
  is not proof of a named local file action. Untrusted file/provider text stays
  indented below the runtime-owned receipt, and the persistence formatter
  escapes its reserved metadata delimiter before adding the canonical suffix.
  `src/lib/computerTaskEvidenceContract.ts` adds the hidden execution proof
  contract for each route: observe-before, actionability, approval, proof-after,
  fail-closed, retry-evidence, and source-reference requirements. Pure desktop
  launch/focus/read contracts carry only exact app/window identity plus the
  smallest requested app-native or accessibility observation; file search/stat,
  mutation, browser fallback, export proof, and approval requirements appear
  only when the typed task actually needs them.
  `src/lib/computerTaskEvidenceRecovery.ts` classifies failed browser, local
  file, desktop, Photoshop, and InDesign runs against that contract so recovery
  options can distinguish fresh-evidence retry, user unblock, connected-agent
  adapter repair, and stop/report without parsing loose prose. It also emits
  required evidence tools and `missing` / `stale` / `ready` / `blocked`
  readiness state before a retry is allowed. Recovery also consumes the compact
  app route decision, so missing route confirmations become fresh-evidence
  requirements, missing approvals become approval boundaries, user-action
  blockers stop retries, and connected-agent buildout decisions become bounded
  adapter-repair options. If an older browser/computer-use failure path does not
  pass an explicit evidence contract, `chatFailureRecovery` infers the hidden
  chat computer route from the task text plus execution/source context and uses
  its contract before falling back to generic recovery.
- Strongly framed `Use`/`Open`/`In <App>` requests, including long-tail app
  names, stay desktop-owned and strip browser tools/fallbacks. Literal URLs,
  web-only apps, WordPress, transactional web intent, and browser-product
  navigation remain browser-owned. A strict lifecycle-only `Open Chrome`-style
  request targets the installed native app and does not add `browser.open_url`.
  Ambiguous lowercase long-tail lifecycle names enter this branch only on an
  exact normalized match in the refreshed bridge-online installed/running app
  context; unavailable names and offline stale inventories remain rejected.
  Finder/Preview/TextEdit file-shaped work stays local-file.
  The exact Photoshop compiler remains isolated from this generic routing.
  Docker Desktop and Microsoft Remote Desktop are exact app identities, not
  Desktop-folder references. Read-only named-app routes expose only
  launch/focus/wait/observation tools and must be rebuilt before mutation.
- `parseDirectDesktopCommandEnvelope` and
  `parseStrictNamedAppLifecycleIntent` in `genericAppNavigator.ts` are shared by
  routing, preflight, and the closed-world exact-program compiler. The envelope
  strips only a closed set of non-operational greetings, request courtesy/scope,
  `for me/us`, soft urgency/timing, and explicit local-desktop qualifiers.
  Combinations cannot change the action, exact target, approval, tools, or
  execution mode. Exact catalog/fresh observed identities are checked longest
  first, preserving real names that contain connector or modifier-looking
  words. Guidance questions, schedules, conditions, credentials, approval
  changes, generic nouns/files, and appended clauses remain material and do not
  compile. The route preserves the user's exact app phrase while resolving a
  separate canonical bridge/bundle dispatch identity; an exact observed
  lowercase-name match never bypasses those rejection guards.
  These reversible lifecycle-only programs require `desktop_control`, no
  approval, no clarifier, and no AI relay. Before desktop access,
  `computerTaskRuntime` fingerprints the originating Chat request, creates or
  recovers its authenticated root, and claims one request-only §26 activation
  action. That stable action key deliberately excludes the refresh-sensitive
  canonical app/program fingerprint: a post-launch case/spelling change finds
  the prior owner, while the separate exact program comparison fails closed
  instead of minting another action. The router's `open_or_launch` manifest
  exposes mutually exclusive conditions—launch and bounded wait only when the
  initial observation says stopped, or focus only when it says already running
  in the background. The adapter receives one `open_app` primitive and never
  performs launch followed by focus. Explicit focus blocks when stopped.
  Terminal action state makes a refresh/retry observation-only, so the same
  originating request cannot activate again. STOP yields a neutral typed
  `cancelled` result. Semantic reads remain model-assisted, and every document/
  UI mutation keeps its normal approval/evidence contract. This lifecycle slice
  is source/smoke/typecheck coverage current 2026-08-10; no updated live GUI,
  duplicate-refresh, bridge-restart, foreground-override, or competing-client
  validation is claimed.
- Authenticated non-exact app/file/hybrid computer turns require the canonical
  device-local typed tool loop through `AgentRunRequest.forceClientToolLoop`.
  That makes the runtime catalog containing Photoshop status/create tools
  authoritative even while the global client-loop rollout remains off, and it
  prevents an edge or relay failure from replaying the task through v1's
  execution-incapable text-only catalog. The relay retries bounded transient
  5xx/network errors. Ask-classified mutations proceed only as far as the
  named canonical handler's durable exact-call approval boundary; explicit
  user prohibitions still stop before handler entry.
- `computer_apps` is a desktop-only execution profile, not a hint. Its runtime
  guard is carried through the legacy and v2 typed loops, removes browser tools,
  `desktop.open_url`, and generic tool search from the advertised catalog, and
  rejects browser-named launch/focus/raise arguments before dispatch. Browser
  control is available only to an explicit browser or hybrid route.
- Compiler-owned exact programs bypass that relay only after their declared
  authorization policy passes. The Photoshop blank-document family runs
  status -> conditional launch -> status -> exact create -> final status. A
  closed-world unsaved draft at or below 4096 px per axis / 16 MP uses the
  current direct command without a redundant approval; larger allocations keep
  the one-shot Chat approval, and appended/unknown actions cannot inherit the
  direct authority. It does not request local-file evidence, generic UI planning,
  or a connected-agent buildout. Its task card is likewise reduced to
  Status -> Prepare -> Create -> Verify, with exact dimension proof and no
  source-file, layer-review, export, or handoff phases. The executor persists an
  authenticated root `agent_runs` row before desktop access and issues a
  compiler-scoped dispatch capability for the exact program. The create action
  then uses §26 claim -> start -> finish, so a duplicate under that same root and
  action cannot enter the bridge. A missing post-create receipt remains outcome-
  unknown and disables automatic replay. When the exact plan requires and files
  approval, `computerTaskState` persists only a bounded credential-free
  correlation to the exact approval row, requester/circle/thread, expiry, and
  program/request/intent fingerprints. After a full Chat-tab refresh, hydration,
  bounded polling, or Realtime only triggers an exact authenticated row requery.
  The normal gate recomputes every fingerprint and must win the one-shot consume
  compare-and-set before the handler clears the correlation and may touch the
  desktop. Rejected, expired, stale, consumed, legacy, or mismatched rows
  terminalize without replay. Office/another client still has no cross-surface
  execution continuation; that broader durable coordinator remains pending.
  The same bounded polite-command envelope recognizes natural
  `Can/Could/Would you ...` and `I need you to ...` wording without widening the
  exact Photoshop action whitelist. This 600x600 document compiler remains
  separate from the router-owned lifecycle-only dispatcher.
  A separate Chrome-free terminal drill is available through
  `npm run drill:photoshop-exact`. Its default mode is a non-mutating dry run;
  explicit `--live` plus the current dry-run confirmation fingerprint is
  required before it can use the fixed loopback desktop bridge. The drill
  derives the exact program manifest from the production compiler, requires
  strict Photoshop identity and positive foreground evidence, and permits
  exactly one create dispatch. `smoke:photoshop-exact-drill` checks the drill;
  the separately required `smoke:computer-task-runtime-context` independently
  pins production retry, STOP, identity, and exact-proof source behavior. They
  do not share an execution helper or constitute end-to-end production parity. After
  a positive named create receipt, both the production executor and drill make
  no more than three fresh, read-only app-native status checks at 250 ms
  intervals; that invocation's proof loop never re-enters creation. Success
  requires the exact created document name and requested dimensions. Production
  fingerprints the originating Chat message/submission plus the program and
  preserves it across approval/capability re-entry, reusing the matching root
  and §26 action. Missing, legacy, or mismatched request identity stops before
  root creation and desktop access. A separately submitted user message is
  intentionally a distinct request/root. When an exact program needs approval,
  `computerTaskState` retains a bounded credential-free correlation for the
  exact row, authenticated requester/circle/thread, session/action/expiry, and
  program/request/intent fingerprints. A full Chat-tab refresh performs an
  exact row requery, with bounded polling and Realtime used only as requery
  triggers. Approval resumes the original request through the normal
  re-fingerprinting and one-shot consume gate; the correlation remains durable
  until that gate wins, then clears in the handler before any computer action.
  Rejected, expired, stale, consumed, legacy, or mismatched rows terminalize
  without replay. Cross-process restart and live competing-client/database
  contention still require proof. Its source contracts are pinned by
  `smoke:exact-program-authority`, `smoke:computer-task-runtime-context`, and
  `smoke:computer-task-state-provider`, `smoke:chat-lane-outcome`, and
  `smoke:photoshop-exact-drill`. On 2026-08-05 one live invocation made one
  create call and zero browser calls. Its original strict immediate proof was
  stale and the drill exited `verification_incomplete`; a separate fresh
  read-only status then proved Photoshop frontmost with `Untitled-1` active at
  600x600. The status-only retry was added from that result and has not been
  exercised by another live create. This scope does not include the
  authenticated Chat UI, approval filing/consumption or persistence,
  message/Realtime continuity, or browser focus/event wiring.
  Live Chat validation on 2026-07-31 started from Photoshop
  `appRunning:false`, submitted the exact 600x600 request through the refreshed
  authenticated UI, created no approval row, persisted one completion, and
  finished with app-native proof for `Untitled-1` at 600x600, RGB, 72 ppi, and
  one layer. After refresh, an exact `chat.run_computer_task*` approval can
  rehydrate only its bounded credential-free correlation and resume through an
  exact authenticated row requery plus the normal one-shot consume gate; raw
  task text is not persisted as authority. A newer
  same-thread completion never suppresses an approval by chronology alone
  because the thread may contain unrelated tasks.
  Timeline reconciliation never compares prompt wording, normalized request
  text, inferred structure, or a shared chat-turn id. An older ready/approval
  design card becomes `Superseded` only when a later structured, verified
  completion shares its exact immutable run id or explicit request id. Without
  exact lineage, it becomes `Historical` only after a newer human turn from the
  same stable author; another member's later turn cannot deactivate it. New bot
  rows persist `requestAuthorId`, so interleaved shared threads do not infer
  ownership from message proximity; ambiguous multi-author legacy rows fail
  open as `Current`. A
  metadata-free legacy row is eligible only under the strict desktop-plan
  fallback: approval/readiness language plus `Approve desktop run`,
  `desktop-app path`, `app-native tool`, or `desktop.*`, with failure and
  blocked states excluded. That fallback may become only `Historical`, and only
  after a newer same-author turn. `Superseded` and `Historical` rows keep phase,
  proof, review, and browser-session evidence visible while disabling approval,
  launch, verification retry, recovery, run-stop, and run-again mutations.
  Deployments that still enforce `messages.content <= 1000` use a separate safe
  persistence fallback. `persistedChatMetadata` builds a bounded, redacted
  source/status/lineage envelope, fits visible text around complete JSON, and
  parses it before submission; if that cannot fit safely, it emits an explicit
  marker-free text-only row. `chatService` releases the recoverable local
  pending row only after the database response strictly round-trips every
  present local-message, run, request, requester, status, and source field, or exactly
  matches the submitted marker-free text. Truncated or parseable-but-mutated
  metadata is not acknowledged.
  Typed-batch and outer failures finalize through the same durable pending-row
  helper; verification retries also update the saved message. Message Realtime
  listens for INSERT and UPDATE through the reconnect/catch-up owner and
  rehydrates the complete envelope into existing rows. Authoritative bounded
  snapshots repair a missed DELETE. A metadata-free bot UPDATE explicitly
  clears stale structured actions, so another mounted client cannot retain
  unproven controls.
  A computer result that may have dispatched mutation but lacks final proof
  carries structured `manual_verify_only` replay policy, `mutationDispatched`,
  and a bounded read-only verification-tool allowlist through persistence and
  refresh. Chat removes approval, retry, recovery, app-choice, preflight,
  quick-reply, run-again, and cross-surface mutation controls in that state;
  only the declared observation may run. That single-use observation is bound
  to the original requester, current task, exact bridge process instance, and
  exact target; scope is rechecked after every await and before persistence.
  Copy is never replay authority.
  Chat passes the raw utterance to classification/compilation and keeps any
  dispatch prefix as non-semantic notes, so this ordered sentence is never
  split into an artificial `Open Photoshop` ask. The web composer has no
  automatic focus claim and is blurred only immediately before native desktop
  dispatch. The exact executor positively proves Photoshop foreground before
  create and after final status; at most one semantic focus plus one follow-up
  observation is allowed at either boundary, with no coordinate fallback.
- Native browser execution uses `supabase/functions/computer-use-agent/index.ts`
  and Browserbase.
- The older `src/lib/computerUse.ts` lane cannot safely execute any of its six
  mutations because it does not carry genuine authenticated user/circle/
  persisted-run identity, provider `toolUseId`/iteration, durable action
  claim, and exact OpenSwan approval. Planned `navigate`, `click`, `fill`,
  `select`, `press_key`, and `scroll` actions therefore fail visibly as
  value-stripped structured non-executable typed OpenSwan handoffs before
  screenshot, Stagehand, MCP, or bridge mutation I/O. They must continue as
  fresh Chat/OpenSwan typed calls and never fall back to a legacy/raw path.
  Saved-plan replay preflights the whole plan and permits only the reviewed
  observation allowlist.
- Local app/browser/file awareness uses bridge tools and
  `src/lib/localComputerAwarenessIntent.ts`.
- `src/lib/computerCapabilityExpansion.ts` is the pure planner for deciding
  what to build next when a computer/app/browser task needs more coverage. It
  maps task text and current capability readiness into browser semantic
  actionability, browser protocol inspection, desktop semantic control,
  app-native adapter, local-file grant, and connected-agent buildout lanes, each
  with source refs, proof requirements, and focused smoke commands.
- Native browser popups are handled by a guarded modal-advisor path:
  `src/lib/browserAIModalAdvisor.ts` defines the LLM prompt and validator,
  while the local browser bridge treats JavaScript alerts/confirms/prompts as
  blocking evidence. Safe alerts can be acknowledged, requested-output
  overwrites can be accepted only when the task names that output file, and
  credentials, MFA/CAPTCHA, payments, publishing, deletes, unsaved changes,
  prompt input, or vague confirmations stop with a concise user decision.
- Desktop app popups use the same guarded policy through
  `src/lib/desktopAIModalAdvisor.ts`: read accessibility text and visible
  buttons first, allow safe acknowledgements, allow requested-output
  overwrites, keep requested file extensions such as `.png` on macOS extension
  mismatch prompts, and stop for credentials, payments, publishing, destructive
  actions, unsaved changes, or ambiguous choices.
- Desktop app execution strategy is selected through
  `src/lib/computerAppTaskStrategy.ts`, preflighted by
  `src/lib/computerAppPreflight.ts`, grounded by
  `src/lib/computerAppGrounding.ts`, and given app-specific prompt contracts by
  helpers such as `src/lib/designAppAutomation.ts`.
- `src/lib/computerAppGrounding.ts` also owns the pure hard-contract foundation
  beneath those prompts: a short-lived observation epoch identifies the exact
  app/process/window/document or browser session/tab and exposes an explicit
  revocation function that callers must invoke after focus, navigation, modal,
  or mutation changes. A proposed mutation carries the matching target, a
  deterministic secret-safe fingerprint derived from canonical normalized
  arguments, runtime-issued exact-call approval policy, idempotency key,
  verification predicate, and safe outcome-unknown policy. Unknown mutators
  default to reviewable medium risk, duplicate/capacity in-process
  authorization fails closed, and a single-use sealed wrapper rechecks
  observation/policy expiry before recording actual handler entry. Completion
  requires a distinct newer runtime-issued after-state with complete target
  identity.
- Typed OpenSwan `browser.fill_field` is one of three integrated browser consumers
  of that contract. `agentExecutionCore` first reserves a bounded provider-issued
  `toolUseId` for the full run and gives the handler the exact tool/id/iteration
  context. The runtime then canonicalizes one exact non-secret draft, takes a
  fresh DOM observation, then asks `POST /browser/fill_target` to resolve and
  inspect exactly one field before the approval lookup. The browser bridge
  issues opaque process/context/live-document identity (`pageId` rotates on
  navigation or reload), binds the current URL, and returns a short-lived,
  single-use `targetId` backed by that exact ElementHandle plus an HMAC
  privacy-safe v2 `targetFingerprint` over inspected semantics and keyed
  document/node/frame structure. The id is dispatch-only and is excluded from
  durable approval, receipts, and model output. Approval stores SHA-256
  bindings for the exact normalized intent and page URL plus bounded safe
  origin/length and opaque process/context/page/fingerprint metadata; raw draft
  text, URL path/query/fragment, locator, and task context are not persisted.
  It still requires a genuine receipt backed by an `agent_run_approvals` row.
- The source-default SwanBot v2 edge schema for `browser.fill_field` is now
  lockstep with that sealed contract: one exact accessible `name` xor CSS
  `selector`, optional `textbox`/`searchbox` role, bounded non-secret `text`,
  optional bounded task context/exactness/timeout, and no submit field or
  unrecognized properties. It cannot model a credential fill, dropdown
  selection, or submit side effect through the generic text-fill shape. The
  edge schema, app normalizer/sealed runtime, browser client request builders,
  and bridge target/perform endpoints independently enforce exactly one locator
  (`name` XOR `selector`); both-present and neither-present inputs fail before
  observation or dispatch.
- Guarded handler entry consumes the target id once. It rechecks the live
  identity, target fingerprint, direct attributes, associated label text,
  `aria-labelledby`/`aria-describedby` text, and containing-form context for
  credential/recovery/seed/private-key/payment/CVV signals before filling.
  App-side and bridge-side classifiers also reject obvious secret-bearing draft
  values without reflecting them. The mutation action SHA-256-binds the exact
  transient dispatch args; the sealed dispatcher recomputes that digest from a
  deep-frozen clone, invalidates the bound observation epoch, and passes only
  those sealed args to the handler. It reads the same handle first and skips
  `fill()` when the value already equals the approved draft, avoiding duplicate
  input/change handlers after an outcome-unknown attempt. Whether skipped or
  filled, proof uses one renderer capture of value, semantics, document, node,
  and frame state bracketed by stable browser identity checks. Proof contains
  only the approved fingerprint, `valueMatches`, bounded
  actual/expected lengths, a `mutationPerformed` boolean, and observation
  identity. The filled or observed value and ephemeral id are never echoed. Navigation, page/context close,
  bridge restart, capability expiry/replay, detachment, or target drift fails
  closed and requires a fresh target observation.
- Typed OpenSwan `browser.set_toggle` is the second sealed consumer, and the
  SwanBot v2 client catalog routes it through the same exact tool/id/iteration
  gateway. It accepts only one checkbox, switch, or radio plus an explicit
  boolean state. Model normalization and bridge inspection both require
  positive presentation/accessibility semantics; account, authentication,
  security, privacy, sharing, subscription, notification, network, payment,
  destructive, publishing, messaging, and unknown settings fail closed. Its
  approval card stores a bounded secret-redacted target summary plus digests
  and opaque identity, never the raw selector, task context, full URL, or
  one-shot target id. The bridge verifies the exact same handle before replay,
  clicks it at most once only when state differs, and proves the final boolean
  without submitting or navigating. Generic `browser.click_role` now inspects
  its resolved handle and refuses native/ARIA state controls, their labels, and
  descendants even when caller role or selector semantics are spoofed.
- Typed OpenSwan `browser.select_option` is the third sealed browser consumer.
  It accepts one native single-value `<select>` and one exact option value or
  label, takes a fresh dedicated target/option observation, binds the same
  exact provider-call and approval identity, selects at most once, and verifies
  the exact option on the same live handle without submitting or navigating.
  Multi-select, ambiguous options, protected/unknown settings, stale handles,
  and target drift fail closed. Generic click refuses select/combobox/listbox/
  option targets, labels, and descendants, so raw click cannot bypass this
  dedicated stateful lane.
- `src/lib/agentActionCalls.ts` and the §26 `agent_action_calls` RPC contract
  provide the durable cross-process boundary for fill, toggle, select, the
  native semantic press, `desktop.open_path`, manual automation file writes,
  and approval-gated external edge mutations. An authenticated claim binds
  user, circle, persisted
  run, tool, provider `toolUseId`, action id, argument fingerprint,
  authorization-contract fingerprint, and idempotency key; no raw args,
  selector, URL, text content, or unrestricted metadata is stored. The exact
  transition is `claimed → dispatched → verified / outcome_unknown`; `failed`
  is valid only while the row is still undispatched `claimed`.
- Handler entry atomically records `dispatched`, and duplicate or terminal
  calls never invoke the bridge handler. Concurrent claimers may receive the
  same token, so a worker that loses before its callback leaves the claim
  unfinalized/reclaimable instead of overwriting another worker's dispatched
  action. Once start is confirmed, any error maps only to `outcome_unknown`.
  Verified fresh proof remains `ok: true` if final database acknowledgement is
  unavailable, but the runtime warns that the exact call remains replay-blocked.
  The TypeScript parser independently rejects a forged `failed` row with a
  non-null `dispatchedAt`.
- Approval rows remain the durable authorization source. The hidden tool-event
  receipt replaces the canonical approval key/args with a privacy-safe digest
  and is stripped from model-visible raw/formatted results. All five guarded
  canaries emit issued mutation-dispatch and computer-app verification
  receipts; `agentRunPersistence` stores only their bounded primitive
  allowlists. SwanBot continuation transport carries only those sanitized
  subsets outside model content, re-sanitizes them at the edge, and persists
  correlated client result events on resume.
- SwanBot v2 and OpenSwan converge in source on this canonical typed runtime.
  The default edge continuation client merges hard constraints parsed from the
  raw turn with richer upstream constraints, then runs the executable
  constraint/always-confirm floor before an optional live exact-call review
  callback. Missing required approval, rejection, and callback exceptions fail
  closed before handler entry. When a review callback is present, calls are
  serialized so concurrent approval prompts cannot reorder user decisions. A
  non-empty always-confirm floor applies to every non-read browser/desktop call,
  including bland or opaque keypresses and unknown/future mutations without
  keyword-bearing arguments.
- The computer-task forced-local lane is narrower than the global SwanBot v2
  rollout. Ordinary chat still follows the v2 preference/circuit flags. If the
  required local loop cannot start or exhausts its relay retries, Chat receives
  a stable `client_tool_loop_unavailable` error and no v1 replay occurs.
- Every browser/desktop mutation currently registered as client-delegated in
  SwanBot v2 is intercepted before the raw browser/desktop dispatchers and
  enters `executeOpenSwanRuntimeTool` with the provider name, tool-use id, and
  iteration. The five guarded canaries retain their sealed action, durable call,
  and sanitized hidden-receipt contracts. Other current mutations gain the
  canonical policy/approval chokepoint, but that does not retroactively give
  them the canaries' proof contract or establish a universal gateway for future
  tools, direct callers, or new mutation families.
- Fresh v2 Chat requests carry the active thread only from authenticated client
  context. The edge authorizes that exact user/circle/thread before model or
  tool work, seals the thread identity inside the encrypted continuation, and
  restores it on resume. `messages.create` fails closed if thread identity is
  absent or if a model argument disagrees, and its service-role insert uses only
  the pre-authorized `thread_id`. This source contract closes the observed
  `messages?select=id` 400/default-thread misrouting seam; deployed-edge and live
  §31 behavioral proof remain pending.
- Each paused edge turn minimizes and AES-256-GCM seals its exact model/tool
  snapshot through `_shared/swanbot-continuation-crypto.ts`; the public
  `agent_runs.metadata.continuation` field is a value-free CAS envelope, not a
  plaintext snapshot. It exposes only bounded identity/version/nonce,
  resume/claim state, counters/tool identities/timestamps, an `expiresAt`
  exactly ten minutes after `pausedAt`, and the authenticated ciphertext
  envelope. Public `agent_run_events` tool inputs are value-free structural
  schemas and failures use stable redacted codes/copy; exact arguments/errors
  remain transient for live approval, dispatch, proof, and model-loop work.
- Deployments must explicitly set a dedicated
  `SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and
  `SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`; never derive or reuse the
  service-role key or another shared credential. The source `v1` fallback is
  not a rotation configuration. Without the encryption key, SwanBot withholds
  all `clientOnly` tools before the model turn and dispatches no local action.
- Before local execution, a client-generated exact claim compare-and-sets
  `pending` / `client_pending` to `dispatch_claimed` /
  `client_dispatching`; only the exact echoed claim may enter a handler. Exact
  results then compare-and-set that state to `results_claimed` /
  `client_resuming` before model resume, and the result claim binds every
  next-pending or terminal write. Only an exact same-claim dispatch retry
  carrying the already-winning claim is idempotently acknowledged. A competing
  claim, mixed protocol/state, acknowledgement ambiguity, expired lease, failed
  claim-bound transition, or post-claim loop error becomes
  `outcome_unknown` with no reopen or automatic replay. Readiness ignores all
  three active stop-reason rows: `client_pending`, `client_dispatching`, and
  `client_resuming`. Pending, checkpoint-failure, continuation-close/seal,
  cancel, failure, and terminal writers normalize a complete run summary:
  array `tool_calls`, `iteration_count >= 1`, and finite nonnegative
  input/output/cache token fields. The hardened summary/checkpoint/close/CAS
  writes log only a bounded operation name and safe machine code; older
  claim/event logging elsewhere in the Edge remains outside that guarantee.
- Terminal success is proof-bound, not prose-bound. A dispatched
  client-delegated mutation with `ok: false`, missing accepted verification, or
  outcome-unknown latches across continuation rounds and cannot be converted
  to completion by model `end_turn`; the edge persists failed/no-replay,
  suppresses a completed Feed card, and returns a structured non-fallback 409.
  Fresh terminal compare-and-set results are inspected and exactly reread:
  late user cancellation wins, while any other ambiguity stops before
  publication. The client treats `cancelled: true` as a neutral reached-edge
  terminal regardless of empty/nonempty model text, so STOP cannot fall
  through to v1 or count against the transport breaker. Other reached-edge
  empty terminals are also non-fallback. Direct WordPress/workspace mutation
  handlers stamp value-free receipts immediately before their provider/DB/UI
  boundary and require concrete returned identity/state for completion;
  unsupported after-state proof remains outcome-unknown. The immutable
  `turnRequestId` survives every fresh pending/terminal/cancel/failure metadata
  update, so lost-response retries collide before another model/Feed run.
- A fresh modern v2 turn sends one client-generated UUID `turnRequestId` on
  every transport attempt and the edge inserts it as `agent_runs.id`; a
  duplicate collides before model/tool work. Legacy/no-identity starts have
  server writers withheld. Those memory/task/mission/message/room/approval
  writers also latch before handler entry. If a later provider/runtime failure
  makes the write ambiguous, v2 persists `server_mutation_outcome_unknown`
  with `replayAllowed: false` and requires verification before new action.
  The client recovers that structured non-2xx error before the v1 fallback
  branch, preventing a completed write from being retried under a new run.
- Section 29 defines a service-role-only atomic sweep for active unsafe or
  expired SwanBot continuations. Its named `pg_cron` job runs every three
  minutes when cron exists and emits a stable NOTICE otherwise. Missing,
  legacy/plaintext, malformed, state-mismatched, or expired active checkpoints
  lose the continuation and receive only a value-free
  `continuationResumeOutcome` with `replayAllowed: false`: `client_pending`
  becomes `failed_before_dispatch`, while
  `client_dispatching`/`client_resuming` become `outcome_unknown`. The
  migration separately performs a one-time terminal/non-active checkpoint
  scrub. AES-GCM additional authenticated data binds the canonical exact
  run/user/circle row without exposing those identifiers in the public
  envelope, so cross-row ciphertext transplantation fails closed. A §29
  protected-row trigger rejects authenticated INSERT/UPDATE/DELETE attempts
  against active SwanBot v2 continuations while preserving existing reads,
  service-role/Postgres maintenance, and only the exact owner STOP transition
  plus one write-once bounded cancellation-provenance merge. Swept terminal
  rows also repair the existing tool/iteration/token summary columns to safe
  shapes without copying those values into outcome metadata.
- Legacy `computerUse.ts` is now observation-only: all six legacy Computer Use
  mutation kinds—`navigate`, `click`, `fill`, `select`, `press_key`, and
  `scroll`—become value-stripped, non-executable typed OpenSwan
  handoffs before screenshot, Stagehand, MCP, or bridge I/O. Recording replay
  preflights the complete plan and runs zero steps if any browser/desktop
  mutation is present; only a reviewed observation allowlist can replay.
- Hosted Browserbase Computer Use is separately source-hardened as of
  2026-07-26. `computerUseAgent` carries a bounded schema-v1 execution-policy
  envelope that the edge validates before provider/session work.
  Authenticated Chat/queue starts require an interactive envelope;
  watch/service calls are forced scheduled observation-only, and authenticated
  legacy callers without the policy receive HTTP 400. All three root Chat
  starts—automatic browser launch, booking-session continuation, and manual
  approved launch—preserve router-derived user constraints and the
  opaque-target/credential/external-side-effect confirmation floors. The
  single-task and queue hooks acquire synchronous start reservations before
  imports or credential lookup, count pending reservations against capacity,
  and invalidate them on cancellation/clear.
  Cloud handles, local browser sessions, and pending permission dialogs are
  owned by the exact mounted thread/user/circle. Scope changes cancel and clear
  those owners before hydration, invalidate late callbacks, and convert an
  orphaned durable `executing` row to blocked/unverified instead of presenting
  a false resumable run. Capability polling uses stable checkpoint identity,
  approval submission has a synchronous double-click reservation, and animated
  Computer Use status/particle loops stop on cleanup without changing hook
  topology.
- The cloud edge treats left/right/double click, type, key, and saved-login
  filling as mutations and treats unknown native actions as blocked mutations.
  Every current opaque coordinate/focus call requires durable exact-call live
  confirmation, including when a pre-run grant exists. Approved work requires
  a fresh pre-action screenshot, one-attempt mutation dispatch, and a fresh
  post-action screenshot. Missing pre-proof blocks before dispatch; ambiguous
  post-dispatch state ends `mutation_outcome_unknown` with no replay.
  Type/key/credential/question inputs are redacted or suppressed across SSE,
  progress/action traces, model history, guided replay, stuck-solver payloads,
  usage metadata, and errors.
- Root Chat's `computerTaskRuntime` no longer calls the deterministic app
  adapter or bridge open/wait helpers for generic/model-planned work before
  authenticated `executeAgentRun`. Read-only live observation may remain
  before the loop. A compiler-owned exact program is the deliberate exception:
  after its closed-world direct-request or SHA-bound Chat-approval policy
  passes, the local handler executes once and requires fresh app-native proof. This
  removes broad pre-agent app-adapter and attachment-open bypasses without
  forcing simple exact tasks through an unavailable AI relay. Uploaded desktop
  files remain staged and return a
  value-free, non-executable `desktop.open_path` handoff without raw path,
  identity, approval, receipt, or proof. Exact staged context remains only in
  the authenticated task prompt and is redacted from result,
  capability-buildout, and action-trace telemetry.
- Approval authority is exact and one-use across the audited chat surfaces.
  Chat SHA-binds the complete normalized plan plus user/circle/thread/room and
  consumes `agent_approvals.applied_at` before one transport dispatch.
  Deployments that specifically lack that additive column use a guarded legacy
  compatibility path: the same exact fingerprint lookup omits only
  `applied_at`, then atomically transitions `approved`/`auto_approved` to
  terminal `consumed`. All unrelated lookup, RLS, network, or schema failures
  still fail closed, and §10b/§28 remains the target database authority.
  `HitlApprovalBanner` sends runtime-owned Chat/scheduled rows back to their
  runners instead of the generic apply worker; the worker's real
  `chat.review_comment` handler is explicitly excluded from that predicate.
  OpenSwan SHA-binds canonical tool arguments plus authenticated run/provider
  call identity and atomically stamps one dispatch binding. SwanBot WordPress
  writes and its generic risk floor use the same schema-v2 digest and claim
  semantics. Durable/model-visible payloads contain only bounded labels and
  safe digests, never raw commands, paths, values, credentials, or canonical
  approval keys.
- `src/lib/approvalEffectPolicyCore.ts` is the canonical dependency-free effect
  taxonomy beneath category auto-approval, sticky scopes, unified/tool policy,
  OpenSwan approval batching, and exact tool-call approval classification.
  Only observe, exact lifecycle, and positively identified reversible
  non-secret effects are category-auto eligible. Persistent, external,
  credential/login/payment/purchase/publish/send/delete/private-file/
  permission/security/destructive, ambiguous, and unknown effects require
  exact outcome authority. All existing persisted Chat computer mutation
  categories currently map to that exact side, so broad site/app standing-grant
  creation is paused, forged or legacy scopes hydrate to no authority, stored
  broad auto preferences clamp to ask, and the Permissions form stays hidden.
  The exported prompt-budget descriptor is explicitly not runtime-integrated.
- `openswanToolApprovals` also owns an inert V1 Chat plan-to-tool manifest. It
  binds up to 32 ordered entries to one root and request plus exact tool+args
  and current-policy digests, stores no raw arguments, and marks the first hard
  floor plus every later action `final_confirmation`. Validation proves only
  canonical integrity; the unkeyed digest is not a signature or dispatch
  authority. Runtime issuance, catalog revalidation, atomic consumption, and
  persistence/rehydration remain Phase 4 work.
- The default SwanBot v2 edge continuation uses the current catalog policy
  before client dispatch. A present review callback no longer prompts auto/read
  tools, runtime-owned ask calls do not receive a duplicate surface prompt,
  direct ask calls require one exact review, and missing policy fails closed.
  Only batches that can actually reach the surface callback are serialized.
  The device-local typed loop and legacy v1 review path still need the same
  policy-aware UX convergence audit.
- Durable OpenSwan/subagent tool-call telemetry is value-free as well:
  `eventBoundCore` persists only bounded field/type/shape summaries, collapses
  unknown result/output/data/content/path fields to a value-free result schema,
  and permits receipt metadata only through exact namespace/field/type/value
  allowlists. `agentRunSystem.addStep` independently reapplies the same fresh
  projection at the final `agent_run_steps` insert boundary for tool input,
  tool output, tool-bound metadata/title/body, and malformed tool names. The
  Run History drawer projects each whole tool step to controlled labels and
  hides legacy raw name/title/body/output fields; non-tool message/plan
  metadata/title/body remains compatible. Exact arguments/results remain
  transient for approval, dispatch, proof, and model work; `event-bound-core`
  guards this in readiness and both release gates.
- Legacy direct local-file, image-conversion, and diagnostic launch paths
  return only value-free, non-executable typed-tool handoffs. The executable
  `desktop.open_path` gateway instead requires a fresh exact stat and path
  digests, authenticated run/provider call, exact approval, §26 claim/start,
  one bridge attempt, and a fresh exact frontmost-app proof. Ambiguity seals
  `outcome_unknown` and cannot replay.
- `automation-executor` keeps service/scheduled invocations read-only. A manual
  room-file mutation needs exact fresh single-use authority plus the §26
  ledger. Every scheduled external action separately needs fresh per-occurrence
  approval, one durable claim, and one dispatch. Timeout or any post-dispatch
  error persists `outcome_unknown`; the Pending Actions UI shows a redacted
  verify-first roadblock with no retry, and recurrence starts without reused
  authority.
- Office Realtime payloads are advisory wakeups only. After client
  authentication/shape checks, §28 `invoke_agent` locks the exact durable
  message/circle/expected command, verifies membership plus owned
  target/scope, and returns canonical command/sender/targets/model. Claims are
  idempotent per message and agent subject, including synthetic `blackswan`;
  stream/completion writes require the same claimant, membership, live state,
  bounded payload, CAS, and multi-target completion coverage.
- Section 28 also validates allowlisted schema-v2 payloads and immutable
  bindings for protected `chat.*` `agent_approvals` and tool-digest
  `agent_run_approvals`. Resolution is member-only while pending and stamps the
  resolver server-side; expiry/one-shot consume is requester-only; protected
  rows cannot be deleted or converted from legacy v1. Legacy unrelated and
  scheduled rows remain outside those trigger predicates.
- Source catalog parity is pinned at **25 server-side + 59 client-delegated =
  84 total**. `browser.wait_for` and `browser.scroll` provide bounded semantic
  synchronization/viewport control through the canonical client runtime. Both
  require the complete opaque process/context/page/process-HMAC-URL identity
  from one fresh DOM snapshot. The bridge retains that concrete page reference
  and exact-checks active tab, process, context, page id, and opaque URL before
  and after the operation; navigation, same-URL reload, SPA URL drift, tab
  switch, close, and bridge restart fail closed. Element waits call an exact
  ARIA role/accessibility-name locator directly, so a CSS-looking name cannot
  become selector authority. Scroll accepts only semantic direction plus a
  coarse amount and dispatches exactly one bounded wheel gesture. The bridge
  keeps the before/after viewport position private and may take up to three
  read-only settle samples after the gesture; it never dispatches a second
  scroll while verifying. Completion requires requested-axis
  `movementVerified:true`. No movement or an already-reached boundary returns
  `browser_scroll_verification_failed`; recovery requires a fresh DOM snapshot
  or screenshot before deciding whether another bounded gesture is safe, never
  blind replay. Results expose only redacted opaque identity/time/evidence and
  semantic movement proof—not raw coordinates, deltas, or viewport geometry.
  `browser.locator_actionability` is a read-only advisory
  observation for one fresh exact target, not authorization or target binding
  for a later mutation. The bridge-side `browser.dom_snapshot` walker redacts
  every editable value before transport; skips hidden, inert, and executable
  source descendants; canonicalizes bounded roles; and returns only controlled
  field structure and lengths. Entry/capture/exit identity checks bind the tree
  and title to one exact process/context/page/URL. The model sees an HTTP(S)
  origin-only display URL; exact actionability drift checks use a
  process-scoped HMAC URL identity. HMAC identities rotate on bridge restart,
  and raw/forged legacy URL identities plus non-HTTP snapshots fail closed. The
  device-local typed client remains opt-in/default-off. The 2026-08-05 live
  report verified that deployed SwanBot v1/v2 functions existed with the
  expected JWT modes, required secret names, production-origin CORS, §31 Chat
  catalog, and §32 readiness RPC; it passed all 18 dependency checks. That
  deployment snapshot is not a code-hash or 84-tool parity proof for the newer
  source in this worktree, which still requires deploy/re-verification.
  Historical production telemetry is incomplete and still blocks operational
  sign-off. §29 remains unapplied, so encrypted resume/key rotation, claim
  races, three-minute cron expiry, and historical checkpoint scrubbing remain
  unproven. A live exact Photoshop run created and app-natively verified a
  600x600 scratch document while Photoshop stayed frontmost; arbitrary native
  semantic input, Browserbase/confirmation integration, and the updated
  `computer-use-agent` deployment remain unproven. Its HTTP 400 for
  authenticated legacy callers without a v1 policy is intentional.
- Native `desktop.click_element` is a narrow semantic-press canary, not a
  general desktop click gateway. It observes a fresh indexed accessibility
  tree, binds exact app/PID/path/role/label/fingerprint identity, proposes one
  low-consequence target, requires a genuine exact approval, performs one
  target-bound press, and accepts completion only when a refreshed observation
  proves that exact target disappeared or changed semantics. Coordinates,
  ambiguous targets, stale indexes, target drift, consequential actions, and
  arbitrary desktop mutations remain outside this lane.
- Native `desktop.launch_app` and `desktop.focus_app` use one proof-bearing
  helper across the deterministic adapter, typed OpenSwan, and SwanBot v2.
  Every mutation takes a fresh before/after observation, resolves only an exact
  installed name or bounded explicit alias, binds a positive PID for running
  targets, rejects dispatch identity swaps, no-ops when the postcondition
  already holds, and marks attempted-but-unverified work outcome-unknown with
  replay disabled. Bridge acknowledgement alone is not completion. The
  reversible lifecycle step needs no separate approval through either an
  authenticated persisted run with exact provider tool-call identity or the
  strict Chat compiler's immutable direct-request program through the paired
  local bridge. Launch proves the exact app is running and focus proves it is
  running and frontmost. A lifecycle-only command may name an installed native
  browser product, but URL/navigation work remains browser-owned. This is
  bounded activation proof, not a general sealed native mutation gateway.
  The strict Chat lifecycle program additionally binds the originating request,
  authenticated root, and request-only §26 activation key. `open_app` chooses
  launch/wait or focus from the initial observation and cannot execute both;
  explicit focus never launches. A duplicate refresh sees the prior action and
  cannot activate again, while canonical-name/program drift fails closed. These
  newer guarantees are source/focused-smoke only.
  The requested activation may foreground the exact target once at its bounded
  action boundary. If the user switches to Terminal or another app afterward,
  that foreground change is a human interrupt: the task pauses/fails closed and
  must not poll, retry, or raise either the target app or Chat browser again.
  Generic app workflow recovery now carries that same verification-only rule
  instead of recommending an automatic refocus or relaunch; durable foreground
  lease wiring is still pending.
- `computer_files` uses the parallel `local_file_only` execution ceiling.
  Scoped `desktop.file_*`, `desktop.open_path`, Preview, and other non-browser
  native apps remain available; browser tools, URL opening, generic search,
  and Chrome/Safari launch, focus, or window raising are rejected before
  dispatch. The outer Chat automation planner projects the embedded canonical
  route, risk, and approval decision instead of restoring a browser label or a
  redundant plan approval around a native/local sequence.
- `/desktop diag` is an authenticated read-only health/pairing/running-app
  probe. Supplying an app (`/desktop diag <app>`) still performs no launch,
  focus, open, click, or type mutation; it returns a value-free,
  non-executable `desktop.launch_app` typed-runtime handoff that requires a
  fresh authenticated run, provider call identity, exact approval, dispatch
  receipt, and post-launch focus proof.
- The sealed browser gateway covers
  non-submit/non-credential fill, clearly local presentation/accessibility
  toggle, and one exact option in a native HTML single-value select; the native
  gateway covers one exact low-consequence semantic press plus fail-closed
  dispatch protection for 11 generic typing, paste, keys, menu, bounded
  coordinate/mouse-gesture, and scroll actions. Each guarded call requires an
  exact freshly observed app name, process, and surface before approval; stable
  exact-call approval binding; a private one-shot handler-entry recheck; and
  §26 claim/start before one bridge attempt. Coordinate and mouse actions also
  require live screen bounds and a visible exact-app window. PID, surface,
  bounds/window, args, TTL, clone, or replay drift stops before mutation.
  Acknowledgement-only endpoints return `ok: false`,
  `completionVerified: false`, and `outcomeUnknown: true`, then seal
  replay-blocked `outcome_unknown`; they are never reported as verified
  completion. `desktop.set_element_value` is no longer in that
  acknowledgement-only lane. It requires authenticated persisted run/provider
  call identity and a fresh full accessibility observation, then binds exact
  app/PID/generation/dotted path/role/label plus current/requested value hashes
  and lengths into a short-lived one-shot non-secret target before requesting a
  genuine exact-call approval receipt. The sealed handler re-observes the
  target, performs one AX set-value, and accepts completion only from a newer
  same-field observation with the exact requested hash and length. Raw values
  and paths remain transient; secure, credential, payment, permission,
  destructive, modal, stale, drifting, raw-dispatch, paste, and coordinate
  variants fail closed. Any possibly dispatched call without accepted proof is
  `outcome_unknown` and cannot replay. SwanBot v2 no longer raw-dispatches
  those browser/desktop mutations in its current client catalog.
  Credential automation is intentionally stopped at a narrower boundary. The
  app and v2-edge schemas require `credentialField` plus exactly one non-empty
  source (`credentialId` for the circle vault or `item` for 1Password), reject
  unknown fields, and are pinned by `smoke:browser-credential-schema-parity`.
  The runtime rejects neither, both, blank, or ambiguous sources before any
  approval lookup. Even a valid source then fails closed before secret lookup
  or fill until the handler can bind and immediately recheck one exact browser
  process/context/page/opaque-URL/field fingerprint. Model-side
  `credentials.get`, `approvals.resolve`, and saved credential fill are withheld
  from model-selectable catalogs; their dormant handlers also fail closed.
  Submit, upload, browser navigation/close,
  generalized native after-state verification, future catalog additions, and
  non-typed callers still need explicit universal-gateway coverage. The
  separate hosted cloud edge now
  exact-confirms opaque native clicks/typing/keys, but that one-call screenshot
  boundary is not the local semantic target/ledger proof contract.
  Source/contract smokes and app typecheck verify this slice; the current edge
  source additionally normalizes complete v2 summaries across pending and
  terminal paths, but it is not deployed/re-verified. §29 is not applied, and pre-deployment
  plaintext/legacy pending continuations do not gain the fail-closed/scrub
  boundary until those steps. No live generic browser/native-input GUI execution or live
  Postgres contention/race proof was performed. §26 is applied and
  catalog-verified, but its real concurrent-worker/crash-boundary behavior is
  still unproven. §29 remains authored/mirrored but unapplied, so encrypted
  checkpoint cleanup and resume are not operational claims.
- Non-browser task results use `src/lib/computerTaskOutcome.ts`. Only
  authoritative `completed` outcomes count as app success or produce a
  completion message; partial, blocked, input/approval, failed, and cancelled
  states remain explicit in persisted Chat metadata. Successful deterministic
  app calls without fresh proof remain partial; read/observation results are
  their own proof. `src/lib/chatLaneOutcome.ts` adapts this typed terminal
  without inspecting user-visible prose: approval wait is deferred, input stays
  input, partial/blocked/cancelled stay blocked, and failed stays failed. Chat
  records native terminals plus cloud/local browser completion, failure,
  cancellation, approval denial, and post-approval launch failure, preventing
  an earlier deferred preview from remaining the apparent terminal. Structured
  runtime-owned action/proof outcomes now reach `agentRuntime` through
  `getSwanBotTurnResult`; a clean correlated receipt set proves only the
  dispatched actions. It cannot prove that the outer user request and final
  acceptance predicate were satisfied. Generic tasks therefore remain
  inconclusive until a runtime-owned request/acceptance-bound task completion
  receipt exists. String-only/prose-only turns and tools without the complete
  action receipt pair remain inconclusive as well. This seam also does not yet
  give uncovered tools durable one-shot identity. The exact Photoshop and
  named-app lifecycle executors separately project their existing closed-world
  durable proof through a runtime-local one-use outer-completion authority; this
  is not general V1 acceptance-core wiring. The Photoshop compiler retains
  origin-message/program-bound root/§26 identity across approval/capability
  re-entry, rejects missing/drifted identity before desktop access, and treats a
  new explicit submission as a new request/root.
  The same path forwards the
  live Chat thread, plugin ids, cancellation signal, route constraints, and
  always-confirm floor through `agentRuntime` into `SwanBotContext`. Those
  values are consumed by the opt-in typed client canary; the default edge route
  remains non-cancellable. The path does not promote a plan-level approval into
  exact tool-call consent.
- `manual_verify_only` recovery is observation-only and never completes the
  task. Source now issues its in-memory single-use capability only to the
  original requester for the current task, exact bridge process instance, and
  exact target. The handler rechecks task and bridge-instance scope after every
  awaited read and immediately before transcript/archive persistence. Its
  allowlist remains `browser.dom_snapshot`, `desktop.observe_app`,
  `desktop.photoshop_document_status`, and `desktop.file_stat`; Photoshop status
  inspects only the active document and never activates another document. Stale
  task buttons disappear. Focused smokes verify these source boundaries, not a
  live recovery run, cross-device continuation, or task completion.
- Unfamiliar-app self-healing state records the connected provider. Delayed
  buildout polling accepts dedicated bounded capability receipts from Codex and
  Claude Code, requires exact or unique sufficiently long session identity, and
  converts unsupported Gemini/Cursor result polling into explicit incomplete
  evidence. Claude's transcript JSONL id is reconciled to its managed launch id
  only from one unambiguous anchored UC marker; missing or conflicting claims
  fail closed. `agent.build_app_capability` is therefore hard-limited to
  Codex/Claude until the other bridges provide the same strict result field.
- `src/lib/agentRunPersistence.ts` keeps authoritative typed-loop dispatch truth
  (`true`, `false`, or legacy unknown) and only bounded primitive receipt
  allowlists for computer action, mutation dispatch, app verification, and
  generic verification. The guarded browser fill/toggle/select and native
  semantic-press/value canaries now produce the mutation-dispatch and
  app-verification namespaces, but other computer mutation handlers do not;
  five narrow canaries are not proof that the universal gateway is enforced.
- Claude, Codex, Cursor, and Gemini bridge servers share the local
  `scripts/desktop-bridge-security.js` boundary: explicit loopback binding,
  Host/Origin/source checks, one-time short-lived pairing challenges, and
  bearer-token validation. Claude's expected first challenge uses a quiet HTTP
  200 envelope; the client also accepts rolling/older 428 challenges without
  weakening the one-time exchange. The Claude desktop surface additionally
  enforces exact file grants and a fixed read-only exec-file allowlist that
  rejects shell-family launchers. Every generic native input call carries one
  fresh transient app/PID/CGWindowID/bounds guard into the adjacent bridge
  call. The Swift input helper validates the same target atomically while
  typing/pressing/pasting; pointer coordinates are inside the window and
  mouse-up/scroll require x/y. Raw target authority is never serialized into
  model, approval, receipt, or durable result data. Intentional tunnel access additionally requires the
  exact emitted Host in `UC_BRIDGE_ALLOWED_HOSTS` and the exact browser origin
  in `UC_BRIDGE_ALLOWED_ORIGINS`; setting only an
  `EXPO_PUBLIC_*_BRIDGE_URL` does not relax the server boundary.
- `src/lib/appAutomationControlSurfaces.ts` owns the research-backed
  control-surface ladder for app tasks. Photoshop prefers UXP DOM/modal
  execution, then batchPlay/action descriptors or cloud Photoshop API where
  appropriate, then semantic desktop fallback. InDesign prefers UXP
  script/plugin DOM, then cloud InDesign API for rendition/data-merge/custom
  script style work, then Apple Events/accessibility fallback. CAD/engineering
  tasks prefer official app APIs and script/add-in surfaces first: AutoCAD
  API/AutoLISP, Fusion API, SOLIDWORKS API, RhinoCommon, Revit API, Inventor
  API/iLogic-style routes, and APS cloud automation for approved batch/server
  workflows. Other apps prefer official vendor APIs, plugin SDKs, CLIs, or
  file-format operations before accessibility or screenshots. Browser-app tasks
  use DOM/CDP/ARIA plus resilient locator/actionability evidence before
  screenshots or coordinates.
- `src/lib/genericAppNavigator.ts` owns the unfamiliar-app navigation policy
  used when Chat/SwanBot/OpenSwan is asked to operate an app without a
  prebuilt adapter. It infers the target app, classifies the task family,
  preserves the exact request, and emits a schema-v1 semantic workflow with at
  most ten ordered checkpoints. Every checkpoint names its goal,
  observe-before evidence, allowed semantic surfaces, mutation and approval
  classes, expected postcondition, and buildout/stop rule; the final checkpoint
  is reserved for proof of every original clause. Allowed surfaces stop at
  adapters, app lifecycle, app-native APIs/scripts, documented file adapters,
  embedded DOM/CDP, accessibility, semantic menus, and verified shortcuts.
  Coordinates are never part of this workflow. Pure observation and exact
  launch/focus/wait require no mutation approval. Model-issued lifecycle calls
  still need authenticated persisted-call identity; the strict Chat compiler
  instead uses its immutable direct-request program through the paired local
  bridge. Both require fresh exact proof. Named reversible non-secret
  field/menu/toggle steps share one bounded workflow review rather
  than one prompt per control; their runtime calls still need exact receipts.
  Persistent/external/destructive/credential/permission or ambiguous steps
  retain their exact floor. The navigator keeps route/status internals hidden
  on success and asks for only the smallest needed approval or unblock. If the task needs app-specific
  scripting, exporting, rendering, canvas/timeline/model control, or a missing
  bridge tool, it routes to `agent.build_app_capability` before coordinate-heavy
  driving so the runtime can learn a reusable recipe/adapter and retry only the
  failed step with fresh evidence.
- Generic app task-family labels are canonical. Reuse
  `buildGenericAppNavigatorRouteContext` instead of rebuilding target-app or
  task-family detection inside older strategy/buildout files.
  `appAutomationControlSurfaces`, `chatComputerRequestRouter`, `chatComputerRequestUx`,
  `chatComputerHandoffContext`, and `computerTaskEvidenceContract` should reuse
  `genericAppNavigator` labels so recovery/buildout metadata says things like
  "Ableton Live file/save/export work" instead of falling back to "Native
  desktop app" or a vague unfamiliar-app bucket.
- The same module now returns a typed app route decision
  (`ready_to_execute`, `needs_observation`, `needs_approval`,
  `needs_user_action`, or `needs_connected_agent_buildout`). Chat route prompts
  and computer-app preflight both carry that decision; chat handoff metadata and
  persisted chat rows keep a compact summary so the runtime can stop,
  re-observe, request approval, ask the user to unblock, or delegate a bounded
  connected-agent buildout before mutating another app, including after reload.
- `src/lib/engineeringCadOperationRunbooks.ts` turns CAD/engineering app tasks
  into hidden observe/approve/act/verify/recover/stop recipes for
  inspection/measurement, 2D drafting, dimensions/layers/title blocks,
  model/BIM edits, export/plot, and batch conversion. SwanBot, OpenSwan,
  computer-task dispatch, chat handoff metadata, and persisted chat metadata
  receive the compact runbooks so the user only sees approval, proof, or
  actionable blockers.
- InDesign/layout-file and Photoshop/image tasks should use uploaded-file
  staging plus app-native document/layer/text/link or layer/mask/selection
  inventory before accessibility or coordinate control.
- Photoshop and InDesign are the priority desktop-app lanes. Their strategy
  enriches from `designAppAutomation` so chat/OpenSwan carries app-specific
  document inventory, layer/text/link or layer/mask/selection checks,
  approval gates, proof/package verification, and recovery rules.
- `src/lib/designAppOperationRunbooks.ts` turns detected Photoshop/InDesign
  operations into observe/approve/act/verify/recover/stop runbooks. It gives
  SwanBot, OpenSwan, and computer-task dispatch exact tool sequences for
  InDesign text updates, InDesign/Photoshop layer show/hide/lock/unlock,
  relinks, proof exports, package handoffs, Photoshop text/smart-object
  updates, localized/generative edits, and raster proofs, including fail-closed
  blockers and connected-agent buildout triggers.
- `src/lib/designAppAdapterGaps.ts` turns still-missing Photoshop/InDesign
  operations into typed connected-agent buildout contracts. The current gap
  set covers InDesign resize/layout plus Photoshop resize/canvas,
  adjustment-layer, selection/mask, and generative/content-aware adapters. Each
  contract names official Adobe source
  refs, missing bridge tools, prerequisite observation tools, approval gates,
  required evidence, focused smoke cases, fail-closed rules, and the retry
  prompt to use after a connected agent adds the capability.
- `src/lib/designAppObjectManifest.ts` owns the before/after evidence contract
  for design tasks. It defines a `design_object_manifest` JSON artifact for
  document, layer, text-frame, link, font/preflight, smart-object,
  selection/mask, adjustment-layer, proof, and package-folder evidence. Prompt
  and metadata paths require redacted basename/hash paths, content hashes or
  summaries, source tool/timestamp references, changed-entity comparisons,
  approval evidence, and blocked-manifest reasons. The same module can now
  normalize real bridge tool captures into a redacted artifact and audit for
  missing approvals, missing before/after snapshots, missing proof/package
  artifacts, and accidental local-path leakage before completion is accepted.
  `chatComputerHandoffContext` and persisted chat metadata carry only the
  compact audited manifest summary so chat stays quiet and local paths/full copy
  do not leak into saved transcript rows.
- `src/lib/designAppManifestLedger.ts` converts audited manifest summaries into
  compact `design.object_manifest` run-ledger tool actions. Successful manifests
  become completed ledger events with proof/package artifact basenames; blocked
  manifests become blocked events with the missing evidence, still without raw
  local paths.
- `src/lib/designAppRuntimeManifest.ts` assembles live OpenSwan Photoshop/InDesign
  desktop tool events into the hidden manifest contract. The runtime keeps
  structured before/action/after captures out of normal persisted tool metadata,
  then appends only the redacted `design.object_manifest` ledger action.
- `src/lib/designAppProofReview.ts` owns the Photoshop/InDesign proof-review
  contract. It is injected into SwanBot/OpenSwan/computer-task prompts and
  summarized in the chat design-task card as a short review checklist rather
  than raw paths or verbose run logs.
- `src/lib/designAppCreativeAi.ts` owns the creative-AI capability plan for
  Photoshop, InDesign, and Firefly-backed work. It detects text-to-image,
  generative fill/remove, generative expand, AI asset generation, creative
  variations, and InDesign data-merge variants; names the required prompts,
  target frames/layers/selections, generated-output receipts, proof evidence,
  source refs, connected-agent buildout trigger, and reusable user-task recipes
  such as Photoshop generated background packs and InDesign text-to-image frame
  placement; and is injected into SwanBot/OpenSwan plus compact chat handoff
  metadata and the design-task card.
- `src/lib/designAppExecutionPipeline.ts` owns the ordered Photoshop/InDesign
  task pipeline. It turns automation plans, operation runbooks, creative-AI
  recipes, and adapter gaps into phases for resolve, observe, approve, mutate,
  export/package, verify, and connected-agent recovery. The compact pipeline is
  injected into SwanBot/OpenSwan, chat handoff metadata, persisted chat rows,
  and connected-agent buildout prompts.
- The local desktop bridge exposes script-backed InDesign status, text
  inventory, text-layer/Find-Change updates, placed-asset relink, and
  `packageForPrint` production package handoff, and proof-PDF export, plus
  Photoshop status, layer inventory, text-layer update, asset placement, and
  proof-export tools through the same OpenSwan runtime used by chat. Proof
  exports and InDesign package output folders require local write grants;
  InDesign asset relink and Photoshop asset placement require local read grants.
- Other Adobe Creative Cloud products route through
  `src/lib/adobeCreativeCloudApps.ts` and the `adobe_cc_control` strategy. That
  path resolves files, observes app/window state, gates mutations/exports, and
  uses connected-agent app-capability buildout when the runtime lacks a native
  adapter; it does not replace the dedicated Photoshop/InDesign bridge tools.
- Native Anthropic computer use in the edge function must use a Sonnet-capable
  model; unsupported selections fall back to the default Sonnet computer-use
  model.

## Schema Gotchas

| Item | Gotcha |
|---|---|
| `profiles` | No `email` column. Use auth user data for email. |
| `circle_office_agents` | No `model` column. Owner FK is `owner_id`. |
| `user_xp` | Primary key is `user_id`. |
| `room_messages.message_type` | Must match the DB check constraint. |
| `messages` Chat rows | §31 requires a canonical non-null `thread_id`; `circle_id`, `thread_id`, and `reply_to` must resolve to one thread. Toggle reactions through `set_message_reaction` instead of replacing another member's JSON. |
| `circle_integrations.provider` | Provider values are open-ended; validate known providers in app registries and keep lookup indexes/migrations current instead of re-adding a rigid CHECK. |
| `circle_members` RLS | Avoid recursive policy reads; use security-definer helpers where available. |

## SQL

- Local migrations are append-only in `supabase/migrations/`.
- Consolidated idempotent agent SQL is in `docs/RUN_THIS_SQL.sql`.
- Roadmap section 5 owns applied/pending status.
- `npm run preflight:attachment-authority-deployment` is the local-only,
  no-apply gate for §§28 and 38-41. It checks canonical dependency order,
  executable consolidated parity, required authority markers, and readiness
  query availability without loading env files or opening a socket. It also
  inventories every migration filename/version prefix. The repository has
  duplicate legacy versions, including four `20260726_*` migrations, so the
  canonical consolidated SQL may be ready while automated migration push is
  blocked. Do not rename historical migrations during deployment; use the
  reviewed `docs/RUN_THIS_SQL.sql` workflow. Linked history currently lacks
  §§28/38-41, so source readiness is not live application proof. Add
  `--local-bridge-health` only for the fixed unauthenticated loopback health
  read. Its classifications keep missing capability, proven source drift,
  blocked refresh, and an idle-safe refresh opportunity distinct; an older
  bridge without `restartSafety` can never turn a missing tool into inferred
  source drift. Every non-current result is `watch`, not deployment proof or
  restart authority. The authenticated loopback
  `POST /desktop/refresh_if_idle` is executable only under the v2 direct
  `dev-stack-keepalive` or `start-dev` supervisor contract. It requires complete
  forced scans, no active or idle Claude session, spawned child, persistent
  browser context/page/launch, private attachment capability, in-flight or
  abort-uncertain bridge request, or changing/invalid source. After an
  authenticated reservation, the supervisor captures the exact validated
  five-file manifest into a private 0700/0600 snapshot. Only after the 202 is
  flushed and safety is rechecked may the old bridge commit and exit `75`; the
  replacement loads that immutable snapshot under the original filenames and
  must prove signed post-listen ONLINE plus exact instance, manifest, and
  snapshot lineage through health. Bounded retries reuse that snapshot without
  erasing crash history, then cleanup on ready, rejection, exhaustion, or
  shutdown. Legacy, foreign, unsupported, non-idle, or mismatched supervisors
  remain typed-409 fail closed. The preflight never calls this endpoint.
  `--live-catalog` and
  `--live-canary` are separate read-only modes requiring their exact
  `RUN_LIVE_ATTACHMENT_AUTHORITY_*` confirmation plus exact project identity.
  The catalog probe additionally requires operator-reviewed absolute,
  non-symlink paths for the `psql` binary and CA bundle, pins libpq to
  `verify-full`, and gives `psql` only a minimal environment so a
  caller-controlled executable search or `PG*` service/options/certificate
  override cannot weaken or intercept the connection.
  The authenticated canary also requires one exact
  `UC_ATTACHMENT_AUTHORITY_CIRCLE_ID`, independently proves both user tokens
  can see both memberships in that circle, and binds the artifact, staged
  attachment, device-private approval, and its user-owned parent run to that
  same circle. They never apply SQL; keep catalog results distinct from
  authenticated two-user behavior.
- `20260726_agent_action_calls.sql` (§26) is **applied and catalog-verified**:
  the live table and claim/start/finish RPCs were rechecked on 2026-08-05.
  A real two-worker claim/start contention race remains unproven, so catalog
  presence alone is not cross-process no-replay proof.
- `20260726_scheduled_action_mutation_guard.sql` is mirrored as §27 but is
  **not applied or live-DB verified**. Apply it before relying on the durable
  scheduled claim/dispatch/outcome-unknown state machine.
- `20260726_database_authority_guards.sql` is mirrored as §28 but is **not
  applied or live-DB verified**. The 146-assertion source/byte-identity guard is not proof of
  Office RPC concurrency or approval resolve/consume behavior; local
  Docker/Supabase was unavailable for this review.
- `20260726_swanbot_continuation_privacy.sql` is mirrored as §29 but is **not
  applied or live-DB verified**. Source verification does not prove encrypted
  resume/key rotation, live claim races, cron expiry, or the historical scrub.
- `20260805_messages_thread_rls_and_reactions.sql` (§31) is **applied and
  catalog-verified on the target project as of 2026-08-05**. The service-role
  readiness contract proves the canonical table/column, four message policies,
  mutation trigger, reaction RPC grant, and Realtime publication. Authenticated
  private/shared/circle behavior, revocation, reply/reaction contention, and
  two-client Realtime delivery still need live behavioral proof. Current
  compatibility deliberately permits a creator to author/finalize their own
  `is_bot=true` row until a trusted server/RPC bot-write lane replaces it.
- `20260805_openswan_production_readiness_contract.sql` (§32) is **applied and
  live-verified on 2026-08-05**. Its service-role RPC returns booleans only.
  The report combines those booleans with hosted function/JWT metadata,
  required secret names, the production web origin, browser CORS, source
  smokes/parity, and real telemetry. An authenticated Supabase CLI may supply a
  service key transiently when no explicit key is exported; no key or secret
  value is printed.
- `20260806_universal_computer_task_roots.sql` (§34) is **pending and not
  applied**. Its exact 129,820-byte source/tail has SHA-256
  `45251c1ffd2ea002a227bfdcfcbd0875dbab47127e590031f3b4bf827651e30a`.
  PostgreSQL 14 syntax/catalog, positive/rollback/fault, claimed recovery,
  fresh post-lock clock/token, STOP/human-override guard, and exact source/tail
  paths passed for root-first combined root/§26 claim/start/settle. This is not
  behavioral crash-cut, live contention/recovery, production migration, or
  Photoshop canary proof.
- `20260807170000_office_agent_session_bindings.sql` (§36) is **pending and not
  applied**. Disposable PostgreSQL 14 applied the migration twice and focused
  smokes cover the no-backfill owner-private table, single-policy reapply, RLS
  read, denied direct writes, authenticated set/clear including stale cleanup
  after provider drift, versioned bound/missing `invoke_agent_v2` claim, pure
  exact resolver, and Office/Feed source wiring. No live authenticated binding UI, provider
  dispatch, cross-device local-token availability, production migration, or
  deployment has been proven. Typed provider final-result reconciliation also
  remains pending, so acceptance stays nonterminal.
- Use `NOTIFY pgrst, 'reload schema';` after schema changes when relevant.

## Validation

```bash
npm run check:openswan-lanes
npm run check:swanbot-chat:daily
npm run check:office-addons
npm run smoke:export-traces
npm run typecheck
npm run build
```

The 2026-08-13 Office private-state slice is source-checked by the preference
SQL source/parity tests, exact-scope queue/cache/identity/presence/heartbeat and
runtime-wiring tests, disposable PostgreSQL behavior, and app typecheck through
`check:office-addons`. The default gate intentionally excludes the disposable
PostgreSQL script because it requires a developer-local database owner; run
`smoke:office-user-preferences-sql-behavior` explicitly where PostgreSQL is
available. These checks do not prove §45 application, target RLS, two-tab
account-switch races, native secret-store cleanup, cross-device convergence, or
deployed behavior.

The 2026-08-13 exact Office runtime slice adds focused membership,
connection-authority, durable terminal receipt/listener, approval-mutation,
OAuth/Figma lifecycle, and idle-scheduler cleanup checks. These checks exercise
the source contracts and account-retirement fences; they do not replace a live
two-account/two-tab race, real provider callback, native protected-storage, or
deployed canary.

The 2026-08-13 Office addon/editor slice is source-checked by
`smoke:office-addon-registry`, `smoke:office-addon-experience-core`, `smoke:office-addon-ui-wiring`, the
terminal-target/advisory-wakeup smoke, existing Office dashboard-state and
validation smokes, and app typecheck via `check:office-addons`. These checks
cover the exhaustive 81-item registry,
catalog metadata and truth-state aging, query/filter behavior, bounded detached
undo/redo, deterministic bounded room kits, floor serialization, terminal-native
target identity, atomic selected-target projection, no-dispatcher fail-before-
persist, durable-insert/advisory-wakeup separation, out-of-order direct-read and
modal OAuth rejection, provider-switch payload reset, reconnect-required status,
same-provider scope union, token refresh, revision/intent/lease-fenced OAuth
storage, secret-free disconnect tombstones, generic BYOK namespace isolation,
explicit terminal control names, and type-safe wiring. They do
not substitute for live
responsive web/native, keyboard and screen-reader, pointer/drag, real external
agent dispatch, applied §42, deployed Edge functions, real-provider OAuth, cross-device §37,
or dormant-component rendering proof.

The 2026-07-27 guarded-action slice is source-verified by the focused
103-assertion `agent-action-calls` ledger smoke, `agent-action-runtime-wiring`,
read-only `browser-locator-actionability`, browser fill/toggle/select,
computer-app grounding, `swanbot-v2-batch-policy`,
`swanbot-v2-continuation`, `swanbot-v2-edge-fill-schema`,
`computer-use-mutation-handoff`, readiness, and typed-runtime invariant smokes
plus app typecheck. Locator actionability remains advisory and cannot authorize
or bind a later mutation. Those checks do not substitute for deploying the
current edge, applying §29 to Postgres, proving encrypted continuation/key-
rotation, cron-expiry, §26/continuation contention and crash-boundary behavior,
or running a live browser/native GUI task. §26 catalog application is recorded
separately in the SQL checklist.
The 2026-08-05 structured action-evidence seam is source-checked by
`smoke:computer-task-truthful-outcome`,
`smoke:agent-run-persistence-receipt`,
`smoke:swanbot-v2-terminal-integrity`, and app typecheck. These checks prove
value-free action receipt transport/correlation and fail-closed handling in
source. The truthful-outcome smoke now also directly exercises the pure V1
outer-acceptance compiler/evaluator/issuer, including exact root/contract/action
binding, opaque ordered action-claim authority, fresh final-proof ordering,
plain/JSON-clone/copied-binding/cross-contract/reorder/reuse rejection,
concurrent claim/seal/issuance reservation, and one-use receipt application. No
production caller invokes or persists that in-process receipt yet, so generic
runs remain task-level inconclusive. These checks do not prove universal stable root
identity, catalog-wide ledger coverage, a deployed edge, or a live computer
task. The exact Photoshop branch separately
binds its authenticated root and §26 create action to the originating message/
submission fingerprint, preserves it across approval/capability re-entry, and
fails before root/desktop work when the identity is missing or mismatched. A new
explicit submission intentionally remains a new request/root.
The manual verifier is source-checked by `smoke:chat-failure-recovery`,
`smoke:chat-computer-outcome-ux`, `smoke:persisted-chat-metadata`, and
`smoke:photoshop-extendscript-adapters`. The checks cover requester/task/bridge-
instance/target binding, post-await scope rechecks, stale-affordance suppression,
and non-activating Photoshop status reads. They do not prove a live recovery or
turn observation evidence into task completion.
Chat local-file authority is now demand-driven: mounting Chat does not request
`~/Desktop` write access. Only a compiled `file_read`/`file_write` grant can
open the local permission flow, scoped to inferred task roots and the exact
task reason. `smoke:chat-file-permission-demand` pins that boundary and runs
through the canonical readiness smoke used by daily, release, and `smoke:all`.
Both SwanBot v2 and Chat release gates run bounded browser wait/scroll
reachability, truthful computer-task outcome, and exact v2 Chat-thread identity
checks. The browser guard pins all four opaque identity fields, retained-page
pre/post checks, direct exact ARIA lookup, and rejection of tab/navigation/
reload/SPA-URL/close/bridge drift without selector or coordinate authority. It
also pins exactly one wheel dispatch, privacy-local before/after viewport reads,
at most three read-only settle samples, requested-axis `movementVerified:true`,
and `browser_scroll_verification_failed` plus fresh DOM/screenshot recovery for
boundary/no-motion results without blind replay or returned geometry. The
thread guard binds service-role message writes to the authenticated
fresh/resumed request rather than model arguments. Chat release additionally
runs failure recovery and the `ThinkingLabel` hook-order regression that guards
the React static-flag console failure.
`smoke:exact-program-authority` also runs in the Chat release gate and pins the
authenticated root plus §26 lifecycle for the exact Photoshop mutation lane.
The aggregate truthful-outcome gate now also includes
`computer-task-root-action-gateway-smoketest` and
`photoshop-root-action-canary-smoketest`. Together with the repaired desktop
runtime-wiring smoke, they pin database-binding-only entry, root/action identity
matching, exact value-bound one-shot authority from `started`, claimed refresh
recovery, stale same-action lease rebinding, persisted-root fallback fencing,
STOP/override refusal, no child run, frontmost-only dispatch, no launch/focus/
browser branch, target-guard ordering, non-authoritative final-foreground
telemetry, and fail-closed/no-replay outcomes. These are source checks; they do
not give the bridge independent attestation, persist later reconciliation
evidence, simulate every crash cut, or prove a foreground-required gateway
fixture. They did not enable flags, apply §34, mutate Photoshop, or deploy.
`smoke:chat-computer-request-router` and
`smoke:computer-task-runtime-context` separately pin named-app request/root/
action binding, mutually exclusive launch-or-focus, explicit-focus no-launch,
request-only idempotency across canonical-name drift, and duplicate no-reentry.
They are not a live duplicate-refresh or foreground-override test.
A separate compiler-generated exact Photoshop drill was run once after a local
bridge restart on 2026-08-06. It dispatched exactly one create, proved
`Untitled-4` at 600x600 with Photoshop frontmost, recorded zero browser calls,
and five subsequent OS foreground samples remained in Photoshop. This is
direct closed-world compiler/bridge/app evidence, not canonical Chat lifecycle,
duplicate-refresh, competing-client, hosted-edge, or production-site proof.
`openswan-generic-native-ui-runtime`, `browser-dom-snapshot-privacy`, and
`swanbot-v2-terminal-integrity` each run exactly once in both Chat/SwanBot daily
and release chains and in `smoke:all`; these are source/contract gates, not live
database, Browserbase, native-GUI, or deployed-edge proof.
The 2026-07-26 cloud/root-Chat slice is source-verified by
`computer-use-cloud-policy`, `chat-computer-request-router`, and
`computer-task-runtime-context`. The cloud-policy and runtime-context guards
run exactly once in all Chat/SwanBot daily and release gates, `smoke:all`, and
canonical readiness. Exact approval, direct-handoff, open-path, automation,
scheduled-action, Office broadcast, and database-authority guards share that
same exactly-once gate contract. This does not prove a deployed edge, live
Browserbase/confirmation-database integration, or live native-app execution.
`smoke:photoshop-exact-drill` also runs exactly once in the Chat daily/release
commands through their matching npm `precheck:*` lifecycle hooks, and once in
`smoke:all`; the canonical `check:*` bodies do not invoke those hooks again. It
verifies the compiler manifest, drill safety, and
drill source contracts; `smoke:computer-task-runtime-context` independently
pins the related production source contract, not shared execution parity. The
separate manual command stays dry
unless `--live` and the dry-run fingerprint are explicit. The one 2026-08-05
live invocation made one create call and no browser calls; its successful
600x600 result required a separate fresh read-only status after the immediate
proof was stale. It does not cover authenticated Chat, approval persistence,
browser events, or a post-retry live create.
It also does not prove §27/§28/§29 application or live two-client Realtime/RLS
behavior, encrypted resume/key rotation or cron expiry, §26 concurrent claims
or crash boundaries, external provider dispatch, or automation/scheduler edge
deployment. §26 catalog application is separately verified by the SQL
checklist; that is not a live contention proof.

The 2026-08-05 unfamiliar-app and semantic-value slice is covered by the
focused `generic-app-navigator`, `universal-app-task-eval`,
`native-semantic-value-runtime`, launch/focus, grounding, approval, and runtime
contract smokes, the desktop/local execution-surface guard, and app typecheck.
The universal source corpus covers 160 requests and 7,410 assertions. These
are source/contract checks. They do
not prove a live generic native-app mutation, an edge deployment, a database
contention race, or universal completion for arbitrary human actions in every
app.

Use focused smoke scripts from `package.json` for runtime changes. Use
`npm run check:swanbot-chat:release` before bundling a larger
SwanBot/OpenSwan/Chat delivery. `.github/workflows/openswan-release.yml` runs
that suite on pull requests and manual dispatches after `npm ci`: it computes
committed scope from the exact merge base with
`scripts/openswan-lane-report.ts --base-ref`, exports the production web
artifact, and runs `git diff --check`. Its pull-request filter includes app
source, scripts, edge functions, migrations, docs (including canonical root
docs), Netlify config, and package/TypeScript metadata so authority or deploy
changes cannot silently skip the gate. The workflow pins the official
`actions/checkout@v7`, `actions/setup-node@v7`, and
`denoland/setup-deno@v2` actions. A green local source check does not claim the
hosted workflow ran. Use the SwanBot/OpenSwan readiness report only
for M4 production-readiness evidence because it requires either an explicit
Supabase service-role key or authenticated CLI access, plus real `agent_runs`
rows. Its live dependency section must pass separately from telemetry:
`npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>`.
`smoke:all` is the integration sweep, not the daily default.
