-- Add office_preferences JSONB column to profiles
-- Stores user-specific Office data: agent names, telegram config, whiteboard notes
-- Structure: { agentNames: {}, telegramConfig: {}, whiteboardNotes: [], updatedAt: number }

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS office_preferences jsonb DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
