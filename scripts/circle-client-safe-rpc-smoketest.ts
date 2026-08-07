/** Source contract: discovery and invite consumers never read secret rows. */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const discover = fs.readFileSync(path.join(root, 'src/screens/circles/DiscoverScreen.tsx'), 'utf8');
const join = fs.readFileSync(path.join(root, 'src/screens/circles/JoinCircleScreen.tsx'), 'utf8');
const invites = fs.readFileSync(path.join(root, 'src/lib/invites.ts'), 'utf8');

let assertions = 0;
const check = (condition: boolean, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(`circle client safe RPC smoke failed: ${message}`);
};

check(discover.includes("supabase.rpc('discover_public_circles'"), 'discovery uses the narrow RPC');
check(discover.includes("supabase.rpc('join_public_circle'"), 'public joining uses the serialized RPC');
check(!discover.includes(".from('circles')"), 'discovery never reads raw circle rows');
check(!discover.includes(".from('circle_members')"), 'discovery never inserts membership directly');
check(!discover.includes(".from('circle_missions')"), 'mission counts come from the safe projection');
check(!discover.includes('invite_code'), 'discovery has no invite-code field');
check(!discover.includes('api_key'), 'discovery has no circle API-key field');

check(join.includes("supabase.rpc('join_circle_by_invite_code'"), 'join screen uses the invite RPC');
check(!join.includes(".from('circles')"), 'join screen never resolves a raw circle by code');
check(!join.includes(".from('circle_members')"), 'join screen never inserts membership directly');
check(!join.includes(".eq('invite_code'"), 'join screen never filters a secret-bearing table');

check(invites.includes("supabase.rpc('join_circle_by_invite_code'"), 'invite acceptance uses the invite RPC');
const acceptStart = invites.indexOf('export async function acceptInvite(');
const referralStart = invites.indexOf('// ─── Referral stats', acceptStart);
check(acceptStart >= 0 && referralStart > acceptStart, 'invite acceptance section exists');
const acceptSection = invites.slice(acceptStart, referralStart);
check(!acceptSection.includes(".from('circle_invites')"), 'invite acceptance never reads invite rows');
check(!acceptSection.includes(".from('circle_members')"), 'invite acceptance never inserts membership directly');
check(!invites.includes('export async function lookupInvite('), 'enumerable invite lookup API is removed');

console.log(`circle client safe RPC smoke passed (${assertions} assertions)`);
