import type { ChatSlashCommand } from './chatSlashCommands';

export type WebComposerTextAction = 'unchanged' | 'none' | 'submit';
export type WebComposerKeyAction = 'none' | 'navigate_down' | 'navigate_up' | 'select_slash' | 'submit';

export function getChatComposerSlashToken(input: string): string {
  return input.trimStart().split(/\s+/, 1)[0] || '';
}

export function shouldShowChatComposerSlashCommands(params: {
  input: string;
  focused: boolean;
  commandCount: number;
}): boolean {
  const { input, focused, commandCount } = params;
  const slashToken = getChatComposerSlashToken(input);
  return focused && /^\/[^\s]*$/.test(slashToken) && commandCount > 0;
}

export function getSelectedChatSlashCommand<T extends ChatSlashCommand>(
  commands: T[],
  highlightedIndex: number,
): T | null {
  if (!Array.isArray(commands) || commands.length === 0) return null;
  return commands[highlightedIndex] || commands[0] || null;
}

export function canSubmitChatComposerInput(input: string): boolean {
  return input.trim().length > 0;
}

export function resolveWebComposerTextAction(
  previousValue: string,
  nextValue: string,
): WebComposerTextAction {
  if (nextValue === `${previousValue}\n`) {
    return canSubmitChatComposerInput(previousValue) ? 'submit' : 'unchanged';
  }
  return 'none';
}

export function resolveWebComposerKeyAction(params: {
  key: string | null | undefined;
  shiftKey?: boolean;
  showSlashCommands: boolean;
}): WebComposerKeyAction {
  const { key, shiftKey = false, showSlashCommands } = params;
  if (!key) return 'none';
  if (showSlashCommands) {
    if (key === 'ArrowDown') return 'navigate_down';
    if (key === 'ArrowUp') return 'navigate_up';
    if ((key === 'Enter' || key === 'Tab') && !shiftKey) return 'select_slash';
  }
  if (key === 'Enter' && !shiftKey) return 'submit';
  return 'none';
}
