/**
 * RoomsTab — MeshAgent-style collaborative workspaces
 *
 * Each Room is a mini-platform:
 *   • Multi-file tree (folders, drag-drop, upload, download)
 *   • Multi-tab editor / viewer
 *   • Real-time chat + agent task assignment
 *   • Room APIs panel: Storage · Database · Messaging · Queues · Secrets · Containers
 *   • Usage / observability log
 *   • File management (rename, delete, tag)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Modal, Platform, useWindowDimensions, ActivityIndicator,
  Image, Alert,
} from 'react-native';
import { supabase } from '../../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  circle_id: string;
  name: string;
  description: string | null;
  file_path: string | null;
  language: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

interface RoomFile {
  id: string;
  room_id: string;
  name: string;
  folder: string;
  file_type: string;
  content: string;
  storage_url: string | null;
  mime_type: string | null;
  size_bytes: number;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

interface RoomMessage {
  id: string;
  room_id: string;
  user_id: string | null;
  agent_name: string | null;
  content: string;
  message_type: 'chat' | 'agent_output' | 'edit_event' | 'system';
  metadata: any;
  created_at: string;
}

interface RoomSecret {
  id: string;
  room_id: string;
  key: string;
  value: string;
}

interface RoomService {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'webhook' | 'scheduled';
  status: 'running' | 'stopped' | 'error' | 'deploying';
  endpoint: string | null;
  description: string | null;
  created_at: string;
}

interface RoomTask {
  id: string;
  name: string;
  schedule: string;
  agent: string;
  prompt: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

interface StickyNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

interface LiveAgent {
  id: string;
  name: string;
  status: string;
  owner_id: string | null;
  owner_display_name: string | null;
  color: string | null;
  tool_icon: string | null;
  current_task: string | null;
  circle_id: string | null;
}

interface PlaygroundVariant {
  id: string;
  label: string;
  system: string;
  userMsg: string;
  model: string;
  temperature: number;
  maxTokens: number;
  outputSchema: string;
  toolDefs: string;
}

interface Props {
  circleId: string;
  accentColor: string;
}

// ─── Arrow Scroll View ───────────────────────────────────────────────────────
// Horizontal ScrollView with left/right arrow buttons for desktop usability.

interface ArrowScrollProps {
  children: React.ReactNode;
  style?: any;          // applied to the outer wrapper View
  scrollStyle?: any;    // applied to the inner ScrollView
  contentContainerStyle?: any;
  scrollStep?: number;
  maxHeight?: number;
}

function ArrowScrollView({ children, style, scrollStyle, contentContainerStyle, scrollStep = 160, maxHeight }: ArrowScrollProps) {
  const ref = useRef<ScrollView>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const scroll = (dir: 'left' | 'right') => {
    if (Platform.OS !== 'web') return;
    const node = (ref.current as any)?.getScrollableNode?.();
    if (node?.scrollBy) {
      node.scrollBy({ left: dir === 'right' ? scrollStep : -scrollStep, behavior: 'smooth' });
    } else {
      ref.current?.scrollTo({ x: dir === 'right' ? scrollStep : -scrollStep, animated: true });
    }
  };

  const handleScroll = (e: any) => {
    const { contentOffset: { x }, layoutMeasurement: { width: w }, contentSize: { width: total } } = e.nativeEvent;
    setCanLeft(x > 4);
    setCanRight(x + w < total - 4);
  };

  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center' },
      maxHeight ? { maxHeight } : undefined,
      style,
    ]}>
      {Platform.OS === 'web' && canLeft && (
        <Pressable onPress={() => scroll('left')} style={arrowSt.arrow}>
          <Text style={arrowSt.arrowText}>‹</Text>
        </Pressable>
      )}
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[{ flex: 1 }, scrollStyle]}
        contentContainerStyle={contentContainerStyle}
        onScroll={handleScroll}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {Platform.OS === 'web' && canRight && (
        <Pressable onPress={() => scroll('right')} style={arrowSt.arrow}>
          <Text style={arrowSt.arrowText}>›</Text>
        </Pressable>
      )}
    </View>
  );
}

const arrowSt = StyleSheet.create({
  arrow: {
    width: 22, height: 28, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  arrowText: { color: '#aaa', fontSize: 18, lineHeight: 20, fontWeight: '700' },
});

// ─── File Type System ────────────────────────────────────────────────────────

const FILE_TYPES = [
  'typescript','javascript','python','sql','json','bash','rust','go',
  'markdown','plaintext','csv','image','html','css','yaml',
  'canvas',   // Miro-style sticky note whiteboard
  'other',
] as const;
type FileType = typeof FILE_TYPES[number];

const LANG_COLORS: Record<string, string> = {
  typescript:'#3178c6', javascript:'#f7df1e', python:'#3776ab', sql:'#e38c00',
  json:'#6d6d6d', bash:'#4eaa25', rust:'#dea584', go:'#00add8',
  markdown:'#519aba', plaintext:'#9ca3af', csv:'#21b76a', image:'#ec4899',
  html:'#e34c26', css:'#1572b6', yaml:'#cb171e', canvas:'#8b5cf6', other:'#888',
};
const FILE_ICONS: Record<string, string> = {
  typescript:'📘', javascript:'📒', python:'🐍', sql:'🗃', json:'{ }',
  bash:'⚡', rust:'⚙️', go:'🐹', markdown:'📝', plaintext:'📄',
  csv:'📊', image:'🖼', html:'🌐', css:'🎨', yaml:'⚙', canvas:'🎨', other:'📁',
};
const FOLDER_ICONS: Record<string, string> = {
  '.images':'🖼', '.schemas':'📐', '.threads':'💬', 'src':'📂',
  'docs':'📚', 'data':'🗄', default:'📁',
};

const MONO = Platform.OS === 'web' ? 'monospace' : 'Courier New';

function detectFileType(name: string, current: FileType = 'typescript'): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const MAP: Record<string, FileType> = {
    ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript', mjs:'javascript',
    py:'python', sql:'sql', json:'json', sh:'bash', bash:'bash', zsh:'bash',
    rs:'rust', go:'go', md:'markdown', mdx:'markdown', txt:'plaintext',
    csv:'csv', png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image',
    svg:'image', html:'html', htm:'html', css:'css', scss:'css',
    yaml:'yaml', yml:'yaml',
  };
  // Also detect by special names
  if (name.endsWith('.gallery')) return 'image';
  if (name.endsWith('.document')) return 'markdown';
  if (name.endsWith('.thread')) return 'plaintext';
  if (name.endsWith('.present')) return 'markdown';
  return MAP[ext] ?? current;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)}KB`;
  return `${(bytes/1024/1024).toFixed(1)}MB`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

// ─── Room APIs Config ─────────────────────────────────────────────────────────

const ROOM_APIS = [
  { id: 'storage',    label: 'Storage',    icon: '🗄',  color: '#6366f1', desc: 'File & blob storage. Put, get, list, delete objects.' },
  { id: 'database',  label: 'Database',   icon: '🏛',  color: '#3b82f6', desc: 'Supabase Postgres. Query tables, run SQL, subscribe.' },
  { id: 'messaging', label: 'Messaging',  icon: '📨',  color: '#22c55e', desc: 'Realtime channels. Publish events, broadcast messages.' },
  { id: 'queues',    label: 'Queues',     icon: '📋',  color: '#f59e0b', desc: 'Task queues. Enqueue jobs, process with agents or workers.' },
  { id: 'secrets',   label: 'Secrets',   icon: '🔒',  color: '#ef4444', desc: 'Encrypted KV store. Store API keys, tokens, credentials.' },
  { id: 'containers',label: 'Containers', icon: '🐳',  color: '#00add8', desc: 'Run sandboxed code. Execute tasks, deploy agents.' },
] as const;

const INTEGRATIONS = [
  { name: 'AWS',       icon: '🟠', color: '#ff9900' },
  { name: 'Azure',     icon: '🔵', color: '#0078d4' },
  { name: 'GCP',       icon: '🔴', color: '#4285f4' },
  { name: 'Python',    icon: '🐍', color: '#3776ab' },
  { name: 'JS',        icon: '🟡', color: '#f7df1e' },
  { name: 'TypeScript',icon: '📘', color: '#3178c6' },
  { name: 'React',     icon: '⚛', color: '#61dafb' },
  { name: 'Flutter',   icon: '🐦', color: '#54c5f8' },
  { name: 'OpenAI',    icon: '🤖', color: '#412991' },
  { name: 'Anthropic', icon: '🅐', color: '#d4a76a' },
  { name: 'GitHub',    icon: '🐙', color: '#24292f' },
  { name: 'Docker',    icon: '🐳', color: '#2496ed' },
];

// ─── JS Syntax Highlighter ───────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','import',
  'export','from','default','class','extends','new','this','async','await',
  'try','catch','throw','typeof','interface','type','enum','implements',
  'public','private','protected','static','readonly','true','false','null',
  'undefined','void','never','any','string','number','boolean','switch',
  'case','break','continue','do','in','of',
]);

function highlightLine(line: string, lang: string): React.ReactNode[] {
  if (!['typescript','javascript','html','css'].includes(lang)) {
    const color = lang === 'python' ? '#e6e6e6' : '#e6e6e6';
    return [<Text key="plain" style={{ color }}>{line || ' '}</Text>];
  }
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return [<Text key="c" style={{ color:'#6a9955', fontStyle:'italic' }}>{line}</Text>];
  }
  const parts: React.ReactNode[] = [];
  const regex = /(\s+)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|([a-zA-Z_$][\w$]*)|([^\s\w])/g;
  let match, idx = 0;
  while ((match = regex.exec(line)) !== null) {
    const [, space, str, word, op] = match;
    if (space) parts.push(<Text key={idx++} style={{ color:'#e6e6e6' }}>{space}</Text>);
    else if (str) parts.push(<Text key={idx++} style={{ color:'#ce9178' }}>{str}</Text>);
    else if (word) {
      if (JS_KEYWORDS.has(word)) parts.push(<Text key={idx++} style={{ color:'#569cd6', fontWeight:'700' }}>{word}</Text>);
      else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase())
        parts.push(<Text key={idx++} style={{ color:'#4ec9b0' }}>{word}</Text>);
      else parts.push(<Text key={idx++} style={{ color:'#e6e6e6' }}>{word}</Text>);
    } else if (op) parts.push(<Text key={idx++} style={{ color:'#d4d4d4' }}>{op}</Text>);
  }
  return parts.length ? parts : [<Text key="e" style={{ color:'#e6e6e6' }}>{line || ' '}</Text>];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RoomsTab({ circleId, accentColor }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 768;

  const loadRooms = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('circle_rooms').select('*')
        .eq('circle_id', circleId).eq('is_active', true)
        .order('updated_at', { ascending: false });
      setRooms(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [circleId]);

  useEffect(() => {
    loadRooms();
    const ch = supabase.channel(`rooms:${circleId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'circle_rooms', filter:`circle_id=eq.${circleId}` }, loadRooms)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [circleId, loadRooms]);

  const handleDelete = useCallback(async (roomId: string) => {
    const ok = Platform.OS === 'web'
      ? window.confirm('Delete this room? This cannot be undone.')
      : await new Promise<boolean>(r => Alert.alert('Delete Room','Cannot be undone.',[
          { text:'Cancel', style:'cancel', onPress:()=>r(false) },
          { text:'Delete', style:'destructive', onPress:()=>r(true) },
        ]));
    if (!ok) return;
    await supabase.from('circle_rooms').update({ is_active:false }).eq('id', roomId);
    setRooms(p => p.filter(r => r.id !== roomId));
    if (selectedRoom?.id === roomId) setSelectedRoom(null);
  }, [selectedRoom]);

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator color={accentColor} />
      <Text style={s.loadingText}>Loading rooms...</Text>
    </View>
  );

  if (selectedRoom) return (
    <RoomDetail
      room={selectedRoom} accentColor={accentColor} isMobile={isMobile}
      onClose={() => setSelectedRoom(null)}
      onDelete={() => handleDelete(selectedRoom.id)}
      onRoomUpdated={u => { setSelectedRoom(u); setRooms(p => p.map(r => r.id===u.id ? u : r)); }}
    />
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.listHeader}>
        <View>
          <Text style={s.listTitle}>🏠 ROOMS</Text>
          <Text style={s.listSub}>{rooms.length} workspace{rooms.length!==1?'s':''}</Text>
        </View>
        <Pressable onPress={() => setShowCreate(true)} style={[s.createBtn,{backgroundColor:accentColor+'20',borderColor:accentColor+'60'}]}>
          <Text style={[s.createBtnText,{color:accentColor}]}>+ New Room</Text>
        </Pressable>
      </View>

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        {rooms.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🏠</Text>
            <Text style={s.emptyTitle}>No rooms yet</Text>
            <Text style={s.emptySub}>Create a Room — a shared workspace with files, APIs, chat, and agents.</Text>
            <Pressable onPress={() => setShowCreate(true)} style={[s.emptyBtn,{backgroundColor:accentColor}]}>
              <Text style={s.emptyBtnText}>Create First Room</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[s.grid, isMobile && s.gridMobile]}>
            {rooms.map(room => (
              <RoomCard key={room.id} room={room} accentColor={accentColor} isMobile={isMobile}
                onPress={() => setSelectedRoom(room)}
                onDelete={() => handleDelete(room.id)} />
            ))}
          </View>
        )}
      </ScrollView>

      <CreateRoomModal visible={showCreate} circleId={circleId} accentColor={accentColor}
        onClose={() => setShowCreate(false)}
        onCreated={room => { setShowCreate(false); setRooms(p=>[room,...p]); setSelectedRoom(room); }} />
    </View>
  );
}

// ─── Room Card ────────────────────────────────────────────────────────────────

function RoomCard({ room, accentColor, isMobile, onPress, onDelete }: {
  room: Room; accentColor: string; isMobile: boolean;
  onPress: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [fileCount, setFileCount] = useState<number|null>(null);
  const langColor = LANG_COLORS[room.language] || '#888';
  const icon = FILE_ICONS[room.language] || '📁';

  useEffect(() => {
    supabase.from('room_files').select('id', { count:'exact', head:true })
      .eq('room_id', room.id).eq('is_deleted', false)
      .then(({ count }) => setFileCount(count ?? 0));
  }, [room.id]);

  return (
    <Pressable onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[s.card, hovered && { borderColor:accentColor+'60', backgroundColor:'#ffffff08' }, isMobile && s.cardMobile]}>
      <View style={s.cardHeader}>
        <Text style={s.cardIcon}>{icon}</Text>
        <Text style={s.cardName} numberOfLines={1}>{room.name}</Text>
        <View style={[s.langBadge,{backgroundColor:langColor+'20',borderColor:langColor+'50'}]}>
          <Text style={[s.langBadgeText,{color:langColor}]}>{room.language.toUpperCase()}</Text>
        </View>
        <Pressable onPress={e=>{e.stopPropagation?.();onDelete();}} style={s.cardDelete} hitSlop={8}>
          <Text style={s.cardDeleteText}>🗑</Text>
        </Pressable>
      </View>
      {room.file_path && <Text style={s.cardPath} numberOfLines={1}>{room.file_path}</Text>}
      {room.description && <Text style={s.cardDesc} numberOfLines={2}>{room.description}</Text>}
      <View style={s.cardFooter}>
        <Text style={s.cardTime}>{timeAgo(room.updated_at)}</Text>
        {fileCount !== null && (
          <View style={s.cardFiles}>
            <Text style={s.cardFilesText}>{fileCount} file{fileCount!==1?'s':''}</Text>
          </View>
        )}
      </View>
      {/* API badges */}
      <View style={s.cardApiBadges}>
        {['🗄','🏛','📨','📋','🔒','🐳'].map((ic,i) => (
          <Text key={i} style={s.cardApiBadge}>{ic}</Text>
        ))}
      </View>
    </Pressable>
  );
}

// ─── Create Room Modal ────────────────────────────────────────────────────────

