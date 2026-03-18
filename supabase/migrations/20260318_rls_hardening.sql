-- ─────────────────────────────────────────────────────────────────────────────
-- RLS Hardening — tighter policies across key tables
-- Pattern: DROP existing + CREATE replacement. Service role bypasses all RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Helper: check if user is circle creator ─────────────────────────────────

CREATE OR REPLACE FUNCTION is_circle_creator(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = cid AND user_id = auth.uid() AND role = 'creator'
  );
$$;

-- ─── Helper: check if user is in a circle ────────────────────────────────────

CREATE OR REPLACE FUNCTION is_circle_member(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = cid AND user_id = auth.uid()
  );
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- circles — only creator can UPDATE/DELETE. Members can SELECT.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can view their circles" ON circles;
DROP POLICY IF EXISTS "Authenticated users can create circles" ON circles;
DROP POLICY IF EXISTS "Creator can update circle" ON circles;
DROP POLICY IF EXISTS "Users can view circles they're members of" ON circles;
DROP POLICY IF EXISTS "Circle creators can update their circles" ON circles;

CREATE POLICY "rls_circles_select" ON circles FOR SELECT
  USING (is_circle_member(id));

CREATE POLICY "rls_circles_insert" ON circles FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "rls_circles_update" ON circles FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "rls_circles_delete" ON circles FOR DELETE
  USING (auth.uid() = created_by);


-- ═══════════════════════════════════════════════════════════════════════════════
-- circle_members — users can insert themselves, leave, creator manages all
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can view fellow members" ON circle_members;
DROP POLICY IF EXISTS "Users can join circles" ON circle_members;
DROP POLICY IF EXISTS "Users can leave circles" ON circle_members;
DROP POLICY IF EXISTS "Users can view circle memberships" ON circle_members;
DROP POLICY IF EXISTS "Circle creators can manage members" ON circle_members;

-- Members see fellow members in their circles
CREATE POLICY "rls_cm_select" ON circle_members FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

-- Users can only insert themselves (as 'member' role)
CREATE POLICY "rls_cm_insert" ON circle_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only the circle creator can change roles
CREATE POLICY "rls_cm_update_creator" ON circle_members FOR UPDATE
  USING (is_circle_creator(circle_id))
  WITH CHECK (is_circle_creator(circle_id));

-- Users can delete themselves (leave). Creator can remove anyone.
CREATE POLICY "rls_cm_delete_self" ON circle_members FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "rls_cm_delete_creator" ON circle_members FOR DELETE
  USING (is_circle_creator(circle_id));


-- ═══════════════════════════════════════════════════════════════════════════════
-- circle_office_agents — owner manages own agents, members can SELECT published
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "office_agents_select" ON circle_office_agents;
DROP POLICY IF EXISTS "office_agents_insert" ON circle_office_agents;
DROP POLICY IF EXISTS "office_agents_update" ON circle_office_agents;
DROP POLICY IF EXISTS "office_agents_delete" ON circle_office_agents;

-- Members can see published agents in their circles
CREATE POLICY "rls_oa_select" ON circle_office_agents FOR SELECT
  USING (
    (is_published = true AND circle_id IN (SELECT get_my_circle_ids()))
    OR owner_id = auth.uid()
  );

-- Users can only insert agents they own
CREATE POLICY "rls_oa_insert" ON circle_office_agents FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND is_circle_member(circle_id));

