import { isPersistedChatBotMessage, stripPersistedChatBotPrefix } from './chatAgentIdentity';

type ChatMessageShapeOptions = {
  currentUserId?: string | null;
  botDisplayName: string;
  fallbackUserName?: string;
  isBotFlag?: boolean;
};

export type ShapedChatMessageBase = {
  id: string;
  dbId?: string;
  content: string;
  isBot: boolean;
  isUser: boolean;
  userName: string;
  timestamp: Date;
};

export function shapePersistedChatMessage(row: any, options: ChatMessageShapeOptions): ShapedChatMessageBase {
  const isBot = isPersistedChatBotMessage(row?.content, options.isBotFlag ?? row?.is_bot === true);
  const fallbackUserName = options.fallbackUserName || 'Unknown';

  return {
    id: row.id,
    dbId: row.id,
    content: isBot ? stripPersistedChatBotPrefix(row?.content || '') : (row?.content || ''),
    isBot,
    isUser: row?.user_id === options.currentUserId && !isBot,
    userName: isBot
      ? options.botDisplayName
      : (row?.user?.display_name || row?.user?.username || fallbackUserName),
    timestamp: new Date(row?.created_at || Date.now()),
  };
}

export function deriveChatActivityFlags(content: string | null | undefined) {
  const normalized = (content || '').toLowerCase();
  return {
    isCheckIn: normalized.includes('checked in') || normalized.includes('streak'),
    isAchievement: normalized.includes('achievement') || normalized.includes('unlocked'),
  };
}
