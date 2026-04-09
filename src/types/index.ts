export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  current_streak: number;
  longest_streak: number;
  created_at: string;
  wallet_address?: string;
  wallet_chain?: 'ethereum' | 'solana';
  xp?: number;
  level?: number;
  title?: string;
  // New customization fields
  theme_color?: string;
  banner_url?: string;
  status_message?: string;
  linked_accounts?: Record<string, any>;
  pinned_achievements?: string[];
}

export interface Circle {
  id: string;
  name: string;
  description?: string;
  invite_code: string;
  max_members: number;
  created_by: string;
  created_at: string;
  member_count?: number;
  circle_type?: string;
  icon?: string;
  accent_color?: string;
  check_in_format?: CheckInFormat;
  tags?: string[];
  vibe?: string;
  rules?: string[];
  circle_image_url?: string;
  verification_badges?: string[];
  org_id?: string;
  settings?: {
    sessionMemoryMode?: 'private' | 'shared';
    [key: string]: any;
  };
}

export interface CheckInFormat {
  type: 'photo' | 'number' | 'text' | 'yesno' | 'rating';
  label?: string;
  unit?: string; // For number type (steps, pages, dollars, etc.)
  min?: number; // For rating type
  max?: number; // For rating type
}

export interface CircleTemplate {
  id: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  accent_color: string;
  suggested_names: string[];
  check_in_format: CheckInFormat;
  tags: string[];
}

export interface CircleMember {
  id: string;
  circle_id: string;
  user_id: string;
  role: 'creator' | 'member';
  joined_at: string;
  user?: User;
}

export interface CheckIn {
  id: string;
  user_id: string;
  circle_id: string;
  content: string;
  created_at: string;
  vote_count?: number;
  user?: User;
}

export interface UserXP {
  id: string;
  total_xp: number;
  level: number;
  title: string;
  grind_karma: number;
  social_karma: number;
  updated_at: string;
}

export interface XPEvent {
  id: string;
  user_id: string;
  event_type: string;
  xp_amount: number;
  metadata: Record<string, any>;
  created_at: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  xp_reward: number;
  category: string;
  requirement: Record<string, any>;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
  achievement?: Achievement;
}

export interface Challenge {
  id: string;
  circle_id: string;
  title: string;
  description: string;
  challenge_type: 'streak' | 'checkins' | 'tasks' | 'xp';
  target_value: number;
  start_date: string;
  end_date: string;
  created_by: string;
  status: 'active' | 'completed';
  xp_reward: number;
  created_at: string;
}

export interface ChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;
  progress: number;
  completed: boolean;
  completed_at: string | null;
  user?: User;
}

export interface Vote {
  id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  vote: number;
  created_at: string;
}

export interface AgentBot {
  id: string;
  owner_id: string;
  name: string;
  avatar_url?: string;
  api_endpoint: string;
  api_key_hash: string;
  type: 'chatbot' | 'assistant' | 'integration' | 'custom';
  description?: string;
  is_active: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'declined';
  message?: string;
  created_at: string;
  updated_at: string;
  sender?: User;
  receiver?: User;
}

export interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  since: string;
  user?: User;
  friend?: User;
}

export interface Integration {
  id: string;
  user_id: string;
  platform: 'discord' | 'twitter' | 'github' | 'spotify' | 'fitbit' | 'strava' | 'other';
  platform_user_id: string;
  platform_username?: string;
  access_token_encrypted: string;
  refresh_token_encrypted?: string;
  metadata?: Record<string, any>;
  is_active: boolean;
  connected_at: string;
  last_sync?: string;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'system';
  is_read: boolean;
  created_at: string;
  updated_at: string;
  sender?: User;
  receiver?: User;
}

// ─── Wallet & Crypto Types ──────────────────────────────────────────────

export type Chain = 'solana' | 'ethereum' | 'polygon' | 'base';

export interface ChainConfig {
  id: Chain;
  name: string;
  symbol: string;
  icon: string;
  color: string;
  rpcUrl: string;
  explorerUrl: string;
  chainId?: number; // For EVM chains
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chain: Chain;
  balance?: string;
  usdValue?: number;
  change24h?: number;
  raw?: number;
  isNative?: boolean;
}

export interface NFT {
  mint: string;
  name: string;
  image?: string;
  collection?: string;
  traits?: Array<{ trait_type: string; value: string }>;
  chain: Chain;
  tokenId?: string;
  contractAddress?: string;
  floorPrice?: number;
  lastSale?: number;
}

export interface Transaction {
  hash: string;
  type: 'send' | 'receive' | 'swap' | 'stake' | 'unstake' | 'mint' | 'burn' | 'approve';
  amount: string;
  token: Token;
  from: string;
  to: string;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
  chain: Chain;
  fee?: string;
  blockNumber?: number;
  confirmations?: number;
}

export interface SwapQuote {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: Array<{ protocol: string; percentage: number }>;
  estimatedGas?: string;
  minimumReceived?: string;
}

export interface StakeAccount {
  validator: string;
  validatorName?: string;
  amount: string;
  rewards: string;
  status: 'active' | 'inactive' | 'deactivating';
  apy?: number;
  activationEpoch?: number;
  deactivationEpoch?: number;
}

