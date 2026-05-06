import type { ConnectorAdapter } from '../types';
import { providerGraphql } from '../graphqlClient';

const DEFAULT_SHOPIFY_API_VERSION = '2026-01';

interface ShopifyShopResponse {
  shop: {
    id: string;
    name: string;
    myshopifyDomain: string;
  };
}

function normalizeShopDomain(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return trimmed.endsWith('.myshopify.com') ? trimmed : `${trimmed}.myshopify.com`;
}

function resolveShopifySecrets(secrets: Record<string, string>): { token: string | null; endpoint: string | null } {
  const token = secrets.access_token || secrets.admin_access_token || secrets.api_token || null;
  const rawShop = secrets.shop || secrets.shop_domain || secrets.store_domain || '';
  const apiVersion = secrets.api_version || DEFAULT_SHOPIFY_API_VERSION;
  if (!token || !rawShop) return { token, endpoint: null };
  const shop = normalizeShopDomain(rawShop);
  return {
    token,
    endpoint: `https://${shop}/admin/api/${apiVersion}/graphql.json`,
  };
}

export const shopifyConnector: ConnectorAdapter = {
  providerId: 'shopify',

  async test(secrets) {
    const { token, endpoint } = resolveShopifySecrets(secrets);
    if (!token) return { ok: false, error: 'Missing Shopify Admin API access token.' };
    if (!endpoint) return { ok: false, error: 'Missing Shopify shop domain.' };

    const res = await providerGraphql<ShopifyShopResponse>({
      endpoint,
      token,
      authHeader: 'none',
      headers: { 'X-Shopify-Access-Token': token },
      query: `query ShopIdentity { shop { id name myshopifyDomain } }`,
    });

    if (res.error || !res.data?.shop?.id) {
      return { ok: false, error: res.error || 'Shopify GraphQL shop query returned no shop.' };
    }
    return { ok: true };
  },

  listActions() {
    return [
      {
        id: 'list_products',
        label: 'List products',
        description: 'Read products, variants, inventory, and publication context through Shopify Admin GraphQL.',
      },
      {
        id: 'update_product',
        label: 'Update product',
        description: 'Prepare product updates for approval before changing Shopify content.',
      },
      {
        id: 'list_orders',
        label: 'List orders',
        description: 'Pull order/customer context for support, analytics, and automation playbooks.',
      },
    ];
  },
};
