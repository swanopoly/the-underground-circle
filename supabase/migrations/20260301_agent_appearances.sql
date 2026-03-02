-- Add agent appearance customization storage to profiles
-- Stores Record<agentName, AgentAppearance> as JSONB (keyed by agent name for persistence across reconnections)
-- RLS already allows users to update their own profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS agent_appearance jsonb DEFAULT '{}';
