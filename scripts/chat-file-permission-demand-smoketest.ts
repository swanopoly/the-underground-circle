import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const chatTabSource = readFileSync(
  `${repoRoot}/src/screens/circles/tabs/ChatTab.tsx`,
  'utf8',
);

const componentStart = chatTabSource.indexOf('export default function ChatTab');
const modelCatalogStateBoundary = chatTabSource.indexOf(
  'const modelCatalogGenerationRef = useRef(0);',
  componentStart,
);
assert(componentStart >= 0, 'ChatTab component is present');
assert(modelCatalogStateBoundary > componentStart, 'ChatTab mount-state boundary is present');

const mountStateSection = chatTabSource.slice(componentStart, modelCatalogStateBoundary);
assert.doesNotMatch(
  mountStateSection,
  /requestLocalFileSessionGrant|getActiveLocalFileSessionGrant|inferLocalFileGrantRootsForTask/,
  'Chat mount does not inspect or request a local file grant',
);
assert.doesNotMatch(
  chatTabSource,
  /desktopWriteGrantSeededRef|Local Chat dashboard Desktop file-write access|\['~\/Desktop'\]/,
  'Chat has no eager localhost Desktop write-grant state, reason, or root',
);

const executableGrantCalls = chatTabSource.match(/(?:await|void)\s+requestLocalFileSessionGrant\s*\(\s*\{/g) || [];
assert.equal(
  executableGrantCalls.length,
  1,
  'Chat has exactly one executable local file grant request and it is task-scoped',
);

const taskGrantStart = chatTabSource.indexOf('const needsLocalFileRead =');
const taskGrantEnd = chatTabSource.indexOf(
  'const businessModelPickerId =',
  taskGrantStart,
);
assert(taskGrantStart > componentStart, 'task-time local file grant gate is present');
assert(taskGrantEnd > taskGrantStart, 'task-time local file grant gate has a stable end boundary');
const taskGrantSection = chatTabSource.slice(taskGrantStart, taskGrantEnd);
assert.match(
  taskGrantSection,
  /grant\.id === 'file_read'[\s\S]*grant\.id === 'file_write'/,
  'task-time permission demand derives from the planned file grants',
);
assert.match(
  taskGrantSection,
  /inferLocalFileGrantRootsForTask\(trimmed\)[\s\S]*getActiveLocalFileSessionGrant\(roots, requiredScope\)/,
  'task-time permission demand infers the requested roots and reuses a matching active grant',
);
assert.match(
  taskGrantSection,
  /await requestLocalFileSessionGrant\(\{\s*roots,\s*scope: requiredScope,\s*reason: trimmed,\s*\}\)/,
  'task-time permission demand uses the exact task as its grant reason',
);

const stagedFlowStart = chatTabSource.indexOf('const stageUploadedFilesForDesktopTask = useCallback');
const stagedFlowEnd = chatTabSource.indexOf('const sendMessage = async', stagedFlowStart);
assert(stagedFlowStart > componentStart, 'uploaded-file desktop staging callback is present');
assert(stagedFlowEnd > stagedFlowStart, 'uploaded-file desktop staging callback has a stable end boundary');
const stagedFlowSection = chatTabSource.slice(stagedFlowStart, stagedFlowEnd);
assert.match(
  stagedFlowSection,
  /stageAttachmentForDesktop\(\{[\s\S]*stageAttachmentManifestForDesktop\(\{ groupId, manifest \}\)/,
  'task-time uploaded files still flow through desktop staging and its manifest',
);

assert.doesNotMatch(
  mountStateSection,
  /if\s*\([^)]*\)\s*return\s+(?:null|undefined)\s*;[\s\S]*\buse(?:State|Effect|Ref|Memo|Callback)\s*\(/,
  'removing eager permission setup does not leave a conditional component return before later hooks',
);
assert.match(
  mountStateSection,
  /const \[selectedModel, setSelectedModel\] = useState[\s\S]*$/,
  'the mount-state hook sequence reaches the marketplace boundary unconditionally',
);

const parsed = ts.createSourceFile(
  'ChatTab.tsx',
  chatTabSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const chatTabFunction = parsed.statements.find((statement): statement is ts.FunctionDeclaration => (
  ts.isFunctionDeclaration(statement) && statement.name?.text === 'ChatTab'
));
assert(chatTabFunction?.body, 'ChatTab parses as a function with a body');

const directHookCalls: ts.CallExpression[] = [];
const directReturns: ts.ReturnStatement[] = [];
function visitChatTab(node: ts.Node): void {
  if (node !== chatTabFunction && ts.isFunctionLike(node)) return;
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && /^use[A-Z]/.test(node.expression.text)
  ) {
    directHookCalls.push(node);
  }
  if (ts.isReturnStatement(node)) directReturns.push(node);
  ts.forEachChild(node, visitChatTab);
}
visitChatTab(chatTabFunction.body);
assert(directHookCalls.length > 0, 'ChatTab has a parsed component-level hook sequence');
const lastHookPosition = Math.max(...directHookCalls.map((call) => call.getStart(parsed)));
assert.equal(
  directReturns.filter((statement) => statement.getStart(parsed) < lastHookPosition).length,
  0,
  'ChatTab has no component-level early return before its final hook',
);

console.log('Chat file permission demand smoke passed');
