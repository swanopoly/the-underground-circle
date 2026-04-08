-- Office Layout Validation Trigger — prevents JSONB abuse
CREATE OR REPLACE FUNCTION validate_office_layout()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  layout jsonb;
  floors jsonb;
  floor_count int;
  f jsonb;
  furn_count int;
  payload_size int;
BEGIN
  layout := NEW.office_layout;
  IF layout IS NULL OR layout = '{}'::jsonb THEN RETURN NEW; END IF;

  payload_size := length(layout::text);
  IF payload_size > 512000 THEN
    RAISE EXCEPTION 'office_layout exceeds 500KB limit (got %KB)', payload_size / 1024;
  END IF;

  floors := layout -> 'floors';
  IF floors IS NOT NULL AND jsonb_typeof(floors) = 'array' THEN
    floor_count := jsonb_array_length(floors);
    IF floor_count > 10 THEN
      RAISE EXCEPTION 'Too many floors (max 10, got %)', floor_count;
    END IF;

    FOR f IN SELECT * FROM jsonb_array_elements(floors)
    LOOP
      IF f -> 'furniture' IS NOT NULL AND jsonb_typeof(f -> 'furniture') = 'array' THEN
        furn_count := jsonb_array_length(f -> 'furniture');
        IF furn_count > 100 THEN
          RAISE EXCEPTION 'Too many furniture items on floor (max 100, got %)', furn_count;
        END IF;
      END IF;
      IF f -> 'agentIds' IS NOT NULL AND jsonb_typeof(f -> 'agentIds') = 'array' THEN
        IF jsonb_array_length(f -> 'agentIds') > 30 THEN
          RAISE EXCEPTION 'Too many agents on floor (max 30)';
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_office_layout ON profiles;
CREATE TRIGGER trg_validate_office_layout
  BEFORE INSERT OR UPDATE OF office_layout ON profiles
  FOR EACH ROW EXECUTE FUNCTION validate_office_layout();

-- Content Reports table
CREATE TABLE IF NOT EXISTS content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content_type text NOT NULL CHECK (content_type IN ('furniture_text', 'furniture_image', 'agent_name', 'status_message', 'other')),
  content_preview text,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_insert_reports" ON content_reports FOR INSERT WITH CHECK (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "creator_read_reports" ON content_reports FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Furniture presets (shareable layouts)
CREATE TABLE IF NOT EXISTS furniture_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  install_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE furniture_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_read_public_presets" ON furniture_presets FOR SELECT USING (is_public = true OR created_by = auth.uid());
CREATE POLICY "users_manage_own_presets" ON furniture_presets FOR ALL USING (created_by = auth.uid());
