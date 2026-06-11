-- Action trace for guided replay (D7c).
--
-- Successful computer-use runs persist their tool-action sequence so a
-- repeat of the same task (saved recipe, scheduled automation, manual
-- re-run) can follow the proven sequence instead of re-exploring —
-- fewer iterations, fewer tokens, faster runs. Inputs are REDACTED at
-- write time in the edge function (credential-shaped keys stripped,
-- values bounded); this column never stores secrets.
--
-- Additive only; safe to re-run.

ALTER TABLE computer_use_runs
  ADD COLUMN IF NOT EXISTS action_trace jsonb;

NOTIFY pgrst, 'reload schema';
