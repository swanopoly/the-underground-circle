-- ─── Circle Invites ─────────────────────────────────────────────────────────
-- Proper invite system: shareable links + email invites with expiry and usage limits

CREATE TABLE circle_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  invite_type TEXT NOT NULL CHECK (invite_type IN ('link', 'email')),
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  email TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_circle_invites_code ON circle_invites(invite_code);
CREATE INDEX idx_circle_invites_email ON circle_invites(email) WHERE email IS NOT NULL;
CREATE INDEX idx_circle_invites_circle ON circle_invites(circle_id);
CREATE INDEX idx_circle_invites_status ON circle_invites(status) WHERE status = 'pending';

ALTER TABLE circle_invites ENABLE ROW LEVEL SECURITY;

-- Circle creators/admins can manage invites
CREATE POLICY "Circle creators can manage invites"
  ON circle_invites FOR ALL USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid() AND role = 'creator')
  );

-- Anyone can look up a pending, non-expired invite by code
CREATE POLICY "Anyone can view valid invites by code"
  ON circle_invites FOR SELECT USING (
    status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())
  );
