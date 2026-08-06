-- ─── builder_publications: remove world-readable SELECT ─────────────────────
-- APPLIED LIVE 2026-08-06.
--
-- 20260415_builder_publications.sql:41 created
--   `create policy builder_pubs_read ... for select using (true);`
-- with a comment reasoning that public read was harmless because the
-- view-build edge function uses the service role anyway. It is not harmless:
-- `using (true)` means anyone holding the public anon key can enumerate the
-- WHOLE table — every user's publication id, user_id, circle_id, title, and
-- html — including rows past `expires_at`, since expiry is enforced only in
-- the edge function (view-build/index.ts:101-103), never in RLS.
--
-- The table happened to be empty when this was found (0 rows), so nothing
-- leaked, but the first publish would have exposed every publish that followed.
--
-- Owner-scoped read is a safe drop-in: the only client reader
-- (src/lib/builderPublish.ts:65 listMyPublications) already filters
-- `.eq('user_id', user.id)`, and public share links keep working because
-- view-build reads with the service role (index.ts:85-89), which bypasses RLS.

drop policy if exists builder_pubs_read on public.builder_publications;
create policy builder_pubs_read on public.builder_publications for select
  using (auth.uid() = user_id);
