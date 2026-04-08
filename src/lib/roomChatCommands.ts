/**
 * Room Chat Commands — allows the chat agent to interact with Room files
 * Supports listing rooms, browsing files, reading/editing/creating files
 */

import { supabase } from './supabase';

export interface RoomChatContext {
  circleId: string;
  userId: string;
  roomId?: string; // if set, commands target this room
  surface?: 'main_chat' | 'room_chat'; // restricts destructive ops from main chat
}

export interface RoomCommandResult {
  success: boolean;
  message: string;
  data?: any;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function listRooms(circleId: string): Promise<{ id: string; name: string; status: string; file_count: number }[]> {
  const { data } = await supabase
    .from('project_rooms')
    .select('id, name, status')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });
  if (!data) return [];

  // Get file counts
  const rooms = [];
  for (const room of data) {
    const { count } = await supabase
      .from('room_files')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id);
    rooms.push({ ...room, file_count: count || 0 });
  }
  return rooms;
}

async function findRoom(circleId: string, nameOrId: string): Promise<{ id: string; name: string } | null> {
  // Try by ID first
  const { data: byId } = await supabase
    .from('project_rooms')
    .select('id, name')
    .eq('id', nameOrId)
    .eq('circle_id', circleId)
    .maybeSingle();
  if (byId) return byId;

  // Try by name (case-insensitive)
  const { data: byName } = await supabase
    .from('project_rooms')
    .select('id, name')
    .eq('circle_id', circleId)
    .ilike('name', nameOrId)
    .maybeSingle();
  if (byName) return byName;

  // Try partial match
  const { data: partial } = await supabase
    .from('project_rooms')
    .select('id, name')
    .eq('circle_id', circleId)
    .ilike('name', `%${nameOrId}%`)
    .limit(1);
  return partial?.[0] || null;
}

async function getDefaultRoom(circleId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('project_rooms')
    .select('id, name')
    .eq('circle_id', circleId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function listFiles(roomId: string): Promise<{ id: string; name: string; language: string; size_bytes: number }[]> {
  const { data } = await supabase
    .from('room_files')
    .select('id, name, language, size_bytes')
    .eq('room_id', roomId)
    .order('name');
  return data || [];
}

async function readFile(roomId: string, fileName: string): Promise<{ id: string; name: string; content: string; language: string } | null> {
  const { data } = await supabase
    .from('room_files')
    .select('id, name, content, language')
    .eq('room_id', roomId)
    .ilike('name', fileName)
    .maybeSingle();
  if (data) return data;

  // Partial match
  const { data: partial } = await supabase
    .from('room_files')
    .select('id, name, content, language')
    .eq('room_id', roomId)
    .ilike('name', `%${fileName}%`)
    .limit(1);
  return partial?.[0] || null;
}

async function createFile(roomId: string, name: string, content: string, language: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('room_files')
    .insert({ room_id: roomId, name, content, language, size_bytes: new Blob([content]).size })
    .select('id')
    .single();
  if (error) { console.error('[roomChatCommands] create file error:', error.message); return null; }
  return data;
}

async function updateFile(fileId: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from('room_files')
    .update({ content, size_bytes: new Blob([content]).size, updated_at: new Date().toISOString() })
    .eq('id', fileId);
  if (error) { console.error('[roomChatCommands] update file error:', error.message); return false; }
  return true;
}

async function deleteFile(fileId: string): Promise<boolean> {
  const { error } = await supabase
    .from('room_files')
    .delete()
    .eq('id', fileId);
  return !error;
}

// ─── Language detection ──────────────────────────────────────────────────────

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    css: 'css', html: 'html', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    sql: 'sql', sh: 'shell', bash: 'shell', txt: 'text', toml: 'toml',
  };
  return map[ext] || 'text';
}

// ─── Main Command Parser ────────────────────────────────────────────────────

