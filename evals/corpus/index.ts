/**
 * evals/corpus/index.ts — aggregate of the extended deterministic golden-case
 * corpus. Each sibling module pins load-bearing invariants of a batch of pure
 * cores (grounded in real captured output). The base corpus lives in
 * `../coreGoldenCorpus.ts` (CORE_GOLDEN_CORPUS); these EXTENDED_CASES broaden the
 * regression net to ~56 cores.
 *
 * The runner (`scripts/run-evals.ts`) runs both. To add a new group: author
 * `evals/corpus/<name>.ts` exporting `CASES: CoreGoldenCase[]`, then add one
 * import + spread here.
 */
import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { CASES as accountabilityAudit } from './accountability-audit';
import { CASES as accountabilityLinks } from './accountability-links';
import { CASES as approvalAttach } from './approval-attach';
import { CASES as chatAccuracy } from './chat-accuracy';
import { CASES as chatFlow } from './chat-flow';
import { CASES as chatMisc } from './chat-misc';
import { CASES as chatRender } from './chat-render';
import { CASES as chatUx } from './chat-ux';
import { CASES as contextBudget } from './context-budget';
import { CASES as delegation } from './delegation';
import { CASES as execPolicy } from './exec-policy';
import { CASES as indexPersist } from './index-persist';
import { CASES as openswanQuality } from './openswan-quality';
import { CASES as optimization } from './optimization';
import { CASES as optimization2 } from './optimization2';
import { CASES as optimization3 } from './optimization3';
import { CASES as optimization4 } from './optimization4';
import { CASES as routingResilience } from './routing-resilience';
import { CASES as v2Loop } from './v2-loop';
import { CASES as verifyA11yCodebase } from './verify-a11y-codebase';

export const EXTENDED_CASES: CoreGoldenCase[] = [
  ...accountabilityAudit,
  ...accountabilityLinks,
  ...approvalAttach,
  ...chatAccuracy,
  ...chatFlow,
  ...chatMisc,
  ...chatRender,
  ...chatUx,
  ...contextBudget,
  ...delegation,
  ...execPolicy,
  ...indexPersist,
  ...openswanQuality,
  ...optimization,
  ...optimization2,
  ...optimization3,
  ...optimization4,
  ...routingResilience,
  ...v2Loop,
  ...verifyA11yCodebase,
];
