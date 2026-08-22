-- Align the live circles schema with the fields used by the create, detail,
-- settings, discovery, and OpenSwan tool surfaces. The original migration was
-- accidentally checked in under src/migrations, so it was never part of the
-- Supabase migration stream.

BEGIN;

ALTER TABLE public.circles
  ADD COLUMN IF NOT EXISTS circle_type text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS check_in_format jsonb,
  ADD COLUMN IF NOT EXISTS tags text[];

UPDATE public.circles
SET
  circle_type = COALESCE(circle_type, 'custom'),
  icon = COALESCE(icon, '✨'),
  accent_color = COALESCE(accent_color, '#6366f1'),
  check_in_format = COALESCE(
    check_in_format,
    '{"type":"text","label":"Daily Check-in"}'::jsonb
  ),
  tags = COALESCE(tags, ARRAY[]::text[])
WHERE circle_type IS NULL
   OR icon IS NULL
   OR accent_color IS NULL
   OR check_in_format IS NULL
   OR tags IS NULL;

ALTER TABLE public.circles
  ALTER COLUMN circle_type SET DEFAULT 'custom',
  ALTER COLUMN circle_type SET NOT NULL,
  ALTER COLUMN icon SET DEFAULT '✨',
  ALTER COLUMN icon SET NOT NULL,
  ALTER COLUMN accent_color SET DEFAULT '#6366f1',
  ALTER COLUMN accent_color SET NOT NULL,
  ALTER COLUMN check_in_format SET DEFAULT '{"type":"text","label":"Daily Check-in"}'::jsonb,
  ALTER COLUMN check_in_format SET NOT NULL,
  ALTER COLUMN tags SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN tags SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.circles'::regclass
      AND conname = 'circles_accent_color_hex_check'
  ) THEN
    ALTER TABLE public.circles
      ADD CONSTRAINT circles_accent_color_hex_check
      CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.circles'::regclass
      AND conname = 'circles_icon_length_check'
  ) THEN
    ALTER TABLE public.circles
      ADD CONSTRAINT circles_icon_length_check
      CHECK (char_length(icon) BETWEEN 1 AND 16);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.circles'::regclass
      AND conname = 'circles_check_in_format_shape_check'
  ) THEN
    ALTER TABLE public.circles
      ADD CONSTRAINT circles_check_in_format_shape_check
      CHECK (
        jsonb_typeof(check_in_format) = 'object'
        AND octet_length(check_in_format::text) <= 8192
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.circles'::regclass
      AND conname = 'circles_tags_count_check'
  ) THEN
    ALTER TABLE public.circles
      ADD CONSTRAINT circles_tags_count_check
      CHECK (cardinality(tags) <= 20);
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS idx_circles_circle_type
  ON public.circles (circle_type);

CREATE INDEX IF NOT EXISTS idx_circles_tags
  ON public.circles USING gin (tags);

COMMIT;
