-- ─── Organizations ──────────────────────────────────────────────────────────
-- Foundation for team/business features. An organization manages multiple circles.

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business', 'enterprise')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  seat_count INTEGER NOT NULL DEFAULT 1,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_organizations_created_by ON organizations(created_by);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ─── Org Members ────────────────────────────────────────────────────────────

CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_by UUID REFERENCES profiles(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_compound ON org_members(user_id, org_id);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- ─── Add org_id to circles (nullable for backward compatibility) ────────────

ALTER TABLE circles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX idx_circles_org ON circles(org_id) WHERE org_id IS NOT NULL;

-- ─── RLS: Organizations ─────────────────────────────────────────────────────

CREATE POLICY "Org members can view their org"
  ON organizations FOR SELECT USING (
    id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create orgs"
  ON organizations FOR INSERT WITH CHECK (
    auth.uid() = created_by
  );

CREATE POLICY "Org owners/admins can update org"
  ON organizations FOR UPDATE USING (
    id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

CREATE POLICY "Org owners can delete org"
  ON organizations FOR DELETE USING (
    id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'owner')
  );

-- ─── RLS: Org Members ──────────────────────────────────────────────────────

CREATE POLICY "Org members can view fellow members"
  ON org_members FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Org admins can add members"
  ON org_members FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

CREATE POLICY "Org admins can remove members or self-remove"
  ON org_members FOR DELETE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    OR user_id = auth.uid()
  );

CREATE POLICY "Org owners can update member roles"
  ON org_members FOR UPDATE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'owner')
  );

-- ─── Extended circle access for org members ─────────────────────────────────

CREATE POLICY "Org members can view org circles"
  ON circles FOR SELECT USING (
    org_id IS NOT NULL AND org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Org admins can update org circles"
  ON circles FOR UPDATE USING (
    org_id IS NOT NULL AND org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );
