-- Create private chat threads through a SECURITY DEFINER RPC instead of
-- relying on direct client inserts against circle_chat_threads. This avoids
-- brittle RLS interactions and lets the app stamp OpenSwan-first defaults.

create or replace function create_private_chat_thread(
  p_circle_id uuid,
  p_title text default null,
  p_default_model text default 'openswan'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_thread_id uuid;
  v_title text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_user_id
  ) then
    raise exception 'Not a member of this circle';
  end if;

  v_title := coalesce(nullif(btrim(p_title), ''), 'OpenSwan Session');

  insert into circle_chat_threads (
    circle_id,
    created_by,
    title,
    visibility,
    default_model
  ) values (
    p_circle_id,
    v_user_id,
    v_title,
    'private',
    coalesce(nullif(btrim(p_default_model), ''), 'openswan')
  )
  returning id into v_thread_id;

  insert into circle_chat_thread_members (
    thread_id,
    user_id,
    role,
    added_by
  ) values (
    v_thread_id,
    v_user_id,
    'owner',
    v_user_id
  )
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function create_private_chat_thread(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
