-- Migration: Add missing circle settings columns
-- Date: 2026-02-17
-- Description: Add vibe, rules, and circle_image_url columns to circles table

ALTER TABLE circles 
ADD COLUMN IF NOT EXISTS vibe text DEFAULT '',
ADD COLUMN IF NOT EXISTS rules text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS circle_image_url text DEFAULT NULL;
