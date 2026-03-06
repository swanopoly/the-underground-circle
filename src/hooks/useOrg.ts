/**
 * Organization context hook — provides current org info and features.
 * Used by feature-gated components to check plan access.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getOrgDetails,
  getOrgFeatures,
  getMyOrgRole,
  type Organization,
  type OrgFeatures,
} from '../lib/organizations';

interface UseOrgReturn {
  org: Organization | null;
  features: OrgFeatures | null;
  role: 'owner' | 'admin' | 'member' | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  isOwner: boolean;
  canManage: boolean;
}

const DEFAULT_FREE_FEATURES: OrgFeatures = {
  org_id: '',
  max_circles: 1,
  max_members_per_circle: 12,
  analytics_enabled: false,
  slack_enabled: false,
  teams_enabled: false,
  sso_enabled: false,
  export_enabled: false,
  whitelabel_enabled: false,
  custom_branding: false,
  goal_alignment: false,
};

export function useOrg(orgId: string | null | undefined): UseOrgReturn {
  const [org, setOrg] = useState<Organization | null>(null);
  const [features, setFeatures] = useState<OrgFeatures | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | 'member' | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setOrg(null);
      setFeatures(DEFAULT_FREE_FEATURES);
      setRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [orgData, featuresData, roleData] = await Promise.all([
        getOrgDetails(orgId),
        getOrgFeatures(orgId),
        getMyOrgRole(orgId),
      ]);

      setOrg(orgData);
      setFeatures(featuresData || DEFAULT_FREE_FEATURES);
      setRole(roleData);
    } catch (err) {
      console.error('useOrg error:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    org,
    features,
    role,
    loading,
    refresh,
    isAdmin: role === 'admin' || role === 'owner',
    isOwner: role === 'owner',
    canManage: role === 'admin' || role === 'owner',
  };
}