function CreateRoomModal({ visible, circleId, accentColor, onClose, onCreated }: {
  visible: boolean; circleId: string; accentColor: string;
  onClose: () => void; onCreated: (r: Room) => void;
}) {
  const [name, setName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [language, setLanguage] = useState<FileType>('typescript');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handlePathChange = (v: string) => {
    setFilePath(v);
    const d = detectFileType(v, language);
    if (d !== language) setLanguage(d);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data:{ user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('circle_rooms').insert({
        circle_id: circleId, name: name.trim(),
        file_path: filePath.trim() || null,
        language, description: description.trim() || null,
        content: '', created_by: user?.id || null,
      }).select().single();
      if (error) throw error;
      setName(''); setFilePath(''); setLanguage('typescript'); setDescription('');
      onCreated(data);
    } catch (e) { console.error(e); }
    finally { setCreating(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.modalBox} onPress={()=>{}}>
          <Text style={s.modalTitle}>Create Room</Text>
          <Text style={s.modalSub}>A Room is a shared workspace with files, APIs, chat, and agents.</Text>

          <Text style={s.label}>Room Name *</Text>
          <TextInput style={s.input} value={name} onChangeText={setName}
            placeholder="e.g. Acme RFP" placeholderTextColor="#555" />

          <Text style={s.label}>File Path <Text style={{color:'#555',fontWeight:'400'}}>(auto-detects type)</Text></Text>
          <TextInput style={s.input} value={filePath} onChangeText={handlePathChange}
            placeholder="e.g. src/auth.ts, README.md, photo.png" placeholderTextColor="#555"
            autoCapitalize="none" autoCorrect={false} />

          <Text style={s.label}>Language / Type</Text>
          <ArrowScrollView scrollStyle={s.langPicker}>
            {FILE_TYPES.map(t => (
              <Pressable key={t} onPress={()=>setLanguage(t)}
                style={[s.langOpt, language===t && {backgroundColor:accentColor+'20',borderColor:accentColor+'60'}]}>
                <Text style={[s.langOptText, language===t && {color:accentColor}]}>{FILE_ICONS[t]} {t}</Text>
              </Pressable>
            ))}
          </ArrowScrollView>

          <Text style={s.label}>Description</Text>
          <TextInput style={[s.input,{height:50}]} value={description} onChangeText={setDescription}
            placeholder="What's this room for?" placeholderTextColor="#555" multiline />

          <View style={s.modalActions}>
            <Pressable onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleCreate} disabled={!name.trim()||creating}
              style={[s.submitBtn,{backgroundColor:accentColor,opacity:!name.trim()||creating?0.5:1}]}>
              <Text style={s.submitText}>{creating?'Creating...':'Create Room'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Room Detail ──────────────────────────────────────────────────────────────

type RightPanel = 'chat' | 'apis' | 'secrets' | 'usage' | 'sessions' | 'services' | 'permissions' | 'tasks' | 'playground' | null;

const RIGHT_PANEL_TABS: [RightPanel, string][] = [
  ['chat',        'Chat'],
  ['playground',  'Playground'],
  ['sessions',    'Sessions'],
  ['services',    'Services'],
  ['apis',        'APIs'],
  ['secrets',     'Secrets'],
  ['permissions', 'Permissions'],
  ['tasks',       'Tasks'],
  ['usage',       'Usage'],
];

function RoomDetail({ room, accentColor, isMobile, onClose, onDelete, onRoomUpdated }: {
  room: Room; accentColor: string; isMobile: boolean;
  onClose: () => void; onDelete: () => void; onRoomUpdated: (r: Room) => void;
}) {
  const [files, setFiles] = useState<RoomFile[]>([]);
  const [openTabs, setOpenTabs] = useState<RoomFile[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingContent, setEditingContent] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);

  const activeTab = openTabs.find(t => t.id === activeTabId) ?? null;
  const isDirty = activeTab ? (editingContent[activeTab.id] !== undefined && editingContent[activeTab.id] !== activeTab.content) : false;
  const hasOpenedRef = useRef(false);

  const openFile = useCallback((file: RoomFile) => {
    setOpenTabs(p => p.find(t => t.id === file.id) ? p : [...p, file]);
    setActiveTabId(file.id);
  }, []);

  // Load files
  const loadFiles = useCallback(async () => {
    const { data } = await supabase.from('room_files')
      .select('*').eq('room_id', room.id).eq('is_deleted', false)
      .order('folder').order('name');
    if (data) {
      setFiles(data);
      // Seed initial tab from legacy content if no files yet
      if (data.length === 0 && room.content) {
        const seed: RoomFile = {
          id: 'legacy', room_id: room.id,
          name: room.file_path || room.name,
          folder: '/', file_type: room.language,
          content: room.content, storage_url: null, mime_type: null,
          size_bytes: room.content.length, tags: [], created_by: null,
          created_at: room.created_at, updated_at: room.updated_at, is_deleted: false,
        };
        setFiles([seed]);
        if (!hasOpenedRef.current) { hasOpenedRef.current = true; openFile(seed); }
      } else if (data.length > 0 && !hasOpenedRef.current) {
        hasOpenedRef.current = true;
        openFile(data[0]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]); // room.content/file_path/language intentionally excluded — only re-fetch on room switch

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Realtime file updates
  useEffect(() => {
    const ch = supabase.channel(`room_files:${room.id}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'room_files', filter:`room_id=eq.${room.id}` }, loadFiles)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [room.id, loadFiles]);

  // Web drag-drop
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = document.body;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = () => setIsDragging(false);
    const onDrop = async (e: DragEvent) => {
      e.preventDefault(); setIsDragging(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      for (const file of dropped) await uploadFileRef.current(file);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [room.id]);

  const closeTab = (fileId: string, e?: any) => {
    e?.stopPropagation?.();
    setOpenTabs(p => {
      const remaining = p.filter(t => t.id !== fileId);
      if (activeTabId === fileId) setActiveTabId(remaining[remaining.length-1]?.id ?? null);
      return remaining;
    });
    setEditingContent(p => { const n={...p}; delete n[fileId]; return n; });
  };

  const uploadFile = async (file: File) => {
    const { data:{ user } } = await supabase.auth.getUser();
    const isText = file.type.startsWith('text/') || file.name.match(/\.(ts|tsx|js|jsx|py|sql|json|md|txt|csv|html|css|yaml|yml|sh|rs|go)$/i);
    let content = '';
    let storageUrl: string | null = null;

    if (isText) {
      content = await file.text();
    } else {
      // Upload binary to Supabase Storage
      const path = `rooms/${room.id}/${Date.now()}_${file.name}`;
      const { data: uploaded } = await supabase.storage.from('room-files').upload(path, file);
      if (uploaded) {
        const { data: url } = supabase.storage.from('room-files').getPublicUrl(path);
        storageUrl = url.publicUrl;
        content = storageUrl; // store URL as content for images
      }
    }

    const ft = detectFileType(file.name, 'plaintext');
    const { data, error } = await supabase.from('room_files').insert({
      room_id: room.id, name: file.name, folder: '/',
      file_type: ft, content, storage_url: storageUrl,
      mime_type: file.type, size_bytes: file.size,
      created_by: user?.id || null,
    }).select().single();

    if (!error && data) {
      setFiles(p => [...p, data]);
      openFile(data);
    }
  };

  // Stable ref for uploadFile so drag-drop handler doesn't go stale
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;

  const triggerUpload = () => {
    if (Platform.OS !== 'web') return;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.onchange = async () => {
      for (const f of Array.from(inp.files ?? [])) await uploadFile(f);
    };
    inp.click();
  };

  const saveFile = async () => {
    if (!activeTab || !isDirty) return;
    setSaving(true);
    const newContent = editingContent[activeTab.id] ?? activeTab.content;
    try {
      if (activeTab.id === 'legacy') {
        // Migrate legacy content to room_files
        await supabase.from('circle_rooms').update({ content: newContent }).eq('id', room.id);
      } else {
        await supabase.from('room_files').update({
          content: newContent, updated_at: new Date().toISOString(),
          size_bytes: newContent.length,
        }).eq('id', activeTab.id);
      }
      setFiles(p => p.map(f => f.id === activeTab.id ? { ...f, content: newContent } : f));
      setOpenTabs(p => p.map(f => f.id === activeTab.id ? { ...f, content: newContent } : f));
      setEditingContent(p => { const n={...p}; delete n[activeTab.id]; return n; });
      // Log edit event
      await supabase.from('room_messages').insert({
        room_id: room.id, content: `Saved ${activeTab.name}`, message_type: 'edit_event',
      });
    } finally { setSaving(false); }
  };

  const deleteFile = async (file: RoomFile) => {
    const ok = Platform.OS === 'web'
      ? window.confirm(`Delete ${file.name}?`)
      : await new Promise<boolean>(r => Alert.alert('Delete File', file.name, [
          { text:'Cancel', style:'cancel', onPress:()=>r(false) },
          { text:'Delete', style:'destructive', onPress:()=>r(true) },
        ]));
    if (!ok) return;
    if (file.id !== 'legacy') {
      await supabase.from('room_files').update({ is_deleted:true }).eq('id', file.id);
    }
    setFiles(p => p.filter(f => f.id !== file.id));
    closeTab(file.id);
  };

  const downloadFile = (file: RoomFile) => {
    if (Platform.OS !== 'web') return;
    // Resolve correct MIME type from file type/name rather than trusting stored mime_type
    const mime = resolveFileMime(file);
    const content = file.storage_url && file.file_type === 'image' ? null : file.content;
    if (!content && file.storage_url) {
      // Binary file — just open the storage URL directly
      window.open(file.storage_url, '_blank');
      return;
    }
    const blob = new Blob([content ?? ''], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Guarantee the right extension even if the file was created without one
    const EXT_MAP: Record<string, string> = {
      typescript:'.ts', javascript:'.js', python:'.py', sql:'.sql', json:'.json',
      bash:'.sh', rust:'.rs', go:'.go', markdown:'.md', plaintext:'.txt',
      csv:'.csv', html:'.html', css:'.css', yaml:'.yaml', other:'',
    };
    const hasExt = file.name.includes('.');
    a.download = hasExt ? file.name : file.name + (EXT_MAP[file.file_type] ?? '');
    a.click();
    URL.revokeObjectURL(url);
  };

  // Resolve the correct MIME type for download based on file extension/type
  function resolveFileMime(file: RoomFile): string {
    if (file.mime_type && file.mime_type !== 'text/plain') return file.mime_type;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const MIME_MAP: Record<string, string> = {
      ts: 'application/typescript', tsx: 'application/typescript',
      js: 'application/javascript', jsx: 'application/javascript', mjs: 'application/javascript',
      py: 'text/x-python',
      sql: 'application/sql',
      json: 'application/json',
      sh: 'application/x-sh', bash: 'application/x-sh', zsh: 'application/x-sh',
      rs: 'text/x-rust',
      go: 'text/x-go',
      md: 'text/markdown', mdx: 'text/markdown',
      txt: 'text/plain',
      csv: 'text/csv',
      html: 'text/html', htm: 'text/html',
      css: 'text/css',
      yaml: 'application/yaml', yml: 'application/yaml',
      svg: 'image/svg+xml',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp',
      pdf: 'application/pdf',
      zip: 'application/zip',
    };
    return MIME_MAP[ext] ?? 'text/plain';
  }

  // Group files by folder
  const folderMap = useMemo(() => {
    const m: Record<string, RoomFile[]> = {};
    for (const f of files) {
      const k = f.folder || '/';
      if (!m[k]) m[k] = [];
      m[k].push(f);
    }
    return m;
  }, [files]);

  return (
    <View style={[s.container, isDragging && s.dragging]}>
      {/* ── Top Bar ── */}
      <View style={s.detailBar}>
        <Pressable onPress={onClose} style={s.backBtn}>
          <Text style={s.backText}>← Rooms</Text>
        </Pressable>
        <Text style={s.detailName} numberOfLines={1}>{room.name}</Text>
        <View style={s.detailActions}>
          {/* Save */}
          {isDirty && (
            <Pressable onPress={saveFile} disabled={saving}
              style={[s.barBtn,{backgroundColor:'#22c55e20',borderColor:'#22c55e50'}]}>
              <Text style={{color:'#22c55e',fontSize:12,fontWeight:'700'}}>{saving?'Saving...':'💾 Save'}</Text>
            </Pressable>
          )}
          {/* Upload */}
          <Pressable onPress={triggerUpload} style={[s.barBtn,{backgroundColor:accentColor+'15',borderColor:accentColor+'40'}]}>
            <Text style={{color:accentColor,fontSize:12,fontWeight:'700'}}>↑ Upload</Text>
          </Pressable>
          {/* New File */}
          <Pressable onPress={()=>setShowNewFile(true)} style={[s.barBtn,{backgroundColor:accentColor+'15',borderColor:accentColor+'40'}]}>
            <Text style={{color:accentColor,fontSize:12,fontWeight:'700'}}>+ File</Text>
          </Pressable>
          {/* New Canvas */}
          <Pressable onPress={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const init = JSON.stringify({ notes: [] });
            const { data, error } = await supabase.from('room_files').insert({
              room_id: room.id, name: 'canvas.canvas', folder: '/',
              file_type: 'canvas', content: init, size_bytes: init.length,
              created_by: user?.id || null,
            }).select().single();
            if (!error && data) { setFiles(p=>[...p,data]); openFile(data); }
          }} style={[s.barBtn,{backgroundColor:'#8b5cf615',borderColor:'#8b5cf640'}]}>
            <Text style={{color:'#a78bfa',fontSize:12,fontWeight:'700'}}>+ Canvas</Text>
          </Pressable>
          {/* Summarize */}
          <Pressable onPress={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const summary = [
              `Room: ${room.name}`,
              files.length ? `Files (${files.length}): ${files.map(f=>f.name).join(', ')}` : 'No files',
              activeTab ? `Active: ${activeTab.name} · ${activeTab.file_type} · ${activeTab.content.split('\n').length} lines` : '',
            ].filter(Boolean).join('\n');
            await supabase.from('room_messages').insert({
              room_id: room.id, user_id: user?.id || null,
              agent_name: 'System', message_type: 'system',
              content: `📋 Room summary requested:\n${summary}`,
              metadata: { summary_request: true },
            });
            setRightPanel('chat');
          }} style={[s.barBtn,{backgroundColor:'#22c55e15',borderColor:'#22c55e40'}]}>
            <Text style={{color:'#22c55e',fontSize:12,fontWeight:'700'}}>Summarize</Text>
          </Pressable>
          {/* Sidebar toggle */}
          <Pressable onPress={()=>setSidebarOpen(p=>!p)} style={s.barBtn}>
            <Text style={{color:'#888',fontSize:12}}>☰</Text>
          </Pressable>
          {/* Delete room */}
          <Pressable onPress={onDelete} style={[s.barBtn,{backgroundColor:'#ef444415',borderColor:'#ef444430'}]}>
            <Text style={{color:'#ef4444',fontSize:12}}>🗑</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Body: Sidebar + Editor + Right Panel ── */}
      <View style={s.body}>
        {/* File Tree Sidebar */}
        {sidebarOpen && (
          <View style={[s.sidebar, isMobile && s.sidebarMobile]}>
            <View style={s.sidebarHeader}>
              <Text style={s.sidebarTitle}>FILES</Text>
              <Pressable onPress={()=>setShowNewFile(true)} style={s.sidebarAdd}>
                <Text style={{color:'#888',fontSize:14}}>+</Text>
              </Pressable>
            </View>
            <ScrollView style={s.sidebarScroll}>
              {Object.entries(folderMap).map(([folder, folderFiles]) => (
                <FolderSection key={folder} folder={folder} files={folderFiles}
                  activeTabId={activeTabId} onOpen={openFile}
                  onDelete={deleteFile} onDownload={downloadFile}
                  accentColor={accentColor} />
              ))}
              {files.length === 0 && (
                <View style={{padding:16,alignItems:'center'}}>
                  <Text style={{color:'#555',fontSize:12,textAlign:'center'}}>No files yet.{'\n'}Upload or create one.</Text>
                </View>
              )}
              {/* Drag drop hint */}
              {Platform.OS === 'web' && (
                <View style={s.dropHint}>
                  <Text style={s.dropHintText}>⬆ Drop files anywhere to upload</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* Editor / Viewer */}
        <View style={s.editorPane}>
          {/* Tab bar */}
          <ArrowScrollView style={s.tabBar} maxHeight={36}>
            {openTabs.map(tab => {
              const isActive = tab.id === activeTabId;
              const dirty = editingContent[tab.id] !== undefined;
              return (
                <Pressable key={tab.id} onPress={() => setActiveTabId(tab.id)}
                  style={[s.editorTab, isActive && {backgroundColor:'#0d1117',borderBottomColor:accentColor}]}>
                  <Text style={s.editorTabIcon}>{FILE_ICONS[tab.file_type]||'📄'}</Text>
                  <Text style={[s.editorTabName, isActive && {color:'#fff'}]} numberOfLines={1}>
                    {tab.name}{dirty?'●':''}
                  </Text>
                  <Pressable onPress={e=>closeTab(tab.id,e)} hitSlop={6} style={s.tabClose}>
                    <Text style={s.tabCloseText}>×</Text>
                  </Pressable>
                </Pressable>
              );
            })}
            {openTabs.length === 0 && (
              <Text style={{color:'#555',fontSize:12,padding:8,alignSelf:'center'}}>Open a file from the sidebar</Text>
            )}
          </ArrowScrollView>

          {/* Active file toolbar */}
          {activeTab && (
            <View style={s.fileToolbar}>
              <Text style={s.fileToolbarPath}>
                {FILE_ICONS[activeTab.file_type]} {activeTab.folder !== '/' ? activeTab.folder+'/' : ''}{activeTab.name}
              </Text>
              <View style={s.fileToolbarRight}>
                <Text style={s.fileToolbarMeta}>
                  {formatBytes(activeTab.size_bytes)} · {activeTab.file_type}
                </Text>
                <Pressable onPress={()=>downloadFile(activeTab)} style={s.fileAction}>
                  <Text style={s.fileActionText}>⬇ Download</Text>
                </Pressable>
                {activeTab.tags.length > 0 && activeTab.tags.map(tag => (
                  <View key={tag} style={s.tag}><Text style={s.tagText}>{tag}</Text></View>
                ))}
              </View>
            </View>
          )}

          {/* File content */}
          {activeTab ? (
            <FileViewer
              file={activeTab}
              editValue={editingContent[activeTab.id]}
              onEdit={v => setEditingContent(p => ({...p, [activeTab.id]:v}))}
            />
          ) : (
            <View style={s.noFile}>
              <Text style={s.noFileIcon}>📂</Text>
              <Text style={s.noFileText}>Select a file from the sidebar</Text>
              <Text style={s.noFileSub}>or upload / drag & drop files here</Text>
            </View>
          )}
        </View>

        {/* Right Panel */}
        {!isMobile && (
          <View style={s.rightPanel}>
            {/* Panel tabs at top of right panel */}
            <ArrowScrollView style={s.rightPanelTabs} scrollStep={120}>
              {RIGHT_PANEL_TABS.map(([id,label]) => (
                <Pressable key={id} onPress={() => setRightPanel(rightPanel===id ? null : id)}
                  style={[s.rpTab, rightPanel===id && {backgroundColor:accentColor+'20',borderColor:accentColor+'50'}]}>
                  <Text style={[s.rpTabText, rightPanel===id && {color:accentColor}]}>{label}</Text>
                </Pressable>
              ))}
            </ArrowScrollView>
            {/* Panel content */}
            {rightPanel === 'chat'        && <ChatPanel roomId={room.id} accentColor={accentColor} circleId={room.circle_id} activeFile={activeTab} />}
            {rightPanel === 'apis'        && <APIsPanel room={room} accentColor={accentColor} />}
            {rightPanel === 'secrets'     && <SecretsPanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'usage'       && <UsagePanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'sessions'    && <SessionsPanel roomId={room.id} roomName={room.name} accentColor={accentColor} />}
            {rightPanel === 'services'    && <ServicesPanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'permissions' && <PermissionsPanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'tasks'       && <TasksPanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'playground'  && <PlaygroundPanel roomId={room.id} accentColor={accentColor} activeFile={activeTab} circleId={room.circle_id} />}
            {!rightPanel && (
              <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                <Text style={{color:'#444',fontSize:12}}>Select a panel above</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Mobile: right panel as bottom sheet */}
      {isMobile && (
        <View style={s.bottomSheet}>
          <ArrowScrollView style={s.rightPanelTabs} scrollStep={120}>
            {RIGHT_PANEL_TABS.map(([id,label]) => (
              <Pressable key={id} onPress={() => setRightPanel(rightPanel===id ? null : id)}
                style={[s.rpTab, rightPanel===id && {backgroundColor:accentColor+'20',borderColor:accentColor+'50'}]}>
                <Text style={[s.rpTabText, rightPanel===id && {color:accentColor}]}>{label}</Text>
              </Pressable>
            ))}
          </ArrowScrollView>
          {rightPanel === 'chat'        && <ChatPanel roomId={room.id} accentColor={accentColor} circleId={room.circle_id} activeFile={activeTab} />}
          {rightPanel === 'apis'        && <APIsPanel room={room} accentColor={accentColor} />}
          {rightPanel === 'secrets'     && <SecretsPanel roomId={room.id} accentColor={accentColor} />}
          {rightPanel === 'usage'       && <UsagePanel roomId={room.id} accentColor={accentColor} />}
          {rightPanel === 'sessions'    && <SessionsPanel roomId={room.id} roomName={room.name} accentColor={accentColor} />}
          {rightPanel === 'services'    && <ServicesPanel roomId={room.id} accentColor={accentColor} />}
          {rightPanel === 'permissions' && <PermissionsPanel roomId={room.id} accentColor={accentColor} />}
          {rightPanel === 'tasks'       && <TasksPanel roomId={room.id} accentColor={accentColor} />}
            {rightPanel === 'playground'  && <PlaygroundPanel roomId={room.id} accentColor={accentColor} activeFile={activeTab} circleId={room.circle_id} />}
        </View>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <View style={s.dropOverlay}>
          <Text style={s.dropOverlayText}>⬆</Text>
          <Text style={s.dropOverlayLabel}>Drop files to upload</Text>
        </View>
      )}

      {/* New File Modal */}
      <NewFileModal visible={showNewFile} roomId={room.id} accentColor={accentColor}
        onClose={()=>setShowNewFile(false)}
        onCreated={f => { setFiles(p=>[...p,f]); setShowNewFile(false); openFile(f); }} />
    </View>
  );
}

// ─── Folder Section ───────────────────────────────────────────────────────────

function FolderSection({ folder, files, activeTabId, onOpen, onDelete, onDownload, accentColor }: {
  folder: string; files: RoomFile[]; activeTabId: string|null;
  onOpen: (f:RoomFile)=>void; onDelete: (f:RoomFile)=>void; onDownload:(f:RoomFile)=>void;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const folderName = folder === '/' ? 'root' : folder.replace(/^\//, '');
  const folderIcon = FOLDER_ICONS[folderName] ?? FOLDER_ICONS.default;

  return (
    <View>
      <Pressable onPress={()=>setExpanded(p=>!p)} style={s.folderRow}>
        <Text style={s.folderArrow}>{expanded?'▾':'▸'}</Text>
        <Text style={s.folderIcon}>{folderIcon}</Text>
        <Text style={s.folderName}>{folderName}</Text>
        <Text style={s.folderCount}>{files.length}</Text>
      </Pressable>
      {expanded && files.map(file => (
        <FileRow key={file.id} file={file} isActive={file.id===activeTabId}
          onOpen={()=>onOpen(file)} onDelete={()=>onDelete(file)} onDownload={()=>onDownload(file)}
          accentColor={accentColor} />
      ))}
    </View>
  );
}

function FileRow({ file, isActive, onOpen, onDelete, onDownload, accentColor }: {
  file: RoomFile; isActive: boolean;
  onOpen:()=>void; onDelete:()=>void; onDownload:()=>void;
  accentColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  const color = LANG_COLORS[file.file_type] || '#888';
  return (
    <Pressable onPress={onOpen}
      onHoverIn={()=>setHovered(true)} onHoverOut={()=>setHovered(false)}
      style={[s.fileRow, isActive && {backgroundColor:accentColor+'18'}, hovered && !isActive && {backgroundColor:'#ffffff08'}]}>
      <Text style={[s.fileRowIcon,{color}]}>{FILE_ICONS[file.file_type]||'📄'}</Text>
      <Text style={[s.fileRowName, isActive && {color:'#fff'}]} numberOfLines={1}>{file.name}</Text>
      {hovered && (
        <View style={s.fileRowActions}>
          <Pressable onPress={e=>{e.stopPropagation?.();onDownload();}} hitSlop={4}>
            <Text style={s.fileRowAction}>⬇</Text>
          </Pressable>
          <Pressable onPress={e=>{e.stopPropagation?.();onDelete();}} hitSlop={4}>
            <Text style={[s.fileRowAction,{color:'#ef4444'}]}>🗑</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

// ─── File Viewer ──────────────────────────────────────────────────────────────

function FileViewer({ file, editValue, onEdit }: {
  file: RoomFile; editValue?: string; onEdit: (v:string)=>void;
}) {
  const content = editValue ?? file.content;
  const lang = file.file_type;

  if (lang === 'image') {
    const uri = (file.storage_url || content).trim();
    return (
      <ScrollView style={s.codeScroll} contentContainerStyle={{padding:20,alignItems:'center'}}>
        {uri ? (
          <>
            <Image source={{uri}} style={s.fileImage} resizeMode="contain" />
            <Pressable onPress={()=>onEdit(uri)}>
              <Text style={{color:'#555',fontSize:11,fontFamily:MONO,marginTop:8,textDecorationLine:'underline'}} selectable>{uri}</Text>
            </Pressable>
          </>
        ) : (
          <View style={{padding:40,alignItems:'center'}}>
            <Text style={s.emptyText}>No image — paste a URL below</Text>
            <TextInput style={[s.input,{marginTop:12,width:300,color:'#fff'}]}
              value={content} onChangeText={onEdit}
              placeholder="https://..." placeholderTextColor="#555" autoCapitalize="none" />
          </View>
        )}
      </ScrollView>
    );
  }

  if (lang === 'markdown') {
    return (
      <View style={{flex:1,flexDirection:'row'}}>
        {/* Edit pane */}
        <TextInput style={[s.codeEditor,{flex:1,borderRightWidth:1,borderRightColor:'#1a1a1a'}]}
          value={content} onChangeText={onEdit} multiline
          autoCapitalize="none" autoCorrect={false} spellCheck={false} />
        {/* Preview pane */}
        <ScrollView style={[s.codeScroll,{flex:1}]} contentContainerStyle={s.mdContent}>
          {renderMarkdown(content)}
        </ScrollView>
      </View>
    );
  }

  if (lang === 'csv') {
    const rows = content.trim().split('\n').map(r => r.split(','));
    const headers = rows[0] ?? [];
    return (
      <View style={{flex:1}}>
        <TextInput style={[s.codeEditor,{height:80}]} value={content} onChangeText={onEdit}
          multiline autoCapitalize="none" autoCorrect={false} />
        <ScrollView style={s.codeScroll} contentContainerStyle={{padding:8}}>
          <ArrowScrollView scrollStep={200}>
            <View>
              <View style={s.csvRow}>
                {headers.map((h,i) => <View key={i} style={[s.csvCell,s.csvHead]}><Text style={s.csvHeadText}>{h.trim()}</Text></View>)}
              </View>
              {rows.slice(1).map((row,ri) => (
                <View key={ri} style={[s.csvRow,ri%2===1&&{backgroundColor:'#ffffff05'}]}>
                  {row.map((c,ci) => <View key={ci} style={s.csvCell}><Text style={s.csvCellText}>{c.trim()}</Text></View>)}
                </View>
              ))}
            </View>
          </ArrowScrollView>
        </ScrollView>
      </View>
    );
  }

  if (lang === 'plaintext') {
    return (
      <TextInput style={[s.codeEditor,{fontFamily:undefined,fontSize:14,lineHeight:22}]}
        value={content} onChangeText={onEdit} multiline autoCorrect={false} />
    );
  }

  if (lang === 'canvas') {
    return <CanvasViewer file={file} onEdit={onEdit} />;
  }

  // Code
  return (
    <View style={{flex:1}}>
      <TextInput style={s.codeEditor} value={content} onChangeText={onEdit}
        multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} />
    </View>
  );
}

function renderMarkdown(content: string): React.ReactNode[] {
  return content.split('\n').map((line, i) => {
    if (line.startsWith('# '))   return <Text key={i} style={s.mdH1}>{line.slice(2)}</Text>;
    if (line.startsWith('## '))  return <Text key={i} style={s.mdH2}>{line.slice(3)}</Text>;
    if (line.startsWith('### ')) return <Text key={i} style={s.mdH3}>{line.slice(4)}</Text>;
    if (line.startsWith('> '))   return <View key={i} style={s.mdQuote}><Text style={s.mdQuoteText}>{line.slice(2)}</Text></View>;
    if (line.startsWith('- ')||line.startsWith('* ')) return <Text key={i} style={s.mdLi}>• {line.slice(2)}</Text>;
    if (line === '') return <View key={i} style={{height:8}} />;
    return <Text key={i} style={s.mdP}>{line}</Text>;
  });
}

// ─── New File Modal ───────────────────────────────────────────────────────────

function NewFileModal({ visible, roomId, accentColor, onClose, onCreated }: {
  visible: boolean; roomId: string; accentColor: string;
  onClose: ()=>void; onCreated: (f:RoomFile)=>void;
}) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('/');
  const [fileType, setFileType] = useState<FileType>('typescript');
  const [creating, setCreating] = useState(false);

  const handleNameChange = (v: string) => {
    setName(v);
    const d = detectFileType(v, fileType);
    if (d !== fileType) setFileType(d);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data:{ user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('room_files').insert({
        room_id: roomId, name: name.trim(), folder: folder.trim() || '/',
        file_type: fileType, content: '', size_bytes: 0,
        created_by: user?.id || null,
      }).select().single();
      if (!error && data) { setName(''); setFolder('/'); setFileType('typescript'); onCreated(data); }
    } finally { setCreating(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.modalBox,{maxWidth:420}]} onPress={()=>{}}>
          <Text style={s.modalTitle}>New File</Text>
          <Text style={s.label}>File Name *</Text>
          <TextInput style={s.input} value={name} onChangeText={handleNameChange}
            placeholder="e.g. auth.ts, README.md" placeholderTextColor="#555"
            autoCapitalize="none" autoCorrect={false} autoFocus />
          <Text style={s.label}>Folder</Text>
          <TextInput style={s.input} value={folder} onChangeText={setFolder}
            placeholder="/ or /src/components" placeholderTextColor="#555"
            autoCapitalize="none" autoCorrect={false} />
          <Text style={s.label}>Type</Text>
          <ArrowScrollView scrollStyle={s.langPicker}>
            {FILE_TYPES.map(t => (
              <Pressable key={t} onPress={()=>setFileType(t)}
                style={[s.langOpt, fileType===t && {backgroundColor:accentColor+'20',borderColor:accentColor+'60'}]}>
                <Text style={[s.langOptText, fileType===t && {color:accentColor}]}>{FILE_ICONS[t]} {t}</Text>
              </Pressable>
            ))}
          </ArrowScrollView>
          <View style={s.modalActions}>
            <Pressable onPress={onClose} style={s.cancelBtn}><Text style={s.cancelText}>Cancel</Text></Pressable>
            <Pressable onPress={handleCreate} disabled={!name.trim()||creating}
              style={[s.submitBtn,{backgroundColor:accentColor,opacity:!name.trim()||creating?0.5:1}]}>
              <Text style={s.submitText}>{creating?'Creating...':'Create'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({ roomId, accentColor, circleId, activeFile }: {
  roomId: string; accentColor: string;
  circleId?: string; activeFile?: RoomFile | null;
}) {
  const [messages, setMessages]   = useState<RoomMessage[]>([]);
  const [input, setInput]         = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [liveAgents, setLiveAgents] = useState<LiveAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [selectedFile, setSelectedFile]   = useState<string>('');   // file name
  const [roomFiles, setRoomFiles]  = useState<{ id: string; name: string }[]>([]);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [assigning, setAssigning]  = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Load messages + subscribe to new ones
  useEffect(() => {
    supabase.from('room_messages').select('*').eq('room_id', roomId)
      .order('created_at', { ascending: true }).limit(200)
      .then(({ data }) => {
        if (data) {
          setMessages(data);
          // Scroll to bottom after initial load
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
        }
      });
    const ch = supabase.channel(`msgs:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'room_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        setMessages(prev => [...prev, payload.new as RoomMessage]);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  // Load live agents — all non-offline agents, prefer same circle first
  useEffect(() => {
    const query = () =>
      supabase.from('circle_office_agents')
        .select('id, name, status, owner_id, color, tool_icon, owner_display_name, current_task, circle_id')
        .neq('status', 'offline')
        .order('status')
        .limit(100)
        .then(({ data }) => {
          if (!data) return;
          // Sort: same circle first, then others
          const sorted = [...data].sort((a, b) => {
            const aMatch = a.circle_id === circleId ? 0 : 1;
            const bMatch = b.circle_id === circleId ? 0 : 1;
            return aMatch - bMatch;
          });
          setLiveAgents(sorted);
        });
    query();
    const ch = supabase.channel(`chat_agents_${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_office_agents' }, query)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId, circleId]);

  // Load room files for targeting
  useEffect(() => {
    supabase.from('room_files').select('id, name').eq('room_id', roomId).eq('is_deleted', false)
      .then(({ data }) => setRoomFiles(data || []));
  }, [roomId]);

  const send = async () => {
    if (!input.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('room_messages').insert({
      room_id: roomId, user_id: user?.id || null, content: input.trim(), message_type: 'chat',
    });
    setInput('');
  };

  const assignToAgent = async () => {
    if (!selectedAgent || !taskPrompt.trim()) return;
    setAssigning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Resolve the file to attach: explicit pick > active open file
      const targetName = selectedFile || activeFile?.name || null;
      const filePart = targetName ? ` on \`${targetName}\`` : '';
      // Embed file content for context — prioritise explicitly selected file
      const contextFile = selectedFile
        ? null  // we only have the name; content would need a separate fetch — omit body, just name
        : activeFile ?? null;
      const fileContext = contextFile
        ? `\n\n--- FILE: ${contextFile.name} ---\n${contextFile.content.slice(0, 8000)}${contextFile.content.length > 8000 ? '\n...[truncated]' : ''}\n---`
        : '';

      const msgContent = `@${selectedAgent.name}${filePart}: ${taskPrompt.trim()}${fileContext}`;

      await supabase.from('room_messages').insert({
        room_id: roomId,
        user_id: user?.id || null,
        agent_name: selectedAgent.name,
        content: msgContent,
        message_type: 'agent_output',
        metadata: {
          task: true,
          agent_id: selectedAgent.id,
          target_file: targetName,
          prompt: taskPrompt.trim(),
          status: 'pending',
        },
      });
      // Update agent's current_task so it's visible in the Office
      await supabase.from('circle_office_agents')
        .update({ current_task: `[Room: ${roomId.slice(0,8)}] ${taskPrompt.trim().slice(0, 120)}`, status: 'building' })
        .eq('id', selectedAgent.id);

      await supabase.from('room_usage').insert({
        room_id: roomId, user_id: user?.id || null,
        agent_name: selectedAgent.name, event_type: 'agent_task',
        metadata: { prompt: taskPrompt.trim(), file: targetName },
      });
      setTaskPrompt(''); setSelectedFile(''); setSelectedAgent(null); setShowAssign(false);
    } finally { setAssigning(false); }
  };

  // Subscribe to task status updates (when agent posts a reply, mark task done)
  useEffect(() => {
    const ch = supabase.channel(`task_status_${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'room_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        const msg = payload.new as RoomMessage;
        // If agent posted a non-task reply, look for pending tasks to mark done
        if (msg.message_type === 'agent_output' && !msg.metadata?.task) {
          setMessages(prev => prev.map(m =>
            m.metadata?.task && m.metadata?.status === 'pending' && m.agent_name === msg.agent_name
              ? { ...m, metadata: { ...m.metadata, status: 'done' } }
              : m
          ));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  const STATUS_COLOR: Record<string, string> = { active: '#22c55e', idle: '#f59e0b', error: '#ef4444', offline: '#6b7280' };

  return (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={[s.panelTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Chat</Text>
        <Pressable onPress={() => setShowAssign(p => !p)}
          style={[s.panelBtn, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700' }}>Assign Agent</Text>
        </Pressable>
      </View>

      {/* ── Agent Assignment Panel ── */}
      {showAssign && (
        <View style={chatSt.assignBox}>
          {/* Agent picker */}
          <Text style={chatSt.assignLabel}>SELECT AGENT</Text>
          {liveAgents.length === 0 ? (
            <Text style={{ color: '#555', fontSize: 11, fontStyle: 'italic', marginBottom: 8 }}>
              No agents online — connect one in the Office tab
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {liveAgents.map(agent => {
                const isSelected = selectedAgent?.id === agent.id;
                const dotColor = STATUS_COLOR[agent.status] || '#888';
                const agentColor = agent.color || accentColor;
                return (
                  <Pressable key={agent.id} onPress={() => setSelectedAgent(isSelected ? null : agent)}
                    style={[chatSt.agentChip, isSelected && { backgroundColor: agentColor + '25', borderColor: agentColor + '70' }]}>
                    <View style={[chatSt.agentChipDot, { backgroundColor: dotColor }]} />
                    <View>
                      <Text style={[chatSt.agentChipName, isSelected && { color: agentColor }]}>
                        {agent.tool_icon ? `${agent.tool_icon} ` : ''}{agent.name}
                      </Text>
                      {agent.owner_display_name && <Text style={chatSt.agentChipOwner}>@{agent.owner_display_name}</Text>}
                      {agent.current_task && <Text style={chatSt.agentChipTask} numberOfLines={1}>{agent.current_task}</Text>}
                    </View>
                    {isSelected && <Text style={{ color: agentColor, fontSize: 12, marginLeft: 4 }}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* File picker — active file pre-highlighted */}
          <Text style={chatSt.assignLabel}>
            TARGET FILE <Text style={{ color: '#444', fontWeight: '400' }}>(optional)</Text>
          </Text>
          {activeFile && !selectedFile && (
            <View style={chatSt.activeFileBanner}>
              <Text style={chatSt.activeFileBannerIcon}>{FILE_ICONS[activeFile.file_type] || '📄'}</Text>
              <Text style={chatSt.activeFileBannerName}>{activeFile.name}</Text>
              <Text style={chatSt.activeFileBannerHint}>currently open — will be attached</Text>
            </View>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            {/* "No file" option */}
            <Pressable onPress={() => setSelectedFile('')}
              style={[chatSt.fileChip, !selectedFile && { backgroundColor: '#ffffff08', borderColor: '#444' }]}>
              <Text style={[chatSt.fileChipText, !selectedFile && { color: '#aaa' }]}>
                {activeFile ? `📄 ${activeFile.name} (open)` : 'No file'}
              </Text>
            </Pressable>
            {roomFiles.filter(f => f.name !== activeFile?.name).map(f => (
              <Pressable key={f.id} onPress={() => setSelectedFile(selectedFile === f.name ? '' : f.name)}
                style={[chatSt.fileChip, selectedFile === f.name && { backgroundColor: '#6366f120', borderColor: '#6366f160' }]}>
                <Text style={[chatSt.fileChipText, selectedFile === f.name && { color: '#a5b4fc' }]}>{f.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Task prompt */}
          <Text style={chatSt.assignLabel}>TASK</Text>
          <TextInput style={s.taskInput} value={taskPrompt} onChangeText={setTaskPrompt}
            placeholder={selectedFile
              ? `What should ${selectedAgent?.name || 'the agent'} do with ${selectedFile}?`
              : `What should ${selectedAgent?.name || 'the agent'} do?`}
            placeholderTextColor="#555" multiline />

          {/* Selected summary */}
          {selectedAgent && (
            <View style={chatSt.assignSummary}>
              <View style={[chatSt.assignSummaryDot, { backgroundColor: STATUS_COLOR[selectedAgent.status] || '#888' }]} />
              <Text style={{ color: '#aaa', fontSize: 11 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{selectedAgent.name}</Text>
                {selectedFile ? <Text> → <Text style={{ color: '#a5b4fc' }}>{selectedFile}</Text></Text> : null}
              </Text>
            </View>
          )}

          <Pressable onPress={assignToAgent}
            disabled={!selectedAgent || !taskPrompt.trim() || assigning}
            style={[s.submitBtn, { backgroundColor: accentColor, marginTop: 8,
              opacity: selectedAgent && taskPrompt.trim() && !assigning ? 1 : 0.4 }]}>
            <Text style={s.submitText}>{assigning ? 'Assigning...' : 'Assign Task'}</Text>
          </Pressable>
        </View>
      )}

      {/* Messages */}
      <ScrollView ref={scrollRef} style={s.msgList} contentContainerStyle={{ padding: 10, gap: 6 }}>
        {messages.length === 0 && <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20, fontStyle: 'italic' }}>No messages yet</Text>}
        {messages.map(m => <MsgBubble key={m.id} msg={m} accentColor={accentColor} />)}
      </ScrollView>

      {/* Input */}
      <View style={s.msgInputRow}>
        <TextInput style={s.msgInput} value={input} onChangeText={setInput}
          placeholder="Message..." placeholderTextColor="#555"
          onSubmitEditing={send} returnKeyType="send" />
        <Pressable onPress={send} disabled={!input.trim()}
          style={[s.sendBtn, { backgroundColor: accentColor, opacity: input.trim() ? 1 : 0.4 }]}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>→</Text>
        </Pressable>
      </View>
    </View>
  );
}

const chatSt = StyleSheet.create({
  assignBox: { backgroundColor: '#0a0f0a', borderBottomWidth: 1, borderBottomColor: '#1a2a1a', padding: 14, gap: 4 },
  assignLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  agentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: '#222', backgroundColor: '#0d0d0d',
    marginRight: 8, minWidth: 100,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  agentChipDot: { width: 7, height: 7, borderRadius: 4 },
  agentChipName: { color: '#ccc', fontSize: 12, fontWeight: '700' },
  agentChipModel: { color: '#555', fontSize: 9, fontFamily: MONO, marginTop: 1 },
  fileChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
    borderColor: '#222', backgroundColor: '#0d0d0d', marginRight: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  fileChipText: { color: '#888', fontSize: 11, fontFamily: MONO },
  assignSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#1a2a1a', marginTop: 4 },
  assignSummaryDot: { width: 7, height: 7, borderRadius: 4 },
  activeFileBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    backgroundColor: '#6366f110', borderWidth: 1, borderColor: '#6366f130',
  },
  activeFileBannerIcon: { fontSize: 14 },
  activeFileBannerName: { color: '#a5b4fc', fontSize: 12, fontWeight: '700', fontFamily: MONO },
  activeFileBannerHint: { color: '#555', fontSize: 10, fontStyle: 'italic' },
  agentChipOwner: { color: '#555', fontSize: 9, marginTop: 1 },
  agentChipTask: { color: '#888', fontSize: 9, marginTop: 1, fontStyle: 'italic' },
});

const MsgBubble = React.memo(function MsgBubble({ msg, accentColor }: { msg: RoomMessage; accentColor: string }) {
  const time = new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if (msg.message_type==='edit_event')
    return <View style={{alignItems:'center'}}><Text style={{color:'#555',fontSize:11,fontStyle:'italic'}}>✏️ {msg.content} · {time}</Text></View>;
  if (msg.message_type==='system')
    return <View style={{alignItems:'center'}}><Text style={{color:'#555',fontSize:11,fontStyle:'italic'}}>{msg.content}</Text></View>;
  if (msg.message_type==='agent_output') {
    const isTask = msg.metadata?.task === true;
    const targetFile = msg.metadata?.target_file;
    const status = msg.metadata?.status;
    return (
      <View style={{borderLeftWidth:3,borderLeftColor:isTask?'#6366f1':'#22c55e',paddingLeft:10,paddingVertical:7,backgroundColor:isTask?'#6366f108':'#0d1a0d10',borderRadius:4}}>
        <View style={{flexDirection:'row',gap:8,marginBottom:3,flexWrap:'wrap',alignItems:'center'}}>
          <Text style={{color:isTask?'#a5b4fc':'#22c55e',fontSize:11,fontWeight:'700'}}>{msg.agent_name||'Agent'}</Text>
          {isTask && <View style={{backgroundColor:'#6366f120',paddingHorizontal:5,paddingVertical:2,borderRadius:4,borderWidth:1,borderColor:'#6366f140'}}>
            <Text style={{color:'#a5b4fc',fontSize:9,fontWeight:'800',letterSpacing:0.5}}>TASK</Text>
          </View>}
          {targetFile && <Text style={{color:'#a5b4fc',fontSize:10,fontFamily:MONO}}>→ {targetFile}</Text>}
          {status && (
            <Text style={{
              color: status==='pending' ? '#f59e0b' : status==='done' ? '#22c55e' : '#ef4444',
              fontSize: 9, fontWeight: '800', marginLeft: 'auto' as any,
            }}>
              {status === 'pending' ? '⏳ PENDING' : status === 'done' ? '✓ DONE' : '✗ ERROR'}
            </Text>
          )}
          <Text style={{color:'#444',fontSize:10}}>{time}</Text>
        </View>
        <Text style={{color:'#ccc',fontSize:12,lineHeight:18}}>{isTask ? msg.metadata?.prompt || msg.content : msg.content}</Text>
        {isTask && msg.metadata?.status === 'pending' && (
          <Text style={{color:'#555',fontSize:10,marginTop:4,fontStyle:'italic'}}>
            → Agent has been notified. Check the Office tab to see it pick up the task.
          </Text>
        )}
      </View>
    );
  }
  return (
    <View style={{paddingVertical:4}}>
      <View style={{flexDirection:'row',gap:8,marginBottom:3,alignItems:'center'}}>
        <View style={{width:20,height:20,borderRadius:10,backgroundColor:accentColor+'30',alignItems:'center',justifyContent:'center'}}>
          <Text style={{fontSize:10}}>👤</Text>
        </View>
        <Text style={{color:'#ccc',fontSize:11,fontWeight:'700'}}>{msg.agent_name||'Member'}</Text>
        <Text style={{color:'#444',fontSize:10}}>{time}</Text>
      </View>
      <Text style={{color:'#e6e6e6',fontSize:13,marginLeft:28,lineHeight:19}}>{msg.content}</Text>
    </View>
  );
});

// ─── APIs Panel ───────────────────────────────────────────────────────────────

function APIsPanel({ room, accentColor }: { room: Room; accentColor: string }) {
  const [activeApi, setActiveApi] = useState<string>('storage');
  const base = `rjkniqiqdtroeholxacg.supabase.co`;

  const API_DETAILS: Record<string, { endpoint: string; example: string }> = {
    storage:    { endpoint:`https://${base}/storage/v1/object/room-files/${room.id}/`, example:`// Upload\nawait room.storage.put('key', data)\n// Get\nawait room.storage.get('key')` },
    database:   { endpoint:`https://${base}/rest/v1/room_files?room_id=eq.${room.id}`, example:`// Query files\nconst files = await room.db\n  .from('room_files')\n  .eq('room_id','${room.id}')\n  .select('*')` },
    messaging:  { endpoint:`wss://${base}/realtime/v1/room:${room.id}`, example:`// Subscribe\nconst ch = supabase.channel('room:${room.id}')\n  .on('broadcast',{event:'*'},handler)\n  .subscribe()` },
    queues:     { endpoint:`https://${base}/functions/v1/room-queue`, example:`// Enqueue task\nawait room.queue.push({\n  room_id: '${room.id}',\n  task: 'your_task',\n  payload: {}\n})` },
    secrets:    { endpoint:`Encrypted KV — room_secrets table`, example:`// Set secret\nawait room.secrets.set('API_KEY','value')\n// Get\nconst key = await room.secrets.get('API_KEY')` },
    containers: { endpoint:`https://${base}/functions/v1/room-exec`, example:`// Run sandboxed code\nawait room.exec({\n  image: 'python:3.12',\n  cmd: ['python', 'script.py'],\n  files: { 'script.py': code }\n})` },
  };

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Room APIs</Text>
      <Text style={{color:'#666',fontSize:11,paddingHorizontal:14,marginBottom:10,lineHeight:16}}>
        Storage · Database · Messaging · Queues · Secrets · Containers — all scoped to this room.
      </Text>
      {/* API list */}
      <ArrowScrollView scrollStyle={{paddingHorizontal:4}} maxHeight={40} style={{marginBottom:10}}>
        {ROOM_APIS.map(api => (
          <Pressable key={api.id} onPress={()=>setActiveApi(api.id)}
            style={[s.apiTab, activeApi===api.id && {backgroundColor:api.color+'20',borderColor:api.color+'50'}]}>
            <Text style={s.apiTabText}>{api.icon} {api.label}</Text>
          </Pressable>
        ))}
      </ArrowScrollView>

      {ROOM_APIS.filter(a=>a.id===activeApi).map(api => (
        <ScrollView key={api.id} style={{flex:1}} contentContainerStyle={{padding:14,gap:12}}>
          <View style={[s.apiCard,{borderColor:api.color+'40'}]}>
            <Text style={[s.apiCardTitle,{color:api.color}]}>{api.icon} {api.label}</Text>
            <Text style={s.apiCardDesc}>{api.desc}</Text>
          </View>
          <Text style={s.apiLabel}>ENDPOINT</Text>
          <View style={s.codeBlock}>
            <Text style={s.codeBlockText} selectable>{API_DETAILS[api.id]?.endpoint}</Text>
          </View>
          <Text style={s.apiLabel}>EXAMPLE</Text>
          <View style={s.codeBlock}>
            <Text style={s.codeBlockText} selectable>{API_DETAILS[api.id]?.example}</Text>
          </View>
        </ScrollView>
      ))}

      {/* Integrations */}
      <View style={s.integrationsSection}>
        <Text style={s.apiLabel}>INTEGRATIONS</Text>
        <ArrowScrollView scrollStyle={{paddingHorizontal:4}}>
          {INTEGRATIONS.map(int => (
            <View key={int.name} style={s.integrationBadge}>
              <Text style={s.integrationIcon}>{int.icon}</Text>
              <Text style={s.integrationName}>{int.name}</Text>
            </View>
          ))}
        </ArrowScrollView>
      </View>
    </View>
  );
}

// ─── Secrets Panel ────────────────────────────────────────────────────────────

function SecretsPanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [secrets, setSecrets] = useState<RoomSecret[]>([]);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from('room_secrets').select('id,room_id,key,value').eq('room_id', roomId)
      .then(({ data }) => setSecrets(data || []));
  }, [roomId]);

  const addSecret = async () => {
    if (!key.trim() || !val.trim()) return;
    setAdding(true);
    const { data:{ user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_secrets').upsert({
      room_id: roomId, key: key.trim(), value: val.trim(), created_by: user?.id||null,
    }, { onConflict:'room_id,key' }).select('id,room_id,key,value').single();
    if (!error && data) {
      setSecrets(p => [...p.filter(s=>s.key!==data.key), data]);
      setKey(''); setVal('');
    }
    setAdding(false);
  };

  const deleteSecret = async (id: string) => {
    await supabase.from('room_secrets').delete().eq('id', id);
    setSecrets(p => p.filter(s => s.id !== id));
  };

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Secrets</Text>
      <Text style={{color:'#666',fontSize:11,padding:14,paddingTop:0,lineHeight:16}}>
        Encrypted KV store for this room. Store API keys, tokens, credentials.
      </Text>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:14,gap:8}}>
        {secrets.map(sec => (
          <View key={sec.id} style={s.secretRow}>
            <Text style={s.secretKey}>{sec.key}</Text>
            <Text style={s.secretVal}>{'•'.repeat(Math.min(sec.value.length,16))}</Text>
            <Pressable onPress={()=>deleteSecret(sec.id)} hitSlop={8}>
              <Text style={{color:'#ef4444',fontSize:12}}>🗑</Text>
            </Pressable>
          </View>
        ))}
        {secrets.length===0 && <Text style={{color:'#555',fontSize:12,textAlign:'center',fontStyle:'italic'}}>No secrets yet</Text>}
      </ScrollView>
      <View style={{padding:14,gap:8,borderTopWidth:1,borderTopColor:'#1a1a1a'}}>
        <TextInput style={s.input} value={key} onChangeText={setKey}
          placeholder="SECRET_KEY" placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} />
        <TextInput style={s.input} value={val} onChangeText={setVal}
          placeholder="value" placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false}
          secureTextEntry />
        <Pressable onPress={addSecret} disabled={!key.trim()||!val.trim()||adding}
          style={[s.submitBtn,{backgroundColor:accentColor,opacity:key.trim()&&val.trim()&&!adding?1:0.5}]}>
          <Text style={s.submitText}>{adding?'Saving...':'Add Secret'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Usage Panel ──────────────────────────────────────────────────────────────

function UsagePanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [usage, setUsage] = useState<any[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [msgCount, setMsgCount] = useState(0);

  useEffect(() => {
    supabase.from('room_usage').select('*').eq('room_id', roomId)
      .order('created_at',{ascending:false}).limit(50)
      .then(({ data }) => setUsage(data||[]));
    supabase.from('room_files').select('id',{count:'exact',head:true}).eq('room_id',roomId).eq('is_deleted',false)
      .then(({count})=>setFileCount(count??0));
    supabase.from('room_messages').select('id',{count:'exact',head:true}).eq('room_id',roomId)
      .then(({count})=>setMsgCount(count??0));
  }, [roomId]);

  const totalTokens = usage.reduce((s,u)=>s+(u.tokens||0),0);
  const totalCost   = usage.reduce((s,u)=>s+(parseFloat(u.cost_usd)||0),0);

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Usage</Text>
      <ScrollView contentContainerStyle={{padding:14,gap:12}}>
        {/* Stats grid */}
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
          {[
            {label:'FILES',   value:fileCount,    color:'#6366f1'},
            {label:'MESSAGES',value:msgCount,     color:'#22c55e'},
            {label:'TOKENS',  value:totalTokens>0?`${(totalTokens/1000).toFixed(1)}K`:0, color:'#f59e0b'},
            {label:'COST',    value:`$${totalCost.toFixed(4)}`, color:'#ef4444'},
          ].map(stat => (
            <View key={stat.label} style={s.statBox}>
              <Text style={[s.statVal,{color:stat.color}]}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Event log */}
        <Text style={s.apiLabel}>ACTIVITY LOG</Text>
        {usage.length===0
          ? <Text style={{color:'#555',fontSize:12,textAlign:'center',fontStyle:'italic'}}>No usage logged yet</Text>
          : usage.map(u => (
            <View key={u.id} style={s.usageRow}>
              <Text style={s.usageEvent}>{u.event_type}</Text>
              <Text style={s.usageAgent}>{u.agent_name||'user'}</Text>
              {u.tokens>0 && <Text style={s.usageTokens}>{u.tokens}t</Text>}
              <Text style={s.usageTime}>{timeAgo(u.created_at)}</Text>
            </View>
          ))
        }
      </ScrollView>
    </View>
  );
}

// ─── Canvas Viewer (Miro-style sticky note whiteboard) ───────────────────────

const STICKY_COLORS = ['#fbbf24','#34d399','#60a5fa','#f472b6','#a78bfa','#fb923c','#f87171','#fff'];

function CanvasViewer({ file, onEdit }: { file: RoomFile; onEdit: (v: string) => void }) {
  const parseNotes = (content: string): StickyNote[] => {
    try { return JSON.parse(content || '{"notes":[]}').notes ?? []; }
    catch { return []; }
  };

  const [notes, setNotes] = useState<StickyNote[]>(() => parseNotes(file.content));
  const [nextColor, setNextColor] = useState('#fbbf24');
  const [brainstorm, setBrainstorm] = useState('');
  const [showBrainstorm, setShowBrainstorm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Debounce onEdit so typing doesn't hammer parent state
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const save = useCallback((n: StickyNote[], immediate = false) => {
    setNotes(n);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const flush = () => onEditRef.current(JSON.stringify({ notes: n }, null, 2));
    if (immediate) flush();
    else saveTimerRef.current = setTimeout(flush, 600);
  }, []);

  // Keep notes in sync if file is saved externally (e.g. another tab)
  const lastContentRef = useRef(file.content);
  useEffect(() => {
    if (file.content !== lastContentRef.current) {
      lastContentRef.current = file.content;
      setNotes(parseNotes(file.content));
    }
  }, [file.content]);

  const addNote = useCallback(() => {
    setNotes(prev => {
      const n: StickyNote = {
        id: Date.now().toString(),
        text: '',
        color: nextColor,
        x: 40 + Math.random() * 300,
        y: 40 + Math.random() * 200,
      };
      const updated = [...prev, n];
      save(updated, true);
      setEditingId(n.id);
      return updated;
    });
  }, [nextColor, save]);

  const updateNote = useCallback((id: string, text: string) => {
    setNotes(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, text } : n);
      save(updated); // debounced — fine for typing
      return updated;
    });
  }, [save]);

  const deleteNote = useCallback((id: string) => {
    setNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      save(updated, true);
      return updated;
    });
    setEditingId(p => p === id ? null : p);
  }, [save]);

  const moveNote = useCallback((id: string, x: number, y: number) => {
    setNotes(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, x, y } : n);
      save(updated, true); // immediate on drop
      return updated;
    });
  }, [save]);

  const generateBrainstorm = useCallback(() => {
    if (!brainstorm.trim()) return;
    const IDEAS = [
      `${brainstorm} — core problem`,
      'Who is the target user?',
      'What does success look like?',
      'List key constraints',
      'Simplest possible version',
      'Riskiest assumption to test first',
    ];
    const colors = ['#fbbf24','#34d399','#60a5fa','#f472b6','#a78bfa','#fb923c'];
    setNotes(prev => {
      const newNotes: StickyNote[] = IDEAS.map((idea, i) => ({
        id: Date.now().toString() + i,
        text: idea,
        color: colors[i % colors.length],
        x: 30 + (i % 3) * 210,
        y: 30 + Math.floor(i / 3) * 160,
      }));
      const updated = [...prev, ...newNotes];
      save(updated, true);
      return updated;
    });
    setBrainstorm('');
    setShowBrainstorm(false);
  }, [brainstorm, save]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0f1a' }}>
      {/* Canvas toolbar */}
      <View style={cvSt.toolbar}>
        <Text style={cvSt.toolbarTitle}>Canvas</Text>
        <View style={cvSt.colorRow}>
          {STICKY_COLORS.map(c => (
            <Pressable key={c} onPress={() => setNextColor(c)}
              style={[cvSt.colorDot, { backgroundColor: c }, nextColor === c && cvSt.colorDotActive]} />
          ))}
        </View>
        <Pressable onPress={addNote} style={[cvSt.toolbarBtn, { backgroundColor: nextColor + '30', borderColor: nextColor + '80' }]}>
          <Text style={{ color: nextColor, fontSize: 11, fontWeight: '800' }}>+ Note</Text>
        </Pressable>
        <Pressable onPress={() => setShowBrainstorm(p => !p)}
          style={[cvSt.toolbarBtn, { backgroundColor: '#8b5cf620', borderColor: '#8b5cf650' }]}>
          <Text style={{ color: '#a78bfa', fontSize: 11, fontWeight: '800' }}>Brainstorm</Text>
        </Pressable>
        <Text style={cvSt.noteCount}>{notes.length} notes</Text>
      </View>

      {/* Brainstorm input */}
      {showBrainstorm && (
        <View style={cvSt.brainstormRow}>
          <TextInput
            style={cvSt.brainstormInput}
            value={brainstorm} onChangeText={setBrainstorm}
            placeholder="Enter a topic to brainstorm..." placeholderTextColor="#555"
            onSubmitEditing={generateBrainstorm} returnKeyType="go"
          />
          <Pressable onPress={generateBrainstorm} disabled={!brainstorm.trim()}
            style={[cvSt.brainstormBtn, { opacity: brainstorm.trim() ? 1 : 0.4 }]}>
            <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '800' }}>Generate</Text>
          </Pressable>
        </View>
      )}

      {/* Canvas area */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ minHeight: 700 }}>
        <View style={{ width: '100%' as any, minHeight: 700, position: 'relative' }}>
          {notes.length === 0 && (
            <View style={cvSt.emptyCanvas}>
              <Text style={cvSt.emptyCanvasText}>Click "+ Note" to add your first sticky note</Text>
              <Text style={cvSt.emptyCanvasSub}>or try Brainstorm to generate ideas</Text>
            </View>
          )}
          {notes.map(note => (
            <StickyNoteCard
              key={note.id}
              note={note}
              isEditing={editingId === note.id}
              onPress={() => setEditingId(note.id)}
              onBlur={() => setEditingId(null)}
              onChange={text => updateNote(note.id, text)}
              onDelete={() => deleteNote(note.id)}
              onMove={(x, y) => moveNote(note.id, x, y)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function StickyNoteCard({ note, isEditing, onPress, onBlur, onChange, onDelete, onMove }: {
  note: StickyNote; isEditing: boolean;
  onPress: () => void; onBlur: () => void;
  onChange: (t: string) => void; onDelete: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const isDragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });
  const posRef = useRef({ x: note.x, y: note.y });
  // Keep posRef in sync with prop when not dragging
  if (!isDragging.current) { posRef.current = { x: note.x, y: note.y }; }

  const webDragProps = Platform.OS === 'web' ? {
    onMouseDown: (e: any) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      isDragging.current = true;
      dragStart.current = { mx: e.clientX, my: e.clientY, nx: posRef.current.x, ny: posRef.current.y };
      const onDrag = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const x = Math.max(0, dragStart.current.nx + ev.clientX - dragStart.current.mx);
        const y = Math.max(0, dragStart.current.ny + ev.clientY - dragStart.current.my);
        posRef.current = { x, y };
        const el = document.getElementById(`sticky-${note.id}`);
        if (el) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
      };
      const onUp = () => {
        isDragging.current = false;
        onMove(posRef.current.x, posRef.current.y);
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', onUp);
    },
  } : {};

  return (
    <Pressable
      onPress={onPress}
      style={[
        cvSt.stickyNote,
        { backgroundColor: note.color, left: note.x, top: note.y },
        isEditing && cvSt.stickyNoteEditing,
      ]}
      // @ts-ignore web only
      id={`sticky-${note.id}`}
      {...webDragProps}
    >
      {/* Delete button */}
      <Pressable onPress={e => { e.stopPropagation?.(); onDelete(); }}
        style={cvSt.stickyDelete} hitSlop={8}>
        <Text style={cvSt.stickyDeleteText}>×</Text>
      </Pressable>

      {/* Content */}
      <TextInput
        style={cvSt.stickyText}
        value={note.text}
        onChangeText={onChange}
        onFocus={onPress}
        onBlur={onBlur}
        multiline
        placeholder="Type here..."
        placeholderTextColor="rgba(0,0,0,0.3)"
      />

      {/* Drag handle */}
      {Platform.OS === 'web' && (
        <View style={cvSt.dragHandle} {...webDragProps}>
          <Text style={cvSt.dragHandleText}>⠿</Text>
        </View>
      )}
    </Pressable>
  );
}

const cvSt = StyleSheet.create({
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
    backgroundColor: '#080d1a', flexWrap: 'wrap',
  },
  toolbarTitle: { color: '#a78bfa', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  colorRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  colorDot: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  colorDotActive: { borderColor: '#fff', transform: [{ scale: 1.2 }] },
  toolbarBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  noteCount: { color: '#555', fontSize: 10, marginLeft: 'auto' as any },
  brainstormRow: {
    flexDirection: 'row', gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#080d1a',
  },
  brainstormInput: {
    flex: 1, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#8b5cf640',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: '#fff', fontSize: 13,
  },
  brainstormBtn: {
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#8b5cf620',
    borderRadius: 8, borderWidth: 1, borderColor: '#8b5cf650',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emptyCanvas: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  emptyCanvasText: { color: '#555', fontSize: 14, fontStyle: 'italic' },
  emptyCanvasSub: { color: '#333', fontSize: 12, marginTop: 6 },
  stickyNote: {
    position: 'absolute',
    width: 180, minHeight: 130,
    borderRadius: 4, padding: 10,
    shadowColor: '#000', shadowOffset: { width: 2, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6,
    elevation: 4,
    ...(Platform.OS === 'web' ? { cursor: 'grab', userSelect: 'none', boxShadow: '2px 4px 12px rgba(0,0,0,0.4)' } as any : {}),
  },
  stickyNoteEditing: {
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(255,255,255,0.5), 2px 4px 12px rgba(0,0,0,0.5)', zIndex: 10 } as any : {}),
  },
  stickyDelete: {
    position: 'absolute', top: 4, right: 6, width: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  stickyDeleteText: { color: 'rgba(0,0,0,0.4)', fontSize: 16, fontWeight: '700', lineHeight: 16 },
  stickyText: {
    color: '#1a1a1a', fontSize: 13, lineHeight: 20, flex: 1,
    textAlignVertical: 'top', minHeight: 90,
    ...(Platform.OS === 'web' ? { outlineWidth: 0, outlineStyle: 'none', resize: 'none', backgroundColor: 'transparent', borderWidth: 0 } as any : {}),
  },
  dragHandle: {
    position: 'absolute', bottom: 4, right: 6,
    ...(Platform.OS === 'web' ? { cursor: 'grab' } as any : {}),
  },
  dragHandleText: { color: 'rgba(0,0,0,0.25)', fontSize: 14 },
});

// ─── Playground Panel (Langfuse-style prompt tester) ─────────────────────────

const PLAYGROUND_MODELS = [
  { id: 'claude-opus-4-6',     label: 'Claude Opus 4.6',    provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6',  provider: 'Anthropic' },
  { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5',   provider: 'Anthropic' },
  { id: 'gpt-4o',              label: 'GPT-4o',             provider: 'OpenAI' },
  { id: 'gpt-4o-mini',         label: 'GPT-4o mini',        provider: 'OpenAI' },
  { id: 'gemini-1.5-pro',      label: 'Gemini 1.5 Pro',     provider: 'Google' },
  { id: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash',   provider: 'Google' },
  { id: 'deepseek-r1',         label: 'DeepSeek R1',        provider: 'DeepSeek' },
];

function makeVariant(label: string): PlaygroundVariant {
  return {
    id: Date.now().toString() + Math.random(),
    label,
    system: 'You are a helpful assistant.',
    userMsg: '',
    model: 'claude-sonnet-4-6',
    temperature: 0.7,
    maxTokens: 1024,
    outputSchema: '',
    toolDefs: '',
  };
}

// Extract {{variable}} placeholders from a string
function extractVars(text: string): string[] {
  const matches = text.matchAll(/\{\{(\w+)\}\}/g);
  const vars: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (!seen.has(m[1])) { seen.add(m[1]); vars.push(m[1]); }
  }
  return vars;
}

// Replace {{variables}} with provided values
function fillVars(text: string, vals: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? `{{${k}}}`);
}

function PlaygroundPanel({ roomId, accentColor, activeFile, circleId }: {
  roomId: string; accentColor: string;
  activeFile?: RoomFile | null; circleId?: string;
}) {
  const [variants, setVariants] = useState<PlaygroundVariant[]>([makeVariant('Variant A')]);
  const [varVals, setVarVals] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState<string | null>(null); // variant id
  const [savedPrompts, setSavedPrompts] = useState<RoomFile[]>([]);
  const [activeTab, setActiveTab] = useState<'prompt' | 'tools' | 'schema'>('prompt');

  // Load saved prompt files (markdown or plaintext)
  useEffect(() => {
    supabase.from('room_files').select('id, name, content, file_type, updated_at')
      .eq('room_id', roomId).eq('is_deleted', false)
      .in('file_type', ['markdown', 'plaintext'])
      .order('updated_at', { ascending: false })
      .then(({ data }) => setSavedPrompts((data || []) as RoomFile[]));
  }, [roomId]);

  // Auto-fill user message when active file changes (skip canvas/image)
  const prevFileId = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFile || activeFile.file_type === 'canvas' || activeFile.file_type === 'image') return;
    if (activeFile.id === prevFileId.current) return;
    prevFileId.current = activeFile.id;
    setVariants(prev => prev.map((v, i) => i === 0 && !v.userMsg
      ? { ...v, userMsg: `Review this ${activeFile.file_type} file:\n\n${activeFile.content.slice(0, 2000)}` }
      : v
    ));
  }, [activeFile?.id, activeFile?.file_type, activeFile?.content]);

  // Collect all {{variable}} placeholders across all variant prompts
  const allVars = useMemo<string[]>(() => {
    const seen = new Set<string>();
    for (const v of variants) {
      for (const x of extractVars(v.system)) seen.add(x);
      for (const x of extractVars(v.userMsg)) seen.add(x);
    }
    return [...seen];
  }, [variants]);

  const updateVariant = (id: string, patch: Partial<PlaygroundVariant>) => {
    setVariants(p => p.map(v => v.id === id ? { ...v, ...patch } : v));
  };

  const addVariant = () => {
    const labels = ['A','B','C','D','E'];
    setVariants(p => [...p, makeVariant(`Variant ${labels[p.length] || p.length + 1}`)]);
  };

  const removeVariant = (id: string) => {
    setVariants(p => p.filter(v => v.id !== id));
  };

  const runAll = async () => {
    setRunning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const v of variants) {
        const sys = fillVars(v.system, varVals);
        const usr = fillVars(v.userMsg, varVals);
        const prompt = `[PLAYGROUND: ${v.label}]\nModel: ${v.model} | Temp: ${v.temperature} | MaxTokens: ${v.maxTokens}\n\nSystem:\n${sys}\n\nUser:\n${usr}`;
        await supabase.from('room_messages').insert({
          room_id: roomId,
          user_id: user?.id || null,
          agent_name: `Playground · ${v.label}`,
          content: prompt,
          message_type: 'agent_output',
          metadata: {
            playground: true, variant: v.label,
            model: v.model, temperature: v.temperature, maxTokens: v.maxTokens,
            outputSchema: v.outputSchema || null,
            toolDefs: v.toolDefs || null,
            status: 'pending',
          },
        });
        await supabase.from('room_usage').insert({
          room_id: roomId, user_id: user?.id || null,
          agent_name: `Playground · ${v.label}`, event_type: 'playground_run',
          metadata: { model: v.model, variant: v.label },
        });
      }
    } finally { setRunning(false); }
  };

  const saveAsFile = async () => {
    const v = variants[0];
    if (!v) return;
    const content = `# Playground Prompt — ${v.label}\n\nModel: ${v.model}\nTemperature: ${v.temperature}\nMax Tokens: ${v.maxTokens}\n\n## System\n${v.system}\n\n## User\n${v.userMsg}${v.outputSchema ? `\n\n## Output Schema\n\`\`\`json\n${v.outputSchema}\n\`\`\`` : ''}${v.toolDefs ? `\n\n## Tools\n\`\`\`json\n${v.toolDefs}\n\`\`\`` : ''}`;
    const { data: { user } } = await supabase.auth.getUser();
    const name = `prompt-${Date.now()}.md`;
    await supabase.from('room_files').insert({
      room_id: roomId, name, folder: '/', file_type: 'markdown',
      content, size_bytes: content.length, created_by: user?.id || null,
    });
  };

  const loadFromFile = (file: RoomFile) => {
    const sysMatch = file.content.match(/## System\n([\s\S]*?)(?=\n## |\n$)/);
    const usrMatch = file.content.match(/## User\n([\s\S]*?)(?=\n## |\n$)/);
    if (sysMatch || usrMatch) {
      updateVariant(variants[0].id, {
        system: sysMatch?.[1]?.trim() || variants[0].system,
        userMsg: usrMatch?.[1]?.trim() || variants[0].userMsg,
      });
    }
  };

  return (
    <View style={s.panel}>
      {/* Header */}
      <View style={[s.panelHeader, { flexWrap: 'wrap', gap: 6 }]}>
        <Text style={[s.panelTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Playground</Text>
        <Pressable onPress={addVariant} disabled={variants.length >= 4}
          style={[pgSt.headerBtn, { opacity: variants.length < 4 ? 1 : 0.4 }]}>
          <Text style={pgSt.headerBtnText}>+ Variant</Text>
        </Pressable>
        <Pressable onPress={saveAsFile} style={pgSt.headerBtn}>
          <Text style={pgSt.headerBtnText}>Save</Text>
        </Pressable>
        <Pressable onPress={runAll} disabled={running}
          style={[pgSt.runBtn, { backgroundColor: accentColor, opacity: running ? 0.6 : 1 }]}>
          <Text style={pgSt.runBtnText}>{running ? 'Running...' : variants.length > 1 ? `▶ Run All (${variants.length})` : '▶ Run'}</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}>

        {/* Sub-tabs: Prompt | Tools | Schema */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
          {(['prompt','tools','schema'] as const).map(t => (
            <Pressable key={t} onPress={() => setActiveTab(t)}
              style={[panelTabSt.tab, activeTab === t && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
              <Text style={[panelTabSt.tabText, activeTab === t && { color: accentColor }]}>
                {t === 'prompt' ? 'PROMPT' : t === 'tools' ? 'TOOLS' : 'SCHEMA'}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setShowAdvanced(p => !p)} style={panelTabSt.tab}>
            <Text style={[panelTabSt.tabText, showAdvanced && { color: '#888' }]}>PARAMS</Text>
          </Pressable>
        </View>

        {/* Variables */}
        {allVars.length > 0 && (
          <View style={pgSt.varSection}>
            <Text style={pgSt.sectionLabel}>VARIABLES</Text>
            {allVars.map(v => (
              <View key={v} style={pgSt.varRow}>
                <Text style={pgSt.varName}>{`{{${v}}}`}</Text>
                <TextInput style={pgSt.varInput} value={varVals[v] || ''}
                  onChangeText={val => setVarVals(p => ({ ...p, [v]: val }))}
                  placeholder={`Value for ${v}`} placeholderTextColor="#555" />
              </View>
            ))}
          </View>
        )}

        {/* Variants — side by side on wide, stacked on narrow */}
        <View style={[pgSt.variantsRow, variants.length === 1 && { flexDirection: 'column' }]}>
          {variants.map(v => (
            <View key={v.id} style={[pgSt.variantCard, variants.length > 1 && { flex: 1 }]}>
              {/* Variant header */}
              <View style={pgSt.variantHeader}>
                <Text style={pgSt.variantLabel}>{v.label}</Text>
                {/* Model selector */}
                <Pressable onPress={() => setShowModelPicker(showModelPicker === v.id ? null : v.id)}
                  style={pgSt.modelBtn}>
                  <Text style={pgSt.modelBtnText}>{v.model.split('/').pop() ?? v.model}</Text>
                  <Text style={{ color: '#555', fontSize: 10 }}>▾</Text>
                </Pressable>
                {variants.length > 1 && (
                  <Pressable onPress={() => removeVariant(v.id)} hitSlop={8}>
                    <Text style={{ color: '#555', fontSize: 14 }}>×</Text>
                  </Pressable>
                )}
              </View>

              {/* Model dropdown */}
              {showModelPicker === v.id && (
                <View style={pgSt.modelDropdown}>
                  {PLAYGROUND_MODELS.map(m => (
                    <Pressable key={m.id} onPress={() => { updateVariant(v.id, { model: m.id }); setShowModelPicker(null); }}
                      style={[pgSt.modelOption, v.model === m.id && { backgroundColor: accentColor + '20' }]}>
                      <Text style={pgSt.modelOptionProvider}>{m.provider}</Text>
                      <Text style={[pgSt.modelOptionLabel, v.model === m.id && { color: accentColor }]}>{m.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Params */}
              {showAdvanced && (
                <View style={pgSt.paramsRow}>
                  <View style={pgSt.paramBox}>
                    <Text style={pgSt.paramLabel}>TEMP</Text>
                    <TextInput style={pgSt.paramInput}
                      value={String(v.temperature)}
                      onChangeText={val => updateVariant(v.id, { temperature: parseFloat(val) || 0 })}
                      keyboardType="decimal-pad" />
                  </View>
                  <View style={pgSt.paramBox}>
                    <Text style={pgSt.paramLabel}>MAX TOKENS</Text>
                    <TextInput style={pgSt.paramInput}
                      value={String(v.maxTokens)}
                      onChangeText={val => updateVariant(v.id, { maxTokens: parseInt(val) || 1024 })}
                      keyboardType="number-pad" />
                  </View>
                </View>
              )}

              {activeTab === 'prompt' && (
                <>
                  <Text style={pgSt.fieldLabel}>System</Text>
                  <TextInput style={pgSt.promptInput}
                    value={v.system} onChangeText={text => updateVariant(v.id, { system: text })}
                    multiline placeholder="System prompt... use {{variable}} for inputs"
                    placeholderTextColor="#555" autoCapitalize="none" />
                  <Text style={pgSt.fieldLabel}>User</Text>
                  <TextInput style={[pgSt.promptInput, { minHeight: 100 }]}
                    value={v.userMsg} onChangeText={text => updateVariant(v.id, { userMsg: text })}
                    multiline placeholder="User message..."
                    placeholderTextColor="#555" autoCapitalize="none" />
                </>
              )}

              {activeTab === 'tools' && (
                <>
                  <Text style={pgSt.fieldLabel}>Tool Definitions (JSON)</Text>
                  <TextInput style={[pgSt.promptInput, { minHeight: 160, fontFamily: MONO, fontSize: 11 }]}
                    value={v.toolDefs} onChangeText={text => updateVariant(v.id, { toolDefs: text })}
                    multiline placeholder={'[\n  {\n    "name": "tool_name",\n    "description": "...",\n    "parameters": {}\n  }\n]'}
                    placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} />
                </>
              )}

              {activeTab === 'schema' && (
                <>
                  <Text style={pgSt.fieldLabel}>Output Schema (JSON Schema)</Text>
                  <TextInput style={[pgSt.promptInput, { minHeight: 160, fontFamily: MONO, fontSize: 11 }]}
                    value={v.outputSchema} onChangeText={text => updateVariant(v.id, { outputSchema: text })}
                    multiline placeholder={'{\n  "type": "object",\n  "properties": {\n    "result": { "type": "string" }\n  }\n}'}
                    placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} />
                </>
              )}
            </View>
          ))}
        </View>

        {/* Saved prompts */}
        {savedPrompts.length > 0 && (
          <View>
            <Text style={pgSt.sectionLabel}>SAVED PROMPTS</Text>
            {savedPrompts.map(f => (
              <Pressable key={f.id} onPress={() => loadFromFile(f)} style={pgSt.savedPromptRow}>
                <Text style={pgSt.savedPromptName}>{f.name}</Text>
                <Text style={pgSt.savedPromptTime}>{timeAgo(f.updated_at)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const pgSt = StyleSheet.create({
  headerBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#333',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  headerBtnText: { color: '#888', fontSize: 11, fontWeight: '700' },
  runBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  runBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  sectionLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  varSection: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#1a1a1a', gap: 6 },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  varName: { color: '#a78bfa', fontSize: 11, fontFamily: MONO, fontWeight: '700', width: 90 },
  varInput: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, color: '#fff', fontSize: 12 },
  variantsRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  variantCard: { backgroundColor: '#0d0d0d', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1a1a2e', gap: 6, minWidth: 200 },
  variantHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  variantLabel: { color: '#fff', fontSize: 12, fontWeight: '800', flex: 1 },
  modelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  modelBtnText: { color: '#aaa', fontSize: 10, fontFamily: MONO },
  modelDropdown: { backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  modelOption: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  modelOptionProvider: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  modelOptionLabel: { color: '#ccc', fontSize: 12, fontWeight: '600', marginTop: 1 },
  paramsRow: { flexDirection: 'row', gap: 8 },
  paramBox: { flex: 1 },
  paramLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  paramInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, color: '#fff', fontSize: 12, fontFamily: MONO },
  fieldLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  promptInput: {
    backgroundColor: '#080d1a', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, color: '#e6e6e6', fontSize: 13,
    lineHeight: 20, minHeight: 70, textAlignVertical: 'top',
  },
  savedPromptRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  savedPromptName: { color: '#888', fontSize: 12, fontFamily: MONO, flex: 1 },
  savedPromptTime: { color: '#555', fontSize: 10 },
});

// ─── Sessions Panel ───────────────────────────────────────────────────────────
// Live session viewer — logs, traces, metrics per run (MeshAgent Studio style)

interface SessionEntry {
  id: string;
  room_id: string;
  agent_name: string | null;
  user_id: string | null;
  event_type: string;
  tokens: number;
  cost_usd: number;
  metadata: any;
  created_at: string;
}

function SessionsPanel({ roomId, roomName, accentColor }: { roomId: string; roomName: string; accentColor: string }) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [view, setView] = useState<'logs' | 'traces' | 'metrics'>('logs');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    supabase.from('room_usage').select('*').eq('room_id', roomId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setSessions(data || []));

    const ch = supabase.channel(`sessions:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_usage', filter: `room_id=eq.${roomId}` },
        p => setSessions(prev => [p.new as SessionEntry, ...prev].slice(0, 100)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  const filtered = filter
    ? sessions.filter(s => s.event_type.includes(filter) || (s.agent_name||'').includes(filter))
    : sessions;

  const totalTokens = sessions.reduce((s, e) => s + (e.tokens || 0), 0);
  const totalCost   = sessions.reduce((s, e) => s + (parseFloat(String(e.cost_usd)) || 0), 0);
  const byAgent: Record<string, number> = {};
  sessions.forEach(s => { if (s.agent_name) byAgent[s.agent_name] = (byAgent[s.agent_name] || 0) + 1; });

  const STATUS_COLORS_MAP: Record<string, string> = {
    file_write: '#22c55e', file_read: '#6366f1', message: '#3b82f6',
    agent_task: '#f59e0b', error: '#ef4444',
  };

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Sessions</Text>

      {/* View toggle */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 14, gap: 6, marginBottom: 8 }}>
        {(['logs', 'traces', 'metrics'] as const).map(v => (
          <Pressable key={v} onPress={() => setView(v)}
            style={[panelTabSt.tab, view === v && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
            <Text style={[panelTabSt.tabText, view === v && { color: accentColor }]}>{v.toUpperCase()}</Text>
          </Pressable>
        ))}
        <TextInput style={panelTabSt.filterInput} value={filter} onChangeText={setFilter}
          placeholder="Filter..." placeholderTextColor="#555" autoCapitalize="none" />
      </View>

      {view === 'logs' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 12, gap: 3 }}>
          {filtered.length === 0 && <Text style={panelTabSt.empty}>No session logs yet</Text>}
          {filtered.map(e => (
            <View key={e.id} style={panelTabSt.logRow}>
              <View style={[panelTabSt.logDot, { backgroundColor: STATUS_COLORS_MAP[e.event_type] || '#888' }]} />
              <Text style={panelTabSt.logEvent}>{e.event_type}</Text>
              {e.agent_name && <Text style={panelTabSt.logAgent}>{e.agent_name}</Text>}
              {e.tokens > 0 && <Text style={panelTabSt.logTokens}>{e.tokens}t</Text>}
              <Text style={panelTabSt.logTime}>{timeAgo(e.created_at)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {view === 'traces' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }}>
          {filtered.length === 0 && <Text style={panelTabSt.empty}>No traces yet</Text>}
          {filtered.map(e => (
            <View key={e.id} style={panelTabSt.traceRow}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={[panelTabSt.logEvent, { color: STATUS_COLORS_MAP[e.event_type] || '#aaa' }]}>{e.event_type}</Text>
                <Text style={panelTabSt.logTime}>{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
              </View>
              {e.agent_name && <Text style={{ color: '#6366f1', fontSize: 11, fontFamily: MONO, marginBottom: 2 }}>{e.agent_name}</Text>}
              {e.metadata && Object.keys(e.metadata).length > 0 && (
                <Text style={{ color: '#555', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>
                  {JSON.stringify(e.metadata)}
                </Text>
              )}
              {e.tokens > 0 && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: '#f59e0b', fontSize: 10 }}>{e.tokens} tokens</Text>
                  <Text style={{ color: '#ef4444', fontSize: 10 }}>${parseFloat(String(e.cost_usd)).toFixed(6)}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {view === 'metrics' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#6366f1' }]}>{sessions.length}</Text><Text style={s.statLabel}>EVENTS</Text></View>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#f59e0b' }]}>{totalTokens > 0 ? `${(totalTokens/1000).toFixed(1)}K` : '0'}</Text><Text style={s.statLabel}>TOKENS</Text></View>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#ef4444' }]}>${totalCost.toFixed(4)}</Text><Text style={s.statLabel}>COST</Text></View>
          </View>

          <Text style={s.apiLabel}>BY AGENT</Text>
          {Object.entries(byAgent).length === 0
            ? <Text style={panelTabSt.empty}>No agent activity yet</Text>
            : Object.entries(byAgent).sort((a,b) => b[1]-a[1]).map(([name, count]) => (
              <View key={name} style={{ marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>{name}</Text>
                  <Text style={{ color: '#6366f1', fontSize: 12, fontWeight: '700' }}>{count}</Text>
                </View>
                <View style={{ height: 4, backgroundColor: '#1a1a1a', borderRadius: 2 }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: accentColor,
                    width: `${Math.round((count / sessions.length) * 100)}%` as any }} />
                </View>
              </View>
            ))
          }

          <Text style={s.apiLabel}>EVENT BREAKDOWN</Text>
          {Object.entries(
            sessions.reduce((acc, e) => { acc[e.event_type] = (acc[e.event_type]||0)+1; return acc; }, {} as Record<string,number>)
          ).sort((a,b)=>b[1]-a[1]).map(([type, count]) => (
            <View key={type} style={panelTabSt.logRow}>
              <View style={[panelTabSt.logDot, { backgroundColor: STATUS_COLORS_MAP[type] || '#888' }]} />
              <Text style={panelTabSt.logEvent}>{type}</Text>
              <Text style={{ color: '#888', fontSize: 11, marginLeft: 'auto' as any }}>{count}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Services Panel ───────────────────────────────────────────────────────────

function ServicesPanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [services, setServices] = useState<RoomService[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RoomService['type']>('agent');
  const [newDesc, setNewDesc] = useState('');
  const [loading, setLoading] = useState(true);

  const SERVICE_TYPES: RoomService['type'][] = ['agent', 'tool', 'webhook', 'scheduled'];
  const STATUS_COLOR: Record<RoomService['status'], string> = {
    running: '#22c55e', stopped: '#6b7280', error: '#ef4444', deploying: '#f59e0b',
  };

  useEffect(() => {
    supabase.from('room_services').select('*').eq('room_id', roomId).order('created_at')
      .then(({ data }) => { setServices(data || []); setLoading(false); });
  }, [roomId]);

  const toggleService = async (id: string) => {
    const svc = services.find(s => s.id === id);
    if (!svc) return;
    const newStatus = svc.status === 'running' ? 'stopped' : 'running';
    await supabase.from('room_services').update({ status: newStatus }).eq('id', id);
    setServices(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const addService = async () => {
    if (!newName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_services').insert({
      room_id: roomId, name: newName.trim(), type: newType,
      status: 'stopped', description: newDesc.trim() || null, created_by: user?.id || null,
    }).select().single();
    if (!error && data) { setServices(p => [...p, data]); }
    setNewName(''); setNewDesc(''); setShowAdd(false);
  };

  const removeService = async (id: string) => {
    await supabase.from('room_services').delete().eq('id', id);
    setServices(p => p.filter(s => s.id !== id));
  };

  return (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={[s.panelTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Services</Text>
        <Pressable onPress={() => setShowAdd(p => !p)} style={[s.panelBtn, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700' }}>+ Deploy</Text>
        </Pressable>
      </View>

      {showAdd && (
        <View style={panelTabSt.addBox}>
          <TextInput style={s.input} value={newName} onChangeText={setNewName}
            placeholder="Service name" placeholderTextColor="#555" autoCapitalize="none" autoFocus />
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            {SERVICE_TYPES.map(t => (
              <Pressable key={t} onPress={() => setNewType(t)}
                style={[panelTabSt.miniTab, newType === t && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                <Text style={[{ color: '#888', fontSize: 10 }, newType === t && { color: accentColor }]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={[s.input, { marginTop: 6 }]} value={newDesc} onChangeText={setNewDesc}
            placeholder="Description (optional)" placeholderTextColor="#555" />
          <Pressable onPress={addService} disabled={!newName.trim()}
            style={[s.submitBtn, { backgroundColor: accentColor, marginTop: 8, opacity: newName.trim() ? 1 : 0.5 }]}>
            <Text style={s.submitText}>Deploy</Text>
          </Pressable>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }}>
        {loading && <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />}
        {!loading && services.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 30 }}>
            <Text style={panelTabSt.empty}>No services yet</Text>
            <Text style={{ color: '#444', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 16 }}>
              Deploy agents, tools, webhooks, or scheduled tasks scoped to this Room.
            </Text>
          </View>
        )}
        {services.map(svc => (
          <View key={svc.id} style={panelTabSt.serviceRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={[panelTabSt.statusDot, { backgroundColor: STATUS_COLOR[svc.status] }]} />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 }}>{svc.name}</Text>
              <View style={[panelTabSt.typeBadge]}>
                <Text style={{ color: '#888', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>{svc.type.toUpperCase()}</Text>
              </View>
            </View>
            {svc.description && <Text style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>{svc.description}</Text>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => toggleService(svc.id)}
                style={[panelTabSt.svcBtn, { backgroundColor: svc.status === 'running' ? '#ef444420' : '#22c55e20',
                  borderColor: svc.status === 'running' ? '#ef444450' : '#22c55e50' }]}>
                <Text style={{ color: svc.status === 'running' ? '#ef4444' : '#22c55e', fontSize: 11, fontWeight: '700' }}>
                  {svc.status === 'running' ? 'Stop' : 'Start'}
                </Text>
              </Pressable>
              <Text style={{ color: STATUS_COLOR[svc.status], fontSize: 11, alignSelf: 'center' }}>{svc.status}</Text>
              <Pressable onPress={() => removeService(svc.id)} style={{ marginLeft: 'auto' as any }} hitSlop={8}>
                <Text style={{ color: '#ef4444', fontSize: 12 }}>🗑</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Permissions Panel ────────────────────────────────────────────────────────
// Fine-grained role assignment per Room member

type Permission = 'agents' | 'containers' | 'database' | 'messaging' | 'queues' | 'secrets' | 'storage' | 'sync';
const ALL_PERMISSIONS: Permission[] = ['agents','containers','database','messaging','queues','secrets','storage','sync'];

interface RoomMember {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: Permission[];
}

function PermissionsPanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load circle members with their profile emails
    supabase.from('circle_members').select('user_id, role, profiles(display_name, username)')
      .then(({ data }) => {
        if (data) {
          setMembers(data.map((m: any) => ({
            userId: m.user_id,
            email: m.profiles?.display_name || m.profiles?.username || m.user_id.slice(0, 8) + '...',
            role: m.role || 'member',
            permissions: ALL_PERMISSIONS,
          })));
        }
        setLoading(false);
      });
  }, [roomId]);

  const ROLE_COLOR: Record<string, string> = {
    owner: '#f59e0b', admin: '#6366f1', member: '#22c55e', viewer: '#6b7280',
  };

  const togglePermission = (userId: string, perm: Permission) => {
    setMembers(prev => prev.map(m => {
      if (m.userId !== userId) return m;
      const has = m.permissions.includes(perm);
      return { ...m, permissions: has ? m.permissions.filter(p => p !== perm) : [...m.permissions, perm] };
    }));
  };

  if (loading) return <View style={s.panel}><ActivityIndicator color={accentColor} style={{ marginTop: 20 }} /></View>;

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>Permissions</Text>
      <Text style={{ color: '#666', fontSize: 11, paddingHorizontal: 14, marginBottom: 10, lineHeight: 16 }}>
        Assign roles and control API access per member for this Room.
      </Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {members.length === 0 && <Text style={[panelTabSt.empty, { paddingHorizontal: 14 }]}>No members found</Text>}
        {members.map(member => (
          <View key={member.userId} style={panelTabSt.memberRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
              <View style={[panelTabSt.memberAvatar, { backgroundColor: ROLE_COLOR[member.role] + '30' }]}>
                <Text style={{ color: ROLE_COLOR[member.role], fontSize: 12, fontWeight: '700' }}>
                  {member.email[0].toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: '#ccc', fontSize: 12, flex: 1 }} numberOfLines={1}>{member.email}</Text>
              <View style={[panelTabSt.roleBadge, { backgroundColor: ROLE_COLOR[member.role] + '20', borderColor: ROLE_COLOR[member.role] + '50' }]}>
                <Text style={{ color: ROLE_COLOR[member.role], fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>{member.role.toUpperCase()}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingHorizontal: 14, paddingBottom: 10 }}>
              {ALL_PERMISSIONS.map(perm => {
                const has = member.permissions.includes(perm);
                return (
                  <Pressable key={perm} onPress={() => togglePermission(member.userId, perm)}
                    style={[panelTabSt.permBadge, has && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                    <Text style={[{ color: '#555', fontSize: 9, fontWeight: '700' }, has && { color: accentColor }]}>{perm}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Tasks Panel ──────────────────────────────────────────────────────────────

function TasksPanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [tasks, setTasks] = useState<RoomTask[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('room_tasks').select('*').eq('room_id', roomId).order('created_at')
      .then(({ data }) => {
        if (data) setTasks(data.map((t: any) => ({
          id: t.id, name: t.name, schedule: t.schedule,
          agent: t.agent, prompt: t.prompt, enabled: t.enabled,
          lastRun: t.last_run_at, nextRun: t.next_run_at,
        })));
        setLoading(false);
      });
  }, [roomId]);

  const addTask = async () => {
    if (!name.trim() || !prompt.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_tasks').insert({
      room_id: roomId, name: name.trim(),
      schedule: schedule.trim() || 'once',
      agent: agent.trim() || 'Assistant',
      prompt: prompt.trim(), enabled: true,
      created_by: user?.id || null,
    }).select().single();
    if (!error && data) {
      setTasks(p => [...p, { id: data.id, name: data.name, schedule: data.schedule, agent: data.agent, prompt: data.prompt, enabled: data.enabled, lastRun: data.last_run_at, nextRun: data.next_run_at }]);
    }
    setName(''); setSchedule('0 9 * * *'); setAgent(''); setPrompt('');
    setShowAdd(false);
  };

  const toggleTask = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    await supabase.from('room_tasks').update({ enabled: !task.enabled }).eq('id', id);
    setTasks(p => p.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const deleteTask = async (id: string) => {
    await supabase.from('room_tasks').delete().eq('id', id);
    setTasks(p => p.filter(t => t.id !== id));
  };

  const PRESETS = [
    { label: 'Daily 9am', value: '0 9 * * *' },
    { label: 'Hourly', value: '0 * * * *' },
    { label: 'Mon 9am', value: '0 9 * * 1' },
    { label: 'Once', value: 'once' },
  ];

  return (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={[s.panelTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Tasks</Text>
        <Pressable onPress={() => setShowAdd(p => !p)} style={[s.panelBtn, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700' }}>+ Schedule</Text>
        </Pressable>
      </View>

      {showAdd && (
        <ScrollView style={panelTabSt.addBox} keyboardShouldPersistTaps="handled">
          <TextInput style={s.input} value={name} onChangeText={setName}
            placeholder="Task name" placeholderTextColor="#555" />

          <Text style={[s.label, { marginTop: 8 }]}>Schedule</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {PRESETS.map(p => (
              <Pressable key={p.value} onPress={() => setSchedule(p.value)}
                style={[panelTabSt.miniTab, schedule === p.value && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                <Text style={[{ color: '#888', fontSize: 10 }, schedule === p.value && { color: accentColor }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={s.input} value={schedule} onChangeText={setSchedule}
            placeholder="cron expr or 'once'" placeholderTextColor="#555" autoCapitalize="none" />

          <TextInput style={[s.input, { marginTop: 6 }]} value={agent} onChangeText={setAgent}
            placeholder="Agent name (optional)" placeholderTextColor="#555" />
          <TextInput style={[s.input, { marginTop: 6, height: 70 }]} value={prompt} onChangeText={setPrompt}
            placeholder="What should the agent do?" placeholderTextColor="#555" multiline />

          <Pressable onPress={addTask} disabled={!name.trim() || !prompt.trim()}
            style={[s.submitBtn, { backgroundColor: accentColor, marginTop: 8, opacity: name.trim() && prompt.trim() ? 1 : 0.5 }]}>
            <Text style={s.submitText}>Add Task</Text>
          </Pressable>
        </ScrollView>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }}>
        {loading && <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />}
        {!loading && tasks.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 30 }}>
            <Text style={panelTabSt.empty}>No tasks scheduled</Text>
            <Text style={{ color: '#444', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 16 }}>
              Schedule recurring or one-shot agent tasks tied to this Room.
            </Text>
          </View>
        )}
        {tasks.map(task => (
          <View key={task.id} style={[panelTabSt.serviceRow, { opacity: task.enabled ? 1 : 0.5 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={[panelTabSt.statusDot, { backgroundColor: task.enabled ? '#22c55e' : '#6b7280' }]} />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 }}>{task.name}</Text>
              <View style={panelTabSt.typeBadge}>
                <Text style={{ color: '#888', fontSize: 9, fontWeight: '700' }}>{task.schedule}</Text>
              </View>
            </View>
            <Text style={{ color: '#666', fontSize: 11, marginBottom: 4 }} numberOfLines={2}>{task.prompt}</Text>
            <Text style={{ color: '#6366f1', fontSize: 10, marginBottom: 6, fontFamily: MONO }}>→ {task.agent}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => toggleTask(task.id)}
                style={[panelTabSt.svcBtn, { backgroundColor: task.enabled ? '#ef444420' : '#22c55e20',
                  borderColor: task.enabled ? '#ef444450' : '#22c55e50' }]}>
                <Text style={{ color: task.enabled ? '#ef4444' : '#22c55e', fontSize: 11, fontWeight: '700' }}>
                  {task.enabled ? 'Disable' : 'Enable'}
                </Text>
              </Pressable>
              <Pressable onPress={() => deleteTask(task.id)} style={{ marginLeft: 'auto' as any }} hitSlop={8}>
                <Text style={{ color: '#ef4444', fontSize: 12 }}>🗑</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Shared panel sub-styles ──────────────────────────────────────────────────
const panelTabSt = StyleSheet.create({
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  tabText: { color: '#666', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  filterInput: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, color: '#fff', fontSize: 11 },
  empty: { color: '#555', fontSize: 12, textAlign: 'center', fontStyle: 'italic', marginTop: 20 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#111' },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logEvent: { color: '#888', fontSize: 11, fontFamily: MONO, flex: 1 },
  logAgent: { color: '#6366f1', fontSize: 10, fontWeight: '700' },
  logTokens: { color: '#f59e0b', fontSize: 10 },
  logTime: { color: '#444', fontSize: 10 },
  traceRow: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#1a1a1a' },
  addBox: { backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#1a1a1a', padding: 14, maxHeight: 320 },
  serviceRow: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  typeBadge: { backgroundColor: '#1a1a1a', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  svcBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  miniTab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  memberRow: { borderBottomWidth: 1, borderBottomColor: '#111' },
  memberAvatar: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  permBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#0a0a0a' },
  dragging: { opacity:0.85 },
  center: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#0a0a0a' },
  loadingText: { color:'#888', marginTop:8, fontSize:12 },

  // List
  listHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:'#1a1a1a' },
  listTitle: { color:'#fff', fontSize:18, fontWeight:'800', letterSpacing:1 },
  listSub: { color:'#666', fontSize:12 },
  list: { flex:1 },
  listContent: { padding:16 },
  createBtn: { paddingHorizontal:16, paddingVertical:10, borderRadius:12, borderWidth:1, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  createBtnText: { fontSize:13, fontWeight:'700' },

  // Grid
  grid: { flexDirection:'row', flexWrap:'wrap', gap:14 },
  gridMobile: { flexDirection:'column' },

  // Room Card
  card: { backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:14, padding:16, minWidth:260, maxWidth:420, flex:1, ...(Platform.OS==='web'?{cursor:'pointer',transition:'all 0.2s ease'} as any:{}) },
  cardMobile: { maxWidth:'100%' as any },
  cardHeader: { flexDirection:'row', alignItems:'center', marginBottom:8, gap:6 },
  cardIcon: { fontSize:16 },
  cardName: { color:'#fff', fontSize:15, fontWeight:'700', flex:1 },
  cardPath: { color:'#888', fontSize:12, fontFamily:MONO, marginBottom:6 },
  cardDesc: { color:'#666', fontSize:12, marginBottom:8, lineHeight:18 },
  cardFooter: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  cardTime: { color:'#555', fontSize:11 },
  cardFiles: { backgroundColor:'#ffffff08', paddingHorizontal:8, paddingVertical:3, borderRadius:6 },
  cardFilesText: { color:'#666', fontSize:11 },
  cardDelete: { paddingHorizontal:6, paddingVertical:2, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  cardDeleteText: { fontSize:14, opacity:0.4 },
  cardApiBadges: { flexDirection:'row', gap:6 },
  cardApiBadge: { fontSize:12, opacity:0.5 },

  // Lang badge
  langBadge: { paddingHorizontal:7, paddingVertical:3, borderRadius:6, borderWidth:1 },
  langBadgeText: { fontSize:10, fontWeight:'700', letterSpacing:0.5 },

  // Empty state
  empty: { alignItems:'center', paddingVertical:60 },
  emptyIcon: { fontSize:48, marginBottom:12 },
  emptyTitle: { color:'#fff', fontSize:18, fontWeight:'700', marginBottom:8 },
  emptySub: { color:'#888', fontSize:13, textAlign:'center', maxWidth:300, marginBottom:20, lineHeight:20 },
  emptyBtn: { paddingHorizontal:20, paddingVertical:12, borderRadius:12 },
  emptyBtnText: { color:'#fff', fontSize:14, fontWeight:'700' },
  emptyText: { color:'#555', fontSize:13, fontStyle:'italic' },

  // Modal
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'center', alignItems:'center' },
  modalBox: { backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:16, padding:24, width:'90%', maxWidth:540, maxHeight:'90%' },
  modalTitle: { color:'#fff', fontSize:18, fontWeight:'800', marginBottom:4 },
  modalSub: { color:'#666', fontSize:12, marginBottom:20, lineHeight:18 },
  label: { color:'#888', fontSize:12, fontWeight:'600', marginBottom:6, marginTop:12, letterSpacing:0.5 },
  input: { backgroundColor:'#0a0a0a', borderWidth:1, borderColor:'#222', borderRadius:10, paddingHorizontal:14, paddingVertical:10, color:'#fff', fontSize:14 },
  langPicker: { marginBottom:4 },
  langOpt: { paddingHorizontal:12, paddingVertical:6, borderRadius:8, borderWidth:1, borderColor:'#222', marginRight:6, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  langOptText: { color:'#888', fontSize:12, fontWeight:'600' },
  modalActions: { flexDirection:'row', justifyContent:'flex-end', gap:10, marginTop:20 },
  cancelBtn: { paddingHorizontal:16, paddingVertical:10, borderRadius:10 },
  cancelText: { color:'#888', fontSize:14, fontWeight:'600' },
  submitBtn: { paddingHorizontal:20, paddingVertical:10, borderRadius:10 },
  submitText: { color:'#fff', fontSize:14, fontWeight:'700' },

  // Detail Top Bar
  detailBar: { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#1a1a1a', gap:10 },
  backBtn: { paddingHorizontal:10, paddingVertical:6, borderRadius:8, backgroundColor:'#ffffff08', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  backText: { color:'#888', fontSize:13, fontWeight:'600' },
  detailName: { color:'#fff', fontSize:15, fontWeight:'700', flex:1 },
  detailActions: { flexDirection:'row', gap:6 },
  barBtn: { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1, borderColor:'#333', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },

  // Right Panel Tabs
  rightPanelTabs: { flexDirection:'row', paddingHorizontal:8, paddingVertical:6, gap:4, borderBottomWidth:1, borderBottomColor:'#1a1a1a', backgroundColor:'#0a0a0a' },
  rpTab: { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1, borderColor:'#222', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  rpTabText: { color:'#888', fontSize:11, fontWeight:'700' },

  // Body
  body: { flex:1, flexDirection:'row' },

  // Sidebar
  sidebar: { width:200, borderRightWidth:1, borderRightColor:'#1a1a1a', backgroundColor:'#0d0d0d' },
  sidebarMobile: { width:160 },
  sidebarHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:12, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#1a1a1a' },
  sidebarTitle: { color:'#555', fontSize:10, fontWeight:'800', letterSpacing:1 },
  sidebarAdd: { padding:4, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  sidebarScroll: { flex:1 },

  // Folder
  folderRow: { flexDirection:'row', alignItems:'center', paddingHorizontal:10, paddingVertical:6, gap:4, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  folderArrow: { color:'#555', fontSize:10, width:10 },
  folderIcon: { fontSize:12 },
  folderName: { color:'#888', fontSize:12, fontWeight:'600', flex:1 },
  folderCount: { color:'#555', fontSize:10 },

  // File Row
  fileRow: { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:5, gap:6, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  fileRowIcon: { fontSize:12 },
  fileRowName: { color:'#888', fontSize:12, flex:1 },
  fileRowActions: { flexDirection:'row', gap:6 },
  fileRowAction: { fontSize:12, color:'#888' },

  // Drop hint
  dropHint: { padding:12, margin:10, borderRadius:8, borderWidth:1, borderColor:'#1a1a1a', borderStyle:'dashed', alignItems:'center' },
  dropHintText: { color:'#555', fontSize:10, textAlign:'center' },

  // Editor Pane
  editorPane: { flex:1, flexDirection:'column' },
  tabBar: { maxHeight:36, borderBottomWidth:1, borderBottomColor:'#1a1a1a', backgroundColor:'#080808' },
  editorTab: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:8, gap:5, borderBottomWidth:2, borderBottomColor:'transparent', minWidth:120, maxWidth:180, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  editorTabIcon: { fontSize:12 },
  editorTabName: { color:'#888', fontSize:12, flex:1 },
  tabClose: { padding:2, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  tabCloseText: { color:'#555', fontSize:14, lineHeight:14 },

  // File Toolbar
  fileToolbar: { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#1a1a1a', backgroundColor:'#0d1117', gap:10 },
  fileToolbarPath: { color:'#888', fontSize:12, fontFamily:MONO, flex:1 },
  fileToolbarRight: { flexDirection:'row', alignItems:'center', gap:8 },
  fileToolbarMeta: { color:'#555', fontSize:11 },
  fileAction: { paddingHorizontal:8, paddingVertical:3, borderRadius:6, backgroundColor:'#ffffff08', borderWidth:1, borderColor:'#222', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  fileActionText: { color:'#888', fontSize:11, fontWeight:'600' },
  tag: { backgroundColor:'#6366f120', paddingHorizontal:6, paddingVertical:2, borderRadius:4, borderWidth:1, borderColor:'#6366f140' },
  tagText: { color:'#a5b4fc', fontSize:10, fontWeight:'600' },

  // No file
  noFile: { flex:1, justifyContent:'center', alignItems:'center', gap:8 },
  noFileIcon: { fontSize:48, opacity:0.3 },
  noFileText: { color:'#555', fontSize:14 },
  noFileSub: { color:'#444', fontSize:12 },

  // Code
  codeScroll: { flex:1, backgroundColor:'#0d1117' },
  codeEditor: { flex:1, backgroundColor:'#0d1117', color:'#e6e6e6', fontFamily:MONO, fontSize:13, lineHeight:22, padding:16, textAlignVertical:'top' },

  // Markdown
  mdContent: { padding:20, gap:4 },
  mdH1: { color:'#fff', fontSize:22, fontWeight:'800', marginBottom:6, marginTop:8 },
  mdH2: { color:'#e6e6e6', fontSize:18, fontWeight:'700', marginBottom:4, marginTop:6 },
  mdH3: { color:'#ccc', fontSize:15, fontWeight:'700', marginBottom:3 },
  mdP: { color:'#bbb', fontSize:13, lineHeight:21 },
  mdLi: { color:'#bbb', fontSize:13, lineHeight:21, paddingLeft:8 },
  mdQuote: { borderLeftWidth:3, borderLeftColor:'#6366f1', paddingLeft:12, backgroundColor:'#6366f108', paddingVertical:6, borderRadius:4, marginVertical:4 },
  mdQuoteText: { color:'#888', fontSize:13, fontStyle:'italic' },

  // CSV
  csvRow: { flexDirection:'row' },
  csvCell: { minWidth:100, paddingHorizontal:10, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#1a1a1a', borderRightWidth:1, borderRightColor:'#1a1a1a' },
  csvHead: { backgroundColor:'#111827' },
  csvHeadText: { color:'#a5b4fc', fontSize:12, fontWeight:'700', fontFamily:MONO },
  csvCellText: { color:'#ccc', fontSize:12, fontFamily:MONO },

  // Image
  fileImage: { width:'100%' as any, maxWidth:700, height:380, borderRadius:8, backgroundColor:'#111' },

  // Right panel
  rightPanel: { width:300, borderLeftWidth:1, borderLeftColor:'#1a1a1a' },
  bottomSheet: { height:320, borderTopWidth:1, borderTopColor:'#1a1a1a' },
  panel: { flex:1, backgroundColor:'#0a0a0a', flexDirection:'column' },
  panelHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#1a1a1a' },
  panelTitle: { color:'#fff', fontSize:13, fontWeight:'700', paddingHorizontal:14, paddingTop:12, paddingBottom:4 },
  panelBtn: { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },

  // Chat
  taskBox: { padding:12, backgroundColor:'#0d1a0d', borderBottomWidth:1, borderBottomColor:'#1a2a1a' },
  taskInput: { backgroundColor:'#0a0a0a', borderWidth:1, borderColor:'#1a3a1a', borderRadius:8, paddingHorizontal:12, paddingVertical:8, color:'#fff', fontSize:13, minHeight:50 },
  taskSubmit: { marginTop:8, alignSelf:'flex-end', backgroundColor:'#22c55e20', borderWidth:1, borderColor:'#22c55e60', paddingHorizontal:14, paddingVertical:6, borderRadius:8 },
  msgList: { flex:1 },
  msgInputRow: { flexDirection:'row', alignItems:'center', padding:12, gap:8, borderTopWidth:1, borderTopColor:'#1a1a1a' },
  msgInput: { flex:1, backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:10, paddingHorizontal:12, paddingVertical:8, color:'#fff', fontSize:13 },
  sendBtn: { width:36, height:36, borderRadius:18, justifyContent:'center', alignItems:'center', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },

  // APIs
  apiTab: { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1, borderColor:'#222', marginRight:6, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  apiTabText: { color:'#888', fontSize:11, fontWeight:'700' },
  apiCard: { borderWidth:1, borderRadius:10, padding:12, backgroundColor:'#0d0d0d' },
  apiCardTitle: { fontSize:14, fontWeight:'800', marginBottom:4 },
  apiCardDesc: { color:'#888', fontSize:12, lineHeight:18 },
  apiLabel: { color:'#555', fontSize:10, fontWeight:'800', letterSpacing:1 },
  codeBlock: { backgroundColor:'#0d1117', borderRadius:8, padding:12, borderWidth:1, borderColor:'#1a1a2e' },
  codeBlockText: { color:'#ce9178', fontSize:12, fontFamily:MONO, lineHeight:18 },
  integrationsSection: { padding:14, borderTopWidth:1, borderTopColor:'#1a1a1a', gap:8 },
  integrationBadge: { alignItems:'center', marginRight:10, gap:2 },
  integrationIcon: { fontSize:20 },
  integrationName: { color:'#555', fontSize:9, fontWeight:'700' },

  // Secrets
  secretRow: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#1a1a1a' },
  secretKey: { color:'#a5b4fc', fontSize:12, fontWeight:'700', fontFamily:MONO, flex:1 },
  secretVal: { color:'#555', fontSize:12, fontFamily:MONO, flex:1 },

  // Usage
  statBox: { alignItems:'center', backgroundColor:'#111', borderRadius:10, padding:12, flex:1, minWidth:70, borderWidth:1, borderColor:'#1a1a1a' },
  statVal: { fontSize:18, fontWeight:'900', fontFamily:MONO },
  statLabel: { color:'#555', fontSize:9, fontWeight:'800', letterSpacing:0.5, marginTop:2 },
  usageRow: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#111' },
  usageEvent: { color:'#888', fontSize:11, fontFamily:MONO, flex:1 },
  usageAgent: { color:'#6366f1', fontSize:11, fontWeight:'700' },
  usageTokens: { color:'#f59e0b', fontSize:10 },
  usageTime: { color:'#555', fontSize:10 },

  // Drop overlay
  dropOverlay: { position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(99,102,241,0.15)', borderWidth:2, borderColor:'#6366f1', borderStyle:'dashed', justifyContent:'center', alignItems:'center', zIndex:100 },
  dropOverlayText: { fontSize:64, marginBottom:8 },
  dropOverlayLabel: { color:'#a5b4fc', fontSize:20, fontWeight:'800' },
});
