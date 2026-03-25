import { supabase } from './supabase';

export interface McpServerRecord {
  id: string;
  circle_id: string;
  name: string;
  url: string;
  type: 'sse' | 'http';
  status: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
  serverId: string;
}

/**
 * Lists all MCP servers for a circle
 */
export async function listMcpServers(circleId: string): Promise<McpServerRecord[]> {
  const { data, error } = await supabase
    .from('circle_mcp_servers')
    .select('*')
    .eq('circle_id', circleId)
    .eq('status', 'active');

  if (error) {
    console.error('Error fetching MCP servers:', error);
    return [];
  }

  return data || [];
}

/**
 * Fetches all available tools from all active MCP servers in a circle
 */
export async function fetchAllMcpTools(circleId: string): Promise<McpTool[]> {
  const servers = await listMcpServers(circleId);
  const allTools: McpTool[] = [];

  for (const server of servers) {
    try {
      // Note: This only supports MCP-over-HTTP for now
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-tools',
          method: 'tools/list',
          params: {}
        }),
      });

      const data = await response.json();
      if (data.result && data.result.tools) {
        const toolsWithServer = data.result.tools.map((t: any) => ({
          ...t,
          serverId: server.id
        }));
        allTools.push(...toolsWithServer);
      }
    } catch (e) {
      console.error(`Failed to fetch tools from MCP server ${server.name}:`, e);
    }
  }

  return allTools;
}

/**
 * Invokes a tool on a specific external MCP server
 */
export async function callMcpTool(serverId: string, toolName: string, args: any): Promise<any> {
  const { data: server, error } = await supabase
    .from('circle_mcp_servers')
    .select('*')
    .eq('id', serverId)
    .single();

  if (error || !server) throw new Error('MCP Server not found');

  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-tool',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'MCP Tool execution failed');
    return data.result;
  } catch (e: any) {
    console.error(`Failed to call MCP tool ${toolName}:`, e);
    throw e;
  }
}
