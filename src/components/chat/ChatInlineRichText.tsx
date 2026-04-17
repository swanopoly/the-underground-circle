import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

type ChatInlineRichTextProps = {
  content: string;
  accentColor: string;
  textColor?: string;
};

export default function ChatInlineRichText({
  content,
  accentColor,
  textColor = '#ccc',
}: ChatInlineRichTextProps) {
  const parts = content.split(/(@\w+)/g);

  return (
    <Text style={[styles.base, { color: textColor }]}>
      {parts.map((part, index) => {
        if (part.startsWith('@')) {
          return (
            <Text key={`mention-${index}`} style={[styles.mention, { color: accentColor }]}>
              {part}
            </Text>
          );
        }

        const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
        return boldParts.map((boldPart, boldIndex) => {
          if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
            return (
              <Text key={`bold-${index}-${boldIndex}`} style={styles.bold}>
                {boldPart.slice(2, -2)}
              </Text>
            );
          }

          return <Text key={`text-${index}-${boldIndex}`}>{boldPart}</Text>;
        });
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 15,
    lineHeight: 22,
  },
  mention: {
    fontWeight: '700',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  bold: {
    fontWeight: '800',
    color: '#fff',
    ...(Platform.OS === 'web' ? { fontSynthesis: 'none' } as any : {}),
  },
});
