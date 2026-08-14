/** Main-Chat MCP mutations fail closed until an exact durable adapter exists. */

import assert from 'node:assert/strict';
import { buildMcpAgentTools } from '../src/lib/mcpToolBridge';

async function main() {
  let approvalGateCalls = 0;
  let dispatchCalls = 0;
  const tools = buildMcpAgentTools({
    servers: [{ id: 'server-1', name: 'Project API', trusted: true }],
    tools: [{
      serverId: 'server-1',
      name: 'update_record',
      description: 'Updates a record.',
      inputSchema: { type: 'object', properties: {} },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    }],
    requireDurableMutationAuthority: true,
    approvalGate: async () => {
      approvalGateCalls += 1;
      return { decision: 'approve' };
    },
    callTool: async () => {
      dispatchCalls += 1;
      return { content: [{ type: 'text', text: 'updated' }] };
    },
  });
  assert.equal(tools.length, 1);
  const result = await tools[0]!.handler({ id: 'record-1' }, {
    session: {},
    toolName: tools[0]!.name,
    toolUseId: 'mcp-call-1',
    iteration: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(approvalGateCalls, 0, 'ephemeral approval callback is not treated as authority');
  assert.equal(dispatchCalls, 0, 'MCP mutation never reaches the server');
  assert.match(
    result.ok ? '' : result.error,
    /durable server\/tool\/arguments-bound MCP mutation receipt adapter/i,
  );
  assert.equal(
    result.metadata?.blocker,
    'mcp_durable_mutation_authority_unavailable',
  );

  console.log('openswan main-chat MCP mutation authority smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
