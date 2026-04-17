-- Enable realtime broadcast on org billing tables so the app auto-invalidates
-- feature gates when the Stripe webhook flips `plan` after a successful
-- checkout. Without this, users stay on stale entitlements until they reload.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE organizations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE org_features;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
