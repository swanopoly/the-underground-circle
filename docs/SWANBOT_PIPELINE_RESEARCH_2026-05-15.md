# SwanBot Pipeline Research 2026-05-15

## Research Inputs

- Salesforce Agentforce use-case materials emphasize service, sales, marketing, commerce, analytics, and workflow automation as repeatable agent domains: https://www.salesforce.com/agentforce/pre-built-use-cases/
- OpenAI's Zendesk case study reinforces support triage, response drafting, and agent assist as high-volume customer-service workflows: https://openai.com/index/zendesk/
- Browserbase workflow docs reinforce browser data retrieval, form submission, data entry, and dynamic website automation as core browser-agent capabilities: https://docs.browserbase.com/use-cases/web-data-retrieval
- Microsoft Copilot agent guidance frames agents around role-specific workplace tasks, IT/helpdesk work, research, workflow automation, and user-controlled execution: https://www.microsoft.com/en-us/microsoft-copilot/copilot-101/ai-agents-types-and-uses

## Pipeline Coverage Added

- Customer Support And CRM: ticket triage, support replies, CRM updates, escalations.
- Sales Leads And Outreach: prospect research, enrichment, CRM updates, outreach drafts.
- Analytics And Reporting: KPI reports, dashboards, trends, metric summaries.
- Meetings, Calendar, And Email: invites, email replies, scheduling, meeting recaps.
- Data Import, Export, And Cleanup: CSV/spreadsheet/database import-export and cleanup.
- Finance, Billing, And Invoices: invoices, reconciliation, refunds, subscriptions.
- Document Intelligence: PDF/OCR/contracts/forms/receipts extraction and comparison.
- QA Testing And Regression: browser QA, screenshots, reproductions, release checks.
- IT Support And Ops: access requests, account provisioning, ServiceNow/Jira-style ops.
- Compliance Monitoring: control mapping, audit evidence, policy/regulatory reviews.
- HR Onboarding And People Ops: onboarding checklists, first-day tasks, offboarding.
- Marketing Campaigns: campaign planning, segmentation, newsletters, ads, SEO.
- Workflow Recording And Replay: capture manual browser/desktop flows and replay safely.
- Travel And Booking: compare live availability, stage reservations, sync itinerary/calendar, approval before booking/payment.
- Procurement And Shopping: compare vendors/products, stage carts/purchase orders, approval before checkout/subscription.
- Cloud DevOps And Incidents: read-only diagnostics first, then deploy/rollback/scale only behind approval.
- Social And Community Operations: moderate, draft replies, summarize sentiment, approval before public/DM/moderation actions.
- Inbox And Notification Triage: summarize unread state, prioritize alerts, create tasks, approval before send/archive/delete.
- Learning And Training: teach, create lessons/quizzes, use wiki/digital-brain context when company-specific.
- High-Stakes Advice Guardrail: route medical/legal/tax/financial/safety prompts into safe general guidance and escalation.

## Implementation Notes

- The shared taxonomy lives in `src/lib/userTaskPipelines.ts` and now carries route, execution kind, risk, approvals, persistence targets, tools, and runbook steps.
- `src/lib/chatAutomationPlanner.ts` consumes the taxonomy before generic build/computer heuristics so SwanBot and OpenSwan can route domain tasks instead of answering like a generic LLM.
- Tie-breaking now prefers specific operational pipelines over generic content/direct-answer routes when scores are equal.
- Each pipeline now emits execution requirements into the prompt block so the runtime knows required bridges, integrations, credentials, approvals, and persistence targets before acting.
- Strong pipeline matches now run before generic natural-language command rewrites, which prevents domain tasks like "summarize unread emails" from being swallowed by generic summarization tooling.
- Smoke coverage is in `scripts/user-task-pipelines-smoketest.ts` and `scripts/chat-planner-smoketest.ts`.

## Next Pipeline Pass

- Add per-pipeline model selection hints so Auto can prefer low-cost models for classification/drafts and stronger models for code, legal-adjacent analysis, or multi-step browser tasks.
- Add eval fixtures with expected approval gates, persistence targets, and model-routing decisions, not just primary pipeline IDs.
- Add runtime telemetry for pipeline chosen, model chosen, cost, approval status, and completion proof so Office can show pipeline quality over time.
- Add workflow-template storage for repeated business processes so user-recorded workflows can become scheduled or reusable automations.
