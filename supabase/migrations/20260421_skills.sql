-- Skills Layer — Phase C5 of the OpenSwan/Chat Architecture Plan.
-- SOULs answer WHO; skills answer WHAT THEY CAN DO.
-- A skill = a config + optional tool binding + optional prompt fragment
-- that gets injected into Block E of the system prompt when enabled.

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('dev','content','ops','learning','general','research')),
  -- The prompt fragment injected into Block E when this skill is active
  prompt_fragment text,
  -- Tools this skill requires (refs tool names in the openswanTools registry)
  required_tools text[] NOT NULL DEFAULT '{}',
  -- Estimated cost per invocation (for budget UI)
  cost_tier text NOT NULL DEFAULT 'low' CHECK (cost_tier IN ('free','low','medium','high')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which SOULs in which circles have which skills enabled
CREATE TABLE IF NOT EXISTS circle_soul_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  soul_key text NOT NULL,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  enabled_by uuid REFERENCES auth.users(id),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, soul_key, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_soul_skills_lookup
  ON circle_soul_skills (circle_id, soul_key, enabled);

-- RLS
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skills_select ON skills;
CREATE POLICY skills_select ON skills FOR SELECT TO authenticated USING (is_active = true);

ALTER TABLE circle_soul_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circle_soul_skills_select ON circle_soul_skills;
CREATE POLICY circle_soul_skills_select ON circle_soul_skills FOR SELECT TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS circle_soul_skills_insert ON circle_soul_skills;
CREATE POLICY circle_soul_skills_insert ON circle_soul_skills FOR INSERT TO authenticated
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS circle_soul_skills_update ON circle_soul_skills;
CREATE POLICY circle_soul_skills_update ON circle_soul_skills FOR UPDATE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS circle_soul_skills_delete ON circle_soul_skills;
CREATE POLICY circle_soul_skills_delete ON circle_soul_skills FOR DELETE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Seed the first batch of skills
INSERT INTO skills (name, display_name, description, category, prompt_fragment, required_tools, cost_tier)
VALUES
  ('critique_pr', 'PR Review', 'Review a pull request diff for bugs, style, security, and improvements.', 'dev',
   'When the user asks you to review a PR, use fetch_url to read the diff, then provide a structured review with: (1) Summary, (2) Critical issues, (3) Suggestions, (4) Verdict.',
   '{fetch_url,search_memories}', 'low'),
  ('summarize_thread', 'Thread Summary', 'Summarize the current chat thread into key decisions, action items, and open questions.', 'general',
   'When asked to summarize, read the recent conversation context and produce: (1) Key decisions made, (2) Action items with owners, (3) Open questions, (4) Mood/sentiment of the discussion.',
   '{search_memories}', 'free'),
  ('dig_for_bug', 'Bug Hunter', 'Systematic debugging: reproduce, bisect, root-cause, propose fix.', 'dev',
   'When the user describes a bug, follow this protocol: (1) Clarify symptoms, (2) Search memories for related issues, (3) Hypothesize root cause, (4) Propose fix with code, (5) Suggest prevention.',
   '{search_memories,fetch_url}', 'low'),
  ('research_topic', 'Deep Research', 'Research a topic using web + memory, synthesize findings.', 'research',
   'When asked to research, (1) Search existing memories for prior findings, (2) If a URL is provided, fetch and analyze it, (3) Synthesize a 5-bullet summary with citations.',
   '{search_memories,fetch_url}', 'medium'),
  ('draft_post', 'Content Draft', 'Draft a social post or blog entry from context + memory.', 'content',
   'When asked to draft content, (1) Pull relevant memories for voice/brand consistency, (2) Draft the post in the requested format and length, (3) Suggest 2-3 variations.',
   '{search_memories}', 'free'),
  ('schedule_tasks', 'Task Scheduler', 'Convert a plan into scheduled actions across platforms.', 'ops',
   'When the user outlines tasks to schedule, (1) Parse each task into a scheduled_action kind + payload, (2) Confirm timing with the user, (3) Queue via schedule_action tool.',
   '{schedule_action,search_memories}', 'low')
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