export interface PriceData {
  current: number;
  change24h: number;
  change7d?: number;
  marketCap?: number;
  volume24h?: number;
  lastUpdated: string;
}

export interface Portfolio {
  totalValue: number;
  change24h: number;
  tokens: Token[];
  nfts: NFT[];
  lastUpdated: string;
}

export interface GasEstimate {
  low: string;
  medium: string;
  high: string;
  unit: string; // 'gwei' for ETH, 'lamports' for SOL
}

// ─── Photon Proof Types ────────────────────────────────────────────────

// ─── DAO Governance Types ────────────────────────────────────────────

export type ProposalType = 'general' | 'rule_change' | 'spending' | 'challenge' | 'member_action' | 'poll';
export type ProposalStatus = 'active' | 'passed' | 'failed' | 'expired';

export interface Proposal {
  id: string;
  circle_id: string;
  created_by: string;
  title: string;
  description?: string;
  proposal_type: ProposalType;
  status: ProposalStatus;
  options: { label: string }[];
  quorum_pct: number;
  pass_pct: number;
  expires_at?: string;
  resolved_at?: string;
  metadata?: Record<string, any>;
  created_at: string;
  // Joined
  creator?: User;
  votes?: ProposalVote[];
  vote_summary?: VoteSummary;
}

export interface ProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote: string; // 'yes' | 'no' | 'abstain' | option index
  created_at: string;
  user?: User;
}

export interface VoteSummary {
  total: number;
  yes: number;
  no: number;
  abstain: number;
  options: Record<string, number>; // for polls: { "0": 3, "1": 5 }
  quorum_met: boolean;
  passed: boolean;
  member_count: number;
}

export interface PinnedMessage {
  id: string;
  circle_id: string;
  message_id: string;
  pinned_by: string;
  created_at: string;
  message_content?: string;
  pinned_by_name?: string;
}

export interface PhotonProof {
  id: string;
  user_id: string;
  circle_id: string;
  timestamp: string;
  photo_url: string;
  light_level: number;
  verified: boolean;
  streak: number;
  latitude?: number;
  longitude?: number;
  created_at: string;
}

// ─── Organization Types ──────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  created_by: string;
  plan: 'free' | 'pro' | 'business' | 'enterprise';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';
  seat_count: number;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
  member_count?: number;
  circle_count?: number;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  invited_by?: string;
  joined_at: string;
  user?: User;
}

export interface OrgFeatures {
  org_id: string;
  max_circles: number;
  max_members_per_circle: number;
  analytics_enabled: boolean;
  slack_enabled: boolean;
  teams_enabled: boolean;
  sso_enabled: boolean;
  export_enabled: boolean;
  whitelabel_enabled: boolean;
  custom_branding: boolean;
  goal_alignment: boolean;
}

export interface CircleInvite {
  id: string;
  circle_id: string;
  org_id?: string;
  invited_by: string;
  invite_type: 'link' | 'email';
  invite_code: string;
  email?: string;
  role: 'member' | 'admin';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  max_uses: number;
  use_count: number;
  expires_at?: string;
  created_at: string;
}

export interface CircleAnalytics {
  circle_id: string;
  date: string;
  active_members: number;
  total_check_ins: number;
  total_messages: number;
  avg_streak: number;
  agent_cost_total: number;
  agent_tokens_total: number;
  tasks_completed: number;
  tasks_created: number;
}

export interface MemberEngagement {
  user_id: string;
  username: string;
  display_name: string;
  check_ins: number;
  messages: number;
  tasks_completed: number;
  current_streak: number;
  last_active: string;
}

// ─── Goal Alignment Types ─────────────────────────────────────────────

export type GoalType = 'north_star' | 'okr_objective' | 'key_result' | 'circle_goal';
export type GoalStatus = 'active' | 'completed' | 'paused' | 'abandoned';

export interface OrgGoal {
  id: string;
  org_id: string;
  parent_id?: string;
  goal_type: GoalType;
  title: string;
  description?: string;
  circle_id?: string;
  owner_id?: string;
  target_value?: number;
  current_value: number;
  unit?: string;
  status: GoalStatus;
  due_date?: string;
  created_at: string;
  updated_at: string;
  children?: OrgGoal[];
  owner?: User;
  circle?: Circle;
}

export interface GoalCheckInLink {
  id: string;
  goal_id: string;
  check_in_id: string;
  contributed_value: number;
  created_at: string;
}

// ─── Reporting Types ──────────────────────────────────────────────────

export interface Report {
  id: string;
  org_id: string;
  report_type: 'analytics' | 'goals' | 'engagement' | 'comprehensive';
  format: 'pdf' | 'csv';
  date_from: string;
  date_to: string;
  file_url?: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  created_by: string;
  created_at: string;
}

export interface ReportSchedule {
  id: string;
  org_id: string;
  report_type: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  next_run: string;
  is_active: boolean;
  created_at: string;
}

// ─── White-Label Types ────────────────────────────────────────────────

export interface WhiteLabelConfig {
  id: string;
  org_id: string;
  app_name: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color: string;
  accent_color: string;
  background_color: string;
  card_color: string;
  border_color: string;
  text_color: string;
  font_family: string;
  custom_domain?: string;
  hide_branding: boolean;
  custom_css?: string;
  login_message?: string;
  created_at: string;
  updated_at: string;
}
