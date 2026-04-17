import type { SessionCodingProfile } from './chatSessionProfile';
import { resolveSessionCodingProfile } from './chatSessionProfile';

export function isCodingGenerationRequest(content: string, sessionProfile: SessionCodingProfile): boolean {
  const lower = content.toLowerCase();
  const resolvedProfile = resolveSessionCodingProfile(sessionProfile, content, 'main_chat');
  if (
    /\b(show|open|reopen|close|hide|toggle|dock|undock|resize|move)\b.*\b(builder|preview|workbench)\b/.test(lower) ||
    /\b(builder|preview|workbench)\b.*\b(show|open|reopen|close|hide|toggle|dock|undock|resize|move)\b/.test(lower)
  ) {
    return false;
  }
  if (/\bfigma\b/.test(lower) && /\b(build|code|html|page|site|landing|convert)\b/.test(lower)) {
    return true;
  }
  if (resolvedProfile === 'senior' || resolvedProfile === 'architect' || resolvedProfile === 'debug') {
    if (/code|component|function|build|create|html|css|javascript|typescript|tsx|jsx|react|screen|page|fix|refactor|api|schema|sql|file/.test(lower)) {
      return true;
    }
  }
  return /\/code|\/build-page|generate code|write code|create a page|build a page|make a component|make a screen|fix this code|refactor this|html|tsx|jsx|typescript|javascript/.test(lower);
}

export function inferCodingWorkbenchFileName(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('html') || lower.includes('landing page') || lower.includes('webpage')) return 'index.html';
  if (lower.includes('css')) return 'styles.css';
  if (lower.includes('sql')) return 'query.sql';
  if (lower.includes('json')) return 'config.json';
  if (lower.includes('python')) return 'agent.py';
  if (lower.includes('tsx') || lower.includes('react') || lower.includes('screen') || lower.includes('component')) return 'OpenSwanPanel.tsx';
  if (lower.includes('ts') || lower.includes('typescript')) return 'agentRuntime.ts';
  if (lower.includes('jsx')) return 'OpenSwanPanel.jsx';
  if (lower.includes('js') || lower.includes('javascript')) return 'agent-runtime.js';
  return 'generated-file.tsx';
}

export function buildCodingWorkbenchLines(content: string, step: number): string[] {
  const fileName = inferCodingWorkbenchFileName(content);
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const stem = baseName.replace(/[^a-zA-Z0-9]/g, '') || 'OpenSwanPanel';
  const phases = [
    `import React from 'react';`,
    `import { View, Text } from 'react-native';`,
    ``,
    `type ${stem}Props = {`,
    `  prompt: string;`,
    `  mode: 'build' | 'review';`,
    `};`,
    ``,
    `export function ${stem}(props: ${stem}Props) {`,
    `  const status = 'building';`,
    `  const task = ${JSON.stringify(content.slice(0, 48) || 'OpenSwan task')};`,
    `  return (`,
    `    <View data-agent="openswan">`,
    `      <Text>{task}</Text>`,
    `      <Text>{status}</Text>`,
    `    </View>`,
    `  );`,
    `}`,
  ];
  const visible = 6 + (step % Math.max(6, phases.length - 4));
  return phases.slice(0, Math.min(phases.length, visible));
}

export function getCodingWorkbenchPhase(step: number): string {
  const phases = ['BOOTING CONTEXT', 'SCANNING FILES', 'WRITING TYPES', 'LINKING LOGIC', 'SHAPING UI', 'VERIFYING BUILD'];
  return phases[step % phases.length];
}

export function getCodingWorkbenchMetrics(step: number): { xp: number; files: number; passes: number } {
  return {
    xp: 18 + step * 7,
    files: 1 + (step % 4),
    passes: 1 + (step % 3),
  };
}
