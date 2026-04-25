/**
 * check-bridges — terminal probe of all 5 local agent-source bridges.
 * Run: npm run check:bridges
 *
 * Prints a 1-screen status report. Exits 0 when every bridge is
 * healthy or merely degraded (auth missing), exits 2 when any bridge
 * is fully offline — useful as a `pre-`hook in start-dev or CI checks
 * before the agent stack is exercised.
 */
import { probeBridges, summarizeBridgeProbes } from '../src/lib/bridgeHealthDiag';

async function main() {
  const results = await probeBridges();
  console.log(summarizeBridgeProbes(results));
  // Exit 2 only on hard offline — degraded (auth missing) is the
  // user's responsibility to fix and shouldn't fail CI/start-dev.
  const hardFail = results.some((r) => r.status === 'offline');
  process.exit(hardFail ? 2 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
