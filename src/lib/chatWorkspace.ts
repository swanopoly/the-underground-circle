import type { SwanBotStructuredArtifact } from './swanbot';
import { createFile, createRoom, sendAgentMessage } from '../screens/circles/tabs/rooms/roomRepository';

type WorkspaceFile = {
  name: string;
  content: string;
  fileType: string;
};

export type WorkspaceCreationResult = {
  roomId: string | null;
  roomName: string;
  fileCount: number;
  primaryFileId: string | null;
};

export type RoomArtifactApplyResult = {
  roomId: string;
  fileCount: number;
  primaryFileId: string | null;
  primaryFileName: string | null;
};

function slugifyLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';
}

function inferCodeFileName(artifact: SwanBotStructuredArtifact): string {
  const metaName = typeof artifact.metadata?.fileName === 'string' ? artifact.metadata.fileName : '';
  if (metaName.trim()) return metaName.trim();

  const language = String(artifact.metadata?.language || '').toLowerCase();
  const base = slugifyLabel(artifact.title || 'generated-file');
  if (language.includes('html')) return `${base}.html`;
  if (language.includes('typescript') || language === 'ts' || language === 'tsx') return `${base}.${language === 'tsx' ? 'tsx' : 'ts'}`;
  if (language.includes('javascript') || language === 'js' || language === 'jsx') return `${base}.${language === 'jsx' ? 'jsx' : 'js'}`;
  if (language.includes('json')) return `${base}.json`;
  if (language.includes('css')) return `${base}.css`;
  if (language.includes('markdown') || language === 'md') return `${base}.md`;
  if (language.includes('python') || language === 'py') return `${base}.py`;
  if (language.includes('sql')) return `${base}.sql`;
  if (language.includes('yaml') || language === 'yml') return `${base}.yml`;
  return `${base}.txt`;
}

function buildWorkspaceFiles(artifact: SwanBotStructuredArtifact): WorkspaceFile[] {
  const content = artifact.content || '';
  if (artifact.kind === 'webpage') {
    return [
      { name: 'index.html', content, fileType: 'html' },
      {
        name: 'README.md',
        content: `# ${artifact.title || 'Web Preview'}\n\nGenerated from chat.\n\nOpen \`index.html\` in the room playground to preview and keep editing.`,
        fileType: 'markdown',
      },
    ];
  }

  if (artifact.kind === 'code') {
    const fileName = inferCodeFileName(artifact);
    const ext = fileName.split('.').pop()?.toLowerCase() || 'txt';
    const fileType =
      ext === 'html' ? 'html' :
      ext === 'js' || ext === 'jsx' ? 'javascript' :
      ext === 'ts' || ext === 'tsx' ? 'typescript' :
      ext === 'css' ? 'css' :
      ext === 'json' ? 'json' :
      ext === 'md' ? 'markdown' :
      ext === 'py' ? 'python' :
      ext === 'sql' ? 'sql' :
      ext === 'yml' || ext === 'yaml' ? 'yaml' :
      'plaintext';

    return [
      { name: fileName, content, fileType },
      {
        name: 'README.md',
        content: `# ${artifact.title || 'Code Workspace'}\n\nGenerated from chat.\n\nFiles in this room were created from a chat artifact so you can keep iterating in a room sandbox.`,
        fileType: 'markdown',
      },
    ];
  }

  return [
    {
      name: inferCodeFileName({ ...artifact, kind: 'code' }),
      content,
      fileType: 'plaintext',
    },
  ];
}

async function persistWorkspaceFiles(roomId: string, files: WorkspaceFile[]): Promise<RoomArtifactApplyResult> {
  let fileCount = 0;
  let primaryFileId: string | null = null;
  let primaryFileName: string | null = null;

  for (const file of files) {
    const created = await createFile(roomId, file.name, file.content, file.fileType);
    if (created) {
      fileCount += 1;
      if (!primaryFileId && file.fileType !== 'markdown') {
        primaryFileId = created;
        primaryFileName = file.name;
      }
    }
  }

  return { roomId, fileCount, primaryFileId, primaryFileName };
}

export async function createFilesInRoomFromArtifact(
  roomId: string,
  artifact: SwanBotStructuredArtifact,
): Promise<RoomArtifactApplyResult> {
  const files = buildWorkspaceFiles(artifact);
  const result = await persistWorkspaceFiles(roomId, files);

  await sendAgentMessage(
    roomId,
    'OpenSwan',
    `Generated files added to this room from artifact: **${artifact.title || 'Untitled'}**.`,
    {
      source: 'room_chat_artifact',
      artifactKind: artifact.kind,
      generatedFileCount: result.fileCount,
      primaryFileName: result.primaryFileName,
    },
  );

  return result;
}

export async function createWorkspaceFromArtifact(
  circleId: string,
  artifact: SwanBotStructuredArtifact,
): Promise<WorkspaceCreationResult> {
  const roomName = `${artifact.title?.trim() || 'Generated Workspace'}`.slice(0, 64);
  const roomId = await createRoom(circleId, roomName, 'Created from main chat artifact');
  if (!roomId) {
    return {
      roomId: null,
      roomName,
      fileCount: 0,
      primaryFileId: null,
    };
  }

  const persisted = await persistWorkspaceFiles(roomId, buildWorkspaceFiles(artifact));

  await sendAgentMessage(
    roomId,
    'OpenSwan',
    `Workspace created from chat artifact: **${artifact.title || 'Untitled'}**.\n\nFiles are ready for editing and sandbox preview in this room.`,
    { source: 'main_chat_artifact', artifactKind: artifact.kind, generatedFileCount: persisted.fileCount },
  );

  return {
    roomId,
    roomName,
    fileCount: persisted.fileCount,
    primaryFileId: persisted.primaryFileId,
  };
}
