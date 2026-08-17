# CLAUDE.md - The Underground Circle

> Project context for Claude Code, OpenSwan, Codex, Gemini, and other agents.
> Last reviewed: 2026-08-14

Start with `AGENTS.md`. `docs/AGENTS_ROADMAP.md` is canonical for ownership,
phase status, SQL status, and runtime rules. This file is a current app review
and orientation guide.

## Product

The Underground Circle is a shared AI-agent accountability workspace for small
dev teams. The core loop is:

`connect repo/providers -> plan and run work in Chat/Office/Feed -> agents
execute with tools -> proof, activity, memory, and follow-up become visible`.

Priority remains:

1. GitHub/team accountability.
2. BlackSwan/OpenSwan as the shared agent layer.
3. Reliable provider routing, memory, approvals, and observability.
4. Computer Use and local desktop actions with explicit gates.

Wallet, games, training experiments, and decorative office work are secondary
unless they strengthen the accountability loop.

## Stack

| Layer | Current reality |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| Runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| LLM routing | `llm-proxy`, `swanbot-ai`, `swanbot-v2-ai`, provider marketplace, BYOK |
| Local bridges | app dev server 8081, OpenSwan proxy 18790, Claude bridge 7778 |

Production JavaScript uses `max-age=0, must-revalidate`, not immutable caching.
Expo/Metro may retain an entry-chunk filename while changing its dynamic-import
path table, so year-long JS caching can mix incompatible deployment graphs and
crash a lazy screen. Long-lived immutable caching remains limited to assets
whose URL identity is safe for it. The live Chat canary clears its isolated
browser cache before proving a signed-in route.

Core commands:

```bash
npm run web
npm run start
npm run build
npm run typecheck
npm run proxy
npm run bridge
```

## App Surfaces

- Chat: main agent surface, model picker, chat automation, computer task
  routing, memory references, artifacts, threads, and persisted bot metadata.
- Office: live agent dashboard, local bridge visibility, activity feed,
  terminal, controls, memory/run panels, approvals, agent identity, and a
  truthful customizable addon floor.
- Feed: goals, plans, missions, tasks, proof of work, and team operating loop.
- Rooms: project rooms, files, services, room chat, task execution, playground.
- Marketplace: user/circle integrations, provider keys, model/provider catalog,
  browser/computer providers, and billing preference.
- Computer Use: Browserbase runtime plus local desktop and browser bridge tools.

Opening a circle without an explicit tab now lands on Office. Explicit tab and
validated cross-surface focus requests still take precedence over that default.

## Runtime Map

Canonical owners are in `docs/AGENTS_ROADMAP.md`; this is the practical map:

