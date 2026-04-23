import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { getMatchingChatSlashCommands, type ChatSlashCommand } from './chatSlashCommands';
import {
  canSubmitChatComposerInput,
  getChatComposerSlashToken,
  getSelectedChatSlashCommand,
  resolveWebComposerKeyAction,
  resolveWebComposerTextAction,
  shouldShowChatComposerSlashCommands,
} from './chatComposerController';

type UseChatComposerControllerParams = {
  input: string;
  focused: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onApplySlashCommand: (command: ChatSlashCommand) => void;
};

export function useChatComposerController({
  input,
  focused,
  onInputChange,
  onSend,
  onApplySlashCommand,
}: UseChatComposerControllerParams) {
  const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0);
  const slashCommands = useMemo(() => getMatchingChatSlashCommands(input), [input]);
  const slashToken = getChatComposerSlashToken(input);
  const showSlashCommands = shouldShowChatComposerSlashCommands({
    input,
    focused,
    commandCount: slashCommands.length,
  });

  useEffect(() => {
    setHighlightedSlashIndex(0);
  }, [slashToken, slashCommands.length]);

  const handleComposerInputChange = useCallback((nextValue: string) => {
    if (Platform.OS === 'web') {
      const webAction = resolveWebComposerTextAction(input, nextValue);
      if (webAction === 'submit') {
        if (showSlashCommands) {
          const selected = getSelectedChatSlashCommand(slashCommands, highlightedSlashIndex);
          if (selected) {
            setHighlightedSlashIndex(0);
            onApplySlashCommand(selected);
            return;
          }
        }
        onSend();
        return;
      }
      if (webAction === 'unchanged') {
        onInputChange(input);
        return;
      }
    }
    onInputChange(nextValue);
  }, [highlightedSlashIndex, input, onApplySlashCommand, onInputChange, onSend, showSlashCommands, slashCommands]);

  const handleComposerKeyPress = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    const webAction = resolveWebComposerKeyAction({
      key: e.nativeEvent?.key,
      shiftKey: e.nativeEvent?.shiftKey,
      showSlashCommands,
    });
    if (webAction === 'navigate_down') {
      e.preventDefault?.();
      setHighlightedSlashIndex((prev: number) => (prev + 1) % slashCommands.length);
      return;
    }
    if (webAction === 'navigate_up') {
      e.preventDefault?.();
      setHighlightedSlashIndex((prev: number) => (prev - 1 + slashCommands.length) % slashCommands.length);
      return;
    }
    if (webAction === 'select_slash') {
      e.preventDefault?.();
      const selected = getSelectedChatSlashCommand(slashCommands, highlightedSlashIndex);
      if (selected) {
        setHighlightedSlashIndex(0);
        onApplySlashCommand(selected);
        return;
      }
    }
    if (webAction === 'submit') {
      e.preventDefault?.();
      if (canSubmitChatComposerInput(input)) {
        onSend();
      }
    }
  }, [highlightedSlashIndex, input, onApplySlashCommand, onSend, showSlashCommands, slashCommands]);

  const selectedSlashCommand = useMemo(
    () => getSelectedChatSlashCommand(slashCommands, highlightedSlashIndex),
    [highlightedSlashIndex, slashCommands],
  );

  return {
    highlightedSlashIndex,
    setHighlightedSlashIndex,
    slashCommands,
    slashToken,
    showSlashCommands,
    selectedSlashCommand,
    handleComposerInputChange,
    handleComposerKeyPress,
  };
}
