-- Migration: Flexible Circle Types
-- Date: 2026-02-15
-- Description: Add flexible circle type support with templates, icons, accent colors, and custom check-in formats

-- Add new columns to circles table
ALTER TABLE circles 
ADD COLUMN IF NOT EXISTS circle_type text DEFAULT 'custom',
ADD COLUMN IF NOT EXISTS icon text DEFAULT '✨',
ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#6366f1',
ADD COLUMN IF NOT EXISTS check_in_format jsonb DEFAULT '{"type": "text", "label": "Daily Check-in"}',
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Create index on circle_type for faster queries
CREATE INDEX IF NOT EXISTS idx_circles_circle_type ON circles(circle_type);

-- Create index on tags for faster filtering
CREATE INDEX IF NOT EXISTS idx_circles_tags ON circles USING GIN (tags);

-- Update existing circles to have default values
UPDATE circles 
SET 
  circle_type = 'custom',
  icon = '✨',
  accent_color = '#6366f1',
  check_in_format = '{"type": "text", "label": "Daily Check-in"}',
  tags = '{}'
WHERE 
  circle_type IS NULL 
  OR icon IS NULL 
  OR accent_color IS NULL 
  OR check_in_format IS NULL 
  OR tags IS NULL;