import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SwanBotStructuredArtifact } from '../../lib/swanbot';
import { buildCodingWorkbenchLines, getCodingWorkbenchMetrics, getCodingWorkbenchPhase, inferCodingWorkbenchFileName } from '../../lib/codingWorkbench';

type BuildStudioView = 'code' | 'preview';

type ChatBuildStudioProps = {
  accentColor: string;
  selectedModel: string;
  currentRunStep?: string;
  prompt?: string | null;
  tick?: number;
  artifact?: SwanBotStructuredArtifact | null;
  view: BuildStudioView;
  onViewChange: (view: BuildStudioView) => void;
};

function inferFileName(artifact: SwanBotStructuredArtifact): string {
  const explicit = typeof artifact.metadata?.fileName === 'string' ? artifact.metadata.fileName.trim() : '';
  if (explicit) return explicit;
  if (artifact.kind === 'webpage') return 'index.html';
  const language = String(artifact.metadata?.language || '').toLowerCase();
  if (language.includes('tsx') || language.includes('react')) return 'OpenSwanPanel.tsx';
  if (language.includes('typescript') || language === 'ts') return 'agent-runtime.ts';
  if (language.includes('javascript') || language === 'js') return 'agent-runtime.js';
  if (language.includes('css')) return 'styles.css';
  if (language.includes('json')) return 'config.json';
  return `${(artifact.title || 'generated-file').replace(/\s+/g, '-').toLowerCase() || 'generated-file'}.txt`;
}

function renderCodeLines(content: string) {
  return content.slice(0, 12000).split('\n').map((line, index) => (
    <View key={`${index}-${line}`} style={styles.codeRow}>
      <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
      <Text style={styles.codeLine}>{line || ' '}</Text>
    </View>
  ));
}

export default function ChatBuildStudio({
  accentColor,
  selectedModel,
  currentRunStep,
  prompt,
  tick = 0,
  artifact,
  view,
  onViewChange,
}: ChatBuildStudioProps) {
  const canPreview = Platform.OS === 'web' && artifact?.kind === 'webpage' && !!artifact.content;
  const fileName = prompt ? inferCodingWorkbenchFileName(prompt) : 'generated-file.tsx';
  const liveLines = buildCodingWorkbenchLines(prompt || '', tick);
  const livePhase = getCodingWorkbenchPhase(tick);
  const liveMetrics = getCodingWorkbenchMetrics(tick);

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          <Pressable
            onPress={() => onViewChange('code')}
            style={[styles.tab, view === 'code' && { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}18` }]}
          >
            <Text style={[styles.tabText, view === 'code' && { color: accentColor }]}>CODE</Text>
          </Pressable>
          <Pressable
            onPress={() => canPreview && onViewChange('preview')}
            style={[
              styles.tab,
              view === 'preview' && canPreview && { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}18` },
              !canPreview && styles.tabDisabled,
            ]}
          >
            <Text style={[styles.tabText, view === 'preview' && canPreview && { color: accentColor }, !canPreview && styles.tabTextDisabled]}>
              PREVIEW
            </Text>
          </Pressable>
        </View>
      </View>

      {view === 'preview' && canPreview ? (
        <View style={styles.previewShell}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewFile}>{inferFileName(artifact!)}</Text>
            <Text style={[styles.previewModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          <View style={styles.previewFrame}>
            <iframe
              srcDoc={artifact!.content || ''}
              style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#ffffff' } as any}
              sandbox="allow-scripts allow-same-origin"
              title={artifact!.title || 'OpenSwan Preview'}
            />
          </View>
        </View>
      ) : artifact?.content ? (
        <View style={styles.codeShell}>
          <View style={styles.codeHeader}>
            <Text style={styles.codeFile}>{inferFileName(artifact)}</Text>
            <Text style={[styles.codeModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          <ScrollView style={styles.codeScroll} contentContainerStyle={styles.codeScrollContent}>
            {renderCodeLines(artifact.content)}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.liveShell}>
          <View style={styles.liveHeader}>
            <Text style={styles.liveFile}>{fileName}</Text>
            <Text style={[styles.liveModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          <View style={styles.livePhaseRow}>
            <Text style={[styles.livePhaseBadge, { color: accentColor, borderColor: `${accentColor}40` }]}>{livePhase}</Text>
            <Text style={styles.liveMetric}>+{liveMetrics.xp} BUILD XP</Text>
            <Text style={styles.liveMetric}>{liveMetrics.files} FILES</Text>
            <Text style={styles.liveMetric}>{liveMetrics.passes} PASSES</Text>
          </View>
          <ScrollView style={styles.liveBody} contentContainerStyle={styles.liveBodyContent}>
            {liveLines.map((line, index) => (
              <View key={`${index}-${line}`} style={styles.codeRow}>
                <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.codeLine}>{line || ' '}</Text>
              </View>
            ))}
            <View style={styles.codeRow}>
              <Text style={styles.codeLineNo}>{String(liveLines.length + 1).padStart(2, '0')}</Text>
              <View style={[styles.cursor, { backgroundColor: accentColor }]} />
            </View>
          </ScrollView>
          <View style={styles.liveFooter}>
            <Text style={styles.liveFooterText}>{currentRunStep || 'OpenSwan is building live...'}</Text>
            <Text style={[styles.liveFooterText, { color: accentColor }]}>BUILD STREAM</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 0,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    borderWidth: 1,
    borderColor: '#243246',
    backgroundColor: '#0a1018',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tabDisabled: {
    opacity: 0.45,
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  tabTextDisabled: {
    color: '#475569',
  },
  previewShell: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: '#152032',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#05070b',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b0f17',
    borderBottomWidth: 1,
    borderBottomColor: '#152032',
  },
  previewFile: {
    color: '#d8e1ef',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    flex: 1,
  },
  previewModel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  previewFrame: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#ffffff',
  },
  liveShell: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: '#152032',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#05070b',
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b0f17',
    borderBottomWidth: 1,
    borderBottomColor: '#152032',
  },
  liveFile: {
    color: '#d8e1ef',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    flex: 1,
  },
  liveModel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  livePhaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#07101c',
    borderBottomWidth: 1,
    borderBottomColor: '#101827',
    flexWrap: 'wrap',
  },
  livePhaseBadge: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#09111f',
  },
  liveMetric: {
    color: '#7f8ea3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  liveBody: {
    flex: 1,
    minHeight: 0,
  },
  liveBodyContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  codeShell: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: '#152032',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#05070b',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b0f17',
    borderBottomWidth: 1,
    borderBottomColor: '#152032',
  },
  codeFile: {
    color: '#d8e1ef',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    flex: 1,
  },
  codeModel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  codeScroll: {
    flex: 1,
    minHeight: 0,
  },
  codeScrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  codeLineNo: {
    width: 32,
    color: '#425066',
    fontSize: 10,
    textAlign: 'right',
    fontFamily: 'monospace',
    paddingTop: 2,
  },
  codeLine: {
    color: '#d8e1ef',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
    flex: 1,
  },
  cursor: { width: 8, height: 16, borderRadius: 2 },
  liveFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#152032',
    backgroundColor: '#07101c',
  },
  liveFooterText: {
    color: '#7f8ea3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    fontFamily: 'monospace',
  },
});
