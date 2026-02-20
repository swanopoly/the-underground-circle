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
  verification_badges?: string[]; // Array of badge types: 'activity_verified', 'peer_validated', etc.
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