| Concern | Owner |
|---|---|
| Office exact runtime authority and account-switch lifecycle | `src/lib/officeDashboardPersistence.ts`, `src/lib/connectionManager.ts`, `src/lib/computerTaskState.ts`, `src/lib/agentPlanPersistence.ts`, `src/lib/computerUseHistory.ts`, `src/lib/llmProviders.ts`, `src/lib/workspaceAdaptation.ts`, `src/lib/oauthConnect.ts`, `src/lib/idleBehaviors.ts`, `src/lib/officeTerminal.ts`, `src/lib/agentInvocation.ts`, `src/lib/circleOffice.ts`, `src/services/customThemes.ts`, `src/services/sharedMemory.ts`, `src/services/hitlService.ts`, `src/services/runApprovalsService.ts`, `src/components/OfficeTerminal.tsx`, `src/components/ComputerUseHistoryPanel.tsx`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/ProfileTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/CustomizePanel.tsx`, `supabase/migrations/20260817120000_circle_idle_behavior_claims.sql`, `docs/RUN_THIS_SQL.sql` §46, `scripts/circle-idle-behavior-claims-sql-smoketest.ts`, `scripts/circle-idle-behavior-claims-sql-behavior-smoketest.sh` |
| Office Agent panel router and canonical Chat handoff | `src/lib/{agentRunSystem,agentRuntimeSubject,chatAgentTargets,circleIntegrations,circleOffice,officeAgentSessionBinding,openswanService,progression,siteAutomation}.ts`, `src/services/hitlService.ts`, `src/components/AgentControlCard.tsx`, `src/components/rpg/{AgentEvolutionCard,StreakFlame,XPEventFeed}.tsx`, `src/screens/circles/CircleDetailScreen.tsx`, `src/screens/circles/tabs/{ChatTab,OfficeTab}.tsx`, `src/screens/circles/tabs/office/{AgentPanel,AgentPanelShell,AgentOverviewPanel,AgentActivityPanel,AgentGatewayPanels,AgentTerminalPanels,AgentMemoryPanel,AgentRunsPanel,AgentSpiritPanel,AgentEvolutionPanel,Whiteboard}.tsx`, `src/screens/circles/tabs/office/{AgentPanelTabs,useAgentPanelLayout}.ts`, and the `office-agent-*` plus OpenSwan panel/lifecycle smokes |
| Chat plan approval capability identity | `src/lib/chatPlanApprovalAuthorityCore.ts`, `src/lib/runChatAutomationPlan.ts`, `src/lib/openswanToolApprovals.ts` |
| Dependency compatibility and Expo image build boundary | `package.json`, `package-lock.json`, `scripts/dependency-override-compat-smoketest.mjs`, `scripts/expo-image-asset-guard.mjs`, `scripts/expo-image-asset-guard-smoketest.mjs`, `scripts/security-release-check.mjs` |
| Chat planning and terminal transport | `src/lib/chatAutomationPlanner.ts`, `src/lib/chatTerminalTransportPolicy.ts` |
| Chat computer/app request routing | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer requested-action accounting | `src/lib/chatMultiIntentCore.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/computerFileAdapter.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js`, `src/lib/chatAgentContextPack.ts`, `src/lib/chatComputerHandoffContext.ts`, `src/lib/persistedChatMetadata.ts` |
| Chat computer/app user notices | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Universal Computer Task Kernel plan | `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md` |
| Chat execution | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| Chat transcript and thread lifecycle | `src/screens/circles/tabs/ChatTab.tsx`, `src/screens/circles/tabs/chat/ChatThreadSidebar.tsx`, `src/screens/circles/tabs/chat/ChatThreadHeader.tsx`, `src/lib/chatService.ts`, `src/lib/chatMessageShape.ts`, `src/lib/circleChatThreads.ts`, `src/lib/chatComposerDraftCore.ts`, `src/lib/subscribeWithReconnect.ts` |
| Chat attachment identity, visual brief, connected coding-agent handoff, and idle-safe local bridge refresh | `src/lib/chatMedia.ts`, `src/lib/chatAttachments.ts`, `src/lib/attachmentRoutingCore.ts`, `src/lib/openSwanAttachmentSourceCore.ts`, `src/lib/openSwanAttachmentTurnSources.ts`, `src/lib/openSwanDesktopAttachmentAuthority.ts`, `src/lib/chatAutomationPlanner.ts`, `src/lib/chatDesktopAttachmentRouting.ts`, `src/lib/desktopBridge.ts`, `scripts/desktop-bridge-immutable-snapshot.js`, `scripts/{claude-bridge,browser-bridge,dev-stack-keepalive}.js`, `start-dev.js`, `src/lib/chatVisualBriefCore.ts`, `src/lib/chatVisualBrief.ts`, `src/lib/swanbotStream.ts`, `src/lib/{openswanSessionRuntime,openswanSessionRuntimeAdapters,openswanTaskPlanner,openswanToolRuntime,swanbot}.ts`, `src/lib/openswanTools/index.ts`, `supabase/functions/chat-stream/index.ts`, `supabase/migrations/{20260813160000_message_attachment_link_integrity,20260813170000_message_attachment_visibility_integrity,20260813180000_device_private_run_approval_authority}.sql`, `docs/RUN_THIS_SQL.sql` §§39-41, `scripts/{chat-single-attachment-authority,chat-single-attachment-routing-safety,chat-desktop-attachment-open-wiring,openswan-desktop-attachment-authority,openswan-desktop-attachment-runtime,desktop-attachment-open-capability,desktop-bridge-safe-refresh,desktop-attachment-app-identity,openswan-original-user-task-egress-wiring,openswan-attachment-egress-guard,device-private-run-approval-authority}-smoketest.ts`, `src/lib/chatAgentTargets.ts`, `src/lib/customAgentBridgeDispatcher.ts`, `src/lib/bridgeTaskDispatcher.ts`, `src/lib/connectedAgentDispatch.ts`, `src/lib/terminalAgentControl.ts`, `src/lib/terminalAgentSessionLauncher.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Chat thread/message database authority | `supabase/migrations/20260805_messages_thread_rls_and_reactions.sql`, `docs/RUN_THIS_SQL.sql` §31, `scripts/messages-thread-rls-smoketest.ts` |
| Dated application security evidence | `docs/SECURITY_REVIEW_2026-08-06.md`, `supabase/migrations/20260806_public_collaboration_rls_hardening.sql`, `supabase/migrations/20260806172000_circle_public_access_emergency_hardening.sql`, `supabase/migrations/20260806174000_rotate_site_credential_encryption_key.sql`, `supabase/migrations/20260806174500_security_definer_emergency_lockdown.sql` |
| BlackSwan response path and exact assigned Spirit context | `src/lib/{swanbot,agentSpirits,agentSpiritPromptCore,spiritCareerProfiles,spiritOperationsProfiles}.ts`, `src/lib/swanbotClientToolDispatcher.ts`, `supabase/functions/_shared/agent-spirit-context.ts`, `supabase/functions/{swanbot-ai,swanbot-v2-ai}/index.ts`, `scripts/swanbot-exact-agent-spirit-smoketest.ts` |
| v2 SwanBot tool loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts`, `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/swanbotV2BatchPolicy.ts`, `src/lib/swanbotV2ClientLoopFlag.ts` |
| SwanBot continuation checkpoint privacy | `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/migrations/20260726_swanbot_continuation_privacy.sql`, `docs/RUN_THIS_SQL.sql` §29 |
| SwanBot/OpenSwan production readiness | `src/lib/swanbotOpenSwanReadiness.ts`, `scripts/swanbot-openswan-readiness-report.ts`, `supabase/migrations/20260805_openswan_production_readiness_contract.sql`, `docs/RUN_THIS_SQL.sql` §32 |
| Typed model/tool loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan sessions, exact resume, multi-action completion, and terminal outcome | `src/lib/openswanSessionRuntime.ts`, `src/lib/openswanSessionRuntimeAdapters.ts`, `src/lib/openSwanMultiActionCompletionCore.ts`, `src/lib/toolLoopResume.ts`, `src/lib/openswanTaskPlanner.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/agentRunSystem.ts`, `src/lib/chatLaneOutcome.ts`, `src/lib/chatOutcomeSignals.ts`, `src/lib/persistedChatMetadata.ts`, `src/lib/roomMessageMetadata.ts`, `src/lib/roomChatService.ts`, `src/screens/circles/tabs/ChatTab.tsx`, `scripts/openswan-{terminal-outcome-contract,ordinary-tool-terminal-truth,multi-action-completion-core,multi-action-report-tool,multi-action-artifact-evidence,multi-action-provider-causality,multi-action-read-evidence,multi-action-terminal-wiring,multi-action-semantic-evidence,resume-locator}-smoketest.ts`, `scripts/{agent-run-metadata-merge-cas,chat-multi-action-routing-invariants,room-chat-multi-action-persistence,room-message-reload-pagination}-smoketest.ts` |
| Room document context, reviewed edits, and GitHub submission | `src/screens/circles/tabs/RoomsTab.tsx`, `src/lib/roomChatFileContext.ts`, `src/lib/roomChatService.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/builderGithubSave.ts`, `src/lib/github.ts`, `src/lib/githubChatCommands.ts`, `src/screens/circles/tabs/chat/BuilderGithubSaveModal.tsx`, `scripts/{room-chat-file-context,room-chat-minimal-ui,room-github-submit}-smoketest.ts` |
| Owner-private Office agent → OpenSwan session binding | `src/lib/officeAgentSessionBindingCore.ts`, `src/lib/officeAgentSessionBinding.ts`, `src/lib/agentAutoConnect.ts`, `src/lib/agentAutoConnectState.ts`, `src/lib/agentInvocation.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/AgentGatewayPanels.tsx`, `supabase/migrations/20260807170000_office_agent_session_bindings.sql`, `docs/RUN_THIS_SQL.sql` §36 |
| Office dashboard truth, stable cost semantics, exact private-state lifecycle, per-circle layout, and complete floor presets | `src/lib/officeDashboardPersistence.ts`, `src/lib/officeLayoutLocalCache.ts`, `src/lib/officeLayoutSaveReceiptCore.ts`, `src/lib/officePreferenceWriteQueueCore.ts`, `src/lib/officeFloorPresetCore.ts`, `src/lib/chatAttentionQueue.ts`, `src/lib/runHistoryFilterCore.ts`, `src/lib/officeAgents.ts`, `src/lib/agentIdentity.ts`, `src/lib/agentPresence.ts`, `src/lib/agentHeartbeat.ts`, `src/lib/sessionCache.ts`, `src/lib/sessionTags.ts`, `src/lib/claudeUsage.ts`, `src/components/chat/RunHistoryDrawer.tsx`, `src/components/office/OfficeOpsBoardCards.tsx`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/AgentRunsPanel.tsx`, `src/screens/circles/tabs/office/AgentActivityPanel.tsx`, `src/screens/circles/tabs/office/Whiteboard.tsx`, `supabase/migrations/20260811120000_office_dashboard_state_and_floor_presets.sql`, `supabase/migrations/20260813140000_office_layout_exact_save_receipt.sql`, `supabase/migrations/20260813220000_office_user_preferences.sql`, `supabase/migrations/20260817130000_agent_identity_primary_rpc.sql`, `docs/RUN_THIS_SQL.sql` §§37/45/47, `scripts/office-layout-local-cache-smoketest.ts`, `scripts/office-layout-save-receipt-core-smoketest.ts`, `scripts/office-user-preferences-sql-parity-smoketest.ts`, `scripts/office-private-runtime-wiring-smoketest.ts`, `scripts/agent-identity-exact-authority-smoketest.ts`, `scripts/agent-identity-primary-rpc-sql-smoketest.ts`, `scripts/agent-identity-primary-rpc-sql-behavior-smoketest.sh` |
| Office addon catalog, data truth, reversible floor editor, and OAuth credential control | `src/lib/officeConfig.ts`, `src/lib/officeAddonExperienceCore.ts`, `src/lib/officeValidation.ts`, `src/lib/animationHelpers.ts`, `src/lib/oauthConnect.ts`, `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `src/screens/circles/tabs/office/OfficeSections.tsx`, `src/screens/circles/tabs/office/OfficeFloor.tsx`, `src/screens/circles/tabs/office/InteractiveFurniture.tsx`, `src/screens/circles/tabs/office/AgentPanelShell.tsx`, `src/screens/circles/tabs/office/officeFloorLayout.ts`, `src/components/OfficeTerminal.tsx`, `src/components/PhoneMessenger.tsx`, `src/components/office/ConnectAllBridgesPanel.tsx`, `src/components/office/OfficeBridgeDiagPanel.tsx`, `src/components/office/OfficeBridgeReadinessStrip.tsx`, `src/components/office/StatusPicker.tsx`, `src/components/office/WorldClockBar.tsx`, `supabase/functions/email-calendar-oauth/index.ts`, `supabase/migrations/20260813190000_atomic_oauth_credential_store.sql`, `docs/RUN_THIS_SQL.sql` §42, `scripts/office-addon-registry-smoketest.ts`, `scripts/office-addon-experience-core-smoketest.ts`, `scripts/office-addon-ui-wiring-smoketest.ts`, `scripts/office-validation-smoketest.ts`, `scripts/oauth-popup-boundary-smoketest.ts`, `scripts/oauth-credential-control-sql-smoketest.ts`, `scripts/oauth-credential-control-sql-behavior-smoketest.sh`, `scripts/office-terminal-broadcast-authority-smoketest.ts`, `scripts/office-authenticated-local-e2e.mjs` |
| Personal Figma OAuth and server-only file projection | `src/lib/oauthConnect.ts`, `src/lib/oauthCallbackRelay.ts`, `src/lib/figmaBuilder.ts`, `src/screens/circles/tabs/office/CustomizePanel.tsx`, `supabase/functions/figma-oauth/index.ts`, `supabase/migrations/20260813200000_figma_oauth_credential_control.sql`, `docs/RUN_THIS_SQL.sql` §43, `scripts/figma-oauth-boundary-smoketest.ts`, `scripts/figma-oauth-credential-control-sql-smoketest.ts`, `scripts/figma-oauth-credential-control-sql-behavior-smoketest.sh` |
| Agent subject identity | `src/lib/agentRuntimeSubject.ts`, `src/lib/agentIdentityKey.ts`, `src/lib/agentIdentity.ts` |
| Tool catalog, bounded action reporter, and derived-artifact publisher | `src/lib/openswanToolRuntime.ts`, `src/lib/openswanTaskPlanner.ts`, `src/lib/openswanTools/index.ts` |
| Feed active-run truth | `src/lib/agentRunSystem.ts`, `src/lib/runHistoryFilterCore.ts`, `src/lib/officeOpsBoard.ts`, `src/screens/circles/tabs/FeedTab.tsx`, `scripts/feed-active-runs-truth-smoketest.ts` |
| Provider profile model choice | `src/lib/serviceProfileSouls.ts` |
| Cross-provider fallback | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan model routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime, exact programs, foreground ownership, and truthful Chat lane outcomes | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/computerForegroundOwnership.ts`, `src/lib/chatLaneOutcome.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Structured typed-loop action evidence and outer acceptance core | `src/lib/computerTaskOutcome.ts`, `src/lib/swanbot.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/agentRuntime.ts`, `src/lib/agentRunPersistence.ts` |
| Browser computer use and typed mutation handoffs | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `src/lib/useComputerUseQueue.ts`, `supabase/functions/computer-use-agent/index.ts`, `src/lib/computerUse.ts`; cloud starts require a bounded v1 policy, while all legacy recorder mutations remain value-stripped typed OpenSwan handoffs |
| Local desktop intent | `src/lib/localComputerAwarenessIntent.ts` |
| Desktop bridge authentication boundary | `scripts/desktop-bridge-security.js`, all four local agent bridge servers, `src/lib/bridgeAuth.ts`, `src/lib/desktopBridge.ts` |
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
| Attachment and Chat-approval authority deployment preflight and idle-safe bridge refresh | `scripts/attachment-authority-deployment-preflight.ts`, `scripts/attachment-authority-deployment-preflight-smoketest.ts`, `scripts/{desktop-bridge-safe-refresh,desktop-bridge-capability-readiness}-smoketest.ts`, `scripts/desktop-bridge-immutable-snapshot.js`, `scripts/{claude-bridge,browser-bridge,dev-stack-keepalive}.js`, `start-dev.js`, `supabase/migrations/{20260726_database_authority_guards,20260812_agent_run_artifact_integrity,20260813160000_message_attachment_link_integrity,20260813170000_message_attachment_visibility_integrity,20260813180000_device_private_run_approval_authority,20260813210000_openswan_chat_approval_resume_authority}.sql`, `docs/RUN_THIS_SQL.sql` §§28/38-41/44 |
| Exact single-use approval authority, encrypted exact-call Chat continuation, and inert plan manifest | `src/lib/chatApprovalGate.ts`, `src/lib/{openswanToolApprovals,openSwanApprovalResumeAuthority,openSwanApprovalResumeOutbox,openswanToolRuntime,openswanSessionRuntime,swanbot,swanbotV2BatchRuntime,chatAutomationPlanner,approvalCardModelCore}.ts`, `src/services/runApprovalsService.ts`, `src/components/RunApprovalBanner.tsx`, `src/screens/circles/tabs/ChatTab.tsx`, `scripts/{openswan-approval-resume-binding,openswan-approval-resume-exact-authority,openswan-approval-resume-stop-race,openswan-approval-resume-encrypted-outbox,openswan-approved-unconsumed-selector,openswan-chat-approval-resume-sql-authority,chat-openswan-approval-resume,approval-card-model-core}-smoketest.ts`, `scripts/chat-plan-tool-manifest-smoketest.ts`, `supabase/migrations/{20260726_database_authority_guards,20260813210000_openswan_chat_approval_resume_authority}.sql` / `docs/RUN_THIS_SQL.sql` §§28/44 |
| Scheduled external-action authority | `src/lib/scheduledActions.ts`, `supabase/functions/scheduled-action-runner/index.ts`, `supabase/migrations/20260726_scheduled_action_mutation_guard.sql` |
| Office durable command authority | `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Design creative AI | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Photoshop ExtendScript adapters | `src/lib/photoshopExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Local CAD execution | `src/lib/cadCodeExecutor.ts`, `src/lib/cadFileInspector.ts`, `desktop.cad_compile` |
| Engineering WORKFLOW (how the tools compose) | `docs/ENGINEERING_WORKFLOW.md` — the canonical loop `size (calc) → draw (draft_dxf) → model (model_3d) → measure (inspect_mesh) → tolerance (iso_fit/stack)`, walked on a worked cantilever-bracket example with real tool calls. Proven to compose: `npm run smoke:engineering-workflow-integration` chains the pure cores (20 cross-core assertions — the section modulus the geometry gives is consumed by the stress calc; the load-sized thickness is what the model is built with; the bore the model cuts is what the fit sizes) and `npm run drill:engineering-workflow-e2e` designs→models→builds-in-Blender→measures the bracket (volume/mass/bbox match design to 0.02%). Start here to USE the suite as a pipeline, not a pile of tools. ONE-CALL: `engineering.design_part` (`src/lib/engineeringDesignCore.ts`) packages the whole pipeline — give it a duty ({type:bracket/shaft/beam, load/torque/arm/span, material, safetyFactor}) and it sizes the member (round-up + re-check), emits a ready-to-compile bpy, and returns the mass, realised safety factor, and bore fit. `smoke:engineering-design-core` pins the recipes (bracket = the workflow integration chain). Wave 7 packages the five wave-6 composition drills as designers too — `gearbox`/`isolator`/`pressure_cover`/`conveyor_drive`/`brake` in `src/lib/engineeringDesign{Gearbox,Isolator,PressureCover,ConveyorDrive,Brake}Core.ts` (each rounds to stock + re-checks; honest ok:false refusal for uncoolable/un-isolatable duties); smokes verify by ROUND-TRIP (returned dims fed back into source lanes) + drill regression, `smoke:engineering-design-{gearbox,isolator,pressure-cover,conveyor-drive,brake}` (71/72/72/69/65) |
| Engine-neutral CAD drafting (DXF generation) | `src/lib/engineeringDraftingCore.ts` (pure DXF R12 writer/parser + floor-plan/schematic/grid generators), tool `engineering.draft_dxf` (pure computation, no app); the SAME neutral entity model compiles to AutoCAD `.scr` via `src/lib/autocadScriptAdapter.ts` `draft_entities` (execution gated on real-install verify). Cross-implementation proven by `scripts/dxf-verify.py` + `npm run drill:engineering-drafting`. `buildBoltCircle` adds flange/hole-pattern drawings; `engineeringDimensionCore.ts` + `annotateDrawing` add overall dimensions + title block (`titleBlock`/`autoDimension` args) — dimension TEXT is the MEASURED distance (a dim that lies = cut-the-wrong-part), asserted `text===formatDim(measured)`; verifier bbox expands CIRCLE/ARC by radius |
| Engine-neutral 3D solid modeling | `src/lib/engineeringSolidModelingCore.ts` (pure neutral CSG model → Blender bpy + OpenSCAD emitters + plate/bracket/tube/**flange** generators + `boltCirclePoints`), tool `engineering.model_3d` (pure computation); runs on the live-proven `desktop.cad_compile` blender lane → STL. Dimensionally proven end to end by `scripts/stl-verify.py` + `npm run drill:engineering-solid` (real Blender build → independent STL bbox check; flange = disc+bore+6-hole bolt circle → 2088 triangles at 120×120×12mm) |
| Engineering analysis (calculations) | `src/lib/engineeringCalcCore.ts` (pure: beam deflection/stress, section properties, column buckling Euler Pcr=π²EI/(KL)², shaft torsion τ=16T/πD³ + θ=TL/GJ, thermal expansion ΔL=αLΔT + restrained stress EαΔT, thin-wall pressure vessel σ_hoop=pr/t, spring rate k=G·d⁴/(8D³n), gear-pair transmission, bolt/thread, Ohm/LED/RC, unit conversion, materials with E + shear modulus G + thermal α), tool `engineering.calc` (kinds incl. `column_buckling`/`shaft_torsion`/`thermal_expansion`/`pressure_vessel`/`spring_rate`). Buckling composes the structural-section Iₓ; torsion composes materials G; thermal composes materials α. Textbook-exact — every formula asserted against a hand-computed reference in `scripts/engineering-calc-core-smoketest.ts` (the smoke IS the proof, no app). Sizes a part before `engineering.draft_dxf`/`engineering.model_3d` draw it |
| Rolling-bearing life (L10) | `src/lib/engineeringBearingCore.ts` (pure: `bearingLife` L10=(C/P)^p million rev, p=3 ball / 10/3 roller; equivalent load P=X·Fr+Y·Fa; L10h=L10·1e6/60n; ISO 281 reliability factor a1 for 90–99.95%). Pairs with the shaft lane (shaft carries torque, bearing carries the reaction loads). `engineering.calc` kind `bearing_life`. The steep power law is the point — halving the load × 8 the life, a 26% overload halves it. Textbook-pinned: C=25.5kN/P=5kN/ball → 132.65 Mrev, 1474 h @1500rpm; 99% reliability ×0.25. Smoke `engineering-bearing-core` IS the proof |
| Belt / pulley drives | `src/lib/engineeringBeltDriveCore.ts` (pure, composes the V-groove pulley: `beltDrive` speed ratio D₁/D₂, open-belt length L=2C+(π/2)(D+d)+(D−d)²/4C, wrap angles π∓2asin((D−d)/2C), capstan tension ratio T1/T2=e^(μθ) with V-belt wedge f=μ/sinβ, transmissible power (T1−T2)·V). `engineering.calc` kind `belt_drive`. The small pulley wraps least → slips first → sets capacity. Textbook-pinned: 100/200 pulleys @400 C → ratio 0.5, belt 1277.5mm, wrap 165.6° (+194.4°=360°), belt speed π·D₁·n₁; V-belt grips 3×+ a flat belt. Smoke `engineering-belt-drive-core` IS the proof |
| Power screws / lead screws | `src/lib/engineeringPowerScrewCore.ts` (pure, composes the ISO thread: `powerScrew` unwraps one turn into an inclined plane of lead angle λ=atan(l/πdm), raise torque T=(F·dm/2)(l+πf·dm)/(πdm−f·l), lower torque, efficiency η=Fl/2πT, self-locking test f>tanλ, collar torque; effective friction f=μ/cos(half-angle) so a V-thread wedges). Name an M-size → pitch diameter + coarse pitch supply dm + lead. `engineering.calc` kind `power_screw` (square/acme/iso forms, starts, collar). Textbook-pinned: dm=25/lead=5/μ=0.15/F=6000 → T=16.18 N·m, η=29.5%, self-locking; a fast lead screw back-drives. Smoke `engineering-power-screw-core` IS the proof |
| Mechanism kinematics (linkages) | `src/lib/engineeringKinematicsCore.ts` (pure: `grashof` classification s+l vs p+q + shortest-link position → crank-rocker/double-crank/double-rocker/non-Grashof; `fourBarPosition` Freudenstein output angle + coupler + transmission angle, VERIFIED by the loop-closure residual (crank-tip↔rocker-tip distance must equal the coupler); `crankSlider` piston x=r·cosθ+√(l²−r²sin²θ), stroke 2r, TDC/BDC, velocity). Analysis partner to the cam/rack motion geometry. `engineering.calc` kinds `four_bar` + `crank_slider` + `grashof`. Verified by SELF-CHECK not memorised angles: four-bar loop residual ≈0 at every input angle & both circuits. Textbook-pinned: slider TDC=r+l/BDC=l−r/mid=√(l²−r²). Smoke `engineering-kinematics-core` IS the proof |
| Heat transfer (thermal flow) | `src/lib/engineeringThermalCore.ts` (pure, imports MATERIALS which now carry thermal conductivity k: `conduction` Q=kAΔT/L + R=L/kA; `convection` Q=hAΔT + R=1/hA; `compositeWall` series thermal-resistance network + optional surface films → total R, heat rate, U-value, every interface temperature). The unifying idea = Ohm's law with ΔT as voltage, Q as current, so a layered wall is resistances IN SERIES. `engineering.calc` kinds `conduction` + `convection` + `composite_wall`. Composes materials k. Textbook-pinned: k=50 wall Q=50kW/R=0.002; h=25 convection Q=2000W; composite Q=ΔT/ΣR with insulation dominating (R≫ metal skin) + interface temps hot→cold. Smoke `engineering-thermal-core` IS the proof |
| Mechanical vibration (dynamics) | `src/lib/engineeringVibrationCore.ts` (pure, SI-internal: `naturalFrequency` ωn=√(k/m) OR √(g/δ) from static deflection — the two faces of one fact, k/m=g/δ; `dampedVibration` ζ=c/2√(km), critical damping cc=2√(km), damped ωd=ωn√(1−ζ²), under/critical/over classification, log decrement 2πζ/√(1−ζ²)). Composes spring rate k AND beam deflection δ. `engineering.calc` kinds `natural_frequency` + `damped_vibration` (stiffness N/m or springRate N/mm, mass kg, damping N·s/m or ratio). Textbook-pinned: k=1000/m=1 → fn=5.033 Hz; δ=1mm → fn=15.76 Hz (both faces agree); ζ=0.158 underdamped. Smoke `engineering-vibration-core` IS the proof |
| Pipe hydraulics (fluid flow) | `src/lib/engineeringFluidCore.ts` (pure, SI-internal: `FLUIDS` table ρ/μ, `reynoldsNumber` ρVD/μ, `frictionFactor` laminar 64/Re + turbulent Swamee–Jain, `pipeFlow` → Re, regime, f, Darcy–Weisbach head loss + Δp, continuity Q=VA). `engineering.calc` kind `pipe_flow` (diameter mm, velocity or flowRate, length, fluid, roughness). Composes the pipe/elbow bore. Unit discipline: convert mm/L-min → SI base at the boundary, physics factor-free. Textbook-pinned: water@2m/s@Ø50 → Re=99,601 turbulent; laminar f=64/Re EXACT; turbulent Swamee–Jain cross-checked vs Blasius 0.316/Re^0.25 within a few %; Δp=ρg·h_f consistent. Smoke `engineering-fluid-core` IS the proof |
| Manufacturing tolerances (ISO 286 fits + stack-up) | `src/lib/engineeringToleranceCore.ts` (pure: published IT5–IT11 grade table × 13 size ranges, hole `H` + shaft `h/g/f/k` fundamental-deviation formulas, `isoFit('H7','g6')` → limits + clearance/interference + fit type, `fitClearanceExplicit` for any deviations, `toleranceStackup` worst-case Σ\|tol\| + statistical RSS √Σtol² + largest contributor). `engineering.calc` kinds `iso_fit` + `tolerance_stack`. Closes the drafting dimension → manufacturable-part loop. Textbook-pinned: Ø50 H7/g6 = 9–50 µm clearance, Ø10 g6 = −5/−14, IT7@Ø10 = 15 µm (table, not round(16i)); stack RSS < worst-case. Smoke `engineering-tolerance-core` IS the proof |
| Engineering mesh inspection (measure a part) | `src/lib/engineeringMeshInspectCore.ts` (pure: binary-STL parse, bbox, volume via divergence theorem, surface area, watertight manifold check, mass), tool `engineering.inspect_mesh` (reads STL via new grant-gated `desktop.file_read_binary` base64 endpoint + `readFileBinary`). The measure-a-part partner to `engineering.model_3d`. MUTUAL-verified: `npm run drill:engineering-mesh-inspect` builds a part of known analytical volume in Blender then measures it back — plate agreed to 0.00%, flange 0.16% — so generator and inspector prove each other |
| Involute spur gears | `src/lib/engineeringGearCore.ts` (pure: exact gear geometry PD/OD/root/base, involute tooth profile, 2D `buildSpurGearDrawing`, 3D `buildSpurGearBlenderScript` via bmesh extrude + EXACT bore boolean). Wired as `engineering.draft_dxf` drawing 'gear' + `engineering.model_3d` part 'gear'. LIVE mutual-proven: `npm run drill:engineering-gear` builds Z12/Z24/Z40 gears in Blender, mesh-measures OD = m·(N+2) to 0.02%, all watertight |
| Helical gears | `src/lib/engineeringHelicalGearCore.ts` (pure, REUSES `spurGearProfile`: the same involute cross-section twisted along the axis at a helix angle β; `helicalGearGeometry` twist θ=W·tanβ/r_pitch, lead πd/tanβ, handedness; `buildHelicalGearBlenderScript` twist-extrudes the profile (bmesh rotated layers bridged + n-gon caps) then EXACT-subtracts a straight bore). The most common real gear (quieter/smoother than spur, adds axial thrust the bearing lane sizes). `engineering.model_3d` part 'helical_gear'. Verified by CAVALIERI: twisting a fixed-area section is volume-invariant, so a helical gear's volume EXACTLY equals its spur gear's (profileArea−bore)·face, independent of β. LIVE `npm run drill:engineering-helical-gear`: 15°/30°/25° gears in Blender — measured volume = spur volume to 0.01%, the 15° & 30° gears measure 0.000% apart despite different twist, all watertight, OD=m(N+2) envelope exact |
| Gear pairs (assemblies) | `src/lib/engineeringGearTrainCore.ts` (pure: exact pair geometry — center distance m·(N₁+N₂)/2, ratio, TANGENT pitch circles, 0.25m clearance, mesh phase; 2D assembly `buildGearPairDrawing` with center-distance dim; 3D `buildGearPairBlenderScript` composing two positioned/phased/bored gear units). `engineering.model_3d` 'gear_pair' + `engineering.draft_dxf` 'gear_pair' + `engineering.calc` 'gear_pair' (ratio/torque/speed transform — analysis composes geometry) + `engineering.calc` 'gear_train' (`gearTrain` in calcCore: COMPOUND train value = Π(driven/driver) over N stages, idlers cancel — completes single-gear→pair→train). The suite's first ASSEMBLY. LIVE: `npm run drill:engineering-gear-train` builds 3:1 & 1:1 pairs in Blender, mesh-measures span = ra₁+C+ra₂ to 0.2%, both watertight |
| Gear rack (rack-and-pinion) | `src/lib/engineeringRackCore.ts` (pure: a rack is a gear of infinite radius so its involute teeth are exactly TRAPEZOIDAL — straight flanks at pressure angle φ; `rackGeometry` circular pitch π·m, addendum m/dedendum 1.25m, tip narrower than root; profile = base strip + N trapezoid teeth; `buildRackBlenderScript` EXTRUDES the profile by faceWidth via the profile-solid extruder — no boolean). Completes the gear family (mates the spur `gear` pinion of the same module). `engineering.model_3d` part 'rack'. Verified TWO independent ways: outline shoelace area = base-rect + N tooth-trapezoids (smoke), extrude volume = area·faceWidth (drill). LIVE `npm run drill:engineering-rack`: m2×6 & m3×4 racks in Blender — volume to 0.000%, watertight, length×height×face envelope exact, teeth wider at root than tip |
| Profile solids: extrude + revolve | `src/lib/engineeringProfileSolidCore.ts` (pure: polygon area/centroid, extrudeVolume=A·h, revolveVolume=2π·R̄·A Pappus; general `buildExtrudeBlenderScript` reusing the gear extrude unit; `buildRevolveBlenderScript` via Blender Screw modifier; turnkey V-groove `buildPulley`). Completes the modeling triad (CSG + extrude + revolve). `engineering.model_3d` parts 'extrude'/'revolve'/'pulley'. LIVE Pappus cross-check `npm run drill:engineering-profile-solid`: extrude L-section 0.00%, revolve tube 0.03%, pulley 0.03% vs analytical, all watertight — a 3rd independent volume method agreeing with the mesh |
| Helical solids: compression spring | `src/lib/engineeringHelixCore.ts` (pure: `helixPoints`, developed length n·√((2πR)²+p²), `springGeometry` pitch/OD/ID/index/active-coils + wire volume π(d/2)²·L; `buildSpringBlenderScript` via a POLY helix curve with circular bevel + `use_fill_caps` → watertight mesh). The helical class beyond pure revolution — the developed-length volume is the helical analogue of Pappus. `engineering.model_3d` part 'spring'; sizes the rate k=G·d⁴/(8D³n) via `engineering.calc` 'spring_rate' (materials now carry shear modulus G). LIVE `npm run drill:engineering-helix`: two springs in Blender, mesh-measured wire volume within 1.0% of developed-length (faceting-limited, converges up with bevel resolution), OD=D+d exact, free length exact, both watertight |
| ISO metric threaded fasteners | `src/lib/engineeringThreadCore.ts` (pure: `isoMetricThread` exact ISO diameters d2=d−0.6495P/d3=d−1.2269P, `ISO_COARSE_PITCH` M-series table, `threadedRodGeometry` turns/developed-length + minor/pitch/major cylinder volumes; `buildThreadedRodBlenderScript` builds the thread as a radial HEIGHTFIELD r(θ,z)=minor+threadHeight·tooth((z−θP/2π)/P) on ONE swept fan-capped tube — NO boolean). The second helical solid; composes with `engineering.calc` bolt/tap-drill (size an M8 → model the M8). `engineering.model_3d` part 'thread'. Verified by a rigorous BRACKET not a point: measured STL volume must lie in [minorCyl, majorCyl] and near pitchCyl. LIVE `npm run drill:engineering-thread`: M8×1.25 & M12×1.75 in Blender — watertight, volume in-bracket at −1% of pitch cylinder, OD=d and length exact. KEY: in-Blender manifold ≠ STL manifold (a boolean union of a separate rib read watertight in-memory but left non-manifold edges on the re-welded STL; the single swept heightfield has no union boundary) |
| Sheet-metal bending | `src/lib/engineeringSheetMetalCore.ts` (pure: `bendAllowance` BA=θ(R+K·t), `sheetMetalGeometry` folds a flange/bend sequence into TWO developed lengths — fabrication flat blank Σflanges+ΣBA (uses K) and geometric mid-surface Σflanges+Σθ(R+t/2) — plus area/volume/bbox; `bentProfilePolygon` thickens the folded centreline into a ±t/2 ribbon; `buildBentPartBlenderScript` EXTRUDES that ribbon by the width, reusing the profile-solid extruder — NO boolean). A new class beyond solids of revolution. `engineering.model_3d` part 'sheet_metal'. The two lengths differ by exactly Σθ·t·(0.5−K) — the shop cuts the K length, the solid weighs the mid-surface length. LIVE `npm run drill:engineering-sheet-metal`: 90° L-bracket & U-channel in Blender — volume = t·L_geo·width to 0.01%, watertight, predicted bbox exact |
| Structural steel sections + beams | `src/lib/engineeringStructuralSectionCore.ts` (pure: ONE verified primitive `sectionProperties(rects)` — A, centroid, Iₓ/Iy via parallel-axis over signed rectangles (holes = negative), Sₓ/Sy, rₓ/ry; named `iBeamSection`/`channelSection`/`angleSection` (doubly-sym / singly-sym / asymmetric) each a rectangle decomposition + outline polygon; `buildBeamBlenderScript` EXTRUDES the outline by length via the profile-solid extruder — NO boolean). The structural arm; composes `engineering.calc` beam (feed Iₓ/Sₓ → deflection δ=PL³/48EI, stress). `engineering.model_3d` part 'beam'. Independent area cross-check: outline shoelace = rectangle-sum A. LIVE `npm run drill:engineering-structural-section`: I-beam/channel/angle in Blender — volume = A·length to 0.000%, watertight, predicted bbox exact; section props textbook-pinned in smoke |
| Structural frames / weldments | `src/lib/engineeringFrameCore.ts` (pure: `FrameMember` {axis,length,width,depth,at} → box; `frameUnionVolume` EXACT by inclusion–exclusion (pairwise fast-path when no triple joints, full 2ⁿ for n≤16, else bracket); `frameGeometry` steel takeoff — union volume, member schedule, envelope, mass; `frameSolidModel`→box positives; turnkey `portalFrame`/`rectangularFrame`; `buildFrameBlenderScript` unions via the PROVEN CSG lane `writeBlenderSolidScript` — reuse, not a new mesh path). The structural ASSEMBLY (as gear pairs were the mechanical one). `engineering.model_3d` part 'frame'. Composes CSG + materials mass. LIVE `npm run drill:engineering-frame`: portal/rectangular/ladder frames in Blender — measured volume = inclusion–exclusion union to 0.000%, watertight, envelope exact |
| Hex fasteners (bolt + nut) | `src/lib/engineeringFastenerCore.ts` (pure: `HEX_ACROSS_FLATS` ISO 272 wrench-size table, `hexBoltGeometry`/`hexNutGeometry` closed-form volumes, `buildHexBoltBlenderScript` head∪shank, `buildHexNutBlenderScript` hex−bore — a hex prism is a 6-vertex Blender cylinder, unioned/subtracted with the EXACT solver). The recognizable fastener shapes atop the ISO thread. `engineering.model_3d` parts 'bolt'/'nut'. Volumes: bolt = hexArea·headH + shank − overlap; nut = hexArea·h − bore. LIVE `npm run drill:engineering-fastener`: M10/M16 bolts & nuts in Blender — volume to 0.1%, watertight, across-flats/across-corners/height envelope exact, nut bore confirmed present |
| Fatigue analysis (endurance + mean stress + life) | `src/lib/engineeringFatigueCore.ts` (pure: `enduranceLimit` Se=ka·kb·kc·Se', Se'=0.5·Su cap 700 with Marin surface/size/load derating + Su-from-yield flag; `goodmanSafetyFactor` 1/n=σa/Se+σm/Su plus Soderberg/Gerber/Langer; `fullyReversedLife` Basquin S=a·N^b with infinite/finite/low_cycle regimes). The static-pass-is-not-enough lane — a fluctuating stress under yield still cracks. `engineering.calc` kinds `endurance_limit`/`fatigue_goodman`/`fatigue_life`. NO build (fatigue is statistical material behaviour): the smoke IS the proof — 59 assertions pinned to Shigley reference values, every Marin factor + three mean-stress criteria + runout/finite/low-cycle boundaries |
| Bolted + welded connections | `src/lib/engineeringConnectionCore.ts` (pure: `filletWeld` throat=0.7071·leg carries load not the leg, capacity a·L·τ; `boltGroupShear` As=π/4·(d−0.9382p)² thread-root reusing `coarsePitchFor` from `engineeringThreadCore`, single/double shear; `bearingStress` σ=P/(d·t·n) projected; `boltGroupEccentric` elastic vector method J=Σ(x²+y²), critical bolt where direct⊕torsional shear ALIGN). The joint is where structures fail. `engineering.calc` kinds `fillet_weld`/`bolt_group`/`bolt_bearing`/`bolt_group_eccentric`. Smoke IS the proof — 47 assertions vs worked examples incl. the eccentric-group critical-bolt location |
| Hydraulic cylinders | `src/lib/engineeringCylinderCore.ts` (pure: `cylinderForce` extend p·π(bore/2)² vs retract annulus p·π(bore²−rod²)/4 + regen ratio φ; `cylinderSpeed` v=Q/A retract-faster; `rodBuckling` Euler Pcr=π²EI/(KL)² I=π·d⁴/64). Extend≠retract (rod steals area); rod buckles not crushes. `engineering.calc` kinds `hydraulic_cylinder`/`cylinder_speed`/`rod_buckling`. Smoke IS the proof — 41 assertions + the **F·v=p·Q power invariant** closed so the force lane and flow lane certify each other (two physics domains reconcile, like the geometry lanes' three-volume-method agreement) |
| Gear tooth strength (Lewis bending) | `src/lib/engineeringGearStrengthCore.ts` (pure: `tangentialLoad` Ft=T/r; `lewisBendingStress` σ=Ft/(F·m·Y) — a tooth is a cantilever beam; `sizeFaceWidth` inverse mode; `lewisFormFactor`+`LEWIS_Y` published table interpolated). The OTHER gear failure mode beside geometry — composes module/teeth/torque from the geometry+train lanes. `engineering.calc` kind `gear_strength` (mode tangential_load/stress/size_face_width). Smoke IS the proof — 43 assertions, tabulated Y (hard-coded like the ISO fit table), monotonicities + size↔check round-trip |
| Combined-stress state (Mohr + von Mises) | `src/lib/engineeringStressCore.ts` (pure: `principalStresses` Mohr σ1,2=(σx+σy)/2±√(((σx−σy)/2)²+τxy²)+θp; `vonMises` component form √(σx²−σxσy+σy²+3τxy²) AND principal form cross-checked; `maxShearStress` in-plane vs absolute-3D with hidden σ3=0 governing when σ1,σ2 share a sign). A single component stress lies under combined loading. `engineering.calc` kinds `principal_stress`/`von_mises`/`max_shear`. Smoke IS the proof — 46 assertions, and von Mises computed **two ways that must agree** proves the whole Mohr→vM chain for free |
| Stress concentration (Kt) + notch fatigue (Kf) | `src/lib/engineeringStressConcentrationCore.ts` — `stressConcentration` (Kirsch hole Kt=3 exact, finite-width Heywood/Roark net-section fit, Inglis elliptical Kt=1+2(a/b) with ρ=b²/a self-check, hard-coded Peterson/Shigley A-15 stepped-shaft chart table bilinearly interpolated for tension/bending/torsion) + `notchFatigue` (Peterson q=1/(1+a/r), Kf=1+q(Kt−1), Se_corrected=Se/Kf; a=0.025·(2070/Su)^1.8 from Su or MATERIALS 1.7·yield); `engineering.calc` kinds `stress_concentration`/`notch_fatigue`; composes the geometric Kt into fatigue and derates the endurance-limit lane. Smoke IS the proof — 83 assertions pinning the exact Kt=3 anchor two ways (Kirsch + Inglis circle), the two-path Inglis ρ-form self-check, table nodes/monotonicity/mode-ordering, and the load-bearing invariant Kf≤Kt with blunt→Kt / sharp→1 limits and Se_corrected<Se |
| Thick-walled cylinders (Lamé) + interference (press/shrink) fits | `src/lib/engineeringThickCylinderCore.ts` (pure: `thickCylinder` σr=A−B/r², σθ=A+B/r², A/B from pi/po at ri/ro — bore/outer hoop+radial, bore max shear=pi·ro²/(ro²−ri²), 3D von Mises, capped-end axial=A; `pressFit` diametral interference δ → contact pressure via the shrink-fit compliance δr=p·rc·[(1/Eo)((ro²+rc²)/(ro²−rc²)+νo)+(1/Ei)((rc²+ri²)/(rc²−ri²)−νi)], hub & shaft stresses through the SAME Lamé engine, holding torque T=µ·p·2π·rc²·L). `engineering.calc` kinds `thick_cylinder` + `press_fit`. COMPOSES pressure_vessel (its THIN-WALL limit t→0 reproduces σ=pr/t — cross-checked live against the pressure_vessel lane to 1.0%), iso_fit (consumes its interference δ), shaft_torsion (delivers the holding torque). Verified by EXACT BCs (σr=−pi at bore, −po at outer surface), the σr+σθ=2A radius-invariant, hand-computed Lamé/shrink-fit cases; smoke `engineering-thick-cylinder-core` (104 assertions) IS the proof; MATERIALS has no Poisson so ν defaults to 0.3 |
| Hertzian contact stress (bearings/gears/cams) | `src/lib/engineeringContactCore.ts` (pure: `contactStress` mode 'sphere'=point contact → a=(3FR/4E*)^(1/3), p_max=3F/2πa², δ=a²/R; mode 'cylinder'=line contact → b=√(4FR/πLE*), p_max=2F/πbL; reduced modulus 1/E*=(1−ν₁²)/E₁+(1−ν₂²)/E₂, effective radius 1/R=1/R₁+1/R₂ with R₂ omitted/∞=flat, R₂<0=concave race). The CONTACT failure mode UNDER the bearing-L10, involute-gear, and cam lanes — a ball on a race, a gear tooth flank, a cam roller all reduce to a Hertz contact; these elements fail by pitting/spalling, not by the gross bending/torsion the calc core sizes. `engineering.calc` kind `contact_stress`. Poisson ν absent from MATERIALS → input, default 0.3. EXACT-ratio anchors: sphere p_max/p_mean=3/2, cylinder=4/π; p_max∝F^(1/3) sub-linear so a 1 kN ball contact runs several GPa (~18× yield) yet survives (triaxial confinement). Smoke IS the proof — 82 assertions: two exact ratios, textbook two-steel-sphere + steel-roller hand-computed, sphere-on-flat = R₂→∞ limit, concave-race LOWERs p_max, F^(1/3)/F^(1/2) signature scaling, swap symmetry |
| Parallel-key sizing (keyed shaft-hub joint) | `src/lib/engineeringKeyCore.ts` (pure: `standardKeySize` hard-coded ISO 773/DIN 6885 w×h section table for a shaft Ø (w≈d/4 fallback); `keySizing` sizes the key by TWO failure modes off the surface force F=2T/d — SHEAR across w·L → L_shear=F/(w·τ_allow), and BEARING/crushing across (h/2)·L → L_bear=F/((h/2)·σ_bear_allow) — required length = max, larger mode governs, allowables 0.4·σy shear / 0.9·σy bearing or overrides; `keyTorqueCapacity` inverse). Composes shaft_torsion: the key is the deliberate WEAK LINK sized for the same torque so it shears/crushes before the shaft. `engineering.calc` kind `key_sizing`. Verified by the BALANCED-KEY anchor: a square key at σ_bear=2τ has L_shear=L_bear exactly, a rectangular key (w>h) then crushes by w/h; + table monotonicity + size↔capacity round-trip reproducing the design torque. Smoke `engineering-key-core` IS the proof (156 assertions) |
| Friction clutches & brakes (torque capacity) | `src/lib/engineeringClutchBrakeCore.ts` (pure: `discClutch` carries BOTH bounding models — uniform PRESSURE T=(2/3)μFn(ro³−ri³)/(ro²−ri²) new + uniform WEAR T=(1/2)μFn(ro+ri) worn-in, wear ALWAYS lower → the design torque; `bandBrake` = a CAPSTAN that REUSES the belt-drive law T1/T2=e^(μθ), torque (T1−T2)·rd; `coneClutch` = a V-WEDGE that REUSES the V-belt 1/sinα so T = flat-clutch T / sinα). The suite RECOGNISES ITS OWN PRIMITIVES — a band brake IS the belt capstan, a cone clutch IS the V-belt wedge. `engineering.calc` kinds `friction_clutch` (disc + cone via `type`) + `band_brake`. Verified by the uniform-wear<uniform-pressure DUALITY ordering, the thin-ring limit where both disc models converge to μFnR, the exact capstan cross-check (doubling wrap SQUARES the ratio), cone→disc as α→90°. Smoke `engineering-clutch-brake-core` IS the proof (94 assertions) |
| Intermediate & eccentric columns (Johnson + secant) | `src/lib/engineeringColumnCore.ts` (pure: `columnCritical` auto-selects EULER σcr=π²E/λ² when λ≥Cc else J.B. JOHNSON parabola σcr=Sy·[1−Sy·λ²/(4π²E)]; `eccentricColumn` SECANT σmax=(P/A)[1+(ec/k²)·sec((KL/2k)√(P/AE))]; exports `transitionSlenderness`/`eulerCriticalStress`/`johnsonCriticalStress`). The honest COMPLEMENT to calc-core `column_buckling` (Euler-only, over-predicts for stocky columns). Composes MATERIALS (E, yield) + the structural-section k=√(I/A) (accepts area+radiusOfGyration OR area+momentOfInertia OR round diameter). `engineering.calc` kinds `column_johnson` + `eccentric_column`. Verified by the TANGENCY anchor: Euler and Johnson meet at λ=Cc=√(2π²E/Sy) with EQUAL σcr=Sy/2 AND equal slope −2π²E/Cc³ — pinned from BOTH formulas (why the transition sits at Cc). Textbook-pinned (Shigley): steel λ=40→Johnson 237.3 MPa (Euler would say absurd 1233.7), λ=180→Euler 60.9; secant e→0→P/A, σmax→∞ as P→Pcr. Smoke `engineering-column-core` (92 assertions) IS the proof |
| Forced vibration + isolation (dynamics) | `src/lib/engineeringForcedVibrationCore.ts` (pure, COMPOSES the vibration core's ωn=√(k/m) and ζ=c/2√(km)): `forcedResponse` steady-state under F0·sin(ωt) — magnification M=1/√((1−r²)²+(2ζr)²), amplitude X=(F0/k)·M, phase φ=atan2(2ζr,1−r²), true peak at r=√(1−2ζ²), plus rotating-unbalance form M_r=r²·M; `transmissibility` TR=√(1+(2ζr)²)/√((1−r²)²+(2ζr)²), solves r for a target TR / isolation % → needed static deflection δ=g/ωn². `engineering.calc` kinds `forced_vibration` + `vibration_isolation`. Two exact anchors ARE the proof: resonance M(1)=1/(2ζ), and the √2 crossover TR=1 at r=√2 for EVERY ζ (isolate only above √2, and MORE damping there means WORSE TR). Smoke `engineering-forced-vibration-core` (106 assertions) IS the proof |
| Bolted-joint stiffness diagram + bolt fatigue | `src/lib/engineeringBoltedJointCore.ts` (pure: `jointStiffness` bolt spring kb=Ab·E/L (or shank+thread series) + members-as-frusta Shigley km=π·E·d·tan30°/(2·ln[5(L·t+0.5d)/(L·t+2.5d)]) → joint constant C=kb/(kb+km); `separationLoad` P0=Fi/(1−C); `boltFatigue` σa=C·ΔP/2At, σm=[Fi+C·ΣP/2]/At → standard AND preload-referenced Goodman nf=Se(Su−σi)/(Su·σa+Se(σm−σi))). The layer between `bolt_preload` and the fatigue core that explains WHY preload works: because members are stiffer than the bolt (km≫kb), C is small (~0.24) so the bolt feels only C·P of an external load — separation at Fi/(1−C), and bolt fatigue is far milder than the raw load range. `engineering.calc` kinds `joint_stiffness` + `bolt_fatigue`. Smoke IS the proof — 76 assertions, textbook Shigley M12 joint pinned + invariants (C=0.5 at kb=km, load-split C·P+(1−C)·P=P closes, Fm=0 at P0, stiffer-member→lower-C→better-fatigue) |
| Flywheel energy storage + speed-fluctuation sizing | `src/lib/engineeringFlywheelCore.ts` (pure: `flywheelInertia` disc I=½mr² / thin-rim I=mr² / annulus I=½m(ro²+ri²), mass from geometry×density or direct; `flywheelEnergy` the sizing relation ΔE=I·ωavg²·Cs solved every direction — required I=ΔE/(ωavg²·Cs), traded ΔE, or achieved Cs — plus KE=½Iωavg² and the ωmax/ωmin=ωavg(1±Cs/2) band; `flywheelStress` rim hoop σ=ρv²=ρ(ωr)² and size-independent burst v=√(σ_allow/ρ)). The ROTATING-INERTIA arm — a flywheel smooths shaft speed by trading KE. Composes MATERIALS density (mass, kg/mm³→kg/m³ for hoop stress) + yield; radii convert mm→m at the inertia/rim-speed boundary so I stays kg·m². `engineering.calc` kind `flywheel` (mode inertia/energy/stress). Anchored: at equal mass & radius a RIM stores exactly 2× a DISC's inertia (why flywheels are rims). Textbook-pinned — Shigley/Khurmi (Cs=0.0168), I∝1/Cs, KE∝ω² square law, burst-speed scale-invariance. Smoke `engineering-flywheel-core` (79 assertions) IS the proof |
| Spring types beyond compression (torsion/extension/Belleville) | `src/lib/engineeringSpringTypesCore.ts` (pure: `torsionSpring` — helical torsion spring works in wire BENDING so its angular rate k'=E·d⁴/(10.8·D·N) uses YOUNG'S modulus E + inner-fibre bending stress σ=Ki·32M/πd³; `extensionSpring` — same G-rate as compression k=G·d⁴/(8D³n) BUT with INITIAL TENSION Fi so F=Fi+k·x and force≠0 at zero deflection; `belleville` — coned-disc Almen–Laszlo P=[4E/(K1(1−ν²)Do²)]·δ·[(h−δ/2)(h−δ)t+t³], NONLINEAR (cubic in δ), stacks parallel=+load/series=+deflection). `engineering.calc` kinds `torsion_spring`/`extension_spring`/`belleville`. Composes materials E+G. THE DUALITY: a torsion spring bends its wire (E) while a helical compression spring twists its wire (G) — same coil, different modulus (steel E≈2.5·G); Belleville h/t=√2 gives a constant-force plateau, h/t>√2 snaps through. Smoke `engineering-spring-types-core` IS the proof — 72 assertions, the E-vs-G duality pinned against the shipped compression `springRate` |
| Combined-load shaft design (bending + torsion, static + fatigue) | `src/lib/engineeringShaftDesignCore.ts` (pure, the CAPSTONE composing torsion+beam+stress+fatigue: `shaftDiameter` sizes a solid round shaft under simultaneous M+T by MAX-SHEAR-STRESS d³=(32n/πSy)·√(M²+T²) (equivalent moment Me=√(M²+T²)) AND DISTORTION-ENERGY d³=(32n/πSy)·√(M²+¾T²), reports both + stress state + which governs (MSST larger→conservative, DE≤MSST equal only at T=0); `shaftFatigue` the Shigley DE-Goodman rotating-shaft Eq. 7-8 d=((16n/π)·[√(4(Kf·Ma)²+3(Kfs·Ta)²)/Se+√(4(Kf·Mm)²+3(Kfs·Tm)²)/Sut])^(1/3) — 4-on-bending/3-on-torsion coefficients pinned to Shigley Ex 7-1 (n=1.614); `equivalentLoads` Me=½(M+√(M²+T²))/Te=√(M²+T²)). `engineering.calc` kinds `shaft_diameter`+`shaft_fatigue`. Composes MATERIALS (Sy). Verified by LIMITING CASES: T=0→pure bending σ=Sy/n, M=0→pure torsion τ=Sy/(2n) reproducing the shaft_torsion lane (smoke feeds d back into `shaftTorsion`/`sectionCircle`/stress-core `vonMises` and recovers 125/250/229.13); 87-assertion smoke IS the proof |
| 2D pin-jointed truss (method of joints) | `src/lib/engineeringTrussCore.ts` (pure: `solveTruss` writes the 2j joint-equilibrium equations ΣFx=ΣFy=0 — each member's axial force × its unit vector, TENSION +, plus pin/roller reactions + applied loads — into A·x=b and solves with an in-file dense GAUSSIAN ELIMINATION w/ partial pivoting (`solveLinearSystem`, no library); determinacy guard m+r vs 2j classifies mechanism (<) / determinate (=) / indeterminate (>), and a zero pivot ⇒ geometrically unstable even when the count is right; flags zero-force members; roller honours an incline angle). `engineering.calc` kind `truss`. VERIFIED BY the per-joint EQUILIBRIUM RESIDUAL exactly like the four-bar loop-closure residual — `jointResiduals` recomputes ΣF at every joint from the solved forces (independent of the assembly), must be ~0 (~1e-13), no answer key — plus global ΣFx/ΣFy/ΣM=0, two hand-worked textbook trusses (3-4-5 triangle; king-post zero-force post), Rule-1 zero-force detection, and the three determinacy/stability guards. Smoke `engineering-truss-core` (111 assertions) IS the proof |
| Worm-and-wheel drives | `src/lib/engineeringWormGearCore.ts` (pure: a worm IS a power screw meshing a wheel — same lead angle λ=atan(L/πdw), same self-locking λ<φ ⇔ f>tanλ; `wormGear` VR=Zg/Zw is a HUGE single-stage reduction (1-start/40-tooth=40:1), η=tanλ/tan(λ+φ) with the pressure-angle wedge f=μ/cos(φn) collapsing the full η EXACTLY, self-locking⇒η<½ clean fact (boundary (1−f²)/2), reverse η=tan(λ−φ)/tanλ≤0 ⇔ self-locking as an exact iff). `engineering.calc` kind `worm_gear`. Composes the power screw's inclined-plane physics wholesale (recognise-your-own-primitive, like rack=infinite-radius-gear, band-brake=capstan). Smoke `engineering-worm-gear-core` IS the proof — 72 assertions incl. the CROSS-CHECK that a power screw & worm at the same λ,f give the identical self-locking verdict + lead angle, η computed two ways agree to 15 sig-figs, VR pinned, textbook triple-start (Zw=3/Zg=30 → VR=10, λ=16.70°, η≈84.0%) |
| Tuned dynamic vibration absorber | `src/lib/engineeringVibrationAbsorberCore.ts` (pure: undamped 2-DOF Den Hartog absorber — primary m1/k1 driven by F0·sin(Ωt) gets absorber m2/k2; exact determinant D=(k1+k2−m1Ω²)(k2−m2Ω²)−k2², X1=F0(k2−m2Ω²)/D. THE TUNING: when ωa=√(k2/m2)=Ω the numerator vanishes so X1=0 exactly — the primary stands still and the absorber's spring force k2·X2=−F0 cancels the disturbance. COST: two new resonances (roots of D=0) that STRADDLE the original ωn=√(k1/m1), spacing=√μ when tuned to ωn — larger μ widens the safe band. Explicit / design / dimensionless modes; composes the vibration core's naturalFrequency for ωn & ωa). `engineering.calc` kind `vibration_absorber`. Smoke `engineering-vibration-absorber-core` (111 assertions): X1=0 & k2·X2=−F0 at tuning, the two-root straddle + √μ spacing, Den Hartog closed form, composition — IS the proof |
| Hydrodynamic journal (sleeve) bearing | `src/lib/engineeringJournalBearingCore.ts` (pure: `journalBearing` floats the shaft on an oil film — NO rolling elements; the Sommerfeld number S=(r/c)²·μN/P is the ONE dimensionless group governing everything; Petroff concentric friction f=2π²·(μN/P)·(r/c)=2π²·S·(c/r) is the clean analytic anchor and LOWER bound — pass a Raimondi–Boyd (r/c)f for the loaded case; friction torque Tf=f·W·r, power loss Tf·ω, min film h0=c(1−ε) with ε→1 = metal-to-metal failure). The FLUID-FILM complement to the rolling-element `bearing_life` lane; composes fluid viscosity (accepts Pa·s / SAE-grade `OILS` table / reyn). `engineering.calc` kind `journal_bearing`. RUTHLESS unit discipline (Pa·s, rev/s, Pa, reyn→×6894.757, rpm→/60) — S dimensionless proven by exact scaling, Petroff textbook-pinned (Shigley ch.12). Smoke `engineering-journal-bearing-core` IS the proof (78 assertions) |
| Straight bevel gears (angular drive, intersecting shafts) | `src/lib/engineeringBevelGearCore.ts` (pure, NO imports: `bevelGearPair` rolls two pitch CONES for shafts meeting at Σ — cone angles tan γ_p=sinΣ/(Ng/Np+cosΣ) with γ_p+γ_g=Σ (atan2, obtuse-safe), ratio Ng/Np=tan γ_g at 90°; TREDGOLD equivalent spur Ne=N/cosγ (>N always) develops the back cone so the Lewis strength lane applies to a bevel tooth; mean radius r_m=r_pitch−½F·sinγ; shared tangential Ft=T/r_m resolves to radial Wr=Ft·tanφ·cosγ + axial thrust Wa=Ft·tanφ·sinγ). COMPLETES the gear family (spur/helical/rack/worm were parallel-or-crossed) and composes the Lewis lane via Ne. `engineering.calc` kind `bevel_gear`. Verified four ways: cone-angle sum γ_p+γ_g=Σ (90° and 150° obtuse), cone distance r_pitch/sinγ agreeing from BOTH members (shared-apex self-check) = (m/2)√(Np²+Ng²) at 90°, Ne>N monotone in γ, the Σ=90° force-SWAP identity Wr(pinion)=Wa(gear) & Wa(pinion)=Wr(gear); textbook-pinned (Np20/Ng40/m4/φ20 → Ft=6007.5 N). Smoke `engineering-bevel-gear-core` (63 assertions) IS the proof |
| Roller chain drives | `src/lib/engineeringChainDriveCore.ts` (pure: `chainDrive` — sprocket PITCH DIAMETER PD=p/sin(180/N) is EXACT polygon geometry (N pins = an N-gon of side p, not a circle); ratio=N2/N1 EXACT because rollers positively engage (no belt slip); chain LENGTH L=2·Cp+(N1+N2)/2+((N2−N1)/2π)²/Cp rounded UP to an EVEN number of pitches (odd needs a weak offset link) then centre distance solved back via the Shigley quadratic; chordal/polygon speed ripple 1−cos(180/N) falls with tooth count, why ~17T is a floor; chain speed N1·p·n1, power P=F·V). Completes the gear/belt/chain transmission family — the positive-engagement sibling of the belt (exact ratio where the belt slips). `engineering.calc` kind `chain_drive`. Smoke IS the proof — 64 assertions: PD·sin(180/N)=p polygon identity at 7 N, 4-tooth square PD=p√2, polygon→circle limit, integer-exact ratios, both even-round branches + adjusted-centre round-trip, chordal 11T>17T>25T (17T~1.7%), F·V=P invariant |
| Flat plate bending (Roark, 2D analogue of a beam) | `src/lib/engineeringPlateBendingCore.ts` (pure: `platePressure` — flat plate under uniform pressure q. CIRCULAR uses exact ν-dependent Roark Table 11.2 — clamped σ_edge=0.75·q(a/t)², y=3q·a⁴(1−ν²)/(16E·t³); simply-supported σ_center=(3/8)(3+ν)·q(a/t)², y=3q·a⁴(1−ν)(5+ν)/(16E·t³). RECTANGULAR HARD-CODES the Roark Table 11.4 β/α table for a/b=1.0…2.0+∞ (like the ISO-286 IT-grade table) and interpolates: σ=β·q·b²/t², y=α·q·b⁴/(E·t³)). `engineering.calc` kind `plate_bending`. The 2-D analogue of the beam lane: σ∝(a/t)², y∝a⁴/t³; clamping is stiffer (~4× less deflection) but concentrates edge stress; as a/b→∞ the plate → a 1-D beam strip (β→0.75 SS / 0.5 clamped). Composes MATERIALS (E) + POISSON_RATIO. Smoke IS the proof — 82 assertions: scaling laws, clamped<SS deflection + clamped>SS edge stress, textbook-pinned, table monotonicity, the a/b→∞ strip limit tied to beam-strip theory |
| Extended-surface (fin) heat transfer | `src/lib/engineeringFinCore.ts` (pure: a fin is conduction ALONG the metal k·Ac fighting convection OFF its surface h·P, collapsing to one group m=√(hP/kAc); `finAnalysis` gives θ(x)/θb=cosh(m(L−x))/cosh(mL), heat rate Q=√(hPkAc)·θb·tanh(mL)=M·tanh(mL), efficiency η=tanh(mL)/mL, effectiveness ε=Q/(h·Ac·θb); rectangular/pin/custom shapes + convecting-tip corrected length Lc=L+Ac/P). The extended-surface partner to the thermal core — composes its conductivity k (MATERIALS) and film coefficient h. `engineering.calc` kind `fin_heat`. Smoke IS the proof — 75 assertions: η→1 as mL→0 (short/fat/high-k = ideal) and η→0 as mL→∞ (long tip is dead weight) + monotone, Q saturates with length, ε>2 justifies a fin and FALLS as h rises (a fin helps only when convection is the bottleneck), copper>aluminum>steel by k, textbook-pinned (Incropera/Cengel) |
| Riveted / bolted lap & butt joints (boiler seam) | `src/lib/engineeringRivetJointCore.ts` (pure: `rivetedJoint` sizes a seam per PITCH by three competing failure forces — plate TEARING Pt=σt(p−d)t across the net width, rivet SHEARING Ps=τ(π/4·d²)·n·planes, and CRUSHING Pc=σc·d·t·n on the projected area — the WEAKEST governs; solid-plate σt·p·t gives joint efficiency η=weakest/solid-plate, always in (0,1)). Adds the tearing mode + efficiency concept the bolt/weld `engineeringConnectionCore` lane lacked; shear planes = lap/single-cover-butt 1, double-cover-butt 2 (double shear doubles Ps). `engineering.calc` kind `riveted_joint`. Textbook-pinned Khurmi Ex 9.2 double-riveted lap (t15/d25/p75) → tearing 300 kN governs, η=66.7%. Smoke IS the proof — 67 assertions: η∈(0,1) + strength=min, governing-mode FLIPS (each mode weakest in turn), balanced beats unbalanced at equal solid-plate, double-cover doubles Ps, Pt is n-independent so the plate eventually tears |
| Pipe fittings: elbow | `src/lib/engineeringPipeCore.ts` (pure: `elbowGeometry` partial-revolve Pappus wall volume θ·Rb·π(ro²−ri²) + bore/fluid volume θ·Rb·π·ri²; `buildElbowBlenderScript` sweeps the pipe annulus along the bent centreline in bmesh — outer wall + inward bore wall + annular end caps → watertight, NO boolean). A new toroidal/swept class; θ=360° is the torus-shell limit. `engineering.model_3d` part 'elbow' (angle/bendRadius/od/id or wall). LIVE `npm run drill:engineering-pipe`: 90°/45°/180° elbows in Blender — wall volume = partial Pappus to 0.18%, watertight, bore proven open. A 4th independent volume method (partial revolve) beside extrude/full-Pappus/CSG |
| Disc cams (motion) | `src/lib/engineeringCamCore.ts` (pure: `motionFraction` uniform/harmonic/cycloidal displacement laws; `camProfilePoints` folds a dwell/rise/fall program into a polar profile r(θ)=rb+s(θ); `camGeometry` base/peak radius, shoelace area, volume; `buildCamBlenderScript` EXTRUDES the profile with a shaft bore via the profile-solid extruder). Opens the MOTION arm. `engineering.model_3d` part 'cam'. Program must close (return to start displacement, sum to 360°). Motion laws textbook-pinned (harmonic/cycloidal cross h/2 at midpoint, smooth ends vs uniform's impact). LIVE `npm run drill:engineering-cam`: harmonic + cycloidal cams in Blender — volume = (profileArea−bore)·thickness to 0.00%, watertight, disc height exact, shaft bore proven open |
| A11y action verification diff | `src/lib/a11yTreeDiff.ts` |
| Illustrator ExtendScript adapters | `src/lib/illustratorExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Per-app automation profiles | `docs/apps/*.md` + `src/lib/appAutomationDocsIndex.ts` (status lockstep smoke) |
| App reachability (live ladder) | `src/lib/appReachability.ts`, `src/lib/appReachabilityProbe.ts`, tool `desktop.app_reachability`, `/apps` command |
| App screen observe/next-step | `src/lib/appScreenNextStep.ts`, tool `desktop.observe_app` (one-round-trip observe + Δ diff + suggestion) |
| Unknown-app menu discovery | tool `desktop.menu_inventory` (read-only System Events menu-bar catalog: names/enabled/submenus; never clicks/focuses/launches; feeds exact labels to `desktop.menu_click`); apps that draw menus in their own window (Blender-style) come back with only Apple/Window menus, which routes the agent to `observe_app`/a11y instead |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |
| Codebase index/search + @mentions + conventions (coding-agent P4) | `src/lib/codebaseIndexRuntime.ts`, `src/lib/projectConventions.ts`, pure cores `codebaseIndexCore/codebaseSymbolCore/codebaseMentionsCore` |
| Live TODO + tool-result summarization + run-and-fix gate (coding-agent P6) | `src/lib/agentTodoCore.ts` + `agentTodoStore.ts`, `src/lib/toolResultSummaryCore.ts` (in `agentExecutionCore.ts`), `src/lib/runAndFixGateCore.ts` (in `openswanSessionRuntime.ts`) |
| Google Workspace tools (Gmail/Docs/Sheets/Drive/Calendar) | `src/lib/googleWorkspaceOps.ts` (pure contracts), `src/lib/googleWorkspaceRuntime.ts` (token+fetch), `gmail.*`/`gdocs.*`/`gsheets.*`/`gdrive.*`/`gcal.*` in `openswanToolRuntime.ts`; OAuth Phase A: `supabase/functions/google-oauth/index.ts` + `src/lib/googleCreds.ts` + `[functions.google-oauth]` in `supabase/config.toml` so OPTIONS/callback reach the function's own auth boundary |
| Cross-dashboard awareness (what's connected: marketplace/vault/Google/keys) | `src/lib/connectedResourcesDigest.ts` (pure, secret-safe) + `src/lib/connectedResourcesRuntime.ts` → `connected_resources` prompt section in `swanbot.ts` |
| Vault credential → browser login | `browser.fill_credential_field` requires `credentialField` plus exactly one non-empty source (`credentialId` = circle vault via `vaultAgentAccess`, or `item` = 1Password) in both app and v2-edge schemas. Local model-side execution is currently disabled before secret lookup/fill until exact process/context/page/opaque-URL/field binding exists; remote `fill_saved_login` remains a separate guarded path in `supabase/functions/computer-use-agent/index.ts`. Login-wall recovery pointer: `src/lib/computerTaskEvidenceRecovery.ts`; parity/fail-closed smoke: `scripts/browser-credential-schema-parity-smoketest.ts`. |
| Local diagnostics + connected coding execution | `local.run_shell` + `git.run` remain compatibility names in `openswanToolRuntime.ts`, but now expose only fixed read-only git diagnostics and `node --check/--version` through `POST /desktop/exec_file` with an exact read grant. Shells, package scripts, tests/builds, and mutations are refused and must delegate through a paired Codex/Claude/Cursor/Gemini structured spawn/launch handoff with its normal approval/file-coordination boundary. |
| Context dial + receipt (`/context` lean/standard/max) | `src/lib/contextDepthPolicy.ts` (pure: depth transform — 'standard' is identity — floor compose, receipt, storage); wired at the complexity-floor + policy chokepoints in `swanbot.ts buildSystemPromptAsync`; command handled in `ChatTab.tsx`, registered in `chatCommandRegistry.ts` |

Rule: new routing behavior goes into the relevant owner above. Do not extend
legacy one-off routers when the planner/runtime owner already exists.

## Provider Routing

Provider routing is now a first-class app system, not a side list.

Current provider set includes Anthropic, OpenAI, OpenRouter, Hugging Face,
Groq, Google AI, Mistral AI, Cohere, Perplexity, Together AI, Fireworks AI,
DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search, and
browser/computer providers such as Browserbase and Stagehand.

When adding or changing a provider, keep these files aligned:

- `src/lib/llmProviders.ts`
- `src/lib/llmProxyErrorCore.ts`
- `src/lib/circleIntegrations.ts`
- `src/lib/serviceProfileSouls.ts`
- `src/lib/crossProviderRouter.ts`
- `src/lib/billingPriority.ts`
- `src/lib/swanbot.ts`
- `supabase/functions/llm-proxy/index.ts`
- `supabase/functions/swanbot-ai/index.ts`
- provider CHECK constraints in migrations

Provider failures must keep stable public codes across the Edge/browser
boundary. `key_missing` means no applicable credential; `credential_unreadable`
means a stored ciphertext/key-version or RPC problem and must direct the owner
to reconnect/re-enter the credential, never to a connected code-repair agent.
The 2026-08-06 Vault rotation omitted seven existing `user_api_keys` rows; the
source rotation inventory is corrected, but those live ciphertexts remain
preserved pending former-key recovery or credential re-entry.

The 2026-08-07 plain-Chat credential contract is user-owned BYOK end to end.
Future or unconfigured threads default to `claude-sonnet-4-6`; an explicitly
stored `auto` remains `auto`, and the forward migration does not rewrite
existing thread rows. Authenticated `chat-stream` and public `llm-proxy`
dispatches require the signed-in user's Marketplace credential and cannot fall
through to a platform environment key. `key_missing` and
`credential_unreadable` are terminal setup states for that turn: Chat does not
repeat the same call through another transport, and instead opens the matching
Marketplace model connection. Anthropic connect/reconnect validates the
submitted key before saving, stores it only in the user's encrypted model-key
vault, then validates the stored/decrypted credential through the same
`llm-proxy` route Chat uses before reporting success.

The 2026-08-12 site-wide model slice adds GPT-5.6 Sol/Terra/Luna, Claude
Opus/Sonnet 5, Gemini 3.6 Flash/3.5 Flash-Lite, and current direct-provider
families across the catalog, alias, capability, context, price, registry,
Chat/Rooms/Office pickers, Auto ladders, and Edge owners. For connected user
keys, `llm-proxy` now exposes an authenticated `list_models` action against
fixed provider-owned endpoints; the client loads those account-specific lists
in parallel with a bounded wait, caches by user/provider, filters known retired
and non-chat models, and retains a typed verified/fallback/unsupported result.
A public GET capability preflight now gates that fan-out. Healthy older Edge
deployments that do not advertise `list_models` use the short-cache curated
fallback without producing one expected HTTP 400 per connected provider at
Chat startup; deploying the source capability remains a separate operation.
Memory embedding now metadata-preflights the active OpenAI key and remembers an
unreadable exact key version across reloads, with a bounded daily recheck.
Marketplace key rotation clears the block and re-arms orphan repair
immediately; its scheduler is separate from the write-queue drain timer. The
validated app session is also passed into agent auto-connect so bridge
publication/status writes bind one captured bearer instead of reacquiring the
browser Auth Web Lock on every poll. Expected lifecycle AbortErrors are retried
without console warnings, while real publication failures stay visible.
A verified inventory offers only supported IDs listed for the exact key; a
verified empty response stays visible as empty, while a timeout/error uses a
clearly labeled short-cache curated fallback whose access is rechecked when a
run starts. Chat, Rooms, Office terminal, agent spawn, and Marketplace share
this readiness contract. Chat's curated category/popular shelves disable
hosted models without an exact ready provider/model identity, and Auto ignores
providers with zero ready models and stops unavailable resolutions before
provider I/O; separate image/tool capability routes remain independent. Office
does not expose bare hosted-provider shortcuts that can disagree with the
executed route; current provider families enter through exact account rows.
Key changes invalidate the catalog and refresh mounted key consumers. Rooms
passes only providers with a ready exact model into OpenSwan Auto routing.
OpenRouter Popular remains a clearly labeled current fallback until live
rankings load, with retired and project-excluded model families filtered at the
Edge and client boundaries. This is
also the sole OpenRouter inventory path, replacing the older serial direct
browser fetch. Shared Chat/Rooms/spawn selectors apply the executable-route
guard after merging; local Ollama and arbitrary OpenAI-compatible endpoints
stay on guarded OpenSwan/local-tool paths instead of appearing as dead hosted
Chat choices. It is
additive: saved exact choices stay visible and routable, and the Sonnet 4.6
default is not migrated. Chat resolves one effective model before capability
routing and uses the same model for transport; latest-assistant continuation
context keeps the answer tail. Direct GPT-5.6 requests map
Fast/Balanced/Deep to `reasoning_effort` rather than sending legacy
temperature. See `docs/CURRENT_MODEL_CHAT_MODERNIZATION_2026-08-12.md`.
Source checks are green; live provider entitlement, Edge deployment, latency
evaluation, and any future default change remain separate gates.

Model IDs may be provider-prefixed, such as `openrouter/auto`,
`google_ai/gemini-3.6-flash`, `deepseek/deepseek-v4-pro`, or
`huggingface_endpoint/cswan801/BlackSwan-v5`. Normalize aliases carefully:
`hugging_face` -> `huggingface`, `z_ai` -> `zai`.

Chat Web Search is optional enrichment, not the terminal owner of ordinary
conversation. `src/lib/webSearchAutoDetect.ts` bypasses pure social turns even
when the saved circle toggle is on. If OpenRouter search fails, Chat shows a
bounded not-web-verified notice and continues through the canonical plain
transport exactly once; it does not launch `invokeAnyChat`, create a FAILED
action receipt, or offer a connected code-repair agent for the search lane.

## BlackSwan And OpenSwan

- BlackSwan-v5 lives at `cswan801/BlackSwan-v5`.
- Public HF path: `huggingface/cswan801/BlackSwan-v5`.
- Dedicated endpoint path: `huggingface_endpoint/cswan801/BlackSwan-v5`.
- Tool-heavy BlackSwan requests use a reliable tool executor model —
  `BLACKSWAN_TOOL_EXECUTOR_MODEL_ID` in `src/lib/blackswanRouting.ts`
  (currently `claude-haiku-4-5`) — while BlackSwan remains app-grounding
  context.
- Training/auto-update: weekly launchd job on the dev Mac (Sunday 03:00,
  `scripts/blackswan-llm/launchd/`), full cycle in
  `scripts/blackswan-llm/train_cycle_v5.sh` — see
  `scripts/blackswan-llm/CONTINUOUS_TRAINING.md`.
- `buildBlackSwanGroundingBlock` injects app-state rules and safe memory
  references without exposing secrets.

OpenSwan remains the in-app shared agent/runtime brand. The internal default
agent id `default::blackswan` should not be renamed without a migration plan.

An OpenSwan session turn now has one typed, prose-independent terminal receipt
owned by `openswanSessionRuntimeAdapters.ts` and returned by
`openswanSessionRuntime.ts`. Its state is `succeeded`, `partial`, `failed`, or
`cancelled`; the same object carries a bounded reason, `completionVerified`,
`resumable`, and an optional checkpoint. The receipt, not provider wording,
owns the transcript terminal, run metadata/finalization, eval projection, and
Chat lane outcome. Only `succeeded` with `completionVerified: true` may call the
canonical completion writer or enter reusable/archive success-memory paths. A
user stop remains cancelled, while capped, guarded, edge-failed, or explicitly
unverified work remains non-complete and retains its recovery state. Failed
checks use `verification_failed`, blocked/manual checks use
`verification_blocked`, and a present coding receipt with edits but no passing
checks uses `verification_unverified`. The absence of a coding receipt does not
make ordinary read-only Q&A incomplete. Delegated work is complete only when
every planned child returns both a completed typed parent summary and completed
summary metadata; otherwise the parent becomes partial with
`delegation_incomplete`, and transcript/ledger labels keep each child's actual
status. After classification, the guarded terminal writer reports whether its
exact update applied, lost to a concurrent cancellation, or could not be
verified. The runtime rebuilds the receipt after that write: cancellation wins,
and an unverified database transition becomes `persistence_unverified` rather
than a reported success. Because `agent_runs` has no partial enum,
non-cancelled incomplete rows close as failed instead of remaining active,
while the typed receipt preserves the precise partial/failure reason and
checkpoint.

`ChatTab` derives its OpenSwan message outcome and lane health through
`chatOutcomeSignals.ts` and `chatLaneOutcome.ts`. Non-success status/recovery
copy appears before any possibly optimistic model response, and a stopped turn
does not auto-launch a connected repair agent. A resumable message offers
Continue only with a strict value-free locator bound to the exact circle, user,
thread, run, source-message, and device-local transcript event. Chat
synchronously claims that locator once, and the runtime resolves it before a
new transcript write or any model/tool work. An explicit stale, mismatched,
malformed, missing, or superseded locator stops without falling back to the
latest checkpoint scan; checkpoint contents never enter persisted Chat
metadata. Browser-backed plan creation follows the same truth rule: an
approval-ready plan is `deferred`/waiting approval, not a completed browser
task. Room Chat persists the same bounded terminal scalars
and leads with deterministic non-success copy; Missions refuse completion when
the receipt is not verified success. Feed/Kanban also persists the receipt and
allows only verified success to mark the task complete, publish completion
proof, learn completion memory, award XP, or advance a dependent agent.
Partial, failed, and cancelled children stop collaborative sequences instead of
passing optimistic prose downstream.

The same terminal receipt now accounts for ordinary required tool calls, not
only A1-A3 turns. A failed planner-high call or any failed mutation-policy call
becomes `action_coverage_failed`; blocked, manual-required, pending, or unknown
required work becomes partial `action_coverage_incomplete`. Optional
exploratory read failures remain non-gating. Both typed and legacy event shapes
use one pure disposition, so a provider cannot describe an attempted required
action as complete when runtime evidence says otherwise.

Generic Chat approval continuation also stays on this exact path. Approval
cards no longer synthesize an internal user prompt and feed it through ordinary
routing. Chat recovers the exact persisted source user message and source
ledger, groups only rows from one run/requester/scope, and passes OpenSwan a
transient frozen list of approval id, canonical tool name, and approval digest.
Raw call arguments live only in a short-lived encrypted device outbox: native
uses the OS secure store; web uses AES-GCM local storage plus an origin-wide Web
Lock for one-shot cross-tab claim (at-rest protection, not an XSS boundary).
The runtime deletes and verifies that exact set before direct dispatch, restores
provider order from the original iteration/call ordinal rather than approval-card
order, requires runtime-issued consumption receipts, and stops after the first
non-pass. The typed, legacy, and local-batch loops recheck source run, exact
source-message owner/thread, user, circle, digest, resolver, liveness, and atomic
consume before handler entry. Selected connected agents, Plan mode, pending
composer attachments, newest-row/title fallbacks, category-auto approval, and
another member's cards cannot widen or intercept a bound continuation. The
existing source user row is reused—no synthetic technical/user bubble or
duplicate activity telemetry—and Chat shows only bounded ephemeral verification
status while exact custody is unresolved.

Chat's planner also protects genuine two- or three-action turns
from single-intent first-match loss. It dispatches the intact request once to
OpenSwan with an A1-A3 ledger, grouped `and`/`then` dependencies, and an
all-actions completion rule. More than three accepted asks stop for one
clarification without dispatch. The strictest child/whole-request risk and approval floor applies, and terminal transport
forces authoritative-completion work through the batch runtime instead of
ordinary talk streaming or a specialized single-intent mode. It does not
split computer-task compilers or the existing atomic Office-agent
create-and-attach operation, and it does not add a child replay loop. The
contract turn force-advertises `run.report_action_outcomes`, prompts it as the
final call, and requires exactly one report event. That tool is a pure, no-I/O
structural acknowledgement and singleton ordering barrier; it may reference
only bounded exact earlier provider tool-use ids and returns
`completionDecision: not_evaluated`. The runtime—not the reporter or
provider prose—feeds those ordered events into
`openSwanMultiActionCompletionCore.ts`. Evidence must use an operation-specific
completion tool; mutation proof also requires authoritative mutation and exact
target binding. Derived assistant-authored text actions may additionally use the
deferred `run.publish_action_artifact` seam with one exact current A-id, one
allowlisted artifact kind, and bounded redacted title/content. The publisher
acknowledgement is not proof: the runtime requires one pre-report claim for that
action, the exact successful canonical `agent_run_artifacts` insert row, and a
final report citation to the earlier provider tool-use id. A pure draft may use
that durable artifact alone, but a source-grounded summary, analysis,
comparison, or recommendation requires both exact supporting read evidence and
the durable artifact. That supporting read must be from a strictly earlier
provider iteration than publication; a same-round call cannot prove the model
observed a result it had not received yet. An explicit file, SaaS, app, browser, desktop, or other
external destination remains mutation-bound; this seam grants no mutation
authority and cannot replace its operation-specific proof. Content stays in the
canonical artifact row; tool evidence and persisted Chat/Room A# snapshots stay
value-free. Chat stores an opaque `canonicalArtifactId`, the canonical content
digest, and a truncated inline display copy. It batch rehydrates only a row
whose artifact id, run, circle, title, A-id, kind, and independently recomputed
row/pointer SHA-256 all match; completion never trusts the message copy. §38
removes authenticated artifact UPDATE/DELETE authority and limits INSERT to the
exact run owner; target application remains governed by the roadmap SQL
checklist. Unmapped reads, unsupported mutations, and derived deliverables without
the required read and/or durable typed receipt stay unavailable instead of
borrowing nearby evidence. Missing, duplicate, unknown, future, cross-owned,
status-mismatched, dependency-inverted, invalid, unavailable, pending, or
blocked coverage becomes partial `action_coverage_incomplete`; an explicitly
failed action becomes `action_coverage_failed`; the report call cannot serve as
its own evidence. Dependent calls execute sequentially. Persistence keeps a
bounded value-free summary through a per-run serialized optimistic CAS with
exact-row readback; missing or unverified persistence becomes
`persistence_unverified`. Room overflow stops before runtime. Because Room
messages are immutable under RLS, transient typing stays local and every
clarification, runtime failure, or final answer performs exactly one checked
INSERT—never a persisted placeholder UPDATE. Reload fetches the newest bounded
page with a deterministic timestamp/id tie-break, then presents it in
chronological order. The focused `openswan-multi-action-artifact-evidence` and
`openswan-multi-action-read-evidence` smokes pin publisher schema,
persistence/readback, source-read conjunction, ordering, value-free projection,
and fail-closed cases. These paths are covered by focused source-contract smokes
and app typecheck; no live
provider turn, authenticated cross-surface refresh, cross-process resume,
deployment, or production database transition is claimed.

Chat presents one consistent OpenSwan navigation map in circle, private, and
shared threads. `ChatThreadHeader` remains mounted before Chat chooses an
empty or populated transcript state, clears stale metadata while a new thread
loads, and keeps the `OPEN`/`OPENSWAN` and `RUNS` entries available through
loading, empty, active, and thread-resolution error states.
`OpenSwanServiceMenu` owns mode and crew selection, sends
agent/model/approval/tool configuration to the existing Control Panel, and
sends past or blocked work to the existing Run History surface. Its default
view is centered, shares the Control Panel's purple/cyan treatment, and shows only two
compact selectors plus the primary Control Panel route. Work-mode and crew
choices expand one at a time; Skills, route guidance, Runs, and recovery stay
behind one accessible `More options` disclosure. Close/backdrop own dismissal,
so there is no duplicate `Done` row or bottom-sheet grabber. Product React
Native modals use fade entrances site-wide rather than sliding from a side or
bottom; `scripts/modal-fade-transition-smoketest.ts` guards that motion rule.
These are navigation-only components:
preserve the callbacks and canonical runtime owners, plus responsive layout,
keyboard focus, and semantic labels. Run
`npm run check:openswan-chat-ux` when changing this surface. The Control Panel
opens as a task-first composer rather than an operator dashboard: it keeps the
exact Chat-selected agent, work-type/approval context, one compact mode chooser,
truthful launch readiness, and the launch action visible. Connection setup,
readiness diagnostics, guardrails, automations, templates, runs, tools, memory,
and maintenance live behind one accessible Advanced options disclosure, which
also gates their subscriptions, spend/vault queries, templates, and detail
reads. Readiness appears only after task entry. Automatic routing follows typed
text until the user explicitly chooses a workflow or mode, recognizes named
desktop apps such as Adobe Illustrator, and prioritizes the overall job so a
research or repeat request is not redirected by an incidental code/browser
word. Concrete Execute/Build/Review workflows retain a task-specific capability
gate; global site-readiness diagnostics cannot block an unrelated plan or
research turn. The advanced readiness snapshot waits for capability evidence
before one vault request, and budget preflight reuses the canonical cached
circle snapshot rather than issuing a duplicate usage scan. This progressive
disclosure does not change guardrail, approval, selected-agent, or canonical Chat dispatch
authority. Hosted OpenSwan remains the unattended schedule owner; saved
connected-agent metadata is accountable identity, while device-local bridge
sessions are dispatched live only from Chat or Office when their exact
connection is available. The composer
selector uses `chatAgentSelectorPresentation` so target availability and
runtime activation remain truthful: normal Chat reads
`Chat · OpenSwan available`; only a selected runtime mode reads
`<Mode> · OpenSwan active`. Advanced choices expose expanded/selected
accessibility state. `Reset Mind` requires explicit destructive confirmation,
clears circle session and current-user memory context, and preserves the
visible transcript.

Cross-surface focus has one deliberately narrow product-code adoption as of
2026-08-07. Chat encodes an existing run handle as `office:run:<id>` in both the
web `uc:switch-tab` payload and native route params. `CircleDetailScreen`
validates that the decoded surface/kind is exactly Office/run and captures the
request before lazy Office mounts; `OfficeTab` then opens its existing
`RunHistoryDrawer` at that run. A monotonic request id remounts the drawer when
the user taps the same run again. This is navigation only: it creates no run,
runtime, or second viewer. Thread, task, mission, agent, room, and message focus
remain pending. The source wiring and focused smoke are current; a live
web/native GUI navigation pass has not been claimed.

Changing threads is an authoritative lifecycle. Chat clears the old transcript
immediately, validates exact circle/archive access, restores only the target
thread's draft and staged attachments, and blocks sending until hydration is
ready; resolution failure exposes Retry. It refuses silent switching while a
run or upload can still write back to the old thread. On narrow screens the
conversation list opens as an accessible overlay, and destructive archive,
delete, leave, and member-removal actions are confirmed. Message and thread
subscriptions reconnect with a scoped catch-up and run a quiet repair
heartbeat; the message transcript additionally polls every 15 seconds only
while its channel is degraded. An authoritative tail removes
missed deletes while preserving older pages, optimistic sends, and rows created
after the read began. Older pagination uses `(created_at, id)`, and reply
previews are batch-hydrated.

Every ordinary attachment-dependent Chat model turn uses one exact source
contract rather than a filename or arbitrary local path: one request receives
A1 and a compound request receives bounded A1-A3. Chat awaits the persisted
user-message UUID and verifiably links every staged row to that exact
owner/circle/thread identity before any provider, vision, connected-agent, or
desktop consumer. It then hashes exact bytes and passes a sealed private turn
source to OpenSwan outside message/run metadata. Exact human-member identity
wins agent aliases and causes zero AI dispatch after linkage; an exact selected
connected agent keeps ownership, while unsupported non-image delivery blocks
instead of substituting OpenSwan. Continue, slash, unsafe picker/native,
unfinished, scope-drifted, and failed-link states stop before consumer I/O and
retain the files. Plan mode keeps the exact database source-message UUID and
bound contract without execution. The model sees only value-free identity and
can inspect bounded extracted text or a sanitized visual observation only
through `attachments.read_source({ attachmentId })`; URLs, storage keys, local
paths, base64, and raw-byte arguments are not accepted. The exact original user
text is carried separately from prompt augmentation, and attachment-derived
network access requires a literal user destination plus the public-host guard.
Returned material is fenced as untrusted and omitted from durable tool-event
copy. Completion needs an exact runtime receipt bound to manifest, hash,
message scope, and attachment id; missing persistence, ambiguous linkage,
unreadable content, thread drift, or filename/prose claims stop without
verified completion. The legacy path-bearing desktop branch is disabled. One
explicit open/load/preview/show request for one safe durably linked upload may
use `desktop.open_attachment({ attachmentId })`. Exact bytes and the bearer stay
behind a branded one-shot process-private capability; approval is solo, resume
claims the exact in-memory lease once, durable dispatch runs once, and fresh
proof of the exact privately resolved app, process, frontmost window, and
unpredictably named active document is required for completion. An explicitly
named allowlisted app wins extension defaults; requested/resolved app and
document identity remain private fingerprints. Native-open acceptance,
arbitrary title/accessibility text, an error dialog, or an older generic
document is not proof. Bytes remain staged through the postcondition and are
deleted on proof, revocation, idle expiry, or guarded crash cleanup. Edits/
transforms, copied or expired authority, binding drift, and uncertain post-
dispatch state fail closed without replay. §§39-40 supply the exact linkage
and private metadata/Storage visibility guards; §41 restricts the canonical
device-private approval row to its exact requester. All three remain pending
application.

The native open proof is stricter than process acceptance or a matching title.
The bridge pins the staged file's device, inode, realpath, stat, size, and hash;
uses absolute `/usr/bin/open`; and, in production, admits only a signed app in
a root-owned non-group/world-writable system location. Completion requires the
same private app identity plus exact frontmost PID/window, two matching
`AXDocument` reads for the unpredictable staged path, and `/usr/sbin/lsof`
proof that the exact PID holds the pinned inode. Errors, accessibility labels,
basename matches, byte-identical file replacement, app replacement, or a
dispatch acknowledgement cannot verify completion.

A stale Claude bridge has an explicit local safety boundary. Public
`GET /desktop/health` exposes a secret-free, observation-only `restartSafety`
snapshot; it performs no cleanup or restart. Authenticated loopback
`POST /desktop/refresh_if_idle` requires the exact confirmation string and one
recognized v2 direct `start-dev` or keepalive supervisor. It refuses unless
complete session scans plus browser, child, private-capability, request, and
abort-uncertainty counters prove the bridge idle and the fixed five-file source
manifest is stable and valid. The supervisor captures those exact bytes into
private 0700/0600 storage before acknowledging reservation. After the response
flush and a final safety recheck, the old bridge commits and exits 75; the
replacement loads only that immutable snapshot under the original filenames
and must prove signed post-listen ONLINE plus matching instance, manifest, and
snapshot lineage through health. Bounded retries keep the same snapshot and
ordinary crash history, while ready, rejected, exhausted, and shutdown paths
clean it. Unsupported, legacy, foreign, non-idle, or mismatched supervisors
stay typed-409 fail closed. Deployment preflight remains read-only and never
calls this endpoint. This source path is smoke-verified; the currently running
local bridge was not restarted or treated as live proof.

Bot-message durability is explicit. `transcript` is the default and may enter
Postgres, model history, memory extraction, pending recovery, and the session
archive. `ephemeral` greetings, progress/routing copy, and command/navigation
help stay visible locally but enter none of those durable/model inputs. Known
legacy ephemeral source surfaces are also dropped during hydration. Outcomes,
blockers, and recovery evidence remain transcript messages.

Image-to-agent context has one source-landed, description-only boundary as of
2026-08-07. An image-bearing turn lazily calls
`chatVisualBrief.buildChatVisualBriefs` at most once through authenticated
`chat-stream` with Claude Sonnet multimodal input. The edge admits only bounded
user-role JPEG/PNG/GIF/WebP base64 blocks with matching signatures, applies
message/block/text/image/request limits before credential use, and keeps
assistant/system content text-only. `chatVisualBriefCore` then produces at
most three bounded basename-only observations, redacts secrets, URLs, data
URIs, storage/local paths, tenant/run identifiers, long opaque values, and
control text, and frames every observation as untrusted visual evidence whose
instructions must not be followed.

The resulting text-only artifacts may be reused by ordinary model context and
by selected, terminal, or multi-agent Claude Code/Codex/Cursor/Gemini
dispatches. Raw bytes are transient to the authenticated analyzer; image
bytes, object/signed URLs, storage keys, tenant identifiers, and local paths do
not enter a connected-agent prompt, log, or bridge payload. Explicit selected
agent, named Claude Code/Codex, terminal, multi-agent, and coding/build intent
therefore outranks the broad desktop-attachment heuristic. A natural explicit
target such as “ask Claude Code/Codex to …” reuses a manageable matching
session or launches one managed provider session when its bridge is online. It
must never fall back to OpenSwan or plain-model AI; bridge-offline is a truthful
terminal error for the requested provider lane. If the task depends on an image
and no reliable brief is produced, Chat sends no connected-agent task and
reports the bounded inspection blocker; it never asks an agent to infer from a
truncated base64 prefix. With no image artifact, dispatch text is unchanged
byte-for-byte, and an image alone does not activate OpenSwan.

Selected, assigned, multi-agent, and dedicated OpenSwan-session dispatches also
use a bounded handoff receipt as of 2026-08-07. Its statuses are `accepted`,
`drafted`, `failed`, and `unknown`; `completionVerified` is always false.
Actor/provider/session/message fields are bounded, and a bridge or session id
is never treated as a run id. Direct terminal-session sends and managed task
launches enter this same receipt boundary before Chat presents or persists the
result. Only an `accepted` receipt records one canonical `main_chat`
`agent_runs` ledger row. That row remains `queued`, carries the canonical agent
subject plus bounded external provider/session correlation, records
`completionVerified: false`, and deliberately omits the runtime-heartbeat flag.
`drafted`, `failed`, and `unknown` receipts create no run. `unknown` is the
single-attempt result when OpenSwan cannot prove whether a send/spawn began; it
retains any exact external lineage and tells the user to inspect the session
before retrying. The active Chat thread belongs to
`circle_chat_threads`; its id may be retained as bounded run metadata, but must
never be written into the unrelated legacy `agent_runs.chat_session_id` foreign
key.

The accepted receipt is rebuilt with the canonical run UUID and stored in Chat
metadata, so refresh preserves the nonterminal handoff and the user can open
the same run in Office. Accepted, drafted, and unknown transcript messages keep
`delegatedTo` and explicit nonterminal `outcomeVerdict: unknown`, while
multi-agent summaries separately count accepted, drafted, unknown, and failed handoffs.
Chat no longer immediately flips an accepted roster agent back to `idle`:
provider/session polling owns roster presence, and Office plus canonical run
telemetry own task visibility. A tracking-write failure must leave the dispatch
truthfully accepted with no run link rather than recasting it as a task failure.

The same truth boundary now covers Office-terminal and Feed/Kanban Claude Code
launches. The Claude bridge's `/spawn` response proves only process acceptance,
so `agentInvocation` requires one exact bridge-owned spawn handle and returns a
typed `accepted` disposition with `completionVerified: false`. Office records a
queued `office_terminal` run through the canonical accepted-run writer and
keeps its response/tracking task nonterminal; it does not log provider
completion, close the Office message, or mark the tracking task done. A lost,
timed-out, inconsistent, or malformed response becomes `outcome_unknown` and is
not replayed. Feed/Kanban preserves the same distinction: accepted work keeps
the task run `running`, uncertain dispatch becomes `blocked`, and neither path
publishes completion proof, awards completion XP, or writes `completed_at`.
Feed owns exactly one task-bearing provider attempt; roster `idle`/`offline`
state no longer triggers a hidden wake-and-send first. Sequential collaboration
pauses at the first accepted, unknown, or failed child and never forwards
acknowledgement prose to a dependent agent as completed output. Feed Agent
Tasks, Active Runs, run history, and activity rows expose those nonterminal
states instead of mapping them to done, failed, or invented heartbeat freshness.

Office/Feed OpenSwan invocation no longer owns a parallel raw send/history-poll
loop. It requires one exact `connectionId::sessionKey`, calls the canonical
structured `sessions_send` adapter, and has no implicit `agent:main:main`
fallback or assistant-prose completion inference. Accepted ledgers stamp
`externalDispatchKind = sessions_send` while keeping the external connection,
session, provider run, and canonical run identities separate.

Published OpenSwan Office agents now have an explicit owner-private binding
path in source. In the displayed OpenSwan session's Agent Gateway panel, the
current owner chooses one of their published OpenSwan Office agents and binds
it to that exact owner-owned `agents_bots` UUID and case-sensitive session key;
they can move or clear the link explicitly. §36 adds the no-backfill
`office_agent_session_bindings` table, owner-only reads, server-authorized
set/clear RPCs, and `invoke_agent_v2`. The v2 RPC composes the existing
canonical Office claim exactly once and returns a versioned bound-or-missing
snapshot. It never copies the session identity onto the public
`circle_office_agents` row. The gateway token is never written to the binding,
Office agent, claim, or run: it remains in device-local secret storage.

The Office Agent popup is task-first and lazy without becoming another task
runtime. It has four stable destinations (Overview, Work, Runtime, More) whose
contextual routes are capability-filtered; DB-only or unauthenticated rows do
not expose unusable live OpenSwan sections. Lazy failures are retryable, and a
subject or authority-generation change resets and remounts section resources.

Overview, OpenSwan, and Terminal pass an exact agent id plus optional bounded
draft through the typed Circle handle into hydrated Chat. Chat selects and
focuses the target but never auto-sends; it remains the owner of durable
messages, approvals, runs, proof, and recovery. OpenSwan loads only exact
connection/session evidence by default, with private binding/history/search
behind Advanced options. Schedules are explicitly connection-level, omit the
ambiguous current target, preserve the last verified same-scope snapshot on
failure, require structured action/target receipts and fresh postconditions,
and fail closed for mutation until refreshed. Session, status, history,
subagent, runtime-agent, Cron, and web-search evidence is accepted only from
bounded structured provider payloads. Runtime, schedules, Pause/Resume,
main-agent, and terminal-profile controls consume captured
user/circle/bearer/generation authority; an unknown read cannot mutate state.
The §47 primary-agent RPC is the only multi-row identity writer: it serializes
one authenticated owner, clears and promotes transactionally, enforces a
partial unique `(user_id,bound_ai_provider)` primary invariant, and requires a
bounded exact provider-row receipt before generation-fenced cache publication.
Ordinary exact provider metadata remains a targeted non-primary mutation;
ambient/full-row compatibility saves omit both primary and provider authority,
and a server trigger rejects direct primary changes, moves, or primary-row
deletion outside §47 while preserving non-primary deletion.

Published Spirit projection is owned by
`supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql`, mirrored
as §48. Its owner/circle/member-bound transaction locks the exact published
Office row and optional custom profile, updates the peer-visible Spirit plus
private identity together, and returns a bounded two-row receipt before the UI
publishes success. Profile deletion is a separate exact RPC that serializes
with assignment and rejects any still-referenced owner profile; direct
authenticated profile DELETE is revoked. §48 is pending/not applied.
Narrow server triggers reject direct published public/private Spirit inserts,
updates, identity deletion, or projection-key retargets, including
private-preseed/public-insert
inversion, while preserving
ordinary null publishes and private live-session built-in/cleared Spirit
writes and private identity deletion. Private custom assignments must match one exact same-owner profile's
UUID, name, and emoji and hold that profile `FOR KEY SHARE`, so they serialize
with profile deletion and cannot create a dangling reference. A 2xx response
whose exact receipt cannot be verified is `outcome_unknown`; clients refresh
before any retry. Target-keyed mutation epochs and an exact-scope cache
publication lock prevent older §47/§48/profile-delete completions from
publishing over newer local truth in one JavaScript realm. Cross-tab cache
ordering still has no durable revision/CAS and reconciles on the next exact
server refresh. Memory Soul projection requires an exact published-agent UUID,
never a mutable display-name match.

The compact bridge summary is read-only. Runs never mutates the ledger merely
because it was viewed. Exact-agent run discovery marks a bounded scan as
partial when it reaches 1,000 candidate rows, lets the operator extend that
scan in 1,000-row steps up to 5,000, and reserves “No runs yet” for a verified
complete empty result. Memory and Spirit destructive actions are confirmed and
receipt-checked; Spirit, WordPress, and integration absence appears only after
a verified read, while raw subject/session metadata is disclosed only under
Inspect. Centered and compact modes block the background and restore focus,
docked mode remains non-modal, reduced motion is honored, and the dock resize
handle supports keyboard/assistive input. The open panel reconciles from the
live roster rather than retaining a click-time agent snapshot. Run
`npm run check:openswan-control-panels` for this surface.

After the claim, the pure resolver still requires the exact Office-agent UUID,
exactly one local connection whose `remoteId` is the bound `agents_bots` UUID,
`provider = openswan`, enabled/connected state, a hydrated non-placeholder
device-local token, and exactly one case-sensitive session-key match on that
same connection. It alone produces the local
`connectionId::sessionKey` dispatch target and ephemeral config. There is no
agent-name, connection-name, provider-wide, first-connection, first-session, or
main-session fallback. A missing/stale/ambiguous/offline/unhydrated binding
fails closed with the existing fixed no-dispatch result in both Office and
Feed. Applying a durable binding therefore does not make a token portable to
another device.

Chat uses that same authority boundary. A published OpenSwan Office row keeps
its public Office UUID separate from provider session identity; only an
authenticated owner row with `isOwn = true` may read the private binding and
send once to its exact live session or spawn on that binding's exact connection.
Another member's OpenSwan or terminal-provider row cannot borrow or launch the
current user's local runtime. Session rows
are co-published with a non-secret connection fingerprint (local id, private
bot UUID, normalized endpoint); duplicate ids, stale poll completions, or
same-id endpoint/bot replacement invalidate both the rows and the dispatch.

Chat's other connected-agent routes use the same one-attempt rule. Picker
choices round-trip immutable ids, a stale selection becomes unavailable,
quoted and multi-agent names must be unique, and production-shaped immutable
ids remain ids through multi-agent planning so they can disambiguate duplicate
display names. A live session named OpenSwan is distinct from the single
canonical default. A published custom row requires
an exact connection id or explicit exact gateway. A custom gateway receives a
local token only from an enabled exact-endpoint connection with explicit owner
authority: `isOwn`, owner id, and current user id must all be present and agree.
Missing alleged-owner evidence authorizes neither a local token nor network
I/O; provider or display-name similarity cannot lend credentials.
Terminal target ties dispatch nothing. Terminal send/launch adapters expose
`transportAccepted: true | false | null`, accept only structured positive
evidence plus HTTP success, require the exact requested session echo, and never
replace an exact session or fan out after response loss. Claude, Codex, and
Gemini bridge servers require one case-sensitive exact session id before input;
display names, prefixes, case-folded ids, and duplicates fail before mutation.
Cursor exact-session input currently fails closed because its GUI bridge cannot
bind focus to one verified Composer conversation. A one-session launch is
accepted only with one receipt-safe exact returned session id. Chat stores that
id as external receipt lineage and as the subject for session-native targets;
a selected DB agent keeps its DB subject. Missing, unsafe, or multiple launch
identity stays outcome unknown with no replay or actor-only accepted run.
Office run attribution prefers canonical identity and uses display names only
for identity-less legacy rows.
Sequential Chat chains stop on accepted, unknown, failed, or thrown upstream
work; acknowledgement/error prose is never treated as a completed dependency.

An accepted direct Feed handoff appends one queued canonical `feed_task` run
with the exact task, task-run attempt, and agent subject. Failure to write that
optional ledger never changes provider acceptance or replays work;
outcome-unknown and failed attempts create no accepted run. Activity Feed and
Task Detail use only the returned local run UUID for an exact Open-in-Office
action, never an external connection, session, or provider-run id.

OpenSwan correlation now reads only current structured tool details. Spawn
acceptance retains the exact provider run id and child session key; exact
session sends retain their structured run/session disposition and use a
25-second provider wait inside the 30-second client boundary. A structured
response timeout still means the send was accepted, not that the task failed or
completed. Positive spawn/send acknowledgement is exposed only when its exact
provider-run and session identities are present (and a send echoes the requested
session); missing or mismatched lineage remains outcome-unknown. An
ambiguous/error response is never silently replayed into a second session, and
Office does not impose a shorter UI timeout that could invite a duplicate
manual retry. The Office gateway poller also reads current `subagents action:list`
`active`/`recent` buckets instead of guessing lifecycle from response prose.
Provider `done`/send `ok` still proves only that a provider turn ended; it does
not verify the user's task, and this slice does not terminalize the local run.

The accepted ledger marker has a dedicated presentation boundary. Office calls
it an accepted handoff awaiting a connected-agent update rather than an active
subagent. Queued, paused, and approval-waiting rows stay under Other. Only
fresh `planning` or `running` rows qualify as Active; after 30 minutes without
an update they become `Stale · Not Active`. Chat Run Trace shows completion
unverified without a spinner, STOP,
or Run Again: those controls affect only the local ledger and cannot stop or
replay provider-owned work. The mobile Office roster uses the same accepted
marker instead of generic `Live`/`Active`/`Stale` freshness copy.
Opening Run History is read-only and never reaps or terminalizes a run. Its
list, direct-focus, steps, artifacts, child-run, and Realtime reads use one
captured user/circle/bearer/generation authority; retired snapshots are hidden
synchronously, exact circle membership is proved before an empty ledger is
trusted, and a failed proof read is never presented as an empty history. Memory
references and recommendations in this drawer are read-only run proof; memory
changes belong to the canonical Memory surface. Both selected-run Realtime
channels must report subscribed before the snapshot is labeled live; channel
loss marks it possibly stale and exposes a manually fenced exact refresh and
reconnect action.
Its explicit stale Cancel action captures exact user/circle/bearer/generation
authority, revalidates that authority and the unchanged stale heartbeat after
confirmation, and accepts only one exact guarded row receipt. A zero-row
compare-and-set is visibly reconciled without replay or fabricated completion.
Office's Mine filter likewise joins only exact owned DB ids, provider-main ids,
and provenance-stamped local connection ids; duplicate display names confer no
ownership.
Feed applies that same shared classifier in both its query and render pass.
Timestamp-less or stale processing rows, plus queued, paused, and
approval-waiting work, never count as Active. An exact accepted connected-agent
handoff remains visible in a separate `ACCEPTED HANDOFFS` lane marked
`COMPLETION UNVERIFIED`, so accountable nonterminal work is not hidden or
misrepresented as currently processing.
Forward migration §35 preserves a parent Office message while its response is
a deliberately nonterminal `streaming` handoff, so a later typed final adopter
is not locked out by the legacy two-minute sweeper. Its catalog readiness was
reported from the target SQL Editor on 2026-08-11; live finalization behavior
is still unverified.

Office cost fields are deliberately non-interchangeable. Live bridges expose a
cumulative session meter for snapshot-delta sync; one exact durable Office row
owns the displayed daily and lifetime totals. Identity/cache hydration cannot
promote lifetime or session values into `costToday`, and ambiguous same-provider
rows receive no provider aggregate. Agent cards therefore show the actual daily
field when labelled today. The token card and whiteboard use strict server-backed
rolling 24h/7d/30d reads and retain their previous snapshot through a transient
login-time read failure instead of flashing a false zero.
The main Office dashboard omits the redundant running-cost/reset header strip
and the personal presence/status-note/timer picker so the workspace and live
operations surfaces begin without those utility controls.
`StatusPicker` now reports its save/loading/error state accessibly, but remains
a dormant component and is not a visible dashboard feature. `WorldClockBar` is
also dormant; its formatter is now IANA-timezone and DST safe, refreshes, falls
back cleanly for invalid zones, and has accessible labels. The placeable
`world_clock` addon remains the visible computed-time surface.

Office layouts and complete floor presets use the §37 persistence boundary.
The layout row is private per authenticated user and circle; the client writes
sanitized detached snapshots through a serialized monotonic version gate. Its
fast/offline cache is one versioned user-and-circle envelope written through a
serialized queue and accepted only after exact readback. Local cache operations
own caller deadlines; if an underlying adapter cannot abort, that exact
user/circle lane remains quarantined until it settles while unrelated scopes
continue independently. The server queue compares against both pending and active work,
restores rejected operations for retry, and preserves a newer snapshot across
older failure/conflict. Server success requires a literal accepted receipt for
the exact submitted version and unchanged mutation epoch; equal-version
divergent JSON fails closed. Retry refreshes a preserved pending snapshot with
the freshly checked same-user credential and rejects an edit made during local
verification. Optional private preference enrichment can time out without
downgrading a successful authoritative layout read, and local bridge discovery
is not a hydration dependency. The legacy global
`profiles.office_layout` blob is ignored because it cannot prove circle ownership. Office
attention dismissal is revision-keyed and saved to the server, so the same
blocked episode does not return after remount while a genuine later update can
surface. Old paused/waiting episodes age out instead of remaining urgent
forever. A floor preset includes its theme, assigned agents, every furniture
item, tool/integration settings, labels, and interactive state; applying it
keeps the destination floor identity, creates fresh item ids, and marks the
captured roster manual. Automatic floors reconcile only live agents not already
claimed by a manual floor, so bridge refreshes cannot overwrite preset-owned
assignments. Status/activity reorder keeps existing live automatic occupants
and only fills actual vacancies, so a presentation-order change does not create
a layout version or server write. Preset load/apply/delete continuations bind to the initiating
user/circle generation; rows and mutations re-check circle identity, with
delete requiring an exact returned `id` plus `circle_id` receipt. The original
§37 objects are catalog-ready per the user's 2026-08-12 SQL Editor result. The
follow-up `20260813140000_office_layout_exact_save_receipt.sql` migration is
source-ready but not applied to the target. It also makes the RPC the sole
authenticated layout mutation surface, rejects unsafe/far-future versions, and
repairs legacy future-version poison before raw writes are revoked. It removes
invalid legacy dismissals, enforces a durable run/circle foreign key, and uses
server-owned acknowledgement/expiry timestamps plus a server-clock active-read
RPC. Before that trigger lands, the client includes a bounded 30-day compatibility
window so an expired historical dismissal is actually renewed; the trigger
overwrites both browser timestamps after migration. Authenticated localhost exact
local/server convergence and layout save/reload passed on 2026-08-13.

Private Telegram metadata, names, appearances, notes, budget, idle settings,
and filters use the separate owner-private §45 preference authority, not the
peer-readable profile blob. `office_user_preferences (user_id,circle_id)` has
RLS-scoped reads and one bounded allowlisted atomic patch RPC; direct
authenticated DML is revoked. Client work captures immutable user, circle,
access-token, and auth-generation scope for preferences, roster, identity,
session/tag caches, presence, heartbeat, and cleanup. Retired-scope writes and
late callbacks fail closed, another scope is not blocked by a stalled lane, and
the private Office subtree does not render until the exact scope hydrates.
Telegram tokens stay only in verified exact-scope local secret storage; the
server receives bounded non-secret `chatId`/`botName` metadata. Ownerless
legacy records are not imported. Migration
`20260813220000_office_user_preferences.sql` is mirrored byte-for-byte as §45;
it also scrubs the deprecated private profile keys and appearance column and
prevents older clients from restoring them. Static/parity, exact-scope runtime,
and disposable PostgreSQL behavior are current 2026-08-13, but §45 is not
applied. Negative RLS, two-account/two-tab, deployed, native secret-store,
cross-device layout, preset, preference, and acknowledgement behavior remain
pending.

The 2026-08-13 continuation hardening applies the same exact authority to
Office connections, terminal dispatch, approvals, OAuth/Figma, and idle work.
Before any private local or server hydration, the captured bearer must verify as
the captured user and return an exact membership row for the current circle;
cached workspace state is never membership evidence. Office connections load
and save under captured user/circle/token/generation authority, keep credentials
in verified protected local-secret storage, and ignore the app-wide auto-connect
cache/session list as an authorization source. The legacy connection APIs stay
available for non-Office callers during migration.

Terminal persistence now returns an immutable receipt binding the durable
message, sender/circle authority, and selected-target fingerprint. Direct send
and account-bound listener dispatch both require that receipt and a current
generation; broadcast is only a wake-up for an exact durable-row read. Office
HITL and run-approval mutations use captured bearer authority and validate the
resolved row before notifying callers. Calendar/Email and Figma continuations
likewise carry the captured token and reject popup/provider results after an
account switch. The idle scheduler retains the exact cleanup returned to its
mount, cancels both timers, fences work through the token-bearing Office
lifecycle, and drains a retired predecessor before replacement work. Its
dedicated effect starts only after exact user/circle membership and preference
hydration resolve; it no longer runs transient defaults or restarts for display-
name and bridge churn. Every behavior reserves a server-clock
`(circle_id,behavior_id)` claim through the membership-checked §46 RPC before
status, activity, message, memory mutation, bridge command, or Edge execution.
All five shared-Chat behaviors are owner-only explicit opt-ins, legacy configs
normalize them off, their minimum cadence is one day, and Weekly Retro remains
weekly. Local `lastRanAt` is cache/display
state rather than cross-client authority. Shared compatibility signatures remain
for explicitly non-Office callers; do not use them as Office authority. These
are source and focused-smoke claims, not §46 application, live two-member
contention, native-secret-store, provider, or deployment proof.

The 2026-08-14 continuation applies this boundary to Office computer-task
state, agent-plan queues, Profile computer-use history, provider-key/custom-
theme CRUD and hooks, workspace adaptation/activity, OAuth/Figma disconnect,
Phone/Messenger metadata and local provider secrets, terminal
deletion/invocation, shared-memory idle writes, and per-user/circle
hidden-agent suppression. Each exact path captures user, circle, bearer, and
generation; clears private presentation on retirement; and rejects late work.
Phone/Messenger additionally rejects ownerless legacy credentials, verifies the
captured bearer subject before every public operation, aborts provider I/O, and
unmounts contacts, messages, and drafts on authority retirement.
Terminal invocation also carries cancellation and keeps an ambiguous post-
dispatch result as non-replayable `outcome_unknown`. The scheduler supplies its
captured bearer explicitly to every Supabase and Edge call. Office continuously
revalidates membership through Realtime plus a bounded periodic lease and
retires the private subtree immediately when access is lost.

`chatPlanApprovalAuthorityCore.ts` is the dependency-free in-process capability
brand shared by app and Edge-imported approval code. A serialized or copied
approval object is inert. Dependency mitigation is deliberately narrow:
`nanoid@3.3.18`, Jayson/xcode `uuid@11.1.1`, and an Expo pre-export bounded
magic-signature guard that rejects symlinks plus ICNS/JXL/HEIF/HEIC content in
repository-controlled assets. rpc-websockets keeps its declared UUID major.
The upstream `image-size` issues have no patched release and remain build-time
audit debt; the asset guard does not make that dependency fixed.

Do not generalize this slice to the whole Office. The latest read-only audit
still leaves Vault server enforcement/recent-auth, agent-connect tokens, MCP
administration, and schedules/run-history mutations as unresolved P0 areas.
Source review, focused and aggregate smokes, both typecheck suites, a clean
production export, public-bundle scan, and an authenticated frozen-export
desktop/mobile canary passed on 2026-08-14. This is still not deployed-site,
real-provider, native-secret-store, or multi-account proof.

Office addon and editor behavior has one owner rather than 81 ad hoc contracts.
`OFFICE_ADDON_TYPES` in `officeConfig.ts` exhaustively defines every placeable
item and derives `FurnitureType`; the catalog attaches kind, provenance,
default state, primary action, interaction, configuration, readiness, motion,
audio, and search tags to each definition. Runtime-facing items use explicit
`local`, `demo`, `setup`, `live`, `stale`, or `error` state. Saving a link or
channel is local setup, demo data stays labelled demo, and only an actual
provider/OAuth read may timestamp live state; missing or aged evidence becomes
stale. Do not reintroduce mock connectivity, playback, online-member, viewer,
participant, repository, weather, market, calendar, email, or design-file
claims.

`officeAddonExperienceCore.ts` works from that canonical catalog and existing
floor snapshots. The editor searches all 81 items and filters by category,
Ready/Setup/Demo/Local state, Favorites, Recent, or Needs Attention. Favorites
and the newest 20 recent types use one versioned, bounded, user-and-circle-scoped local
preference record; malformed, unknown, oversized, or unsupported-version data
fails closed. The star control does not place an item, while successful item
selection/placement and kit application update recency. This same-browser
personalization is neither a second catalog nor §37 server/cross-device state.

The same pure owner provides five kits: Agent Ops, Focus Lab, Launch Room,
Review Room, and Social Lounge. `planOfficeRoomKit` builds a detached preview,
tries the requested snapped origin, then performs a deterministic bounded row-
major scan over canonical catalog dimensions, rotation-aware collision
rectangles, internal and existing-item overlap, floor bounds, capacity, and
fresh ids. Malformed input, capacity, no-free-region, and exhausted bounded
scan remain distinct visible failures. `officeFloorLayout.ts` owns the 16px
grid and 900×970 bounds that `OfficeTab` supplies to the planner; the core does
not create a parallel grid contract. A successful plan enters the same history
seam once. Local detached undo/redo is 30 entries by default and hard-capped at
60. Placement, duplicate, move, atomic resize, 90-degree rotation, layer order,
size reset, kit placement, and confirmed removal use that seam; current
connected/game fields on still-present items are not rewound by layout undo,
and a bounded per-floor item-state cache preserves configuration across undo-
add/redo. Farm crops, water, gold, harvests, upgrades, fertilizer uses, and crop
history persist through the allowlisted layout contract.

Floor creation caps at 10, immediately opens the new floor in edit mode, and
supports a sanitized 80-character inline rename. Floor chips expose selected
state plus item/agent counts. Floor deletion and clear-all remain confirmed;
save failure is a labelled retry action and operation status uses a polite live
region. Mobile edit mode exposes the floor. On web, Enter/Space, grid arrow
nudging, Shift+Arrow, and Delete/Backspace supplement explicit accessible
controls and actions so drag is not the only path. While editing, nested widget
controls leave pointer and accessibility traversal so the furniture wrapper
owns selection, position, size, rotation, keyboard, and accessibility actions;
Farm, Pet, and Whack-a-Mole therefore retain their own buttons without a nested
outer button. Hydration and every edit seam use one center-rotation-aware floor
constraint, while pointer cancel restores the preview without committing and
cleans active document listeners. Web move/resize gestures additionally capture
and filter their initiating pointer and roll back on capture loss or window blur.
The resulting floor first saves through exact user-and-circle local-cache
readback, then one newest-snapshot server drain. A busy writer latches a
re-drain; an older failure or conflict cannot erase a newer pending edit, and a
conflict pauses for a fresh authoritative read. Server layout reads and writes
abort after 12 seconds, while SAVED requires the exact accepted version to
remain the newest local generation. The durable server authority remains the
§37 monotonic persistence path.

Edit mode hides the terminal presentation without unmounting its state or
Realtime subscription. Read-only decorations stack behind agents; actionable
widgets and every edit-mode item remain above them. Button Panel and Launch Pad
stage review before effects and target only canonical virtual BlackSwan or one
exact enabled/connected owner UUID, with a current private binding additionally
required for OpenSwan. Picker and full terminal share one canonical selected-ID
array; final resolution atomically derives both compatible single- and multi-
target columns. A stale/presentation-only target fails before persistence rather
than widening to `@all`, and the absence of a mounted dispatcher also stops
before insert while retaining the draft. Send awaits durable persistence and
treats Realtime as an advisory wake-up; losing that wake-up returns the saved
receipt and never replays the command. Launch and preset effects occur only after
persistence succeeds.

Calendar and Email async work carries exact generation, circle, floor, item,
service, and provider scope. Direct reads use a separate item/provider generation
and recheck the current widget before patching; close, floor/circle change,
provider switch, and newer reads invalidate stale callbacks. Provider mutations
serialize; unavailable status never fabricates disconnection; switching provider
clears the prior event/mail payload through the canonical reset; and a provider-
wide disconnect invalidates every loaded widget using that credential. The Edge
source allowlists only `calendar` and `email`, unions each request with stored
same-provider granted scopes, preserves the normalized union through refresh,
and refreshes before status and provider reads. Expired or unrefreshable stored
credentials map through `reconnectRequired` to client `reconnect_required`
instead of row-exists `connected`, and raw provider/token failures remain server-
side. Section 42 adds service-only encrypted access/refresh storage, monotonic
authorization intent and credential revision, bounded refresh leases with CAS,
stable provider-subject checks, a secret-free disconnect tombstone, legacy
plaintext migration, and guards that reserve Google/Microsoft OAuth across
generic BYOK RLS/RPC paths. Source and disposable PostgreSQL hardening are
current; §42 application, Edge deployment, and real-provider OAuth proof remain
pending.

Personal Figma OAuth is a separate account boundary from Calendar/Email and
from circle-wide Figma credentials or saved Board links. The shared web helper
opens the popup during the user gesture and accepts a callback only from the
exact app origin, exact popup window, expected provider, and per-attempt nonce.
The Figma Edge binds that nonce as part of the exact complete one-time SQL
state, uses PKCE S256 and HTTP Basic client authentication for exchange/refresh,
stores tokens only in the encrypted service control plane, allows only
`file_content:read`, and sends Figma API requests with a server-side Bearer
token. The client receives only bounded file reference summaries, applies a
total deadline per lookup, resolves multiple links without racing one refresh
lease, and wraps every provider/attachment field in the canonical readable
untrusted-content fence before model use. Claiming a callback retains its exact
state row under a one-minute lease; the credential path self-heals only an exact
missing or expired state, preserving active callback authority while recovering
abandoned work. Client authorize, status, and disconnect operations have a
15-second total deadline. Same-generation status reads deduplicate, stale panel
lifecycles cannot mutate current UI, and an unknown disconnect outcome never
reports success. Intent/revision fences, bounded
refresh lease/CAS and contention recovery, stable-account checks, disconnect
tombstones, bounded response bodies, and trusted-origin 303 callback redirects
reject stale or ambiguous work; transient provider failures remain retryable
instead of fabricating a reconnect requirement. Definitive file/refresh
credential rejection invalidates only its exact revision, preserves a pending
reconnect callback fence, and cannot disconnect a newer winner; pending
authorization also suppresses background revision rotation, while client-
configuration failures never erase user credentials. Sequential multi-link
enrichment has one five-second pre-send budget, and oversized roots request a
specific frame/node rather than retrying forever. Provider and
attachment text stays inside the untrusted fence while fixed recovery guidance
comes only from a trusted local enum. Source, Deno, 117-assertion boundary,
68-assertion SQL/parity, and disposable PostgreSQL behavior proof are current.
Migrations `20260813190000` and `20260813200000` are not applied, the live
`figma-oauth` endpoint currently returns 404, and Edge deployment/secrets plus
real Figma connect/refresh/disconnect/private-file proof remain pending.

Run `npm run check:office-addons` for this surface. Its focused registry,
experience, UI-wiring, exact/atomic terminal-target and no-dispatcher boundary,
advisory-wakeup, dashboard-state, OAuth refresh/scope-union/control-plane, validation, and app-
typecheck coverage is not native, screen-reader, real external-agent dispatch,
applied §§42-43, deployed Edge, real-provider OAuth, cross-device §37, or dormant-component
rendering proof.
`npm run e2e:office-authenticated-local` is a separate explicit opt-in canary
that preflights cleanup authority, creates a disposable signed-in user/circle,
and uses ephemeral headless system Chrome rather than the persistent browser
bridge. Its successful 2026-08-13 receipt verified exact scoped-local and
authenticated-server version-plus-payload convergence, trusted-mouse
moved/resized/rotated/duplicated Desk geometry with exact snapping and
undo/redo, reload reconstruction, catalog personalization, item edit history,
floor add/rename/delete, the exact six-type Focus Lab application, edit-mode
nested-focus isolation, compact semantic selection/nudge/resize, a visible
no-overflow compact floor, truthful setup validation, one currently connected
exact command target, zero terminal-command writes before explicit Send,
an unsent terminal draft surviving edit-mode hide/show, reduced motion, zero
page/server errors, and zero-record cleanup. The hardened canary also binds the
exact route and Supabase project, emits SHA-256 bundle-resource manifests,
validates its real artifact directory, and captures bounded response/screenshot
evidence on failure. A fresh production export passed both desktop and mobile
paths with verified fixture cleanup on 2026-08-13.
The Office editor stays unavailable until the authenticated user-and-circle
scope has completed its exact layout hydration; the unresolved null scope is
not hydration and cannot expose edit mode before initialization resets finish.
That proves only the linked localhost path—not deployment, native UI,
screen-reader traversal, providers/OAuth, negative RLS, or cross-device §37
persistence.

These visual-context and truthful-receipt changes have source and focused-smoke
coverage only. Deploy the updated
`chat-stream` function and run an authenticated live image-to-connected-agent
E2E before treating it as production-ready. Exact image/file access remains a
separate future capability: use an opaque, expiring handle bound to user,
circle/thread, turn/task, provider/session, content hash, and bridge instance,
never an ambient local path or bearer URL. Connected-agent dispatch also needs
durable typed final-result adoption; launch/send acknowledgement is not proof
that the coding task finished. Until the provider owns typed started/final
events, the accepted ledger remains nonterminal and may become visibly stale;
Chat must not manufacture `running`, `completed`, or `failed`. The accepted-run
ledger is source/focused-smoke work only; no live bridge final-result E2E or
deployment claim is made for it.

## Computer Use

For the current and target app/browser/desktop/local-file/provider architecture,
see `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`. It now owns the Universal
Computer Task Kernel plan: stable root/run/action identity, structured action
evidence plus outer task acceptance, policy categories, the §26 mutation gateway, browser/native and
capability-buildout tracks, crash-safe resume, one cross-surface task ledger,
and production fault-injection gates. The source supports only the explicitly
listed current slices; the phased target is not a claim that OpenSwan can
already complete every human action in every app.

The shared V1 root seam is source-landed as of 2026-08-06.
`computerTaskRoot.ts` owns deterministic identity and the pure coordinator;
`computerTaskRootStore.ts` owns memory compatibility, the disabled durable
binding, and the feature-off atomic root/action gateway. Chat admits and
rechecks the root before planner, bridge, file, approval, or provider work. The
seven-field pointer is inert correlation only.

§34 now exposes combined root/action claim, start, and settle RPCs. They lock
the exact root before its action row, derive one §26 identity per root mutation
action including the canonical root `runId`, and advance both ledgers in one
transaction. Settlement may complete/fail the root in that transaction. Only
the exact proof-bound path may reconcile matching root and §26
`outcome_unknown` state to `verified`; generic §26 remains unchanged. The
TypeScript gateway accepts only its runtime-issued database binding, rejects
memory/clone inputs, and issues one one-shot mutating-handler authority only
from exact `started`. Exact claimed refresh recovery returns the live token
without a root revision bump or rotates an expired token server-side; it
revalidates the current root, active attempt, acceptance/dispatch bindings, and
foreground lease instead of replaying planned-to-claimed. Fresh post-lock
clocks govern claim/lease expiry and settle-token checks. TypeScript and SQL
reject STOP or human override while a claimed action could be stranded.

The pure Photoshop projection remains a value-free requirements artifact, not
authority. Its first runtime consumer is a default-off canary restricted to
Photoshop already running and frontmost. That path uses root A's canonical run
id directly, creates one §26 row for its one create mutation, and never creates
child wrapper B, launches, focuses, raises, or touches the browser. A fresh
target binds exact app, positive PID, CGWindow id, and window bounds; the bridge
rechecks the guard immediately before JSX. Baseline, correlated create receipt,
and final status must agree on positive document id, one-count growth, exact
dimensions. Final foreground is telemetry only after app-native proof: it is
excluded from the proof digest, never refocuses Photoshop, and cannot downgrade
completion. Runtime bindings realize the projected requirement fingerprints;
a persisted non-admitted root is fenced before clarification/generic fallback,
and a stale/changed same-action target lease is released and rebound after a
new exact observation. Another action's lease fails closed. Post-start
ambiguity never replays.

The canary requires all three flags to be exact `true`:
`EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1`,
`EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1`, and
`EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1`. They remain off. The current
sole-call wrapper recomputes handler args and consumes one-shot authority
against the exact issued database binding, root identity/revision,
action/call/token, tool/args, authorization/acceptance/dispatch fingerprints,
and foreground lease/target immediately before bridge entry. The bridge still
cannot independently verify that attestation. Bridge-verifiable authority and
durable STOP/override intent with atomic claimed-action cancellation are P0
blockers. A durable bridge receipt sufficient for post-refresh
`outcome_unknown` reconciliation is P1. Trusted outer request acceptance,
production migration/live canary, crash-cut/contention/recovery proof, and
wider lifecycle branches remain required. No live Photoshop mutation,
production SQL application, or deployment occurred for this slice.

The exact §34 migration and consolidated tail are 129,820 bytes, SHA-256
`45251c1ffd2ea002a227bfdcfcbd0875dbab47127e590031f3b4bf827651e30a`.
PostgreSQL 14 syntax/catalog plus positive, rollback, injected-fault,
claimed-recovery, fresh-clock/token, STOP, and human-override guard paths
passed, exact source/tail parity passed, and disposable resources were cleaned.
No production SQL was applied.

Browser computer use is split into:

- planning and preview in `src/lib/computerUse.ts`
- run state in `src/lib/useComputerUseTask.ts` and
  `src/lib/useComputerUseQueue.ts`
- edge execution in `supabase/functions/computer-use-agent/index.ts`

Kernel rollout order is: identity/authority inventory -> structured action-
evidence transport -> finish durable root identity and wire the source-landed
outer task-acceptance core around the request-bound Photoshop and named-app
lifecycle §26 canaries
-> catalog-wide mutation gateway -> durable leases/checkpoints and approval
continuation -> browser/native/capability breadth -> cross-surface task UX ->
live fault-injection/default rollout. New tools must use the policy matrix in
the kernel doc. Observation, lifecycle, bounded local draft, local/external
mutation, publish/send, credential/payment, destructive, coordinate fallback,
and capability buildout have different approval needs, but none may bypass
exact identity, target binding, dispatch truth, or after-state proof.

`computerUse.ts` does not have the genuine authenticated user/circle/persisted
run, provider `toolUseId`/iteration, durable claim, and exact OpenSwan approval
identity required for mutation. Its planned `navigate`, `click`, `fill`,
`select`, `press_key`, and `scroll` actions therefore become visible,
value-stripped, structured non-executable typed OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge mutation I/O. Continue through a fresh
typed Chat/OpenSwan call; never retry a mutation through the legacy/raw lane.
Saved-plan replay preflights the whole plan and permits only the reviewed
observation allowlist.

Native Anthropic computer use currently requires a Sonnet-capable model in the
edge loop. If a user selects an unsupported model, the edge function falls back
to the default Sonnet computer-use model. Text-only planner/validator work may
use marketplace models, but the native screenshot/action loop must stay on a
computer-use-capable model.

Local computer awareness goes through `src/lib/localComputerAwarenessIntent.ts`
and bridge tools. Reads such as tabs, running apps, clipboard inspection,
screen state, file list/read/search, and accessibility tree are lower risk.
Exact launch/focus is the narrow reversible lifecycle exception. A
model-issued lifecycle call needs an authenticated persisted run plus exact
provider tool-use identity; a strict compiler-owned Chat command may instead
use its bounded direct-request authority through the paired local bridge.
Both paths require fresh exact-app before/after proof. Open URL/path,
clipboard write/clear, shortcut run, window management, and all downstream
mutations keep the risk/approval path described in the runtime docs.

Before executing a chat request that asks to operate another app, browser,
local file, CAD tool, Adobe design file, or unfamiliar desktop program,
`src/lib/chatComputerRequestRouter.ts` builds the hidden best path: computer
preview, selected pipeline, app/browser strategy, surface order, approvals,
fallback pipelines, recommended tools, and proof requirements. Keep this route
quiet in chat; show the user only approval, proof, or actionable blockers.
The route also carries the typed app automation decision from
`src/lib/appAutomationControlSurfaces.ts`, so app/browser tasks can stop for
fresh observation, approval, user action, or connected-agent buildout before
mutating another surface.

Compound computer requests must preserve every user action separately from
planner/tool steps. `src/lib/chatMultiIntentCore.ts` conservatively recognizes
adjacent imperative clauses across sequence words, lists, action commas,
sentence-separated instructions, explicit temporal gerunds, and concise
ready-state transitions. Task/steps preambles do not hide the first action,
while object lists, questions, and narrative gerunds remain one intent. Polite
gerunds normalize only inside an explicit `would/do you mind` request frame.
`chatComputerRequestRouter` assigns stable `A1…An` identities plus explicit
`then` dependencies; `chatAgentContextPack` puts all of them ahead of optional
tool hints in the bounded execution prompt. The evidence contract requires
independent fresh target-bound proof for every A-id, and the plan preview,
telemetry, live handoff, and normal persisted handoff retain the same ledger.
Partial coverage is never whole-task completion: report completed, blocked,
and pending IDs without replaying uncertain mutations. If the detector caps or
truncates the request, decompose the intact original before any mutation. This
coverage ledger does not authorize tools, weaken approvals/target binding, or
replace the runtime-owned typed outer acceptance boundary.

The terminal boundary is explicit as of 2026-08-10: an A-ledger becomes
verified only when the typed task status is `completed` **and** the runtime owns
`taskCompletionVerified: true`. Model prose, a provider/Browserbase end-turn,
or a transport-level completed flag is insufficient. As of 2026-08-11, the
compiler-owned exact Photoshop and named-app lifecycle paths can mint that bit
through a WeakSet-branded single-use authority only after their target-bound
proof reaches a durable verified/completed acknowledgement. An authenticated
completed-root refresh may remint it without replay; copied shapes, missing
durable acknowledgements, and manual-verification results cannot. Cloud/local
browser and generic agent runs still surface their bounded result, but a
compound request without that outer receipt remains `partial`, persists each
A-id as `outcome_unknown`, and cannot automatically replay a possible
mutation. The closed-world file exception now accepts only two to eight
independent explicit `list`, exact-path `read`, `search`, or `stat` clauses. It
executes the original A-ids in order through the desktop bridge, requires an
exact server echo of each requested path or root/query, rejects truncated or
retargeted results, and stops before later actions at the first blocker. Only
an all-verified sequence receives the single-use whole-task authority. A
partial read-only sequence may persist a value-free
`verified* -> blocked -> pending*` projection, but that projection cannot
authorize a write or replace outer completion. Conditional safety clauses
such as `stop if a CAPTCHA appears` remain attached to the preceding action,
and the executable decomposition gate stops requests over eight actions or
4,000 characters before any dispatch. A malformed/mismatched persisted action
count also requires decomposition. File mutations, semantic interpretation,
multiple operations folded into one clause, cross-action pronouns/dependencies,
MCP fallback, and unmatched compound file requests stay in the authenticated
typed agent loop. The one-action shortcut follows the same explicit-operation,
exact request-echo, and non-truncation rules; it cannot use a generic MCP
success as proof of a named local file task. File/provider text is displayed
only inside indented evidence blocks, and the persistence formatter escapes its
reserved metadata delimiter before appending the runtime-owned envelope.

Use `src/lib/chatComputerRequestUx.ts` for that visible/hidden notice decision
so app/browser/desktop routes share the same user-friendly wording and actions.
Live computer handoff metadata and persisted chat rows should carry that notice
and the compact route-decision summary through
`src/lib/chatComputerHandoffContext.ts` instead of inventing new copy.
`src/lib/computerTaskEvidenceContract.ts` owns observe-before, actionability,
approval, proof-after, fail-closed, retry-evidence, and source-reference
requirements for those routes. `src/lib/computerTaskEvidenceRecovery.ts` owns
failure-time contract diagnosis so chat recovery can choose fresh-evidence
retry, user unblock, connected-agent adapter repair, or stop/report. It also
emits required evidence tools plus readiness state so retries can fail closed
when observations are missing or stale. Pass the compact app route decision into
that recovery path so route-level missing confirmations, approvals,
user-action blockers, and connected-agent buildout decisions shape the recovery
options instead of being lost after preflight. A pure desktop launch/focus/read
contract requires only exact app/window identity and the smallest requested
app-native or accessibility observation. It must not inherit file search/stat,
document mutation, browser fallback, export proof, or approval requirements;
those are added only when the typed task actually needs them.

Strongly framed `Use`/`Open`/`In <App>` requests, including long-tail app
names, stay desktop-owned and exclude browser tools/fallbacks. Literal URLs,
web-only apps, WordPress, transactional web intent, and browser-product
navigation remain browser-owned; a strict lifecycle-only `Open Chrome`-style
command targets the installed native app without adding `browser.open_url`.
An otherwise ambiguous lowercase long-tail lifecycle target such as `houdini`
or `acme studio` enters that direct branch only when the refreshed bridge-online
app-resolution context contains the exact normalized installed/running name;
an unavailable name or stale offline inventory remains conversational.
Finder/Preview/TextEdit file-shaped work stays local-file. The
closed-world Photoshop compiler remains isolated from this generic route.
Names such as Docker Desktop and Microsoft Remote Desktop are exact app
identities, not evidence that the task concerns a file on the Desktop folder.
Read-only named-app routes may expose launch/focus/wait/observation tools only;
the router must rebuild the route before any mutation tool can be dispatched.

`parseDirectDesktopCommandEnvelope` and
`parseStrictNamedAppLifecycleIntent` in `src/lib/genericAppNavigator.ts` are
the shared source of truth for strict single-intent `open` / `open up` /
`launch` / `start` / `focus` / `activate` / `switch (over) to` / `bring ...
to the front` / `bring ... forward` commands. The first parser removes only a
closed, bounded non-operational envelope: greetings, request courtesy and
scope words, `for me/us`, soft urgency/timing, and an explicit local-desktop
qualifier. Combinations of that language cannot change the action, exact
target, approval, tool manifest, or execution mode. The longest exact catalog
or freshly observed app identity wins before suffix normalization, so a real
name such as `Acme Now` or `Research and Development` is not truncated.
Scheduling, conditions, credentials, approval changes, and appended actions
remain in the command and cannot inherit deterministic authority. The same
normalizer feeds the closed-world Photoshop exact-program compiler. Router and
preflight consume the lifecycle result, so qualifying commands require only
`desktop_control` and cannot drift into an `app_tools` buildout or app-choice
alternatives. The router retains the user's app phrase separately from the
canonical local bundle/process dispatch identity. It compiles an immutable
no-AI lifecycle program; `ChatTab` passes that program and its STOP signal to
`computerTaskRuntime`, which first binds the originating Chat request to an
authenticated persisted root and one request-only §26 activation action. The
action key deliberately survives refresh-time long-tail app canonicalization;
the separate exact program fingerprint still rejects drift, so a renamed/cased
program cannot mint a second activation. One `open_app` semantic primitive then
chooses mutually exclusive branches from the fresh initial observation: launch
plus bounded wait when stopped, or focus when already running in the
background. It never launches and then focuses. Explicit focus never launches,
and a terminal duplicate after refresh cannot enter either branch. Fresh exact
running/frontmost proof is required. Cancellation is a neutral typed
`cancelled` terminal, not a blocker/recovery loop. Guidance
questions, generic nouns/files, and requests with any follow-up clause do not
compile. The observed-name exception never outranks those guards. Semantic
state reads remain model-assisted, and app/document
mutations keep their normal approval and evidence boundaries. These lifecycle
guarantees are source/focused-smoke current 2026-08-10; no updated live GUI,
duplicate-refresh, bridge-restart, foreground-override, or competing-client
proof is claimed.

`buildGenericAppSemanticWorkflow` in `src/lib/genericAppNavigator.ts` is the
canonical unfamiliar-app decomposition contract. It preserves the exact user
request and emits at most ten ordered checkpoints with observe-before evidence,
allowed semantic surfaces, mutation/approval class, expected postcondition,
and a buildout/stop rule; verification of every original clause is always the
last checkpoint. The allowed surfaces are adapters, app lifecycle,
app-native APIs/scripts, documented file adapters, embedded DOM/CDP,
accessibility, semantic menus, and verified shortcuts. Coordinates are not in
the workflow schema.

Pure observation and exact launch/focus/wait do not create approval prompts.
Model-issued launch/focus still requires authenticated persisted-call identity;
the strict compiler-owned Chat lifecycle path uses bounded direct-request
authority through the paired bridge. Both require fresh exact proof.
Reversible non-secret field/menu/toggle checkpoints share
one bounded workflow review rather than prompting once per control, but each
runtime mutation must still consume its canonical exact-call receipt.
Persistent/external/destructive/credential/permission and ambiguous steps keep
their exact approval or user-choice floor. Missing semantic target, target
drift, or uncertain post-dispatch state stops the workflow; it does not unlock
coordinates or automatic replay.

The first enforced-action foundation lives in
`src/lib/computerAppGrounding.ts`: short-lived observation epochs bind a
proposed mutation to the exact app/process/window/document or browser
session/tab. A deterministic secret-safe fingerprint of canonical normalized
handler args is bound into the sealed contract and runtime-issued exact-call
policy. Conservative unknown-mutator risk, fail-closed process-local
idempotency, single-use authorization expiry, and a sealed handler-entry
receipt guard the foundation. A task can complete only from a newer
runtime-issued same-target after-state.

Typed OpenSwan `browser.fill_field` is one of three integrated browser mutation
routes. The shared loop validates each provider `toolUseId` as a bounded run-wide-unique
capability, rejects a malformed/reused round before any handler enters, and
passes the exact `toolName`, `toolUseId`, and iteration into a fresh call
context. The runtime normalizes one exact non-secret draft, takes a DOM
observation, then calls `POST /browser/fill_target` to resolve and inspect
exactly one field before approval. That read-only step returns a short-lived,
single-use `targetId` backed by the exact ElementHandle and an HMAC privacy-safe
v2 `targetFingerprint` over all inspected semantics plus keyed
document/node/frame structure. The target id is dispatch-only and excluded from
durable approval, receipts, and model output. Durable approval stores SHA-256
bindings for the exact normalized intent and page URL plus bounded safe
origin/length and opaque process/context/page/fingerprint metadata. It does not
persist raw draft text, URL path/query/fragment, locator, or task context, and
accepts only a genuine receipt backed by an `agent_run_approvals` row. Category auto-approval creates
an exact durable `auto_approved` row first; run-scoped and consumed cross-run
approvals preserve their real row id/source. Missing ids and lookup failures
block.

The source-default SwanBot v2 edge `browser.fill_field` schema matches this
sealed non-secret/non-submit contract: it requires bounded `text` plus exactly
one accessible `name` or CSS `selector`, permits only an optional
textbox/searchbox role and bounded exactness/timeout/task context, and rejects
extra fields. There is no submit field or combobox role. Dropdown selection and
saved credentials stay in their dedicated tools. Exactly one locator is not
merely a model-schema hint: the edge schema, app normalizer/sealed runtime,
browser client request builders, and bridge target/perform endpoints each
enforce `name` XOR `selector`; both-present and neither-present inputs stop
before observation or dispatch.

The saved-credential schema has app/edge parity: it requires a bounded
`credentialField` and exactly one non-empty `credentialId` or `item`. Neither,
both, blank, unknown-field, and ambiguous-source payloads stop before approval.
Execution is intentionally disabled even for valid input until one exact
browser process/context/page/opaque-URL/field fingerprint can be rechecked at
handler entry. The outer and inner dispatchers fetch no secret and fill
nothing; model-side `credentials.get`, `approvals.resolve`, and saved credential
fill are withheld from selectable catalogs and their dormant handlers fail closed.

The local browser bridge issues opaque process/context/live-document identity;
the page id changes on main-frame navigation or reload, including a same-URL
reload. Guarded handler entry consumes the target id once, rechecks live
identity and the target fingerprint, and inspects direct attributes, associated
labels, `aria-labelledby`/`aria-describedby`, and the containing form for
credential/recovery/seed/private-key/payment/CVV signals. It reads the same
handle before mutation and skips `fill()` when the approved draft is already
present, avoiding duplicate input/change handlers after an outcome-unknown
attempt. Both the app normalizer and the bridge reject obvious secret-bearing
draft values without reflecting them. The mutation action SHA-256-binds the
exact transient handler args; the dispatcher recomputes the digest from a
deep-frozen clone, revokes the observation epoch at handler entry, and passes
only sealed args to the handler. Proof then uses one exact-handle renderer
capture of value, semantics, document, node, and frame state bracketed by
stable browser identity checks. It contains only fingerprint, server-side
value equality, bounded lengths, a mutation/no-op flag, timestamp, and evidence
identity; it never echoes the requested/observed value or ephemeral target id. Navigation, close, bridge
restart, capability expiry/replay, detachment, or target drift fails closed and
requires a fresh observation. Completion requires that redacted proof to
produce an accepted same-target verification receipt.

`browser.set_toggle` is the second sealed route. It sets one exact checkbox,
switch, or radio to an explicit boolean through the same provider-issued call
identity, genuine exact-call approval, single-use ElementHandle capability,
keyed target fingerprint, verify-before-replay, and redacted after-state proof.
Both model and bridge boundaries require positive local presentation or
accessibility semantics; consequential and unknown settings fail closed. The
approval card includes a bounded secret-redacted target summary but not the raw
selector, task context, exact URL, or one-shot id. Generic `browser.click_role`
inspects its resolved handle and refuses native/ARIA state controls, labels,
and descendants so it cannot bypass this route.

`browser.select_option` is the third sealed browser route. It accepts one native
single-value select and one exact option value or label, takes a dedicated
fresh target/option observation, selects at most once, and proves the exact
option on the same live handle without submitting or navigating. Multi-select,
ambiguous options, protected/unknown settings, stale handles, and target drift
fail closed. Generic click refuses select/combobox/listbox/option targets,
labels, and descendants, so it cannot bypass the dedicated select lane.

`src/lib/agentActionCalls.ts` plus §26 owns durable cross-process claim/start/
finish for fill, toggle, select, the narrow native semantic press,
`desktop.open_path`, manual automation file writes, and approval-gated
external edge mutations. An
authenticated claim binds user, circle, persisted run, exact tool, provider
`toolUseId`, action id, tool-argument fingerprint, authorization-contract
fingerprint, and idempotency key without storing raw args, selectors, URLs,
content, or unrestricted metadata. The state machine is `claimed → dispatched
→ verified / outcome_unknown`; `failed` is valid only while a row is still
undispatched `claimed`. Handler entry atomically records `dispatched`, and
duplicate or terminal calls never re-enter the bridge handler.

Concurrent claimers may receive the same token. A worker that loses before its
callback therefore leaves the claim unfinalized/reclaimable instead of
overwriting another worker's dispatched action. Any error after confirmed
handler start maps only to `outcome_unknown`; the TypeScript parser rejects a
forged failed-after-dispatch payload. If fresh proof verifies the task but the
final database acknowledgement is unavailable, the user-facing result remains
truthful `ok: true` while warning that the exact call is replay-blocked.

Native `desktop.click_element` is a narrow semantic-press canary. It requires a
fresh indexed accessibility observation, exact app/PID/path/role/label/
fingerprint agreement, genuine exact approval, one target-bound press, and a
refreshed exact-target semantic diff. It does not authorize arbitrary desktop
coordinates, consequential controls, or general native-app mutations.

SwanBot v2 routes every browser/desktop mutation currently registered as
client-delegated through the canonical OpenSwan runtime before any raw
dispatcher, preserving provider tool name/id/iteration. The five guarded
canaries additionally keep their sealed proof, durable action-call, and
sanitized receipt contract; hidden receipt subsets never enter model content,
are re-sanitized at the edge, and persist as correlated client result events.
This current-catalog interception is not a universal guarantee for future tools,
other callers, or mutation families without a sealed verifier.

The default edge continuation client unions hard constraints parsed from the
raw turn with richer upstream constraints and consults the current canonical
tool policy before handler entry. Auto/read calls do not invoke a merely-
present review callback; direct ask calls require one exact review; calls whose
canonical handler owns durable approval do not receive a duplicate surface
prompt; and missing policy fails closed. Only calls that can actually reach the
surface callback serialize their batch. Hard constraints still block before
all review/dispatch, and runtime-owned calls retain the original turn floor at
the final chokepoint. The device-local typed loop and legacy v1 per-step review
still need the same policy-aware UX convergence audit.

Fresh v2 Chat requests now carry the active thread only from authenticated
client context. The edge authorizes that exact user/circle/thread before model
or tool work, seals the thread identity inside the encrypted continuation, and
restores it on resume. `messages.create` fails closed when thread identity is
missing or a model argument disagrees; its service-role insert takes
`thread_id` only from the pre-authorized context. This is the source fix for the
observed `messages?select=id` 400/default-thread misrouting seam. Current-edge
deployment and live §31 behavioral proof remain pending.

Continuation resume is encrypted, bounded, and single-consumer. The exact
paused model/tool snapshot is minimized and sealed with AES-256-GCM by
`swanbot-continuation-crypto.ts`; it is never stored as plaintext. Public
`agent_runs.metadata.continuation` contains only a value-free CAS envelope:
opaque identity, protocol/storage versions, one-time nonce, resume/claim state,
bounded counters/tool identities/timestamps, an `expiresAt` exactly ten minutes
after `pausedAt`, and the authenticated ciphertext envelope. Public tool-event
inputs are structural value-free schemas and persisted failures use stable
redacted codes/copy. Exact arguments and errors remain transient for live
approval, dispatch, proof, and model-loop work.

Deployments must explicitly configure a dedicated
`SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and
`SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`; do not derive or reuse the
service-role key or another shared credential. The source fallback key version
`v1` is not a key-rotation configuration. With no continuation encryption key,
SwanBot withholds every `clientOnly` tool before the model turn and dispatches
no local action instead of creating a plaintext or unresumable checkpoint.
AES-GCM additional authenticated data also binds the canonical lowercase
`runId`, `userId`, and `circleId` for the persisted row. Those identifiers are
not copied into the six-field public ciphertext envelope, and moving ciphertext
to another row fails through the same unreadable-close/no-replay path.

The client must first present a client-generated exact claim: an edge CAS
changes `pending` / `client_pending` to `dispatch_claimed` /
`client_dispatching` before any local tool handler runs. Only the exact echoed
claim may dispatch. Exact result submission then atomically rotates that state
to `results_claimed` / `client_resuming` before the model loop resumes, and that
claim gates every later next-pending or terminal update. Competing or non-exact
duplicate claims, ambiguous acknowledgements, expired leases, failed
claim-bound writes, and post-claim loop failures become `outcome_unknown` with
no reopen or automatic replay. Only an exact same-claim dispatch retry carrying
the already-winning claim is idempotently acknowledged; a different claim or
mixed protocol/state never is. Readiness ignores all three active stop-reason
rows: `client_pending`, `client_dispatching`, and `client_resuming`. Every edge
pending, checkpoint-failure, continuation-close/seal, cancellation, failure,
and terminal writer repairs a complete run summary: an array `tool_calls`, an
`iteration_count` of at least one, and finite nonnegative input/output/cache
token fields. Write diagnostics expose only a bounded operation name and safe
machine code for these summary/checkpoint/close/CAS paths; older claim/event
logging elsewhere in the Edge remains outside that guarantee.

Terminal integrity is independent of the model's final prose. Once a
client-delegated mutation is durably recorded as dispatched but returns
`ok: false`, lacks accepted verification, or reports outcome-unknown, that
condition latches across continuation rounds. A later model `end_turn` cannot
convert it to completion: the edge persists a replay-blocked failed terminal,
publishes no completed Feed card, and returns a structured non-fallback 409.
Fresh terminal writes also check the compare-and-set result and exact reread;
a late user cancellation wins, while any other ambiguous write stops before
publication. The client preserves `cancelled: true` as a neutral reached-edge
terminal for empty or nonempty model tails, so STOP never trips the transport
breaker or falls through to v1. Any other authenticated/reached-edge empty
terminal is likewise non-fallback and surfaces a stable missing-payload stop.
Direct WordPress and workspace mutations now stamp a value-free receipt at the
exact provider/database/UI dispatch boundary; only concrete returned identity
and state can add accepted completion proof, while `workspace.open_preview`
and ambiguous trash responses remain outcome-unknown. The original
`turnRequestId` is preserved in every fresh pending, terminal, cancellation,
and failure metadata replacement, so a lost-response retry collides before
another model or Feed run.

The edge also latches before every server-side memory/task/mission/message/
room/approval writer enters its handler. If a later model or runtime failure
makes that turn ambiguous, the run closes as
`server_mutation_outcome_unknown` with `replayAllowed: false` and a
verify-before-new-action marker. The client reads that structured non-2xx
response and stops before v1 fallback, rather than retrying the whole turn
under a new run identity. A modern fresh call generates one UUID
`turnRequestId`, reuses it across transport attempts, and the edge inserts it
as `agent_runs.id`; a duplicate primary-key attempt stops before the model.
Legacy/no-identity fresh calls retain read-only/text work but have every
server-side writer withheld.

Section 29 adds a service-role-only, atomic continuation privacy sweep. When
installed, its named `pg_cron` job runs every three minutes (or emits a stable
NOTICE when cron is unavailable) and closes active missing, legacy/plaintext,
malformed, state-mismatched, or expired checkpoints with a value-free
`continuationResumeOutcome` and `replayAllowed: false`. `client_pending` closes
as `failed_before_dispatch`; claimed `client_dispatching`/`client_resuming`
work closes as `outcome_unknown`. The migration separately performs a one-time
scrub of terminal/non-active checkpoints. Its protected-row trigger also
rejects authenticated INSERT/UPDATE/DELETE attempts for active SwanBot v2
continuations, preventing row cloning or protected-field rewrites while
preserving existing reads, service-role/Postgres maintenance writes, and the
exact owner-only `running → cancelled` STOP transition followed by one bounded
write-once cancellation-provenance merge. Every row terminalized by the sweep
also repairs its existing tool/iteration/token summary columns to safe shapes;
those values are not copied into outcome metadata.

The legacy `computerUse.ts` planner/executor is observation-only. All six legacy
Computer Use mutation kinds—`navigate`, `click`, `fill`, `select`, `press_key`,
and `scroll`—return structured non-executable OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge I/O; saved-plan hydration and persisted
session projections strip mutation values. `/replay` likewise preflights the
complete recording and runs zero steps when any browser/desktop mutation is
present. Only its explicit observation allowlist can replay locally.

The hosted Browserbase Computer Use lane is separately source-hardened as of
2026-07-26. `computerUseAgent` sends a bounded schema-v1 execution-policy
envelope that the edge validates before provider/session work. Authenticated
Chat/queue calls require an interactive envelope; watch/service calls are
forced to scheduled observation-only execution. Authenticated legacy callers
without a policy receive HTTP 400. All three root Chat cloud starts—automatic
browser launch, booking-session continuation, and manual approved launch—use
`buildChatComputerUsePolicyInputs` to preserve derived user constraints plus
the opaque-target, credential, and external-side-effect confirmation floors.
The single-task and queue hooks acquire synchronous start reservations before
imports or credential lookup, count pending starts against capacity, and
invalidate those reservations on cancel/clear.

Computer-task UI and runtime ownership is also exact-thread scoped. Switching
thread, circle, user, or unmounting cancels the owned cloud/local handle,
invalidates late callbacks, clears local session and pending-permission state,
and prevents a result from being persisted into the next thread. A durable
`executing` record without a live reattach owner hydrates as blocked/unverified,
never as resumable work. Capability-buildout polling reads checkpoint state
through a stable ref so each save cannot restart its own polling effect.
Permission submission reserves synchronously against double clicks, and the
Computer Use/particle animations have one cleanup-owned loop with stable hook
topology.

The edge classifies left/right/double click, type, key, and saved-login filling
as mutations; unknown native actions fail closed. Because current coordinate
and focused targets are opaque, every such mutation requires durable exact-call
live confirmation even when a pre-run grant exists. An approved call is
bracketed by fresh pre/post screenshots and uses one-attempt dispatch.
Missing pre-action proof blocks before dispatch; a dispatched but unverified
result becomes `mutation_outcome_unknown` with no automatic replay.
Secret-bearing type/key/credential/question data is redacted or omitted across
SSE actions, progress/action traces, model history, guided replay, stuck-solver
payloads, usage metadata, and errors.

`computerTaskRuntime` no longer performs a generic deterministic app mutation
or attachment open/wait before the authenticated typed agent loop. Read-only
live observation may still precede `executeAgentRun`; model-planned app/hybrid
work itself does not. A compiler-owned exact program is the narrow exception:
when every call, argument, and authorization mode is present in the immutable
Chat plan, its local executor can run without an LLM relay. The router-owned
strict named-app lifecycle program is one reversible instance; it carries only
observe, one mutually exclusive conditional activation (launch/wait if stopped
or focus if already running/background), and final observe calls and remains
separate from document/UI mutations. `src/lib/computerSequenceProgramCore.ts`
owns the independent exact Photoshop blank-document family: app-native
status, conditional launch, status, exact create, and final status proof. It
uses the current direct command for one closed-world new unsaved document at or
below 4096 px per axis / 16 MP; larger allocations retain one SHA-bound Chat
approval. Appended or unknown edit/save/export/overwrite/delete/login/purchase/
external instructions cannot inherit direct authority. It does not request a
source file, layer inventory, generic UI fallback, or capability buildout, and
an unverified post-dispatch result cannot replay. The shared polite-command
envelope also recognizes natural `Can/Could/Would you ...` and `I need you to
...` variants for this exact family without widening its action whitelist. The
visible exact-task card mirrors that program as Status -> Prepare -> Create ->
Verify and omits generic file resolution, edit, layer review, export, and
handoff copy. The executor persists an authenticated root `agent_runs` row
before desktop access and issues a compiler-scoped dispatch capability for the
exact program. Create then uses §26 claim -> start -> finish, so a duplicate
under that same root/action cannot enter the bridge. When required, a
filed/pending plan approval remains an awaiting-approval state
instead of launching generic failure recovery. `computerTaskState` retains only
a bounded credential-free correlation to the exact approval row, authenticated
requester/circle/thread, expiry, and program/request/intent fingerprints. A full
Chat-tab refresh may rehydrate that correlation, but hydration, bounded polling,
and Realtime only trigger an exact authenticated row requery. The normal gate
recomputes the fingerprints and must win the one-shot consume compare-and-set;
only then does the handler clear the correlation before desktop work. Rejected,
expired, stale, consumed, legacy, or mismatched rows terminalize. Office/another
client still has no general cross-surface execution continuation.
This removes the broad pre-agent app-adapter and attachment-open bypasses.
The strict lifecycle dispatcher and courtesy grammar were source-, smoke-, and
typecheck-verified through 2026-08-06, including request/root/§26 no-reentry and
mutually exclusive launch/focus. Model-guided `desktop.launch_app` now also
requires fresh exact running/frontmost proof; a process-only success cannot let
the next semantic action continue against Chrome or another foreground app.
No updated live canonical Chat lifecycle, duplicate-refresh,
foreground-override, or competing-client validation is claimed for that slice.
A separate Chrome-free terminal drill is available as
`npm run drill:photoshop-exact`. It is non-mutating by default and requires an
explicit `--live` flag plus the current dry-run confirmation fingerprint before
using the fixed loopback desktop bridge. The drill derives the immutable
manifest from the production exact compiler and requires strict Photoshop
identity and foreground proof. Its own smoke checks the drill, while the paired
`smoke:computer-task-runtime-context` independently pins the production
executor's bounded retry, STOP, identity, and exact-proof source contract; this
is not a shared-helper or end-to-end production-parity test. The drill dispatches
the create operation at most once. After a positive named create
receipt, both the production executor and drill may make at most three fresh,
read-only app-native status checks at 250 ms intervals; the create action is
never re-entered by that invocation's proof loop. Success requires the exact
created document name and 600x600 dimensions. Durable deduplication across a
live concurrent client or cross-process restart is not claimed. A genuinely new
explicit submission intentionally creates a distinct request/root. Its focused
contract gate is `smoke:photoshop-exact-drill`.
On 2026-08-05 one live drill invocation made exactly one create call and zero
browser calls. Its immediate proof read was stale, so that original invocation
correctly exited `verification_incomplete`; a separate fresh read-only status
then proved Photoshop frontmost with active document `Untitled-1` at 600x600.
The bounded status-only retry was added from that finding and has not been
validated by a second live create. This scope does not exercise the
authenticated Chat UI, approval filing/consumption or persistence,
message/Realtime continuity, or browser focus/event wiring.
Live validation on 2026-07-31 submitted the motivating request through the
refreshed authenticated Chat UI from a fresh Photoshop `appRunning:false`
status. It created no approval row, persisted the completion, and final
app-native status proved `Untitled-1` at 600x600 px, RGB, 72 ppi, with one
layer. After refresh, an exact computer-task approval can rehydrate only its
bounded credential-free correlation and resume through an exact authenticated
row requery plus the normal one-shot consume gate; raw task text is not
persisted as authority. A newer completion
in the same thread never suppresses an approval by chronology alone because a
thread can contain unrelated tasks.
Chat never reconciles task cards by prompt wording, normalized request text,
structural similarity, or a shared chat-turn id. An older ready/approval card
becomes `Superseded` only when a later structured, verified completion shares
its exact immutable run id or explicit request id. Without that exact lineage,
the card becomes `Historical` only after a newer human turn from the same
stable author; a different circle member's later turn cannot deactivate it.
New bot rows persist that requester as `requestAuthorId`, so interleaved shared
threads do not infer ownership from message proximity. Legacy proximity
inference is allowed only when the transcript has at most one known human
author; ambiguous multi-author legacy cards fail open as `Current`.
For metadata-free legacy rows, the only fallback is a strict actionable
desktop-plan signature: approval/readiness language plus a concrete control
phrase such as `Approve desktop run`, `desktop-app path`, `app-native tool`, or
`desktop.*`, with failure and blocked statuses excluded. Even that fallback can
only become `Historical` after a newer same-author turn; text can never prove
completion or supersession. Both inactive states are read-only: phase, proof,
review, and browser-session evidence remain visible while approval, launch,
verification retry, recovery, run-stop, and run-again mutations disappear.

Legacy deployments that still enforce `messages.content <= 1000` use a safe,
parseable persistence retry instead of slicing through structured metadata.
`persistedChatMetadata` preserves only a bounded, redacted source/status/
lineage envelope, fits visible text around complete JSON, validates the
candidate before submission, and otherwise emits an explicit marker-free
text-only row. `chatService` acknowledges the returned database row only when
its present local-message, run, request, requester, status, and source fields strictly
round-trip (or the marker-free text matches exactly). Truncated, unparsable, or
parseable-but-mutated metadata keeps the recoverable local pending record.
Typed-batch and outer failure terminals now use one durable pending-row
finalizer, verification retries update the saved bot row, and message Realtime
merges INSERT and UPDATE envelopes through reconnect/catch-up into mounted
clients; an authoritative bounded snapshot repairs missed DELETE events. If a
bot UPDATE has no valid envelope, Chat clears stale structured controls instead
of retaining unproven actions. If a computer mutation may have dispatched but
final proof is missing, the persisted handoff carries
`replayPolicy: manual_verify_only`, `mutationDispatched: true`, and only the
bounded read-only `verificationOnlyTools`. After refresh Chat hides every
approval, retry, recovery, app-choice, preflight, quick-reply, run-again, and
cross-surface mutation affordance; only that verification path remains.
The source-issued verifier is single-use and bound to the original requester,
current task, exact bridge process instance, and exact target. It rechecks task
and bridge scope after every awaited observation and before persistence, and it
never upgrades the outer task to complete.

The 2026-08-01 desktop-target hardening keeps that exact program attached to
the requested app. Chat classifies and compiles the unmodified user utterance;
dispatch prefixes are metadata only, so `Use computer:` cannot turn one exact
Photoshop workflow into two linguistic asks. The primary web composer never
auto-focuses and blurs only at the native-dispatch boundary. Before creating a
document and again after app-native status proof, the exact executor requires a
fresh window-state observation that identifies Photoshop as foreground. A
missing or contrary observation permits one semantic Photoshop focus call and
one verification read, never a coordinate fallback; pre-create failure blocks
without mutation and post-create failure remains partial/non-replayable.

Model-planned `computer_apps` turns also carry a strict `desktop_app_only`
execution-surface ceiling through both typed tool loops. Browser tools,
`desktop.open_url`, generic tool search, and browser-named launch/focus/raise
targets are unavailable in that profile. A browser is legal only when routing
selected an explicit browser or hybrid profile.

Model-planned `computer_files` turns carry a parallel `local_file_only`
ceiling. Scoped file operations, `desktop.open_path`, Preview, and non-browser
native apps remain available, but browser tools, URL opening, generic search,
and Chrome/Safari launch, focus, or window raising are rejected before
dispatch. The outer automation planner projects the canonical embedded route,
risk, and approval decision, so it cannot relabel a native/local task as a
browser task or add a redundant plan approval.

Uploaded files remain staged and return a value-free, non-executable
`desktop.open_path` handoff with no raw path or fabricated identity, approval,
receipt, or proof. The exact staged context remains in the authenticated task
prompt and is redacted from result, capability-buildout, and action-trace
telemetry.

Approval authority is exact and single-use across the audited Chat,
OpenSwan, and SwanBot lanes. Chat hashes the complete normalized plan and
user/circle/thread/room scope, then consumes `agent_approvals.applied_at`
before one transport dispatch. If a deployed project specifically reports that
the additive `applied_at` column is missing, Chat repeats the exact fingerprint
lookup without only that field and atomically consumes legacy authority through
an `approved`/`auto_approved` -> `consumed` status claim. Other database,
network, RLS, payload, or schema failures still fail closed; §10b/§28 remains
the canonical database target. The generic approval worker does not touch
runtime-owned Chat/scheduled rows, while `chat.review_comment` remains a real
worker-owned exception. OpenSwan hashes canonical tool arguments plus
authenticated persisted-run/provider-call identity and atomically stamps one
dispatch binding. SwanBot WordPress writes and the generic risk floor use that
same schema-v2 digest/claim model. Durable and model-visible payloads keep only
bounded structural labels and safe digests; raw commands, paths, values,
credentials, and canonical approval keys remain transient.

`src/lib/approvalEffectPolicyCore.ts` is the canonical dependency-free effect
taxonomy beneath category auto-approval, sticky scopes, unified/tool policy,
OpenSwan approval batching, and exact tool-call approval classification. Only
observe, exact app lifecycle, and positively identified reversible non-secret
effects are category-auto eligible. Persistent, external, credential/login/
payment/purchase/publish/send/delete/private-file/permission/security/
destructive, ambiguous, and unknown effects require exact outcome authority.
Every existing persisted Chat computer mutation category currently maps to the
exact side, so broad site/app standing-grant creation is paused, forged or
legacy scopes hydrate to no authority, stored broad auto preferences clamp to
ask, and the Permissions form stays hidden. The exported prompt-budget
descriptor is explicitly not runtime-integrated.

The V1 Chat plan-to-tool manifest is a separate inert integrity object, not
authority. It binds at most 32 ordered actions to one root/request plus exact
tool+args and current-policy digests, stores no raw args/policy values, and
turns the first hard floor plus every later action into
`final_confirmation`. Build/validation cannot dispatch; durable issuance,
current-catalog revalidation, and atomic per-action consumption are still
future runtime work. Model-side `approvals.resolve` and `credentials.get` fail
closed at outer and inner dispatchers. Unknown/public/file/governance writes
default to exact approval, and plugins may tighten but never downgrade a
mandatory ask boundary.

Durable OpenSwan/subagent tool-call telemetry is also value-free:
`eventBoundCore` persists only bounded field/type/shape summaries. Unknown
tool-result success payloads collapse to a value-free result schema, while
receipt metadata survives only through namespace/field/type/value allowlists.
`agentRunSystem.addStep` applies the same fresh summary at the final
`agent_run_steps` insert boundary: tool input, tool output, tool-bound
metadata/title/body, and malformed tool names are reduced to controlled
structural labels. The Run History drawer projects each whole tool step and
suppresses legacy raw name/title/body/output fields. Exact arguments and
arbitrary results remain in-memory solely for approval, dispatch, proof, and
model work; ordinary non-tool message/plan metadata/title/body keeps its
compatible shape.
`event-bound-core` is a readiness requirement and runs once in both release
gates (it was already present once in `smoke:all`).

Legacy direct local-file, image-conversion, and diagnostic launch paths return
only value-free, non-executable typed-tool handoffs. Executable
`desktop.open_path` work instead requires fresh stat/path digests, authenticated
run/provider-call identity, exact approval, a §26 claim/start, one bridge
attempt, and fresh exact frontmost-app proof; ambiguity is `outcome_unknown`
with no replay.

Typed OpenSwan and SwanBot v2 generic native input calls now share a guarded
dispatch boundary. `desktop.type_text`, `paste_text`, `press_keys`,
`menu_click`, `click_at`, the mouse move/click/down/up/drag family, and scroll
require an exact `appName` copied from `desktop.window_state` or
`desktop.observe_app`. The runtime observes the frontmost app before approval,
SHA-binds the exact args/app/PID/surface using a digest stable across a later
fresh observation of that same target, then rechecks a private one-shot guard
at handler entry before the §26 claim/start/one-attempt bridge dispatch.
Coordinate and mouse actions additionally require fresh screen bounds and a
visible exact-app window. PID, surface, bounds/window, args, TTL, clone, or
replay drift fails before mutation. These legacy endpoints return only bridge
acknowledgement, so an attempted call returns `ok: false`,
`completionVerified: false`, and `outcomeUnknown: true`, then seals
replay-blocked `outcome_unknown`; it is never reported as independently
verified completion. `desktop.set_element_value` is a separate sealed lane:
authenticated persisted run/provider call identity and one fresh full
accessibility observation bind exact app/PID/generation/dotted path/role/label
plus current/requested value hashes and lengths into a short-lived one-shot
non-secret target. A genuine exact-call approval receipt precedes one AX
set-value dispatch, and only a newer same-field observation with the requested
hash and length can complete it. Raw field values and paths stay transient;
secure, credential, payment, permission, destructive, modal, stale, drifting,
raw-dispatch, paste, and coordinate variants fail closed. Missing proof after a
possible dispatch is `outcome_unknown` and cannot replay.

`automation-executor` keeps service/scheduled invocation read-only and permits
a manual room-file write only with fresh exact one-use authority plus §26.
Every scheduled external action needs a fresh approval for its exact
occurrence, one durable claim, and one dispatch. Timeout/post-dispatch failure
persists `outcome_unknown`; Pending Actions shows a redacted verify-first state
without retry. Office Realtime is likewise not authority. After client
authentication/shape checks, §28 `invoke_agent` locks the exact durable
message/circle/expected command, checks membership and owned target/scope, and
returns canonical command/sender/targets/model. Claims are idempotent per
message/agent subject (including synthetic `blackswan`); stream/completion
writes require the same claimant, membership, live state, bounded payload, CAS,
and multi-target completion coverage. Section 28 also validates and freezes
protected schema-v2 Chat/OpenSwan approval bindings, with server-stamped
resolution and requester-only expiry/one-shot consume.

Source catalog parity is pinned at **25 server-side + 59 client-delegated = 84
total**. `browser.wait_for` and `browser.scroll` add bounded semantic
synchronization/viewport control through the canonical client runtime. Both
require the complete opaque process/context/page/process-HMAC-URL identity from
one fresh DOM snapshot; the bridge retains that concrete page reference and
rechecks active tab, process, context, page id, and opaque URL before and after
the operation. Navigation, same-URL reload, SPA URL drift, tab switch, close,
and bridge restart fail closed. Element wait uses an exact ARIA role/name lookup
directly—CSS-looking names never become selectors—and scroll accepts only a
semantic direction plus coarse amount. Scroll dispatches exactly one bounded
wheel gesture; the bridge keeps before/after viewport positions privacy-local
and may collect up to three read-only settle samples without dispatching again.
Completion requires requested-axis `movementVerified:true`. No movement or an
already-reached boundary returns `browser_scroll_verification_failed`; recovery
requires a fresh DOM snapshot or screenshot before deciding whether another
bounded gesture is safe, never blind replay. Its receipt exposes only redacted
opaque identity/time/evidence plus semantic movement proof, not raw coordinates,
deltas, or viewport geometry. The
`browser.locator_actionability` lane remains read-only advisory
evidence for one fresh exact browser target; it does not authorize or bind a
later mutation. `browser.dom_snapshot` redacts every editable value inside the
bridge walker, excludes hidden/inert/script/style/template/noscript descendants
from ancestor text, canonicalizes bounded roles, and exposes only controlled
field kind/state/value length. One entry/capture/exit check binds tree and title
to the same process/context/page/exact URL. Model-visible URLs are HTTP(S)
origin-only; an opaque process-HMAC URL identity lets actionability reject
exact URL or document drift without revealing userinfo, path, query, or
fragment. The identity rotates on bridge restart; every raw/forged legacy URL
identity and non-HTTP snapshot fails closed. The typed client loop remains
device-local opt-in/default-off for ordinary chat. Authenticated non-exact
app/file/hybrid computer turns require it per turn because it owns the
canonical local Photoshop/desktop catalog; bounded transient relay failures
retry, and a local loop failure cannot replay through v1 text-only chat. Ask
tools defer only to their own durable exact-call runtime approval boundary,
never to a generic plan approval. Compiler-owned exact programs are different:
their full local program and authorization mode are already fixed, so only
their post-policy handler receives execution authority. The 2026-08-05 live
report verified that deployed SwanBot v1/v2 functions existed with the expected
JWT modes, required secret names, production-origin CORS, §31 Chat catalog, and
§32 readiness RPC; it passed all 18 dependency checks. That snapshot is not a
code-hash or 84-tool parity proof for the newer source in this worktree, which
still requires deploy/re-verification. Source now normalizes complete v2 summaries across pending,
checkpoint, close/seal, cancel, failure, and terminal writers, but that source
change is not deployment proof; historical v1/v2 `agent_runs` telemetry is
still incomplete and blocks M4 production sign-off. Section 29 is authored/mirrored but
has not been
applied or live-DB verified, so encrypted resume/key rotation, claim races,
three-minute cron expiry, and historical checkpoint scrubbing remain unproven.
A live exact Photoshop run created and app-natively verified a 600x600 scratch
document while Photoshop stayed frontmost. The updated `computer-use-agent`
deployment, arbitrary native semantic input, and live Browserbase/confirmation
integration remain unproven. Its HTTP 400 response for authenticated legacy
callers without a v1 policy is intentional.

Native `desktop.launch_app` and `desktop.focus_app` also converge on one
proof-bearing helper across the app adapter, typed OpenSwan, and SwanBot v2:
fresh before/after observations, exact-or-explicit-alias resolution, positive
PID identity for running targets, no-op detection, dispatch-target checks, and
outcome-unknown/no-replay when verification is missing. A bridge
acknowledgement by itself never completes launch/focus. These reversible
lifecycle actions need no separate approval only after either the typed runtime
proves authenticated user/persisted-run/exact-provider-call identity or the
strict Chat compiler proves its immutable direct-request program and paired
local bridge. Launch proves the exact app is running; focus proves it is
running and frontmost. Neither authority path permits a browser target in the
`desktop_app_only` profile.

The strict Chat lifecycle compiler additionally binds the originating request,
an authenticated persisted root, and one request-only §26 activation key.
`open_app` selects launch/wait or focus from the initial observation and cannot
perform both; explicit focus never launches. A duplicate refresh returns prior
terminal action state and cannot activate again. The request-only key survives
refresh-sensitive app-name canonicalization, while exact program drift fails
closed. This is current source/focused-smoke behavior, not updated live GUI or
database-contention evidence.

The requested lifecycle action may foreground the exact target once. If the
user then switches to Terminal, another app, or another browser tab, that is a
human interrupt: the task pauses/fails closed and must not poll, retry, or keep
raising either the target app or the OpenSwan browser. The generic app
navigator's recovery guidance now pauses in verification-only mode and requires
an explicit resume rather than telling an agent to refocus or relaunch. The
durable foreground lease remains a separate pending runtime integration.

`/desktop diag` is a read-only bridge health/pairing/running-app probe.
`/desktop diag <app>` remains read-only too: it does not launch, focus, open,
click, or type. It returns a value-free non-executable `desktop.launch_app`
typed-runtime handoff so a fresh authenticated run can obtain exact provider
call identity, dispatch receipt, and post-launch proof. The diagnostic itself
never inherits lifecycle authority.

The verified boundary remains narrow. It covers non-submit/non-credential fill,
clearly local presentation/accessibility toggle, one exact option in a native
HTML single-value select, one exact low-consequence native semantic press, and
one exact non-secret native accessibility field value.
Eleven generic native typing, paste, keypress, menu, bounded
coordinate/mouse/scroll actions now share observe-before-approval, stable
args/app/PID/surface binding, one-shot handler-entry recheck, and §26
claim/start/one-attempt dispatch; coordinates also require live screen bounds
and a visible target-app window. SwanBot v2 no longer raw-dispatches those
browser/desktop mutations in its current client catalog. The bridge endpoints
still return only an acknowledgement, so completion is now decided by a fresh
before/after accessibility diff of the exact target app
(`src/lib/nativeUiVerificationCore.ts`) rather than by the acknowledgement:

- `verified` requires attribution, not movement. Text entry
  (`type_text`/`paste_text`) verifies only when a changed
  field value contains the exact text sent — or, when the snapshot truncated at
  `A11Y_SNAPSHOT_MAX_STRING_LENGTH`, when the sent text contains that truncated
  value. `menu_click` verifies only when a node labelled like the invoked leaf
  item appears. Unattributable tree movement never promotes to `verified`.
- `no_effect` is new and is a *proven* no-op: for the four tools that must move
  the tree, a byte-identical before/after is positive evidence the action
  missed. This replaces a blanket "unknown" that could never be improved.
- Everything else — mouse move/down/up, scroll, bare clicks, keypresses —
  stays `unknown`, because those routinely land without an accessibility-visible
  change and calling them `no_effect` would manufacture a failure.
- A missing or failed snapshot is always `unknown`; absence of evidence is never
  evidence of absence.

§26 forbids `failed` after dispatch, so a proven `no_effect` still seals
durable `outcome_unknown` and stays replay-blocked; only the user-facing text
carries the sharper truth.

The attribution requirement is not theoretical. A read-only live probe against
Google Chrome on 2026-07-29 read the same window's accessibility tree twice
back-to-back with no action performed and observed **8 changes** (+4/-4) from
ordinary background churn — a live feed plus a window title carrying memory
usage. A "the tree moved, so it worked" rule would have reported verified for
an action that was never dispatched. Repeat samples on the same idle window
produced 0 changes, so the churn is intermittent and app-dependent: the naive
rule passes local testing and then fabricates completions against any app with
live content. Both regimes produced the correct verdict (`unknown` when the
tree moved unattributably, `no_effect` when it did not move at all).

The pure policy and its runtime wiring are source/contract-verified
(`native-ui-verification-core` incl. integration cases over the real
`snapshotA11ySummary`/`diffA11ySummaries`, plus
`openswan-generic-native-ui-runtime`). The bridge read path is live-verified
read-only. No live generic native-app mutation has been executed end to end.
Accessibility value-setting is source/contract-verified through the dedicated
sealed runtime: exact generation/path/role/label/current/requested bindings,
one-shot approval and dispatch, and same-target hash/length proof. Local
saved-credential fill is intentionally disabled before secret retrieval until
equivalent exact target binding exists; the remote guarded login path remains
separate. Submit, upload, browser navigation/close, generalized native
after-state verification, future catalog additions, non-typed callers, and a
complete universal sealed gateway remain pending. Focused source/contract
smokes—including `native-semantic-value-runtime`—and app typecheck verify this
slice; current edge source is not
deployed/re-verified, §29 is not applied, and pre-deployment plaintext/legacy
pending continuations do not gain the fail-closed/scrub boundary until those
steps. No live browser/native-app GUI execution or live Postgres
contention/race proof was performed. §26 is applied and live-DB verified as of
2026-07-29 (table, RLS, grants, and fail-closed unauthenticated claim); its
concurrent-claim race behavior is still not proven. §29 remains authored and
mirrored but unapplied, so checkpoint cleanup is not an operational claim.

`src/lib/computerTaskOutcome.ts` is the source of truth for non-browser task
results. Chat may adapt its richer statuses to the older transport enum, but it
must preserve the full status in metadata and must never turn response text or
a failed adapter result into completion. Successful deterministic app
mutations without explicit fresh proof remain partial; canonical read results
are their own evidence. `src/lib/chatLaneOutcome.ts` adapts that typed terminal
for lane health without reading failure prose: approval wait is deferred,
input remains input, partial/blocked/cancelled remain blocked, and only a typed
failure is failed. Chat records this boundary for native outcomes, browser
approval continuations, cloud/local browser completion or failure, launch
failure, denial, and cancellation, so an earlier deferred preview cannot
remain the apparent terminal after the browser run finishes. Typed SwanBot
computer turns now expose a separate runtime-only
`ComputerTaskTurnEvidenceSummary` through `getSwanBotTurnResult`; ordinary Chat
keeps the `getSwanBotResponse` string wrapper. The summary validates action-
level evidence only when the loop ended cleanly and every dispatched mutation
has a coherent same-action/same-before-epoch verification receipt with fresh
evidence and no blocker. That does not prove that the complete user request,
ordering, output, and final acceptance predicate were satisfied. Generic runs
remain inconclusive because the generic summarizer always emits
`taskCompletionVerified:false`. The same file now contains a pure runtime-owned
V1 outer-acceptance core: it compiles an immutable root-request/ordered-action/
typed-predicate contract, enforces its own small tool mutation registry, seals
root/contract/action-bound branded evidence only through the exact opaque,
WeakSet-branded next-action claim, evaluates exact active Photoshop dimensions
or named-app-frontmost state, requires fresh final evidence after all actions
and mutation verification, and concurrency-reserves claim issuance, sealing,
and one immutable value-free receipt. Only those in-process runtime-issued
objects may authorize the matching transition; copied binding strings, plain or
JSON-cloned claims, cross-contract/out-of-order/reused claims, concurrent double
sealing, unknown tools/predicates, stale proof, or fingerprint drift fail
closed. No Chat, SwanBot, `agentRuntime`, generic executor, recovery, or
persistence caller uses the general V1 core yet, and its brands do not survive a
process reload. The exact lifecycle/Photoshop executors use a narrower
runtime-local authority after their existing closed-world durable proof; that
does not widen the V1 tool catalog or claim generic integration.
Prose-only, mismatched, failed-final-read, capped, stopped, outcome-unknown, or
receipt-incomplete turns remain inconclusive too. This closes action-receipt
transport loss and lands the acceptance core in source; it does not wire task
acceptance or give uncovered tools stable one-shot identity. The exact
Photoshop compiler separately binds its root/§26 action to the originating Chat
message/submission plus program and preserves that identity through approval or
capability re-entry. Missing, legacy, or mismatched identity fails before root
creation and desktop access; a new explicit submission intentionally receives a
new request/root.

Those runs preserve the real thread,
active plugins, cancellation signal, route constraints, and always-confirm
floor in `SwanBotContext`; the opt-in typed client canary consumes them, while
the default edge route remains non-cancellable. The plan-level Chat approval is
not exact tool-call consent.

`manual_verify_only` recovery is observation-only and never completes a task.
Its source-issued in-memory capability is single-use and bound to the original
requester, current task, exact bridge process instance, and exact target. Scope
and bridge instance are rechecked after every awaited read and immediately
before transcript/archive persistence. The allowlist is limited to
`browser.dom_snapshot`, `desktop.observe_app`,
`desktop.photoshop_document_status`, and `desktop.file_stat`; Photoshop status
inspects the active document without activating another document. Stale task
buttons disappear. This is source/focused-smoke coverage, not a live recovery or
cross-device continuation claim.

The Chat dispatcher also builds one bounded immutable `chatAgentContextPack`.
Real app/file/hybrid computer runs and both app-capability retry paths pass that
pack through `AgentRunRequest`; `agentRuntime` injects its `compactPrompt` into
model context and saves a bounded projection in run metadata. Remaining
non-computer connected-agent entrypoints still need the same migration.

Unfamiliar-app capability buildout state is provider-aware. Automatic delayed
result recovery supports dedicated bounded `APP_CAPABILITY_*` receipts from
Codex and Claude Code, with exact or unique sufficiently long session matching.
The Claude bridge reconciles its transcript JSONL id to the managed launch id
only from one anchored, unambiguous UC marker; absent or conflicting claims do
not attach.
Gemini and Cursor remain general delegation providers but are excluded from
automatic capability buildout until their bridges expose the same strict result
channel; persisted legacy records without a provider retain the former Codex
interpretation.

`agentRunPersistence` now preserves typed-loop dispatch truth and bounded,
primitive-only computer action/mutation/verification receipt subsets. The
guarded browser fill/toggle/select and native semantic-press canaries emit
issued mutation-dispatch and computer-app-verification receipts into that
durable allowlist. Receipt persistence now retains bounded action/epoch
identities and drops a verification receipt unless its action and before epoch
correlate with the dispatch receipt; a claimed `verified` receipt must also
carry a fresh after epoch, evidence, `canComplete: true`, and no blockers.
Approval telemetry stays hidden from the model: the canonical
approval key and args are
removed and only an issued digest-safe receipt rides the runtime side channel;
the approval row itself is the durable source. Other mutations still do not
emit the complete receipt contract, so the universal gateway, stable desktop
window/document identity, and automatic observation invalidation remain
required. The transactional cross-process ledger is live as of 2026-07-29
(§26 applied); before that every guarded mutation failed closed at the claim
with `rpc_error` and was never dispatched. Concurrent-claim races remain
unproven against a live database.

Local bridge mutation authority stays loopback-bound and is remote-accessible
only through an explicitly allowlisted tunnel. The Claude, Codex, Cursor, and
Gemini bridges share source/Host/Origin checks, challenge pairing, and bearer
token validation. Claude returns the normal first pairing challenge as HTTP 200
to avoid a false browser-console failure; the client remains compatible with
rolling 428 bridges and the challenge/token security exchange is unchanged.
The Claude desktop surface additionally enforces exact file grants and denies
shell-family launchers on its fixed read-only exec-file route. Generic native
typing, paste, key, menu, and pointer calls carry a transient exact
app/PID/CGWindowID/bounds guard captured immediately before dispatch. The
native Swift helper revalidates that target during atomic type/key/paste input;
it no longer proves focus and then performs keyboard input in a separate
AppleScript process. Pointer coordinates must stay inside the sealed window,
mouse-up/scroll require x/y, and raw guards are stripped from model, approval,
receipt, durable, and serialized result surfaces. This contract is
source/compile/smoke verified; no generic native-input mutation was run live.
If a bridge is intentionally tunneled, the server must also be restarted
with `UC_BRIDGE_ALLOWED_HOSTS` set to the exact tunnel Host value and
`UC_BRIDGE_ALLOWED_ORIGINS` set to the exact browser origin; a public client URL
alone never authorizes the tunnel.

Photoshop/InDesign creative-AI work uses `src/lib/designAppCreativeAi.ts` for
text-to-image, generative fill/remove, generative expand, creative variants, and
InDesign data-merge variant planning. It also turns those capabilities into
reusable recipes such as Photoshop generated background packs, variant contact
sheets, localized cleanup, canvas expansion, InDesign frame placement, placed
image expansion, and data-merge campaign variants. It requires prompt/data
approval, target-layer/frame/selection evidence, generated-output receipts,
proof verification, and connected-agent adapter buildout when the exact Firefly
or app bridge tool is missing.

Photoshop/InDesign task execution order lives in
`src/lib/designAppExecutionPipeline.ts`. That file combines automation plans,
operation runbooks, creative-AI recipes, and adapter-gap contracts into the
shared resolve -> observe -> approve -> mutate -> export/package -> verify ->
recover pipeline used by SwanBot/OpenSwan prompts, chat handoff metadata,
persisted chat rows, and connected-agent buildout prompts.

## Memory, Skills, And Approvals

- User memory: `src/lib/userMemory.ts`.
- Agent memory/run identity: `src/lib/agentRuntimeSubject.ts` resolves stable
  subject keys and legacy aliases across Office, Chat, SwanBot, and OpenSwan;
  Office-originated SwanBot calls and v2 batch telemetry preserve the same
  subject metadata. Automation proposals, `/automation run/test`, OpenSwan
  saved automations, specialized Chat/OpenSwan mode runs, `automation-executor`,
  the Automations dashboard, Office terminal, `AgentMemoryPanel`, and
  `AgentRunsPanel` preserve or display that metadata. Pure key normalization
  lives in `src/lib/agentIdentityKey.ts`.
- Circle memory bank: `src/lib/memoryBankKinds.ts`,
  `src/lib/memoryBankChatCommands.ts`, `src/services/sharedMemory.ts`.
- Skill library: `src/lib/skillLibrary.ts`, `src/lib/skillLibraryWrite.ts`,
  `src/lib/skillPromptInjection.ts`, `circle_skills`, `circle_skill_files`.
- Checkpoints: `src/lib/chatCheckpoints.ts` and
  `src/components/ToolCallCheckpointStrip.tsx`.
- Run persistence: `src/lib/agentRunPersistence.ts`, `agent_runs`,
  `agent_run_events`, `claude_api_usage`. Tool-event persistence distinguishes
  dispatched, skipped, and legacy-unknown calls and drops arbitrary hidden
  result metadata outside bounded receipt allowlists.

Memory writes, skill writes, credential access, and destructive automation
changes must follow the HITL/approval rules in the roadmap.

## SQL And Schema

- Local migration files live in `supabase/migrations/`.
- Consolidated agent-runtime helper SQL lives in `docs/RUN_THIS_SQL.sql`.
- The roadmap SQL checklist owns applied/pending status. Do not treat a local
  migration file as proof that production has it.
- `20260726_agent_action_calls.sql` (§26) is **APPLIED and live-DB verified
  (2026-07-29)**: `agent_action_calls` exists with RLS on, one owner-read
  policy, `SELECT` to `authenticated`, and the three `claim`/`start`/`finish`
  RPCs granted to `authenticated`. A live unauthenticated claim probe returns
  structured `not_authenticated` rather than a row, so the fail-closed identity
  binding is proven against Postgres. Cross-process CONTENTION (two real
  workers racing one claim) is still unproven.
- `20260726_scheduled_action_mutation_guard.sql` is mirrored as §27 but is
  **not applied or live-DB verified**. Apply it before relying on the scheduled
  claim/dispatch/outcome-unknown state machine.
- `20260726_database_authority_guards.sql` is mirrored as §28 but is **not
  applied or live-DB verified**. Its 146-assertion source/byte-identity smoke does not prove
  Office RPC races or protected approval resolution/consumption in Postgres;
  local Docker/Supabase was unavailable for this review.
- `20260726_swanbot_continuation_privacy.sql` is mirrored as §29 but is **not
  applied or live-DB verified**. Its source checks do not prove encrypted
  continuation resume/key rotation, live claim races, cron expiry, or the
  historical scrub against Postgres.
- `20260805_messages_thread_rls_and_reactions.sql` (§31) is **applied and
  catalog-verified on the target project as of 2026-08-05**. The service-role
  contract proves the canonical table/column, four message policies, mutation
  trigger, reaction RPC grant, and Realtime publication. Authenticated
  private/shared/circle behavior, revocation, reply/reaction contention, and
  two-client Realtime delivery still need live behavioral proof. It preserves
  creator-owned bot persistence compatibility; trusted bot provenance still
  needs a later server/RPC writer.
- `20260805_openswan_production_readiness_contract.sql` (§32) is **applied and
  live-verified as of 2026-08-05**. Its service-role RPC returns booleans only;
  the report combines them with hosted function/JWT metadata, required secret
  names, production-origin reachability/CORS, source smokes/parity, and real
  telemetry. It can retrieve a service key transiently from an authenticated
  Supabase CLI when no explicit key is exported and never prints key or secret
  values.
- `20260806_universal_computer_task_roots.sql` (§34) is **pending and not
  applied**. Its 129,820-byte source and consolidated tail have exact SHA-256
  `45251c1ffd2ea002a227bfdcfcbd0875dbab47127e590031f3b4bf827651e30a`.
  Disposable PostgreSQL 14 syntax/catalog, positive/rollback/fault,
  claimed-recovery, clock/token, STOP, and human-override guard paths passed;
  this does not prove a production migration, crash cut, live contention, or
  Photoshop execution.
- `20260807170000_office_agent_session_bindings.sql` (§36) is **pending and not
  applied**. The migration applied twice in disposable PostgreSQL 14 with one
  read policy; the table, owner-only RLS read, direct-write denial,
  authenticated set/clear including stale cleanup after provider drift, and
  versioned `invoke_agent_v2` claim have focused source/pure-smoke coverage.
  This is not a live
  authenticated binding/dispatch test, cross-device token-availability test,
  production migration, or deployment claim. Office/Feed remain fail-closed
  until §36 is applied and the current device has the exact live connection,
  session, and local token. Typed provider final-result reconciliation remains
  pending after dispatch acceptance.
- After schema changes, use `NOTIFY pgrst, 'reload schema';` when relevant.

Schema gotchas:

- `profiles` has no `email` column.
- `circle_office_agents` has no `model` column; owner FK is `owner_id`.
- `user_xp` primary key is `user_id`.
- `room_messages.message_type` is constrained.
- Under §31, every `messages` row has one canonical non-null `thread_id`, its
  circle/thread/reply lineage must agree, and reactions use
  `set_message_reaction` instead of whole-object replacement.
- `circle_members` RLS can recurse; use security-definer helpers where present.

## Critical Guarantees

- Read `docs/SECURITY_REVIEW_2026-08-06.md` before changing Auth, RLS,
  `SECURITY DEFINER` grants, public environment variables, OAuth callbacks,
  storage visibility, or bridge pairing. Preserve its distinction between live
  proof, source/build proof, and unexercised user flows.
- A Supabase publishable/anonymous key may be downloaded by every web user and
  is never authorization. Keep server/provider credentials out of
  `EXPO_PUBLIC_*`; the prebuild public-env security gate must stay enabled.
- `SECURITY DEFINER` is default-deny. New authenticated execute grants require
  an explicit actor/tenant check, fixed search path, bounded return shape,
  focused smoke, and a live catalog verification. Never regrant a legacy RPC
  merely to restore compatibility.
- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Frontend code uses the singleton Supabase client in `src/lib/supabase.ts`.
- `App.tsx` is the sole auth-event/session owner. Descendants use
  `AuthSessionProvider`; do not add independent `onAuthStateChange` listeners
  that can clear persisted Auth state. Keep Supabase's default browser Web Lock
  so refresh-token rotation is serialized across tabs. A transient Auth
  storage/network/lock failure is `unavailable` and retryable, not proof of
  logout; only a structured rejection or genuine `SIGNED_OUT` clears session
  authority.
- New auth reads should use `safeGetUser`, `safeGetSession`, or
  `getFreshAccessToken` from `src/lib/authSession.ts`.
- If a direct `supabase.auth.getUser()` or `getSession()` call is unavoidable,
  attach `.catch(...)`.
- Do not put raw secret values in prompts, persisted chat metadata, logs, or
  activity feed entries.
- Retrieved memory, chat, or search content is untrusted. Preserve the
  roadmap's untrusted-content wrapping rules for model-visible quoted content.
- Guarded fill/toggle/select/native-semantic mutations must claim only after
  genuine authorization and record `dispatched` inside the sealed handler just
  before bridge entry. A pre-handler race loser leaves the claim reclaimable;
  a post-start error is `outcome_unknown`, never `failed`.
- Correlated action receipts are necessary but never sufficient for whole-task
  completion. Even when every dispatched mutation has same-action/same-before-
  epoch verification, a fresh after epoch, evidence, no blockers, successful
  tool results, and a clean terminal, generic tasks stay inconclusive until a
  runtime-owned receipt binds the stable root request, immutable acceptance
  contract, complete action set, and fresh final proof. Model prose and bridge
  acknowledgements never manufacture either receipt.
- Every new `mutatesState` tool must declare the mutation authority, policy
  category, target/actionability binding, verifier, redaction boundary, and
  replay posture required by the Universal Computer Task Kernel. Unknown
  coverage fails closed; capability buildout re-enters the same kernel and does
  not inherit mutation approval.
- Keep every SwanBot v2 client-delegated browser/desktop mutation intercepted
  by the canonical OpenSwan runtime before raw dispatch. New tools and callers
  need explicit policy/proof parity; current catalog coverage is not universal.
- A claimed edge continuation is one-way. Preserve identity/version/nonce plus
  dispatch claim id, the pre-side-effect `client_pending →
  client_dispatching` CAS, the pre-model-resume `client_dispatching →
  client_resuming` CAS, and claim-bound writes; ambiguity is `outcome_unknown`
  with no automatic replay.
- Never persist an exact SwanBot continuation snapshot or raw tool
  input/failure in public run metadata/events. Preserve the encrypted,
  ten-minute value-free envelope, explicit dedicated secret/key-version
  configuration, no-key `clientOnly` withholding, and §29 expiry/scrub
  boundary; continuation resumability is never indefinite.
- Treat approvals and Realtime events as separate trust boundaries. One exact,
  current, atomically consumed approval may authorize one dispatch; a
  broadcast may only wake a receiver that authenticates and rereads durable
  RLS state.

## Validation

The current app baseline expects `npm run typecheck` to pass.

Focused smoke scripts in `package.json` cover the main runtime areas. Prefer
the narrow script for the code you touched, for example:

```bash
npm run smoke:agent-core
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:agent-runtime
```

The 2026-07-27 guarded-action slice is source-verified by the focused
103-assertion `agent-action-calls` ledger smoke, `agent-action-runtime-wiring`,
read-only `browser-locator-actionability`, browser fill/toggle/select,
computer-app grounding, `swanbot-v2-batch-policy`,
`swanbot-v2-continuation`, `swanbot-v2-edge-fill-schema`,
`computer-use-mutation-handoff`, `chat-recording`, readiness, and typed-runtime
invariant smokes plus app typecheck. Locator actionability remains advisory and
cannot authorize or bind a later mutation. The 2026-08-05 production contract
separately proves current v1/v2 deployment metadata, required JWT modes, secret
names, §31 catalog state, production-origin reachability, and CORS; it does not
prove Postgres contention, provider behavior, or arbitrary browser/native GUI
completion.
The 2026-08-05 structured action-evidence seam is source-checked by
`smoke:computer-task-truthful-outcome`,
`smoke:agent-run-persistence-receipt`,
`smoke:swanbot-v2-terminal-integrity`, and app typecheck. These prove bounded
action receipt transport/correlation and fail-closed handling in source. The
truthful-outcome smoke now also exercises the pure V1 outer-acceptance compiler,
evaluator, and issuer: exact root/contract/action binding, fresh final-proof
ordering, forgery/reorder/reuse rejection, concurrent issuance reservation, and
one-use receipt application. It does not prove production integration; no
runtime caller invokes or durably rehydrates that in-process receipt, so generic
runs remain task-level inconclusive. Nor does it prove universal stable root
identity, catalog-wide ledger coverage, deployed Edge parity, database
contention, or a live app action. The exact Photoshop branch separately
binds its authenticated root and §26 create action to the originating message/
submission fingerprint and preserves it across approval/capability re-entry.
Missing or mismatched identity blocks before root/desktop work; a new explicit
submission intentionally remains a distinct request/root.
The manual verifier is source-checked by `smoke:chat-failure-recovery`,
`smoke:chat-computer-outcome-ux`, `smoke:persisted-chat-metadata`, and
`smoke:photoshop-extendscript-adapters`. Those checks cover requester/task/
bridge-instance/target binding, post-await rechecks, stale affordance
suppression, and non-activating status reads. They do not prove a live recovery
or turn observation evidence into task completion.
Both SwanBot v2 and Chat release gates run bounded browser wait/scroll
reachability, truthful computer-task outcome, and exact v2 Chat-thread identity
checks. The browser guard pins all four opaque identity values, retained-page
pre/post validation, exact ARIA lookup, and rejection of tab/navigation/reload/
SPA-URL/close/bridge drift without selector or coordinate authority. It also
pins exactly one wheel dispatch, privacy-local before/after viewport reads, at
most three read-only settle samples, requested-axis `movementVerified:true`, and
`browser_scroll_verification_failed` plus fresh DOM/screenshot recovery for
boundary/no-motion results without blind replay or returned geometry. The
thread guard binds service-role message writes to the authenticated
fresh/resumed request rather than model arguments. Chat release also runs
failure recovery and `smoke:thinking-label-hook-order` for the React static-flag
console regression.
`smoke:exact-program-authority` also runs in the Chat release gate and pins the
authenticated root plus §26 lifecycle for the exact Photoshop mutation lane.
The truthful-outcome aggregate also includes the atomic root/action gateway and
frontmost Photoshop canary smokes. They source-pin exact requirement/dispatch
bindings, claimed refresh recovery, stale same-action lease rebinding, the
early persisted-root fallback fence, STOP/override refusal, bridge target-guard
ordering, and non-authoritative final-foreground telemetry. They do not pass a
root/action authority into the bridge, persist a later reconciliation receipt,
exercise the enabled canary, or simulate every crash cut; the gateway fixture's
core action path does not require a foreground lease.
Chat no longer asks for `~/Desktop` write access just because the component
mounted. Local-file permission is requested only after a compiled task declares
`file_read` or `file_write`, with inferred task roots and the exact task as the
reason. `smoke:chat-file-permission-demand` pins the demand-only boundary and is
included through the readiness smoke in daily, release, and `smoke:all`.
`smoke:chat-computer-request-router` and
`smoke:computer-task-runtime-context` separately pin named-app request/root/
action binding, mutually exclusive launch-or-focus, explicit-focus no-launch,
request-only idempotency across app-name canonicalization, and duplicate
no-reentry. They are not a live duplicate-refresh or foreground-override test.
A separate compiler-generated exact Photoshop drill was run once after a local
bridge restart on 2026-08-06: one create, `Untitled-4` at 600x600, Photoshop
frontmost, zero browser invocations, and five subsequent foreground samples
still in Photoshop. This is direct closed-world bridge/app proof, not a
canonical Chat lifecycle, competing-client, hosted-edge, or production-site
canary.
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
same exactly-once gate contract. This is not evidence of a deployed edge, live
Browserbase/confirmation-database integration, or live native-app execution.
`smoke:photoshop-exact-drill` runs exactly once in the Chat daily/release
commands through their matching npm `precheck:*` lifecycle hooks, and once in
`smoke:all`; the canonical `check:*` bodies do not invoke those hooks again. It
proves only compiler-manifest, drill-guardrail, and
drill source contracts. The separately required
`smoke:computer-task-runtime-context` pins the corresponding production source
contract, but the pair does not prove shared execution parity. The manual
command remains a dry
run without explicit `--live` plus the fingerprint printed by that dry run.
The one 2026-08-05 live invocation proved one create dispatch and no browser
calls; its result was established by a subsequent read-only status because the
strict immediate verification observed stale state. It does not prove
authenticated Chat, approval persistence, browser-event behavior, or a
post-retry live create.
It also does not prove §27/§28/§29 application or live two-client Realtime/RLS
behavior, encrypted continuation/key-rotation or cron-expiry behavior, §26
concurrent claims/crash boundaries, or external provider dispatch. §26 catalog
application is separately verified by the SQL checklist; that is not a live
contention proof.

The 2026-08-05 unfamiliar-app slice is source/contract-checked by
`smoke:generic-app-navigator`, `smoke:universal-app-task-eval`,
`smoke:native-semantic-value-runtime`, launch/focus, grounding, approval, and
runtime smokes plus the desktop/local execution-surface guard and app
typecheck. The universal source corpus covers 160 requests and 7,410
assertions. This proves the typed workflow and guarded
boundaries in source; it does not prove a live generic native-app mutation,
deployed edge parity, a database contention race, or universal completion for
every human action in every app.

## Known Risk Areas

- The 2026-08-06 backend remediation is live, but the reviewed login/OAuth/
  logout and strict-header frontend changes were not yet a live-site claim at
  the review cutoff. Deploy the exact green artifact, then test real login,
  reset email, recovery deep link, OAuth popup relay, logout cleanup, refresh,
  and served headers.
- The 2026-08-11 session-continuity repair is source/focused-smoke verified:
  it restores cross-tab refresh locking, removes competing descendant auth
  listeners, retains an already verified same-user session through transient
  verification failures, and retries an unverifiable cold start without
  deleting its stored candidate. Deploy the exact artifact and exercise a real
  two-tab, background/sleep/wake, offline/online, and token-expiry sequence
  before treating intermittent logout as live-verified closed.
- Hosted Auth still auto-confirms email and has no custom SMTP or CAPTCHA. The
  built-in mail limit is two per hour. Decide mailbox verification policy,
  configure production delivery and bot protection, and test with a dedicated
  account before broad public signup.
- Task-image storage is public-by-URL; use a private bucket and short-lived
  signed URLs before storing sensitive images. Local bridge pairing is not yet
  device/user/process/task-bound attestation.
- The safe claimant-bound Office `invoke_agent` signature is not installed and
  therefore remains outside the authenticated 52-function allowlist. Keep the
  legacy RPC disabled until that migration and its live proof land.
- Migration history has duplicate/nonstandard prefixes and linked-ledger drift.
  Do not use a broad `supabase db push`; apply reviewed idempotent files
  individually until the history is reconciled and backed up.
- The 2026-08-14 production audit still reports ten high dependency entries,
  all tracing to two unpatched `image-size` denial-of-service advisories through
  Expo/Metro/React Native build tooling. The pre-export signature guard blocks
  repository-controlled ICNS/JXL/HEIF/HEIC inputs, but this is defense in depth,
  not a patched dependency or permission to ignore untrusted build inputs.
- Older code still has many direct Supabase auth calls. Do not add new unsafe
  ones; migrate to `authSession` helpers when already touching the file.
- Provider routing is multi-surface. A provider added only to the model picker
  but not `llm-proxy` or `swanbot-ai` will look selectable but fail at runtime.
- `swanbot-ai` v1 still has legacy tool-loop code. `swanbot-v2-ai` is the
  typed-loop migration target tracked in the roadmap.
- Chat persistence now stores compact metadata for source, routing, usage,
  browser plans, artifacts, memories, and execution stream. Keep payloads
  bounded to avoid oversized message rows.
- Browser and desktop actions must stay explicit about risk and approval.
- The universal browser/desktop mutation gateway remains incomplete; the five
  guarded canaries and current-catalog interception must not be generalized into a
  claim that arbitrary apps can already be operated safely end to end.
- Current SwanBot v2 deployment metadata, JWT mode, production CORS, and the
  dedicated encryption secret/key-version names were re-verified on 2026-08-05.
  §29 remains source-only until applied and live-DB verified. Old
  plaintext/legacy pending continuations fail closed or are scrubbed only after
  that migration, so rollout must still account for in-flight turns and prove
  key rotation plus claim races before the typed client becomes default.
