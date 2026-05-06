import { executeGraphql, type GraphqlRateLimit } from "./graphql.ts";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

export interface GitHubRepoGraphqlSummary {
  id: number;
  node_id: string;
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  private: boolean;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  size: number;
  fork: boolean;
  archived: boolean;
  open_issues_count: number;
  forks_count: number;
  open_pull_requests_count: number;
  pushed_at: string | null;
  url: string;
}

export interface GitHubRepoGraphqlList {
  repos: GitHubRepoGraphqlSummary[];
  github_username: string;
  rateLimit?: GraphqlRateLimit;
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
}

interface RepoNode {
  id: string;
  databaseId: number | null;
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  updatedAt: string;
  pushedAt: string | null;
  url: string;
  diskUsage: number | null;
  stargazerCount: number;
  forkCount: number;
  owner: { login: string; avatarUrl: string };
  defaultBranchRef: { name: string } | null;
  primaryLanguage: { name: string } | null;
  issues: { totalCount: number };
  pullRequests: { totalCount: number };
}

interface ViewerRepositoriesResponse {
  viewer: {
    login: string;
    repositories: {
      nodes: RepoNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  rateLimit?: GraphqlRateLimit;
}

const VIEWER_REPOSITORIES_QUERY = `
  query ViewerRepositories($first: Int!, $after: String) {
    viewer {
      login
      repositories(
        first: $first
        after: $after
        orderBy: { field: UPDATED_AT, direction: DESC }
        affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ) {
        nodes {
          id
          databaseId
          name
          nameWithOwner
          description
          isPrivate
          isFork
          isArchived
          updatedAt
          pushedAt
          url
          diskUsage
          stargazerCount
          forkCount
          owner {
            login
            avatarUrl
          }
          defaultBranchRef {
            name
          }
          primaryLanguage {
            name
          }
          issues(states: OPEN) {
            totalCount
          }
          pullRequests(states: OPEN) {
            totalCount
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    rateLimit {
      limit
      remaining
      used
      resetAt
      cost
    }
  }
`;

function mapRepo(node: RepoNode): GitHubRepoGraphqlSummary {
  return {
    id: node.databaseId || 0,
    node_id: node.id,
    full_name: node.nameWithOwner,
    name: node.name,
    owner: {
      login: node.owner.login,
      avatar_url: node.owner.avatarUrl,
    },
    description: node.description,
    private: node.isPrivate,
    default_branch: node.defaultBranchRef?.name || "main",
    language: node.primaryLanguage?.name || null,
    stargazers_count: node.stargazerCount,
    updated_at: node.updatedAt,
    size: node.diskUsage || 0,
    fork: node.isFork,
    archived: node.isArchived,
    open_issues_count: node.issues?.totalCount || 0,
    forks_count: node.forkCount,
    open_pull_requests_count: node.pullRequests?.totalCount || 0,
    pushed_at: node.pushedAt,
    url: node.url,
  };
}

export async function listGitHubReposGraphql(
  token: string,
  opts: { first?: number; after?: string | null } = {},
): Promise<{ data?: GitHubRepoGraphqlList; error?: string; status?: number }> {
  const first = Math.max(1, Math.min(100, opts.first || 100));
  const result = await executeGraphql<ViewerRepositoriesResponse>({
    endpoint: GITHUB_GRAPHQL_ENDPOINT,
    token,
    query: VIEWER_REPOSITORIES_QUERY,
    variables: { first, after: opts.after || null },
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (result.error || !result.data?.viewer) {
    return { error: result.error || "GitHub GraphQL returned no data.", status: result.status };
  }

  const repos = (result.data.viewer.repositories.nodes || []).map(mapRepo);
  return {
    data: {
      repos,
      github_username: result.data.viewer.login,
      rateLimit: result.data.rateLimit || result.rateLimit,
      pageInfo: result.data.viewer.repositories.pageInfo,
    },
    status: result.status,
  };
}
