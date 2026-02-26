# OpenClaw Activity Hook Setup

Pipes SwanBot's activity (Discord, webchat, cron) into the Underground Circle app's Office dashboard in real time.

## 1. Get your Supabase Service Role Key

Go to: https://supabase.com/dashboard/project/rjkniqiqdtroeholxacg/settings/api

Copy the **service_role** key (NOT the anon key — the hook needs to insert without user auth).

## 2. Get your Circle ID

Run this SQL in the Supabase SQL editor:
```sql
SELECT id, name FROM circles LIMIT 10;
```

Or find it in the app URL when viewing your circle.

## 3. Set environment variables

Add to `~/.bashrc` or `~/.profile` on the machine running OpenClaw (LegionOfSwan):

```bash
export SUPABASE_URL="https://rjkniqiqdtroeholxacg.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key-here"
export ACTIVITY_CIRCLE_ID="your-circle-uuid-here"
```

Then reload: `source ~/.bashrc`

## 4. Run the Supabase migration

Paste the contents of `supabase/migrations/20260226_agent_activity.sql` into the Supabase SQL Editor and run it.

## 5. Test the hook manually

```bash
cd /home/swan/the-underground-circle

echo '{"source":"system","activity_type":"task_completed","title":"Hook test","body":"If you see this in the app, it works!"}' \
  | node scripts/openclaw-activity-hook.js
```

Check the Office tab in the app — you should see the activity card appear.

## 6. Wire up OpenClaw (automatic logging)

Ask SwanBot: "Log your Discord and webchat activity to the Circle app automatically"

SwanBot will call the hook after completing tasks. It can also be triggered manually:

```bash
# Log a Discord interaction
node scripts/openclaw-activity-hook.js \
  --source discord \
  --type task_completed \
  --title "Updated UI button colors" \
  --body "Changed accent color in OfficeTab to match brand"

# Log a cron completion  
node scripts/openclaw-activity-hook.js \
  --source cron \
  --detail "research-daily-synthesis" \
  --type task_completed \
  --title "Daily research synthesis complete" \
  --status completed
```

## 7. Have SwanBot auto-log (recommended)

Tell SwanBot in any chat:
> "After you complete any task from Discord or webchat, log it to the activity feed using the hook script at /home/swan/the-underground-circle/scripts/openclaw-activity-hook.js"

SwanBot will append a hook call at the end of each task automatically.