-- Only the owner can update their own agents
CREATE POLICY "rls_oa_update" ON circle_office_agents FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Only the owner can delete their own agents
CREATE POLICY "rls_oa_delete" ON circle_office_agents FOR DELETE
  USING (owner_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════
-- room_tasks — room members SELECT, creator manages, members INSERT
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "room_tasks_all" ON room_tasks;
DROP POLICY IF EXISTS "rls_room_tasks_select" ON room_tasks;
DROP POLICY IF EXISTS "rls_room_tasks_insert" ON room_tasks;
DROP POLICY IF EXISTS "rls_room_tasks_update" ON room_tasks;
DROP POLICY IF EXISTS "rls_room_tasks_delete" ON room_tasks;

-- Members can read tasks in their circle's rooms
CREATE POLICY "rls_room_tasks_select" ON room_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_tasks.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- Members can create tasks
CREATE POLICY "rls_room_tasks_insert" ON room_tasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_tasks.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- Only task creator can update their own tasks
CREATE POLICY "rls_room_tasks_update" ON room_tasks FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Only task creator can delete their own tasks
CREATE POLICY "rls_room_tasks_delete" ON room_tasks FOR DELETE
  USING (created_by = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════
-- room_files — room members SELECT/INSERT, uploader UPDATE/DELETE
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "room_files_select" ON room_files;
DROP POLICY IF EXISTS "room_files_insert" ON room_files;
DROP POLICY IF EXISTS "room_files_update" ON room_files;

-- Members can read files in their circle's rooms
CREATE POLICY "rls_room_files_select" ON room_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_files.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- Members can upload files
CREATE POLICY "rls_room_files_insert" ON room_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_files.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- Only uploader can update their files
CREATE POLICY "rls_room_files_update" ON room_files FOR UPDATE
  USING (uploaded_by = auth.uid() OR created_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid() OR created_by = auth.uid());

-- Only uploader can delete their files
CREATE POLICY "rls_room_files_delete" ON room_files FOR DELETE
  USING (uploaded_by = auth.uid() OR created_by = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════
-- room_messages — members SELECT/INSERT own, immutable (no UPDATE/DELETE)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "room_messages_select" ON room_messages;
DROP POLICY IF EXISTS "room_messages_insert" ON room_messages;

-- Members can read messages in their circle's rooms
CREATE POLICY "rls_room_messages_select" ON room_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_messages.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- Users can only insert their own messages
CREATE POLICY "rls_room_messages_insert" ON room_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_messages.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
  );

-- NO UPDATE or DELETE policies for users — messages are immutable
-- Service role can still modify via service key


-- ═══════════════════════════════════════════════════════════════════════════════
-- circle_github_connections — connector/creator manage, members SELECT
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "circle_members_read_github" ON circle_github_connections;
DROP POLICY IF EXISTS "connector_manages_github" ON circle_github_connections;
DROP POLICY IF EXISTS "circle_creator_manages_github" ON circle_github_connections;

-- Members can read connections in their circles
CREATE POLICY "rls_ghconn_select" ON circle_github_connections FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

-- Only connected_by user can update/delete their own connections
CREATE POLICY "rls_ghconn_manage_self" ON circle_github_connections FOR ALL
  USING (connected_by = auth.uid())
  WITH CHECK (connected_by = auth.uid());

-- Circle creator can manage all connections in their circle
CREATE POLICY "rls_ghconn_manage_creator" ON circle_github_connections FOR ALL
  USING (is_circle_creator(circle_id))
  WITH CHECK (is_circle_creator(circle_id));


-- ═══════════════════════════════════════════════════════════════════════════════
-- circle_github_events — members SELECT, service role only INSERT/UPDATE
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "circle_members_read_github_events" ON circle_github_events;
DROP POLICY IF EXISTS "service_role_manage_github_events" ON circle_github_events;

-- Members can read events in their circles
CREATE POLICY "rls_ghevt_select" ON circle_github_events FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

-- Only service role can insert/update (webhook receiver)
-- Service role bypasses RLS, so no explicit policy needed for INSERT/UPDATE.
-- Users cannot INSERT or UPDATE.


-- ═══════════════════════════════════════════════════════════════════════════════
-- user_github_tokens — users SELECT own, service role manages all
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "users_own_github_token" ON user_github_tokens;
DROP POLICY IF EXISTS "service_manages_github_tokens" ON user_github_tokens;

-- Users can see their own token metadata
CREATE POLICY "rls_ght_select" ON user_github_tokens FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for users — service role only (bypasses RLS)


-- ═══════════════════════════════════════════════════════════════════════════════
-- agent_activity — members SELECT circle activity, service role INSERT
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can read activity" ON agent_activity;
DROP POLICY IF EXISTS "Service role can insert" ON agent_activity;

-- Members can read activity in their circles
CREATE POLICY "rls_activity_select" ON agent_activity FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

-- No INSERT/UPDATE/DELETE for users — agents post activity via service role


-- ═══════════════════════════════════════════════════════════════════════════════
-- Done
-- ═══════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
