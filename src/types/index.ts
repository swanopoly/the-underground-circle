export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  current_streak: number;
  longest_streak: number;
  created_at: string;
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
  user?: User;
}
