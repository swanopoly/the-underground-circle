/** Browser/native OpenSwan auto-discovery ordering source contract. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'src/lib/connectionManager.ts'), 'utf8');
const autoConnect = fs.readFileSync(path.join(root, 'src/lib/agentAutoConnect.ts'), 'utf8');

let assertions = 0;
function check(value: unknown, message: string): void {
  assertions += 1;
  if (!value) throw new Error(`OpenSwan browser proxy discovery smoke failed: ${message}`);
}

const helperStart = manager.indexOf('export function getLocalOpenSwanDiscoveryEndpoints(');
const helperEnd = manager.indexOf('/**\n * Probe localhost', helperStart);
const helper = manager.slice(helperStart, helperEnd);
check(helperStart >= 0 && helperEnd > helperStart, 'discovery endpoint helper has a bounded body');
check(helper.includes('const proxyEndpoint = getBridgeUrl(18790)'), 'proxy URL uses the shared environment owner');
check(helper.includes('const directEndpoint = getBridgeUrl(18789)'), 'native direct URL uses the shared environment owner');
check(
  helper.includes("platform === 'web'\n    ? [proxyEndpoint]\n    : [directEndpoint, proxyEndpoint]"),
  'web never probes the direct gateway while native prefers direct then proxy',
);
check(
  manager.includes('for (const endpoint of getLocalOpenSwanDiscoveryEndpoints())')
    && manager.includes('if (await probeEndpointHealth(endpoint))'),
  'auto-discovery consumes the canonical ordered endpoints through the bounded health probe',
);
check(
  autoConnect.match(/for \(const fallback of getLocalOpenSwanDiscoveryEndpoints\(\)\)/g)?.length === 2,
  'both reconnect and connect fallback loops share the canonical endpoint order',
);
check(!autoConnect.includes('OPENCLAW_FALLBACK_ENDPOINTS'), 'stale hard-coded direct fallback list is removed');

console.log(`OpenSwan browser proxy discovery smoke passed (${assertions} assertions).`);
