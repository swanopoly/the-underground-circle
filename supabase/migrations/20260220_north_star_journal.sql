-- Migration: North Star Journal Feature
-- Date: 2026-02-20
-- Description: Add table for morning North Star journal entries

-- Create north_star_entries table
CREATE TABLE IF NOT EXISTS public.north_star_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    intention TEXT NOT NULL,
    priority TEXT NOT NULL,
    energy TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint to ensure one entry per user per day
ALTER TABLE public.north_star_entries 
ADD CONSTRAINT unique_user_date UNIQUE (user_id, date);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_north_star_user_date ON public.north_star_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_north_star_created_at ON public.north_star_entries(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE public.north_star_entries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see their own entries
CREATE POLICY "Users can view own north star entries" ON public.north_star_entries
    FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert their own entries
CREATE POLICY "Users can insert own north star entries" ON public.north_star_entries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own entries
CREATE POLICY "Users can update own north star entries" ON public.north_star_entries
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own entries
CREATE POLICY "Users can delete own north star entries" ON public.north_star_entries
    FOR DELETE USING (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_north_star_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER update_north_star_entries_updated_at
    BEFORE UPDATE ON public.north_star_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_north_star_updated_at();

-- Grant necessary permissions
GRANT ALL ON public.north_star_entries TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;