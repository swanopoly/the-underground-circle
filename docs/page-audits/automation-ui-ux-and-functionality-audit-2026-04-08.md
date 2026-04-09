# Automation UI UX And Functionality Audit

## Findings

### 1. The current automation surface is powerful but still too operator-heavy

The `AutomationsPanel` already does a lot:
- creation
- edit
- duplicate
- manual run
- dry run
- run history
- memory notes
- template application
- goal/task linking

But the day-to-day scanning UX was weaker than it should be:
- search only covered name/description
- list order did not prioritize failures or near-due work
- the empty state always implied “no automations exist,” even when filters/search were the real reason
- cards did not surface output target strongly enough

Relevant file:
- `src/components/AutomationsPanel.tsx`

### 2. Status visibility matters more than template abundance

The panel already has many templates. The bigger practical need is:
- can I see what matters now?
- what is broken?
- what is due soon?
- what output path does this automation use?

This is where automation products usually fail: too much setup UX, not enough operational visibility.

### 3. Search and filtering were underpowered

Before this pass, searching did not include:
- prompt text
- cron expression
- model
- agent
- output target
- event config

That made the dashboard slower to use once automation count grows.

### 4. Some actions lacked immediate feedback loops

The service layer and realtime subscriptions do a lot of the heavy lifting, but toggle/delete flows should still refresh locally after mutation to keep the dashboard feeling reliable.

## Changes Made

I made small but useful improvements directly in:
- `src/components/AutomationsPanel.tsx`

What changed:

1. Smarter search
   - now searches name, description, prompt, cron, model, agent, output target, and event config

2. Better triage ordering
   - list now prioritizes:
     - errored automations
     - enabled automations
     - near-due automations
     - automations with real run history

3. Better empty states
   - empty state text now changes based on:
     - search
     - active filter
     - failed filter
     - disabled filter
     - mine filter

4. Better card visibility
   - cards now show output target as a visible badge
   - next run now shows relative time and absolute timestamp

5. Better mutation feedback
   - toggle now refreshes stats and list
   - delete confirmation now refreshes stats and list

## Remaining Improvement Opportunities

### High-value next changes

1. Add per-card “last result” summary chips
   - success
   - failed
   - skipped
   - dry run

2. Add a dedicated `Needs Attention` view
   - failed runs
   - stale scheduled automations
   - disabled automations with recent history

3. Add inline schedule editing for simple schedule automations
   - avoid opening the full modal for small changes

4. Add output previews at the card level
   - last message posted
   - last webhook delivery
   - last activity feed summary

5. Add automation source badges once scheduler systems are unified
   - `Circle Automation`
   - `OpenSwan Job`

### Structural gap still present

The biggest remaining issue is still architectural:
- `Circle Automations` and `OpenSwan Jobs` are separate systems

That is not a card-design problem. It is a product-structure problem.

## Recommendation

The next best bounded UI/UX step is:

1. Add a `Needs Attention` section above the list.
2. Add `last outcome` and `output target` chips to every card.
3. Add lightweight schedule editing for schedule-based automations.
4. Separate `Circle Automations` from `OpenSwan Jobs` visually at the dashboard level.
