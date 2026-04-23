import {
  CHAT_COMMAND_REGISTRY,
  buildChatCommandHelpMessage,
  getChatCommandCategoryLabel,
  getMatchingChatCommands,
  type ChatCommandDefinition,
  type ChatSlashCommandCategory,
} from './chatCommandRegistry';

export type { ChatSlashCommandCategory } from './chatCommandRegistry';

export interface ChatSlashCommand extends ChatCommandDefinition {}

export const CHAT_SLASH_COMMANDS: ChatSlashCommand[] = CHAT_COMMAND_REGISTRY;

export function getChatSlashCategoryLabel(category: ChatSlashCommandCategory): string {
  return getChatCommandCategoryLabel(category);
}

export function buildChatSlashHelpMessage(): string {
  return buildChatCommandHelpMessage();
}

export function getMatchingChatSlashCommands(input: string): ChatSlashCommand[] {
  return getMatchingChatCommands(input);
}
