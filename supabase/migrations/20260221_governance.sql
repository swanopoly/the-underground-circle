-- ─── Proposals (DAO Governance) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  proposal_type TEXT NOT NULL DEFAULT 'general', -- general, rule_change, spending, challenge, member_action, poll
  status TEXT NOT NULL DEFAULT 'active', -- active, passed, failed, expired
  options JSONB DEFAULT '[]', -- for polls: [{label: "Option A"}, {label: "Option B"}]
  quorum_pct INTEGER DEFAULT 50, -- % of members needed to vote for result to be valid
  pass_pct INTEGER DEFAULT 51, -- % of yes votes needed to pass (for yes/no proposals)
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_circle ON proposals(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);

-- ─── Proposal Votes ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposal_votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL, -- 'yes', 'no', 'abstain', or option index for polls ('0', '1', '2'...)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proposal_id, user_id) -- one vote per person per proposal
);

CREATE INDEX IF NOT EXISTS idx_proposal_votes_proposal ON proposal_votes(proposal_id);

-- ─── Pinned Messages ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pinned_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_circle ON pinned_messages(circle_id);

-- ─── RLS Policies ───────────────────────────────────────────────────

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pinned_messages ENABLE ROW LEVEL SECURITY;

-- Proposals: circle members can read
CREATE POLICY "Circle members can read proposals" ON proposals
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM circle_members WHERE circle_members.circle_id = proposals.circle_id AND circle_members.user_id = auth.uid())
  );

-- Proposals: circle members can create
CREATE POLICY "Circle members can create proposals" ON proposals
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (SELECT 1 FROM circle_members WHERE circle_members.circle_id = proposals.circle_id AND circle_members.user_id = auth.uid())
  );

-- Proposals: creator can update (for resolving)
CREATE POLICY "Proposal creator can update" ON proposals
  FOR UPDATE USING (auth.uid() = created_by);

-- Votes: circle members can read
CREATE POLICY "Circle members can read votes" ON proposal_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM proposals p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = proposal_votes.proposal_id AND cm.user_id = auth.uid()
    )
  );

-- Votes: members can vote
CREATE POLICY "Members can vote" ON proposal_votes
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM proposals p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = proposal_votes.proposal_id AND cm.user_id = auth.uid()
    )
  );

-- Pinned: circle members can read
CREATE POLICY "Circle members can read pins" ON pinned_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM circle_members WHERE circle_members.circle_id = pinned_messages.circle_id AND circle_members.user_id = auth.uid())
  );

-- Pinned: circle members can pin
CREATE POLICY "Circle members can pin" ON pinned_messages
  FOR INSERT WITH CHECK (
    auth.uid() = pinned_by
    AND EXISTS (SELECT 1 FROM circle_members WHERE circle_members.circle_id = pinned_messages.circle_id AND circle_members.user_id = auth.uid())
  );

-- Pinned: pinner can unpin
CREATE POLICY "Pinner can unpin" ON pinned_messages
  FOR DELETE USING (auth.uid() = pinned_by);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE proposal_votes;
