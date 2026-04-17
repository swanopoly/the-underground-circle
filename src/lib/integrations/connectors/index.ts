/**
 * Connector adapter index — maps provider id → ConnectorAdapter.
 *
 * Adding a new connector:
 *   1. Implement the adapter in src/lib/integrations/connectors/{id}.ts
 *   2. Import + register it here.
 *   3. (Optional) write the matching edge function for runtime API calls.
 *
 * Lookup is by registry id (e.g. 'aws', 'github', 'linear'). Returns
 * undefined for providers that don't have an adapter yet — those are
 * either schema-only (`status: 'planned'` in the registry) or use a
 * legacy code path (e.g. github.ts predates this framework).
 */

import type { ConnectorAdapter } from '../types';
import { awsConnector } from './aws';

const ADAPTERS: ConnectorAdapter[] = [
  awsConnector,
  // Add more here as connectors are written:
  //   linearConnector,
  //   sentryConnector,
  //   notionConnector,
  //   ...
];

const ADAPTERS_BY_ID = new Map(ADAPTERS.map(a => [a.providerId, a]));

export function getConnector(providerId: string): ConnectorAdapter | undefined {
  return ADAPTERS_BY_ID.get(providerId);
}

export function listConnectors(): ConnectorAdapter[] {
  return [...ADAPTERS];
}

export { awsConnector };
