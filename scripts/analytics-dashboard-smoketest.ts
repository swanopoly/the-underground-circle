/**
 * Analytics dashboard design and read-truth regression contract.
 *
 * This stays source-only because importing the screen would initialize React
 * Native and Supabase. It pins the production owners rather than a duplicated
 * test implementation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');
const analyticsTab = read('src/screens/circles/tabs/AnalyticsTab.tsx');
const analyticsService = read('src/lib/analytics.ts');
const usagePanel = read('src/components/ClaudeUsagePanel.tsx');
const usageService = read('src/lib/claudeUsage.ts');

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

check(
  analyticsTab.includes("backgroundColor: COLORS.canvas")
    && analyticsTab.includes("canvas: '#0d1117'")
    && analyticsTab.includes("surface: '#161b22'")
    && analyticsTab.includes("border: '#30363d'"),
  'Analytics uses the current UC/Chat dark product tokens',
);
check(
  !analyticsTab.includes("fontFamily: 'monospace'") && !usagePanel.includes('fontFamily: "monospace"'),
  'dashboard prose no longer uses the legacy terminal type treatment',
);
check(
  analyticsTab.includes('maxWidth: 1120') && analyticsTab.includes("alignSelf: 'center'"),
  'dashboard content stays calm and bounded on wide displays',
);
check(
  analyticsTab.includes('useWindowDimensions')
    && analyticsTab.includes('const compact = width < 700')
    && analyticsTab.includes('compact ? ('),
  'member engagement has a real narrow-layout presentation',
);
check(
  analyticsTab.includes('<ScrollView horizontal') && analyticsTab.includes('minWidth: 700'),
  'wide member data retains an explicit scroll-safe table',
);
check(
  analyticsTab.includes('accessibilityRole="tablist"')
    && analyticsTab.includes('accessibilityRole="tab"')
    && analyticsTab.includes('accessibilityState={{ selected }}')
    && analyticsTab.includes('minHeight: 44'),
  'period controls expose selected state and touch-safe targets',
);
check(
  analyticsTab.includes('accessibilityLabel="Refresh analytics"')
    && analyticsTab.includes("setRefreshToken((value) => value + 1)"),
  'the overview has one accessible explicit refresh action',
);
check(
  analyticsTab.includes("type ReadState = 'loading' | 'ready' | 'error'")
    && analyticsTab.includes('Analytics unavailable')
    && analyticsTab.includes('was not replaced with zeros'),
  'summary loading and failure remain distinct from verified zero activity',
);
check(
  analyticsTab.includes('Member activity unavailable')
    && analyticsTab.includes('Circle totals above remain independent'),
  'member-lane failure stays local and truthful',
);
check(
  analyticsTab.includes("key={day.date}") && !analyticsTab.includes('key={i}'),
  'chart rows use stable date identity instead of array position',
);
check(
  analyticsTab.includes("const ClaudeUsagePanel = React.lazy(() => import('../../../components/ClaudeUsagePanel'))")
    && analyticsTab.includes('<React.Suspense')
    && analyticsTab.includes('client={exactReadClient}'),
  'below-fold AI usage stays lazy and receives the captured exact client',
);
check(
  usagePanel.includes('getClaudeUsageSummaryStrict(circleId, range, client)')
    && usagePanel.includes('getClaudeUsageByModelStrict(circleId, range, client)'),
  'AI usage reads fail closed through the same exact client',
);
check(
  usagePanel.includes("type LoadState = 'loading' | 'ready' | 'error'")
    && usagePanel.includes('AI usage unavailable')
    && usagePanel.includes('did not substitute a $0 value'),
  'AI usage distinguishes transport failure from a verified empty period',
);
check(
  usagePanel.includes('No AI usage in this period')
    && !usagePanel.includes('DEPLOY THE UPDATED EDGE FUNCTIONS'),
  'empty usage copy is product-facing instead of deployment diagnostics',
);
check(
  usagePanel.includes('accessibilityLabel="Retry loading AI usage"')
    && usagePanel.includes('accessibilityRole="progressbar"'),
  'usage loading and retry states are announced accessibly',
);
check(
  usagePanel.includes('minHeight: 44')
    && usagePanel.includes('accessibilityState={{ selected }}'),
  'embedded usage filters match the dashboard control contract',
);
check(
  /const \{ data, error \} = await client[\s\S]*?if \(error\) throw error;/.test(analyticsService),
  'daily analytics no longer collapses read errors into empty arrays',
);
check(
  analyticsService.includes('const failedRead = [checkIns.error, messages.error, members.error].find(Boolean)')
    && analyticsService.includes('const failedRead = [checkIns.error, messages.error, tasks.error].find(Boolean)'),
  'summary and member count reads reject partial failed snapshots',
);
check(
  usageService.includes('client: SupabaseClient = supabase')
    && usageService.includes('await client.rpc("get_claude_usage_summary"')
    && usageService.includes('await client.rpc("get_claude_usage_by_model"'),
  'strict usage readers accept an exact caller-owned Supabase client',
);
check(
  analyticsService.includes('const MEMBER_ENGAGEMENT_CONCURRENCY = 6')
    && analyticsService.includes('Promise.all(batch.map'),
  'member counts retain bounded concurrency',
);

console.log(`Analytics dashboard smoke passed (${passed} assertions)`);
