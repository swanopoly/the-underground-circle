import type { ConnectorAdapter } from '../types';
import { providerGraphql } from '../graphqlClient';

const LINEAR_GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';

interface LinearViewerResponse {
  viewer: {
    id: string;
    name: string;
    email: string;
  };
}

function linearToken(secrets: Record<string, string>): string | null {
  return secrets.access_token || secrets.api_key || secrets.token || null;
}

export const linearConnector: ConnectorAdapter = {
  providerId: 'linear',

  async test(secrets) {
    const token = linearToken(secrets);
    if (!token) return { ok: false, error: 'Missing Linear access token.' };

    const res = await providerGraphql<LinearViewerResponse>({
      endpoint: LINEAR_GRAPHQL_ENDPOINT,
      token,
      query: `query Viewer { viewer { id name email } }`,
    });

    if (res.error || !res.data?.viewer?.id) {
      return { ok: false, error: res.error || 'Linear GraphQL viewer query returned no user.' };
    }
    return { ok: true };
  },

  listActions() {
    return [
      {
        id: 'list_issues',
        label: 'List issues',
        description: 'Query Linear issues, projects, cycles, assignees, and labels for planning context.',
      },
      {
        id: 'create_issue',
        label: 'Create issue',
        description: 'Create a Linear issue from a mission, agent run, chat request, or GitHub event.',
      },
      {
        id: 'comment_on_issue',
        label: 'Comment on issue',
        description: 'Add progress updates, run summaries, or approval notes to an existing Linear issue.',
      },
    ];
  },
};