export async function executeRoomCommand(
  input: string,
  context: RoomChatContext,
): Promise<RoomCommandResult> {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Strip /room prefix
  const cmd = lower.startsWith('/room ')
    ? trimmed.slice(6).trim()
    : lower.startsWith('/room')
    ? trimmed.slice(5).trim()
    : trimmed;
  const cmdLower = cmd.toLowerCase();

  // /room help
  if (cmdLower === 'help' || cmdLower === '') {
    return {
      success: true,
      message: `**Room Commands**

| Command | Description |
|---------|-------------|
| \`/room list\` | List all rooms in this circle |
| \`/room files [room]\` | List files in a room |
| \`/room cat <file>\` | Show file contents |
| \`/room create <file> <content>\` | Create a new file |
| \`/room edit <file> <content>\` | Update a file's content |
| \`/room delete <file>\` | Delete a file |
| \`/room help\` | Show this help |

If no room is specified, the most recently updated room is used.`,
    };
  }

  // /room list
  if (cmdLower === 'list' || cmdLower === 'rooms' || cmdLower === 'ls') {
    try {
      const rooms = await listRooms(context.circleId);
      if (rooms.length === 0) return { success: true, message: 'No rooms found in this circle.' };
      const lines = rooms.map(r => `- **${r.name}** (${r.status}) — ${r.file_count} files`);
      return { success: true, message: `**Rooms (${rooms.length})**\n\n${lines.join('\n')}` };
    } catch (e: any) {
      return { success: false, message: `Error listing rooms: ${e.message}` };
    }
  }

  // Resolve target room
  let roomId = context.roomId;
  let roomName = '';

  if (!roomId) {
    const defaultRoom = await getDefaultRoom(context.circleId);
    if (defaultRoom) {
      roomId = defaultRoom.id;
      roomName = defaultRoom.name;
    }
  }

  // /room files [roomName]
  if (cmdLower.startsWith('files')) {
    const roomArg = cmd.slice(5).trim();
    if (roomArg) {
      const found = await findRoom(context.circleId, roomArg);
      if (found) { roomId = found.id; roomName = found.name; }
      else return { success: false, message: `Room "${roomArg}" not found.` };
    }
    if (!roomId) return { success: false, message: 'No rooms found. Create one in the Rooms tab first.' };

    try {
      const files = await listFiles(roomId);
      if (files.length === 0) return { success: true, message: `**${roomName || 'Room'}** — No files yet.` };
      const lines = files.map(f => {
        const size = f.size_bytes > 1024 ? `${(f.size_bytes / 1024).toFixed(1)}KB` : `${f.size_bytes}B`;
        return `- 📄 \`${f.name}\` (${f.language}, ${size})`;
      });
      return { success: true, message: `**${roomName || 'Room'}** — ${files.length} files\n\n${lines.join('\n')}` };
    } catch (e: any) {
      return { success: false, message: `Error listing files: ${e.message}` };
    }
  }

  // /room cat <fileName>
  if (cmdLower.startsWith('cat ') || cmdLower.startsWith('read ') || cmdLower.startsWith('show ')) {
    const fileName = cmd.split(/\s+/).slice(1).join(' ').trim();
    if (!fileName) return { success: false, message: 'Usage: `/room cat <filename>`' };
    if (!roomId) return { success: false, message: 'No rooms found.' };

    try {
      const file = await readFile(roomId, fileName);
      if (!file) return { success: false, message: `File "${fileName}" not found in ${roomName || 'room'}.` };
      const content = file.content.length > 3000 ? file.content.slice(0, 3000) + '\n\n... (truncated)' : file.content;
      return { success: true, message: `**${file.name}** (${file.language})\n\n\`\`\`${file.language}\n${content}\n\`\`\``, data: file };
    } catch (e: any) {
      return { success: false, message: `Error reading file: ${e.message}` };
    }
  }

  // ── Block destructive ops from main chat ──────────────────────────────────
  const isMainChat = context.surface === 'main_chat';
  const isDestructive = cmdLower.startsWith('create ') || cmdLower.startsWith('new ') || cmdLower.startsWith('touch ')
    || cmdLower.startsWith('edit ') || cmdLower.startsWith('update ') || cmdLower.startsWith('write ')
    || cmdLower.startsWith('delete ') || cmdLower.startsWith('rm ') || cmdLower.startsWith('remove ');

  if (isMainChat && isDestructive) {
    return {
      success: false,
      message: `File mutations are not available from the main chat. Open the **Rooms** tab to create, edit, or delete files.\n\nFrom here you can use:\n- \`/room list\` — list rooms\n- \`/room files\` — browse files\n- \`/room cat <file>\` — view file contents`,
    };
  }

  // /room create <fileName> <content> OR /room create <fileName>\n<content>
  if (cmdLower.startsWith('create ') || cmdLower.startsWith('new ') || cmdLower.startsWith('touch ')) {
    const rest = cmd.slice(cmd.indexOf(' ') + 1).trim();
    const newlineIdx = rest.indexOf('\n');
    let fileName: string;
    let content: string;
    if (newlineIdx > 0) {
      fileName = rest.slice(0, newlineIdx).trim();
      content = rest.slice(newlineIdx + 1);
    } else {
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx > 0) {
        fileName = rest.slice(0, spaceIdx).trim();
        content = rest.slice(spaceIdx + 1).trim();
      } else {
        fileName = rest;
        content = '';
      }
    }
    if (!fileName) return { success: false, message: 'Usage: `/room create <filename> <content>`' };
    if (!roomId) return { success: false, message: 'No rooms found.' };

    try {
      const language = detectLanguage(fileName);
      const result = await createFile(roomId, fileName, content, language);
      if (result) return { success: true, message: `Created **${fileName}** in ${roomName || 'room'}.` };
      return { success: false, message: `Failed to create ${fileName}.` };
    } catch (e: any) {
      return { success: false, message: `Error creating file: ${e.message}` };
    }
  }

  // /room edit <fileName> <newContent>
  if (cmdLower.startsWith('edit ') || cmdLower.startsWith('update ') || cmdLower.startsWith('write ')) {
    const rest = cmd.slice(cmd.indexOf(' ') + 1).trim();
    const newlineIdx = rest.indexOf('\n');
    let fileName: string;
    let content: string;
    if (newlineIdx > 0) {
      fileName = rest.slice(0, newlineIdx).trim();
      content = rest.slice(newlineIdx + 1);
    } else {
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx > 0) {
        fileName = rest.slice(0, spaceIdx).trim();
        content = rest.slice(spaceIdx + 1).trim();
      } else {
        return { success: false, message: 'Usage: `/room edit <filename> <new content>`' };
      }
    }
    if (!roomId) return { success: false, message: 'No rooms found.' };

    try {
      const file = await readFile(roomId, fileName);
      if (!file) return { success: false, message: `File "${fileName}" not found. Use \`/room create\` to make a new file.` };
      const ok = await updateFile(file.id, content);
      if (ok) {
        // Show what changed
        const oldLines = (file.content || '').split('\n').length;
        const newLines = content.split('\n').length;
        const preview = content.length > 500 ? content.slice(0, 500) + '\n...' : content;
        return { success: true, message: `Updated **${file.name}** in ${roomName || 'room'}.\n\n${oldLines} lines -> ${newLines} lines\n\n\`\`\`${file.language || 'text'}\n${preview}\n\`\`\`` };
      }
      return { success: false, message: `Failed to update ${fileName}.` };
    } catch (e: any) {
      return { success: false, message: `Error updating file: ${e.message}` };
    }
  }

  // /room delete <fileName>
  if (cmdLower.startsWith('delete ') || cmdLower.startsWith('rm ') || cmdLower.startsWith('remove ')) {
    const fileName = cmd.split(/\s+/).slice(1).join(' ').trim();
    if (!fileName) return { success: false, message: 'Usage: `/room delete <filename>`' };
    if (!roomId) return { success: false, message: 'No rooms found.' };

    try {
      const file = await readFile(roomId, fileName);
      if (!file) return { success: false, message: `File "${fileName}" not found.` };
      // Use --confirm flag to actually delete, otherwise just preview
      if (cmdLower.includes('--confirm') || cmdLower.includes('-y')) {
        const ok = await deleteFile(file.id);
        if (ok) return { success: true, message: `Deleted **${file.name}** from ${roomName || 'room'}.` };
        return { success: false, message: `Failed to delete ${fileName}.` };
      }
      const lines = (file.content || '').split('\n').length;
      return {
        success: true,
        message: `**Delete ${file.name}?** (${lines} lines, ${file.language || 'text'})\n\nThis will permanently remove the file. To confirm, run:\n\`/room delete ${file.name} --confirm\``,
      };
    } catch (e: any) {
      return { success: false, message: `Error deleting file: ${e.message}` };
    }
  }

  // Not a room command
  return { success: false, message: '' };
}
