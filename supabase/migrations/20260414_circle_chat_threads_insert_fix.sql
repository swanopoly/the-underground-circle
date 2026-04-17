-- ─────────────────────────────────────────────────────────────────────────────
-- Hotfix: circle_chat_threads INSERT policy was tripping on circle_members'
-- recursive RLS. Wrap the membership check in a SECURITY DEFINER helper so it
-- bypasses RLS the same way user_can_see_chat_thread() already does.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function user_is_circle_member(p_circle_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1 from circle_members cm
    where cm.circle_id = p_circle_id and cm.user_id = auth.uid()
  );
$$;

drop policy if exists cct_insert on circle_chat_threads;
create policy cct_insert on circle_chat_threads for insert
  with check (
    auth.uid() = created_by
    and user_is_circle_member(circle_id)
    and visibility in ('private','shared')
  );

notify pgrst, 'reload schema';
