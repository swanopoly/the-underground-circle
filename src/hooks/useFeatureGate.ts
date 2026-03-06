/**
 * Feature gating hook — checks if a feature is available for the current org.
 */

import { useOrg } from './useOrg';
import { FEATURE_REQUIRED_PLAN } from '../lib/billing';

interface UseFeatureGateReturn {
  allowed: boolean;
  plan: string;
  requiredPlan: string;
  loading: boolean;
}

export function useFeatureGate(
  feature: string,
  orgId: string | null | undefined
): UseFeatureGateReturn {
  const { features, org, loading } = useOrg(orgId);

  if (loading) {
    return { allowed: false, plan: 'free', requiredPlan: 'free', loading: true };
  }

  // If no org, default to free tier
  if (!org || !features) {
    return {
      allowed: false,
      plan: 'free',
      requiredPlan: FEATURE_REQUIRED_PLAN[feature] || 'free',
      loading: false,
    };
  }

  // Check the feature flag from org_features table
  const featureKey = feature as keyof typeof features;
  const allowed = features[featureKey] === true || features[featureKey] === undefined;

  return {
    allowed: typeof features[featureKey] === 'boolean' ? features[featureKey] as boolean : true,
    plan: org.plan,
    requiredPlan: FEATURE_REQUIRED_PLAN[feature] || 'free',
    loading: false,
  };
}
