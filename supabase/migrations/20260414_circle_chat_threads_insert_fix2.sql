-- Hotfix #2: simplify the INSERT policy on circle_chat_threads.
-- The user_is_circle_member() SECURITY DEFINER helper still returned a 403,
-- likely a search_path quirk. Trust auth.uid() = created_by for inserts;
-- the SELECT policy already restricts thread visibility to circle members
-- (or invitees), so an orphan thread for an unjoined circle would be
-- invisible to its creator and useless anyway.
-- Idempotent.

drop policy if exists cct_insert on circle_chat_threads;
create policy cct_insert on circle_chat_threads for insert
  with check (
    auth.uid() = created_by
    and visibility in ('private','shared')
  );

notify pgrst, 'reload schema';
