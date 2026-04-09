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
import { LoadingScreen } from '../../../components/LoadingWave';
import { supabase } from '../../../lib/supabase';
import { getSwanBotResponse as getAIResponse } from '../../../lib/swanbot';
import { dispatchBridgeTask, spawnNewSession, wakeAndAssignTask } from '../../../lib/bridgeTaskDispatcher';
import SpawnAgentPanel from '../../../components/SpawnAgentPanel';
import {
  getStoredToken, storeToken, removeToken, validateToken as ghValidateToken,
  listRepos, getRepoTree, getFileContent, groupTreeByFolder,
  connectViaOAuth, getOAuthStatus, getConnectedRepos,
  type GitHubUser, type GitHubRepo, type GitHubTreeEntry,
} from '../../../lib/github';
import RoomFileTree from '../../../components/rooms/RoomFileTree.web';
import type { RoomFileEntry } from '../../../components/rooms/roomTreeAdapter';
// ─── Types ───────────────────────────────────────────────────────────────────

// ── Persistent state keys ────────────────────────────────────────────────────
const ROOM_STORAGE = {
  selectedRoom: (circleId: string) => `uc_room_selected_${circleId}`,
  openTabs: (roomId: string) => `uc_room_tabs_${roomId}`,
  activeTab: (roomId: string) => `uc_room_active_tab_${roomId}`,
  rightPanel: (roomId: string) => `uc_room_panel_${roomId}`,
  sidebar: (roomId: string) => `uc_room_sidebar_${roomId}`,
  panelWidth: (roomId: string) => `uc_room_panel_w_${roomId}`,
};

function storageGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function storageSet(key: string, value: string) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch {}
}

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
  taskType: string;
  lastResult: any;
  status: string;
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
  provider: string | null;
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
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12,
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
  typescript:'#3b82f6', javascript:'#f59e0b', python:'#22c55e', sql:'#22d3ee',
  json:'#6f6f6f', bash:'#22c55e', rust:'#f97316', go:'#22d3ee',
  markdown:'#a855f7', plaintext:'#9e9e9e', csv:'#22c55e', image:'#ec4899',
  html:'#f97316', css:'#6366f1', yaml:'#ef4444', canvas:'#a855f7', other:'#888',
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

// ─── Syntax Highlighting ─────────────────────────────────────────────────────

/** Token types for syntax coloring */
type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'function' | 'operator' | 'punctuation' | 'property' | 'builtin' | 'tag' | 'attribute' | 'variable' | 'plain';

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword:     '#a855f7',   // purple (if, else, const, return…)
  string:      '#22c55e',   // green (strings)
  comment:     '#6f6f6f',   // muted (comments)
  number:      '#f59e0b',   // amber (numeric literals)
  type:        '#22d3ee',   // cyan (type names, classes)
  function:    '#3b82f6',   // blue (function names)
  operator:    '#9e9e9e',   // medium (=, +, =>)
  punctuation: '#6f6f6f',   // muted ({, }, [, ], ;)
  property:    '#ec4899',   // pink (object keys)
  builtin:     '#f97316',   // orange (console, Math, etc.)
  tag:         '#ef4444',   // red (HTML tags)
  attribute:   '#f59e0b',   // amber (HTML attributes)
  variable:    '#22d3ee',   // cyan (special vars)
  plain:       '#e8e8e8',   // default text
};

interface Token { text: string; type: TokenType; }

const LANG_KEYWORDS: Record<string, Set<string>> = {
  typescript: new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','class','extends','implements','interface','type','enum','namespace','module','export','import','from','default','as','async','await','yield','try','catch','finally','throw','this','super','static','public','private','protected','readonly','abstract','declare','get','set','void','null','undefined','true','false','never','unknown','any','keyof','infer','is']),
  javascript: new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','class','extends','export','import','from','default','as','async','await','yield','try','catch','finally','throw','this','super','static','get','set','void','null','undefined','true','false']),
  python: new Set(['def','class','return','if','elif','else','for','while','break','continue','import','from','as','try','except','finally','raise','with','yield','async','await','pass','del','in','not','and','or','is','lambda','global','nonlocal','assert','True','False','None','self','cls']),
  rust: new Set(['fn','let','mut','const','if','else','for','while','loop','match','return','break','continue','struct','enum','impl','trait','type','pub','use','mod','crate','self','super','as','in','ref','move','async','await','unsafe','where','dyn','static','extern','true','false','Some','None','Ok','Err','Self']),
  go: new Set(['func','var','const','return','if','else','for','range','switch','case','break','continue','type','struct','interface','map','chan','go','select','defer','import','package','true','false','nil','make','new','append','len','cap','delete','copy','close','panic','recover']),
  sql: new Set(['SELECT','FROM','WHERE','AND','OR','NOT','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','ALTER','DROP','INDEX','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY','ORDER','ASC','DESC','HAVING','LIMIT','OFFSET','UNION','AS','DISTINCT','COUNT','SUM','AVG','MIN','MAX','NULL','IS','IN','BETWEEN','LIKE','EXISTS','CASE','WHEN','THEN','ELSE','END','PRIMARY','KEY','FOREIGN','REFERENCES','CASCADE','DEFAULT','CONSTRAINT','VIEW','TRIGGER','PROCEDURE','BEGIN','COMMIT','ROLLBACK','GRANT','REVOKE']),
  bash: new Set(['if','then','else','elif','fi','for','while','do','done','case','esac','in','function','return','echo','exit','export','source','alias','unset','local','readonly','shift','set','true','false','cd','ls','grep','awk','sed','cat','rm','cp','mv','mkdir','chmod','chown','sudo','apt','yum','brew','npm','yarn','git','docker','curl','wget']),
  html: new Set([]),
  css: new Set(['@import','@media','@keyframes','@font-face','@supports','!important']),
  json: new Set([]),
  yaml: new Set(['true','false','null','yes','no','on','off']),
};

const LANG_TYPES: Record<string, Set<string>> = {
  typescript: new Set(['string','number','boolean','object','symbol','bigint','Array','Promise','Map','Set','Record','Partial','Required','Readonly','Pick','Omit','Exclude','Extract','NonNullable','ReturnType','Parameters','InstanceType','React','ReactNode','JSX','Element','FC','Component','HTMLElement','Event','Error','Date','RegExp','JSON','Math','console','Object','Function','Symbol','Buffer','NodeJS','Response','Request']),
  javascript: new Set(['Array','Promise','Map','Set','Error','Date','RegExp','JSON','Math','console','Object','Function','Symbol','Buffer','Response','Request','HTMLElement','Event']),
  python: new Set(['int','float','str','bool','list','dict','tuple','set','bytes','type','object','range','enumerate','zip','map','filter','print','len','super','isinstance','issubclass','Exception','ValueError','TypeError','KeyError','IndexError','AttributeError','RuntimeError','StopIteration','Generator']),
  rust: new Set(['i8','i16','i32','i64','i128','u8','u16','u32','u64','u128','f32','f64','bool','char','str','String','Vec','Box','Rc','Arc','Option','Result','HashMap','HashSet','BTreeMap','Iterator','Future','Pin','Cow']),
  go: new Set(['int','int8','int16','int32','int64','uint','uint8','uint16','uint32','uint64','float32','float64','complex64','complex128','byte','rune','string','bool','error','any','comparable']),
};

const LANG_BUILTINS: Record<string, Set<string>> = {
  typescript: new Set(['console','Math','JSON','Object','Array','Promise','String','Number','Boolean','Date','RegExp','Error','Map','Set','parseInt','parseFloat','isNaN','isFinite','setTimeout','setInterval','clearTimeout','clearInterval','fetch','require','process','window','document','globalThis','Symbol','Proxy','Reflect','WeakMap','WeakSet','BigInt','Intl']),
  javascript: new Set(['console','Math','JSON','Object','Array','Promise','String','Number','Boolean','Date','RegExp','Error','Map','Set','parseInt','parseFloat','isNaN','isFinite','setTimeout','setInterval','clearTimeout','clearInterval','fetch','require','process','window','document','globalThis']),
  python: new Set(['print','len','range','type','str','int','float','bool','list','dict','tuple','set','sorted','reversed','enumerate','zip','map','filter','any','all','abs','min','max','sum','round','input','open','super','isinstance','issubclass','hasattr','getattr','setattr','delattr','iter','next','id','hex','oct','bin','chr','ord','format','repr','hash','dir','vars','help','__name__','__init__','__str__','__repr__']),
  rust: new Set(['println','print','eprintln','eprint','format','vec','panic','assert','assert_eq','assert_ne','debug_assert','todo','unimplemented','unreachable','cfg','derive','allow','warn','deny','forbid','test','bench','main','include','include_str','include_bytes','env','file','line','column','module_path','stringify','concat','compile_error']),
  go: new Set(['fmt','log','os','io','net','http','json','strings','strconv','sync','context','errors','time','math','sort','bytes','bufio','regexp','path','filepath','encoding','crypto','reflect','testing','flag']),
  bash: new Set(['echo','printf','read','test','expr','eval','exec','trap','wait','kill','jobs','bg','fg','nohup','xargs','tee','sort','uniq','wc','cut','tr','head','tail','find','which','whereis','type','file','stat','date','cal','uptime','whoami','hostname','uname','env','printenv','declare']),
};

function tokenizeLine(line: string, lang: string): Token[] {
  const tokens: Token[] = [];
  const keywords = LANG_KEYWORDS[lang] || LANG_KEYWORDS.typescript || new Set();
  const types = LANG_TYPES[lang] || new Set();
  const builtins = LANG_BUILTINS[lang] || new Set();
  const isSql = lang === 'sql';
  const isHtml = lang === 'html';
  const isCss = lang === 'css';
  const isJson = lang === 'json';
  const isYaml = lang === 'yaml';
  const isBash = lang === 'bash';
  const isPython = lang === 'python';

  let i = 0;
  while (i < line.length) {
    // ── Comments ──
    if (!isJson && !isYaml) {
      if (line[i] === '/' && line[i+1] === '/') { tokens.push({ text: line.slice(i), type: 'comment' }); return tokens; }
      if (line[i] === '#' && (isPython || isBash || isYaml)) { tokens.push({ text: line.slice(i), type: 'comment' }); return tokens; }
      if (isSql && line[i] === '-' && line[i+1] === '-') { tokens.push({ text: line.slice(i), type: 'comment' }); return tokens; }
      if (isCss && line[i] === '/' && line[i+1] === '*') {
        const end = line.indexOf('*/', i+2);
        if (end !== -1) { tokens.push({ text: line.slice(i, end+2), type: 'comment' }); i = end+2; continue; }
        tokens.push({ text: line.slice(i), type: 'comment' }); return tokens;
      }
    }

    // ── Strings ──
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const q = line[i]; let j = i+1;
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
      tokens.push({ text: line.slice(i, j+1), type: 'string' }); i = j+1; continue;
    }

    // ── Numbers ──
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s,;:([\]{}<>=!+\-*/&|^~%?]/.test(line[i-1]))) {
      let j = i;
      if (line[j] === '0' && (line[j+1] === 'x' || line[j+1] === 'X' || line[j+1] === 'b' || line[j+1] === 'o')) j += 2;
      while (j < line.length && /[0-9a-fA-F._]/.test(line[j])) j++;
      if (j < line.length && /[eE]/.test(line[j])) { j++; if (line[j] === '+' || line[j] === '-') j++; while (j < line.length && /[0-9]/.test(line[j])) j++; }
      tokens.push({ text: line.slice(i, j), type: 'number' }); i = j; continue;
    }

    // ── HTML tags ──
    if (isHtml && line[i] === '<') {
      const tagMatch = line.slice(i).match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      if (tagMatch) {
        tokens.push({ text: line[i] + (line[i+1] === '/' ? '/' : ''), type: 'punctuation' });
        i += line[i+1] === '/' ? 2 : 1;
        tokens.push({ text: tagMatch[1], type: 'tag' });
        i += tagMatch[1].length;
        // Attributes
        while (i < line.length && line[i] !== '>' && !(line[i] === '/' && line[i+1] === '>')) {
          if (/\s/.test(line[i])) { tokens.push({ text: line[i], type: 'plain' }); i++; continue; }
          const attrMatch = line.slice(i).match(/^([a-zA-Z_:][a-zA-Z0-9_.:-]*)/);
          if (attrMatch) { tokens.push({ text: attrMatch[1], type: 'attribute' }); i += attrMatch[1].length; continue; }
          if (line[i] === '=') { tokens.push({ text: '=', type: 'operator' }); i++; continue; }
          if (line[i] === '"' || line[i] === "'") { const q = line[i]; let j = i+1; while (j < line.length && line[j] !== q) j++; tokens.push({ text: line.slice(i, j+1), type: 'string' }); i = j+1; continue; }
          tokens.push({ text: line[i], type: 'plain' }); i++;
        }
        if (i < line.length) {
          const cls = line[i] === '/' ? '/>' : '>';
          tokens.push({ text: cls, type: 'punctuation' }); i += cls.length;
        }
        continue;
      }
    }

    // ── CSS property/value pairs ──
    if (isCss && /[a-zA-Z-]/.test(line[i])) {
      let j = i; while (j < line.length && /[a-zA-Z0-9-]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (line[j] === ':') { tokens.push({ text: word, type: 'property' }); i = j; continue; }
      if (word.startsWith('@')) { tokens.push({ text: word, type: 'keyword' }); i = j; continue; }
      tokens.push({ text: word, type: 'plain' }); i = j; continue;
    }

    // ── YAML keys ──
    if (isYaml && i === 0 || (isYaml && i > 0 && line.slice(0, i).trim() === '')) {
      const yamlKeyMatch = line.slice(i).match(/^(\s*[a-zA-Z_][a-zA-Z0-9_.-]*)(\s*:)/);
      if (yamlKeyMatch) {
        if (yamlKeyMatch[1] !== yamlKeyMatch[1].trimStart()) {
          const ws = yamlKeyMatch[1].length - yamlKeyMatch[1].trimStart().length;
          tokens.push({ text: yamlKeyMatch[1].slice(0, ws), type: 'plain' });
          tokens.push({ text: yamlKeyMatch[1].trimStart(), type: 'property' });
        } else {
          tokens.push({ text: yamlKeyMatch[1], type: 'property' });
        }
        tokens.push({ text: yamlKeyMatch[2], type: 'punctuation' });
        i += yamlKeyMatch[0].length; continue;
      }
    }

    // ── Words (identifiers, keywords, types) ──
    if (/[a-zA-Z_$@]/.test(line[i])) {
      let j = i; while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const lcWord = isSql ? word.toUpperCase() : word;
      if (keywords.has(isSql ? lcWord : word)) { tokens.push({ text: word, type: 'keyword' }); }
      else if (types.has(word)) { tokens.push({ text: word, type: 'type' }); }
      else if (builtins.has(word)) { tokens.push({ text: word, type: 'builtin' }); }
      else if (line[j] === '(') { tokens.push({ text: word, type: 'function' }); }
      else if (isJson && line.slice(j).trimStart().startsWith(':')) { tokens.push({ text: word, type: 'property' }); }
      else if (/^[A-Z][a-zA-Z0-9]*$/.test(word) && !isSql) { tokens.push({ text: word, type: 'type' }); }
      else { tokens.push({ text: word, type: 'plain' }); }
      i = j; continue;
    }

    // ── Operators ──
    if (/[=+\-*/<>!&|^~%?:]/.test(line[i])) {
      let j = i; while (j < line.length && /[=+\-*/<>!&|^~%?:]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), type: 'operator' }); i = j; continue;
    }

    // ── Punctuation ──
    if (/[{}()\[\];,.]/.test(line[i])) {
      tokens.push({ text: line[i], type: 'punctuation' }); i++; continue;
    }

    // ── Whitespace / other ──
    tokens.push({ text: line[i], type: 'plain' }); i++;
  }

  return tokens;
}

// ─── Line Number Gutter Width Helper ─────────────────────────────────────────

function gutterWidth(lineCount: number): number {
  return Math.max(3, String(lineCount).length) * 8 + 16;
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
  { id: 'storage',    label: 'Storage',    icon: '🗄',  color: '#3b82f6',
    desc: 'File & blob storage. Put, get, list, delete objects.',
    help: 'Upload and manage files scoped to this room. Each room gets its own storage bucket. Files are accessible to all room members and any agents assigned to this room. Use this for assets, documents, datasets, or any binary data your project needs.' },
  { id: 'database',  label: 'Database',   icon: '🏛',  color: '#22c55e',
    desc: 'Supabase Postgres. Query tables, run SQL, subscribe.',
    help: 'Query the room\'s data tables using the Supabase client. All queries are automatically scoped to this room via Row Level Security. You can read room files, messages, usage logs, and any custom data. Use the Supabase JS client or REST API with your auth token.' },
  { id: 'messaging', label: 'Messaging',  icon: '📨',  color: '#a855f7',
    desc: 'Realtime channels. Publish events, broadcast messages.',
    help: 'Subscribe to real-time events in this room using Supabase Realtime. Events include new messages, file changes, agent activity, and custom broadcasts. Useful for building live dashboards, collaborative editing, or notifying agents of changes.' },
  { id: 'queues',    label: 'Queues',     icon: '📋',  color: '#f59e0b',
    desc: 'Task queues. Enqueue jobs, process with agents or workers.',
    help: 'Push tasks to the room\'s job queue for async processing. Agents or workers can pick up tasks, execute them, and report results. Ideal for background jobs like code generation, data processing, or AI inference that shouldn\'t block the UI.' },
  { id: 'secrets',   label: 'Secrets',   icon: '🔒',  color: '#ef4444',
    desc: 'Encrypted KV store. Store API keys, tokens, credentials.',
    help: 'Securely store sensitive values like API keys, tokens, and credentials. Secrets are encrypted at rest and only accessible by room members. Agents can read secrets at runtime to authenticate with external services without exposing keys in code.' },
  { id: 'containers',label: 'Containers', icon: '🐳',  color: '#22d3ee',
    desc: 'Run sandboxed code. Execute tasks, deploy agents.',
    help: 'Execute code in isolated sandboxed environments. Specify a Docker image, mount files, and run commands. Output is captured and returned. Use this for running untrusted code, CI tasks, data pipelines, or spinning up temporary agent environments.' },
] as const;

const INTEGRATIONS = [
  { name: 'AWS',       icon: '🟠', color: '#f97316' },
  { name: 'Azure',     icon: '🔵', color: '#3b82f6' },
  { name: 'GCP',       icon: '🔴', color: '#ef4444' },
  { name: 'Python',    icon: '🐍', color: '#22c55e' },
  { name: 'JS',        icon: '🟡', color: '#f59e0b' },
  { name: 'TypeScript',icon: '📘', color: '#3b82f6' },
  { name: 'React',     icon: '⚛', color: '#22d3ee' },
  { name: 'Flutter',   icon: '🐦', color: '#3b82f6' },
  { name: 'OpenAI',    icon: '🤖', color: '#22c55e' },
  { name: 'Anthropic', icon: '🅐', color: '#f97316' },
  { name: 'GitHub',    icon: '🐙', color: '#a855f7' },
  { name: 'Docker',    icon: '🐳', color: '#22d3ee' },
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
    const color = lang === 'python' ? '#22c55e' : '#e8e8e8';
    return [<Text key="plain" style={{ color }}>{line || ' '}</Text>];
  }
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return [<Text key="c" style={{ color:'#6f6f6f', fontStyle:'italic' }}>{line}</Text>];
  }
  const parts: React.ReactNode[] = [];
  const regex = /(\s+)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|([a-zA-Z_$][\w$]*)|([^\s\w])/g;
  let match, idx = 0;
  while ((match = regex.exec(line)) !== null) {
    const [, space, str, word, op] = match;
    if (space) parts.push(<Text key={idx++} style={{ color:'#e8e8e8' }}>{space}</Text>);
    else if (str) parts.push(<Text key={idx++} style={{ color:'#22c55e' }}>{str}</Text>);
    else if (word) {
      if (JS_KEYWORDS.has(word)) parts.push(<Text key={idx++} style={{ color:'#a855f7', fontWeight:'700' }}>{word}</Text>);
      else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase())
        parts.push(<Text key={idx++} style={{ color:'#22d3ee' }}>{word}</Text>);
      else parts.push(<Text key={idx++} style={{ color:'#e8e8e8' }}>{word}</Text>);
    } else if (op) parts.push(<Text key={idx++} style={{ color:'#9e9e9e' }}>{op}</Text>);
  }
  return parts.length ? parts : [<Text key="e" style={{ color:'#e8e8e8' }}>{line || ' '}</Text>];
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── New Rooms Module Shell (swap-in) ──────────────────────────────────────
import RoomWorkspaceShell from './rooms/RoomWorkspaceShell';
import NewRoomCard from './rooms/RoomCard';
import { useRoomList } from './rooms/roomHooks';
import { ROOM_CHAT_PRESETS } from './rooms/roomTypes';

export default function RoomsTab({ circleId, accentColor }: Props) {
  // Use new room module for list + workspace
  const [useNewModule] = useState(false); // flip to true to use new module

  if (useNewModule) {
    return <NewRoomsTab circleId={circleId} accentColor={accentColor} />;
  }

  return <LegacyRoomsTab circleId={circleId} accentColor={accentColor} />;
}

function NewRoomsTab({ circleId, accentColor }: Props) {
  const { rooms, loading } = useRoomList(circleId);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem(`uc_selected_room_${circleId}`) || null; } catch {}
    }
    return null;
  });

  // Persist selection
  useEffect(() => {
    if (Platform.OS === 'web' && selectedRoomId) {
      try { localStorage.setItem(`uc_selected_room_${circleId}`, selectedRoomId); } catch {}
    }
  }, [selectedRoomId, circleId]);

  // Auto-select saved room
  useEffect(() => {
    if (rooms.length > 0 && selectedRoomId && !rooms.find(r => r.id === selectedRoomId)) {
      setSelectedRoomId(null);
    }
  }, [rooms, selectedRoomId]);

  if (loading) return <LoadingScreen />;

  if (selectedRoomId) {
    return (
      <RoomWorkspaceShell
        roomId={selectedRoomId}
        circleId={circleId}
        accentColor={accentColor}
        onBack={() => setSelectedRoomId(null)}
      />
    );
  }

  // Room list
  return (
    <View style={{ flex: 1, backgroundColor: '#050508' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a28' }}>
        <Text style={{ color: '#f0f0f5', fontSize: 20, fontWeight: '700' }}>Rooms</Text>
        <Pressable
          onPress={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data } = await supabase.from('project_rooms').insert({
              circle_id: circleId, name: 'New Room', created_by: user.id, status: 'active',
            }).select('id').single();
            if (data) setSelectedRoomId(data.id);
          }}
          accessibilityRole="button"
          style={{ backgroundColor: accentColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 }}
        >
          <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>+ New Room</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {rooms.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ color: '#606075', fontSize: 14, marginBottom: 8 }}>No rooms yet</Text>
            <Text style={{ color: '#3a3a4e', fontSize: 12 }}>Create a room to start collaborating</Text>
          </View>
        )}
        {rooms.map(room => (
          <NewRoomCard
            key={room.id}
            room={room}
            onPress={() => setSelectedRoomId(room.id)}
            accentColor={accentColor}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function LegacyRoomsTab({ circleId, accentColor }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const savedRoomIdRef = React.useRef(storageGet(ROOM_STORAGE.selectedRoom(circleId)));
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Restore selected room from localStorage after rooms load
  React.useEffect(() => {
    if (rooms.length > 0 && !selectedRoom && savedRoomIdRef.current) {
      const saved = rooms.find(r => r.id === savedRoomIdRef.current);
      if (saved) setSelectedRoom(saved);
    }
  }, [rooms]);

  // Persist selected room to localStorage
  React.useEffect(() => {
    if (selectedRoom) {
      storageSet(ROOM_STORAGE.selectedRoom(circleId), selectedRoom.id);
    }
  }, [selectedRoom?.id, circleId]);
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
    await supabase.from('circle_rooms').delete().eq('id', roomId);
    setRooms(p => p.filter(r => r.id !== roomId));
    if (selectedRoom?.id === roomId) setSelectedRoom(null);
  }, [selectedRoom]);

  if (loading) return <LoadingScreen />;

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
          <Text style={s.listTitle}>{'[R]'} ROOMS</Text>
          <Text style={s.listSub}>{rooms.length} workspace{rooms.length!==1?'s':''}</Text>
        </View>
        <Pressable onPress={() => setShowCreate(true)} style={[s.createBtn,{backgroundColor:accentColor+'20',borderColor:accentColor+'60'}]}>
          <Text style={[s.createBtnText,{color:accentColor}]}>+ New Room</Text>
        </Pressable>
      </View>

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        {rooms.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>{'[ ]'}</Text>
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
  const [taskCount, setTaskCount] = useState<number|null>(null);
  const [msgCount, setMsgCount] = useState<number|null>(null);
  const langColor = LANG_COLORS[room.language] || '#888';
  const icon = FILE_ICONS[room.language] || '📁';

  useEffect(() => {
    supabase.from('room_files').select('id', { count:'exact', head:true })
      .eq('room_id', room.id).eq('is_deleted', false)
      .then(({ count }) => setFileCount(count ?? 0));
    supabase.from('room_tasks').select('id', { count:'exact', head:true })
      .eq('room_id', room.id)
      .then(({ count }) => setTaskCount(count ?? 0));
    supabase.from('room_messages').select('id', { count:'exact', head:true })
      .eq('room_id', room.id)
      .then(({ count }) => setMsgCount(count ?? 0));
  }, [room.id]);

  const roomStatus = (room as any).status || 'active';
  const statusColor = roomStatus === 'active' ? '#22c55e' : roomStatus === 'paused' ? '#f59e0b' : '#606075';

  return (
    <Pressable onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      accessibilityRole="button" accessibilityLabel={`Open room ${room.name}`}
      style={[s.card, hovered && { borderColor:accentColor+'60', backgroundColor:'#0f0f18' }, isMobile && s.cardMobile,
        ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
      ]}>
      {/* Left accent stripe */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: statusColor, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 }} />

      <View style={[s.cardHeader, { paddingLeft: 8 }]}>
        <Text style={s.cardIcon}>{icon}</Text>
        <Text style={s.cardName} numberOfLines={1}>{room.name}</Text>
        <View style={[s.langBadge,{backgroundColor:langColor+'20',borderColor:langColor+'50'}]}>
          <Text style={[s.langBadgeText,{color:langColor}]}>{room.language.toUpperCase()}</Text>
        </View>
        <Pressable onPress={e=>{e.stopPropagation?.();onDelete();}} style={s.cardDelete} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Delete room">
          <Text style={s.cardDeleteText}>x</Text>
        </Pressable>
      </View>
      {room.description && <Text style={[s.cardDesc, { paddingLeft: 8 }]} numberOfLines={2}>{room.description}</Text>}

      {/* Stats row */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4, flexWrap: 'wrap' }}>
        {fileCount !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '700' }}>F</Text>
            <Text style={{ color: '#a0a0b0', fontSize: 10 }}>{fileCount}</Text>
          </View>
        )}
        {taskCount !== null && taskCount > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '700' }}>T</Text>
            <Text style={{ color: '#a0a0b0', fontSize: 10 }}>{taskCount}</Text>
          </View>
        )}
        {msgCount !== null && msgCount > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '700' }}>..</Text>
            <Text style={{ color: '#a0a0b0', fontSize: 10 }}>{msgCount}</Text>
          </View>
        )}
        <Text style={[s.cardTime, { marginLeft: 'auto' }]}>{timeAgo(room.updated_at)}</Text>
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

type RightPanel = 'chat' | 'apis' | 'secrets' | 'usage' | 'sessions' | 'services' | 'permissions' | 'tasks' | 'playground' | 'github' | null;

const RIGHT_PANEL_TABS: [RightPanel, string][] = [
  ['chat',        'Chat'],
  ['github',      'GitHub'],
  ['playground',  'Playground'],
  ['sessions',    'Sessions'],
  ['services',    'Services'],
  ['apis',        'APIs'],
  ['secrets',     'Secrets'],
  ['permissions', 'Permissions'],
  ['tasks',       'Tasks'],
  ['usage',       'Usage'],
];

// ─── Resize Handle ──────────────────────────────────────────────────────────

function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = lastX.current - e.clientX; // left drag = wider
      lastX.current = e.clientX;
      onDrag(delta);
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onDrag]);

  const onMouseDown = (e: any) => {
    dragging.current = true;
    lastX.current = e.clientX || e.nativeEvent?.pageX || 0;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <Pressable
      onPressIn={Platform.OS === 'web' ? onMouseDown : undefined}
      style={s.resizeHandle}
    >
      <View style={s.resizeGrip}>
        <View style={s.resizeGripDot} />
        <View style={s.resizeGripDot} />
        <View style={s.resizeGripDot} />
      </View>
    </Pressable>
  );
}

function RoomDetail({ room, accentColor, isMobile, onClose, onDelete, onRoomUpdated }: {
  room: Room; accentColor: string; isMobile: boolean;
  onClose: () => void; onDelete: () => void; onRoomUpdated: (r: Room) => void;
}) {
  const [files, setFiles] = useState<RoomFile[]>([]);
  const [openTabs, setOpenTabs] = useState<RoomFile[]>([]);
  const savedTabIdsRef = React.useRef<string[]>(JSON.parse(storageGet(ROOM_STORAGE.openTabs(room.id)) || '[]'));
  const [activeTabId, setActiveTabId] = useState<string | null>(storageGet(ROOM_STORAGE.activeTab(room.id)));
  const [rightPanel, setRightPanel] = useState<RightPanel>((storageGet(ROOM_STORAGE.rightPanel(room.id)) || 'chat') as RightPanel);
  const [sidebarOpen, setSidebarOpen] = useState(storageGet(ROOM_STORAGE.sidebar(room.id)) !== 'false');
  const [editingContent, setEditingContent] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [showNewFile, setShowNewFile] = useState(false);
  const [fileTreeView, setFileTreeView] = useState<'list' | 'tree'>(
    Platform.OS === 'web' ? ((storageGet(`uc_room_tree_view_${room.id}`) as 'list' | 'tree') || 'list') : 'list'
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(parseInt(storageGet(ROOM_STORAGE.panelWidth(room.id)) || '320', 10));
  // ── Persist room-level UI state ──────────────────────────────────────────
  React.useEffect(() => {
    if (openTabs.length > 0) {
      storageSet(ROOM_STORAGE.openTabs(room.id), JSON.stringify(openTabs.map(t => t.id)));
    }
  }, [openTabs, room.id]);

  React.useEffect(() => {
    if (activeTabId) storageSet(ROOM_STORAGE.activeTab(room.id), activeTabId);
  }, [activeTabId, room.id]);

  React.useEffect(() => {
    storageSet(ROOM_STORAGE.rightPanel(room.id), rightPanel || 'chat');
  }, [rightPanel, room.id]);

  React.useEffect(() => {
    storageSet(ROOM_STORAGE.sidebar(room.id), String(sidebarOpen));
  }, [sidebarOpen, room.id]);

  React.useEffect(() => {
    storageSet(ROOM_STORAGE.panelWidth(room.id), String(rightPanelWidth));
  }, [rightPanelWidth, room.id]);

  // Restore open tabs after files load
  React.useEffect(() => {
    if (files.length > 0 && openTabs.length === 0 && savedTabIdsRef.current.length > 0) {
      const restored = savedTabIdsRef.current
        .map(id => files.find(f => f.id === id))
        .filter((f): f is RoomFile => f != null);
      if (restored.length > 0) {
        setOpenTabs(restored);
        const savedActive = storageGet(ROOM_STORAGE.activeTab(room.id));
        if (savedActive && restored.some(f => f.id === savedActive)) {
          setActiveTabId(savedActive);
        } else {
          setActiveTabId(restored[0].id);
        }
      }
    }
  }, [files, room.id]);

  const handlePanelResize = useCallback((delta: number) => {
    setRightPanelWidth(w => Math.min(700, Math.max(240, w + delta)));
  }, []);

  // GitHub browsing state
  const [ghConnected, setGhConnected] = useState(false);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghRepo, setGhRepo] = useState<GitHubRepo | null>(null);
  const [ghTree, setGhTree] = useState<GitHubTreeEntry[]>([]);
  const [ghBrowsing, setGhBrowsing] = useState(false);
  const [ghLoadingFile, setGhLoadingFile] = useState<string | null>(null);
  const [ghLoadingTree, setGhLoadingTree] = useState(false);

  const activeTab = openTabs.find(t => t.id === activeTabId) ?? null;
  const isDirty = activeTab ? (editingContent[activeTab.id] !== undefined && editingContent[activeTab.id] !== activeTab.content) : false;
  const hasOpenedRef = useRef(false);

  // Check for GitHub connection on mount — tries PAT (local) then OAuth (Supabase)
  useEffect(() => {
    (async () => {
      // 1. Try stored PAT token first (fast, local)
      const token = await getStoredToken(room.circle_id);
      if (token) {
        const { user } = await ghValidateToken(token);
        if (user) { setGhConnected(true); setGhUser(user); return; }
        else { await removeToken(room.circle_id); }
      }
      // 2. Check if connected via OAuth (Integrations tab) — uses circle_github_connections table
      try {
        const { data: ghConns, error: ghErr } = await supabase
          .from('circle_github_connections')
          .select('full_name, owner')
          .eq('circle_id', room.circle_id)
          .eq('is_active', true);
        if (!ghErr && ghConns && ghConns.length > 0) {
          const username = ghConns[0]?.owner || 'connected';
          setGhConnected(true);
          setGhUser({ login: username, avatar_url: '', name: username, id: 0 } as GitHubUser);
        }
      } catch {}
    })();
  }, [room.circle_id]);

  const isGitHubFile = (file: RoomFile) => file.id.startsWith('gh_');

  // Shared helper: get a working GitHub token (PAT or OAuth)
  const getGitHubToken = async (): Promise<string | null> => {
    // 1. Try PAT token (local storage)
    const pat = await getStoredToken(room.circle_id);
    if (pat) return pat;
    // 2. Try OAuth token from user_github_tokens table
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      // Use maybeSingle() — returns null if no row exists instead of erroring
      const { data: tokenRow } = await supabase
        .from('user_github_tokens')
        .select('access_token')
        .eq('user_id', user.id)
        .maybeSingle();
      if (tokenRow?.access_token) return tokenRow.access_token;
    } catch {}
    // 3. Try via edge function with auth header
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/github-oauth?action=status&user_id=${session.user.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) return null;
      const status = await res.json();
      if (status.connected && status.access_token) return status.access_token;
    } catch {}
    return null;
  };

  const openFile = useCallback((file: RoomFile) => {
    setOpenTabs(p => p.find(t => t.id === file.id) ? p : [...p, file]);
    setActiveTabId(file.id);
  }, []);

  const openGitHubFile = useCallback(async (entry: GitHubTreeEntry) => {
    if (!ghRepo) return;
    const virtualId = `gh_${ghRepo.full_name}_${entry.path}`;
    const existing = openTabs.find(t => t.id === virtualId);
    if (existing) { setActiveTabId(virtualId); return; }

    setGhLoadingFile(entry.path);
    const token = await getGitHubToken();
    if (!token) { setGhLoadingFile(null); return; }

    const [owner, repoName] = ghRepo.full_name.split('/');
    const { content, size, error } = await getFileContent(token, owner, repoName, entry.path);
    setGhLoadingFile(null);
    if (error) return;

    const fileName = entry.path.split('/').pop() || entry.path;
    const folder = entry.path.includes('/') ? '/' + entry.path.substring(0, entry.path.lastIndexOf('/')) : '/';
    const fileType = detectFileType(fileName);
    const virtualFile: RoomFile = {
      id: virtualId, room_id: room.id, name: fileName, folder,
      file_type: fileType, content, storage_url: null, mime_type: null,
      size_bytes: size, tags: ['github', ghRepo.full_name],
      created_by: null, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), is_deleted: false,
    };
    setOpenTabs(p => [...p, virtualFile]);
    setActiveTabId(virtualId);
  }, [ghRepo, room.circle_id, room.id, openTabs]);

  const importGitHubFile = async (file: RoomFile) => {
    if (!isGitHubFile(file)) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_files').insert({
      room_id: room.id, name: file.name, folder: file.folder,
      file_type: file.file_type, content: file.content,
      size_bytes: file.size_bytes, tags: file.tags.filter(t => t !== 'github'),
      created_by: user?.id || null,
    }).select().single();
    if (!error && data) {
      setFiles(p => [...p, data]);
      setOpenTabs(p => p.map(t => t.id === file.id ? data : t));
      setActiveTabId(data.id);
    }
  };

  // Load files
  const loadFiles = useCallback(async () => {
    const { data } = await supabase.from('room_files')
      .select('*').eq('room_id', room.id).eq('is_deleted', false)
      .order('folder').order('name');
    if (data) {
      setFiles(data);
      // Sync open tabs with latest file content from DB (e.g. after agent writes)
      setOpenTabs(prev => prev.map(tab => {
        const updated = data.find((f: any) => f.id === tab.id);
        if (updated && updated.content !== tab.content) {
          // Only update if user hasn't made local edits
          setEditingContent(ec => {
            if (ec[tab.id] !== undefined && ec[tab.id] !== tab.content) return ec; // user has edits, don't overwrite
            const n = { ...ec }; delete n[tab.id]; return n;
          });
          return { ...tab, content: updated.content, size_bytes: updated.size_bytes, updated_at: updated.updated_at };
        }
        return tab;
      }));
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
    if (!activeTab || !isDirty || isGitHubFile(activeTab)) return;
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
      await supabase.from('room_files').delete().eq('id', file.id);
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
              style={[s.barBtn,{backgroundColor:'#ffffff10',borderColor:'#ffffff25'}]}>
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
          }} style={[s.barBtn,{backgroundColor:'#ffffff08',borderColor:'#ffffff20'}]}>
            <Text style={{color:'#9e9e9e',fontSize:12,fontWeight:'700'}}>+ Canvas</Text>
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
          }} style={[s.barBtn,{backgroundColor:'#ffffff08',borderColor:'#ffffff20'}]}>
            <Text style={{color:'#a855f7',fontSize:12,fontWeight:'700'}}>Summarize</Text>
          </Pressable>
          {/* Sidebar toggle */}
          <Pressable onPress={()=>setSidebarOpen(p=>!p)} style={s.barBtn}>
            <Text style={{color:'#888',fontSize:12}}>☰</Text>
          </Pressable>
          {/* Delete room */}
          <Pressable onPress={onDelete} style={[s.barBtn,{backgroundColor:'#ffffff08',borderColor:'#ffffff15'}]}>
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
              {ghBrowsing ? (
                <>
                  <Pressable onPress={() => setGhBrowsing(false)} style={{flexDirection:'row',alignItems:'center',gap:4}}>
                    <Text style={{color:'#888',fontSize:11}}>←</Text>
                    <Text style={[s.sidebarTitle,{color:accentColor}]}>GITHUB</Text>
                  </Pressable>
                  <Text style={{color:'#555',fontSize:9,flex:1,marginLeft:4}} numberOfLines={1}>{ghRepo?.full_name}</Text>
                </>
              ) : (
                <>
                  <Text style={s.sidebarTitle}>FILES</Text>
                  <View style={{flexDirection:'row',gap:4,alignItems:'center'}}>
                    {Platform.OS === 'web' && (
                      <Pressable onPress={() => {
                        const next = fileTreeView === 'list' ? 'tree' : 'list';
                        setFileTreeView(next);
                        storageSet(`uc_room_tree_view_${room.id}`, next);
                      }} style={[s.sidebarAdd,{paddingHorizontal:4}]}>
                        <Text style={{color: fileTreeView === 'tree' ? accentColor : '#888', fontSize:10, fontFamily:'monospace', fontWeight:'700'}}>
                          {fileTreeView === 'tree' ? '[T]' : '[L]'}
                        </Text>
                      </Pressable>
                    )}
                    {ghConnected && ghRepo && (
                      <Pressable onPress={() => setGhBrowsing(true)} style={s.sidebarAdd}>
                        <Text style={{color:'#888',fontSize:11}}>🐙</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={()=>setShowNewFile(true)} style={s.sidebarAdd}>
                      <Text style={{color:'#888',fontSize:14}}>+</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
            <ScrollView style={s.sidebarScroll}>
              {ghBrowsing ? (
                <>
                  {ghLoadingTree && (
                    <View style={{padding:20,alignItems:'center'}}>
                      <ActivityIndicator color={accentColor} size="small" />
                      <Text style={{color:'#555',fontSize:11,marginTop:8}}>Loading file tree...</Text>
                    </View>
                  )}
                  {!ghLoadingTree && Object.entries(groupTreeByFolder(ghTree)).map(([folder, entries]) => (
                    <GitHubFolderSection key={folder} folder={folder} entries={entries}
                      activeTabId={activeTabId} loadingPath={ghLoadingFile}
                      onOpen={openGitHubFile} repoFullName={ghRepo?.full_name || ''}
                      accentColor={accentColor} />
                  ))}
                  {!ghLoadingTree && ghTree.length === 0 && (
                    <View style={{padding:16,alignItems:'center'}}>
                      <Text style={{color:'#555',fontSize:12,textAlign:'center'}}>No files in repository</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  {Platform.OS === 'web' && fileTreeView === 'tree' ? (
                    <>
                      <RoomFileTree
                        files={files.map(f => ({
                          id: f.id, name: f.name, folder: f.folder,
                          file_type: f.file_type, size_bytes: f.size_bytes, is_deleted: f.is_deleted,
                        }) as RoomFileEntry)}
                        selectedFileId={activeTabId ?? undefined}
                        onSelectFile={(fileId) => {
                          const file = files.find(f => f.id === fileId);
                          if (file) openFile(file);
                        }}
                        accentColor={accentColor}
                      />
                      {files.length === 0 && (
                        <View style={{padding:16,alignItems:'center'}}>
                          <Text style={{color:'#555',fontSize:12,textAlign:'center'}}>No files yet.{'\n'}Upload or create one.</Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                  {Platform.OS === 'web' && (
                    <View style={s.dropHint}>
                      <Text style={s.dropHintText}>⬆ Drop files anywhere to upload</Text>
                    </View>
                  )}
                </>
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
              const tabLangColor = LANG_COLORS[tab.file_type] || '#888';
              return (
                <Pressable key={tab.id} onPress={() => setActiveTabId(tab.id)}
                  style={[s.editorTab, isActive && {backgroundColor:'#000000',borderBottomColor:tabLangColor}]}>
                  <Text style={s.editorTabIcon}>{FILE_ICONS[tab.file_type]||'📄'}</Text>
                  <Text style={[s.editorTabName, isActive && {color:'#fff'}]} numberOfLines={1}>
                    {tab.name}{dirty?'●':''}
                  </Text>
                  <View style={{width:6,height:6,borderRadius:3,backgroundColor:tabLangColor,opacity:isActive?1:0.4}} />
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
                {isGitHubFile(activeTab) && (
                  <>
                    <View style={{backgroundColor:'#ffffff10',paddingHorizontal:6,paddingVertical:2,borderRadius:12}}>
                      <Text style={{color:'#888',fontSize:10,fontWeight:'700',fontFamily:MONO}}>GITHUB · READ-ONLY</Text>
                    </View>
                    <Pressable onPress={()=>importGitHubFile(activeTab)}
                      style={[s.fileAction,{backgroundColor:'#ffffff08',borderColor:'#ffffff15',borderWidth:1,borderRadius:12}]}>
                      <Text style={{color:'#3b82f6',fontSize:11,fontWeight:'700'}}>↓ Import to Room</Text>
                    </Pressable>
                  </>
                )}
                <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                  <View style={{width:8,height:8,borderRadius:4,backgroundColor:LANG_COLORS[activeTab.file_type]||'#888'}} />
                  <Text style={[s.fileToolbarMeta,{color:LANG_COLORS[activeTab.file_type]||'#888'}]}>
                    {activeTab.file_type.toUpperCase()}
                  </Text>
                  <Text style={s.fileToolbarMeta}>
                    {formatBytes(activeTab.size_bytes)}
                  </Text>
                </View>
                {!isGitHubFile(activeTab) && (
                  <Pressable onPress={()=>downloadFile(activeTab)} style={s.fileAction}>
                    <Text style={s.fileActionText}>⬇ Download</Text>
                  </Pressable>
                )}
                {activeTab.tags.length > 0 && activeTab.tags.filter(t => t !== 'github').map(tag => (
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
              onEdit={v => {
                if (isGitHubFile(activeTab)) return;
                setEditingContent(p => ({...p, [activeTab.id]:v}));
              }}
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
          <>
          <ResizeHandle onDrag={handlePanelResize} />
          <View style={[s.rightPanel, { width: rightPanelWidth }]}>
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
            {rightPanel === 'github' && <GitHubPanel circleId={room.circle_id} accentColor={accentColor}
              ghConnected={ghConnected} ghUser={ghUser} ghRepo={ghRepo}
              onConnected={(user) => { setGhConnected(true); setGhUser(user); }}
              onDisconnected={() => { setGhConnected(false); setGhUser(null); setGhRepo(null); setGhTree([]); setGhBrowsing(false); }}
              onRepoSelected={async (repo) => {
                setGhRepo(repo);
                setGhLoadingTree(true);
                const token = await getGitHubToken();
                if (!token) {
                  setGhLoadingTree(false);
                  // No API token — prompt for PAT in the GitHubPanel
                  if (Platform.OS === 'web') {
                    const pat = window.prompt('Enter a GitHub Personal Access Token to browse files.\n\nGenerate one at: github.com → Settings → Developer settings → Personal access tokens\n\nNeeded scopes: repo');
                    if (pat && pat.startsWith('ghp_')) {
                      await storeToken(room.circle_id, pat);
                      // Retry with the new token
                      const [owner, repoName] = repo.full_name.split('/');
                      setGhLoadingTree(true);
                      const { tree } = await getRepoTree(pat, owner, repoName, repo.default_branch);
                      setGhTree(tree);
                      setGhLoadingTree(false);
                      setGhBrowsing(true);
                    }
                  }
                  return;
                }
                const [owner, repoName] = repo.full_name.split('/');
                const { tree } = await getRepoTree(token, owner, repoName, repo.default_branch);
                setGhTree(tree);
                setGhLoadingTree(false);
                setGhBrowsing(true);
              }}
              onRepoClosed={() => { setGhRepo(null); setGhTree([]); setGhBrowsing(false); }}
            />}
            {!rightPanel && (
              <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                <Text style={{color:'#444',fontSize:12}}>Select a panel above</Text>
              </View>
            )}
          </View>
          </>
        )}
      </View>

      {/* Mobile: right panel as bottom sheet */}
      {isMobile && (
        <View style={[s.bottomSheet, rightPanel ? s.bottomSheetExpanded : s.bottomSheetCollapsed]}>
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
          {rightPanel === 'github' && <GitHubPanel circleId={room.circle_id} accentColor={accentColor}
              ghConnected={ghConnected} ghUser={ghUser} ghRepo={ghRepo}
              onConnected={(user) => { setGhConnected(true); setGhUser(user); }}
              onDisconnected={() => { setGhConnected(false); setGhUser(null); setGhRepo(null); setGhTree([]); setGhBrowsing(false); }}
              onRepoSelected={async (repo) => {
                setGhRepo(repo);
                setGhLoadingTree(true);
                const token = await getGitHubToken();
                if (!token) {
                  setGhLoadingTree(false);
                  // No API token — prompt for PAT in the GitHubPanel
                  if (Platform.OS === 'web') {
                    const pat = window.prompt('Enter a GitHub Personal Access Token to browse files.\n\nGenerate one at: github.com → Settings → Developer settings → Personal access tokens\n\nNeeded scopes: repo');
                    if (pat && pat.startsWith('ghp_')) {
                      await storeToken(room.circle_id, pat);
                      // Retry with the new token
                      const [owner, repoName] = repo.full_name.split('/');
                      setGhLoadingTree(true);
                      const { tree } = await getRepoTree(pat, owner, repoName, repo.default_branch);
                      setGhTree(tree);
                      setGhLoadingTree(false);
                      setGhBrowsing(true);
                    }
                  }
                  return;
                }
                const [owner, repoName] = repo.full_name.split('/');
                const { tree } = await getRepoTree(token, owner, repoName, repo.default_branch);
                setGhTree(tree);
                setGhLoadingTree(false);
                setGhBrowsing(true);
              }}
              onRepoClosed={() => { setGhRepo(null); setGhTree([]); setGhBrowsing(false); }}
            />}
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
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

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
        <TextInput style={[s.codeEditor,{flex:1,borderRightWidth:1,borderRightColor:'#000000'}]}
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
    const ptLines = content.split('\n');
    const ptGw = gutterWidth(ptLines.length);
    return (
      <View style={{flex:1,backgroundColor:'#000000'}}>
        <ScrollView style={{flex:1}}>
          <View style={{position:'relative',minHeight:ptLines.length*22+32}}>
            {/* Line numbers */}
            <View style={{position:'absolute',top:0,left:0,bottom:0,paddingTop:8}} pointerEvents="none">
              {ptLines.map((_,idx) => (
                <Text key={idx} style={{width:ptGw,textAlign:'right',paddingRight:12,color:'#4a4a4a',fontSize:13,fontFamily:MONO,lineHeight:22,userSelect:'none'} as any} selectable={false}>
                  {idx+1}
                </Text>
              ))}
            </View>
            <TextInput
              style={{
                paddingTop:8,paddingBottom:16,paddingLeft:ptGw+4,paddingRight:16,
                color:'#e8e8e8',fontSize:14,lineHeight:22,
                textAlignVertical:'top',minHeight:ptLines.length*22+32,
                ...(Platform.OS==='web'?{outlineStyle:'none'} as any:{}),
              }}
              value={content} onChangeText={onEdit} multiline autoCorrect={false}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (lang === 'canvas') {
    return <CanvasViewer file={file} onEdit={onEdit} />;
  }

  // Code — syntax highlighted
  const lines = content.split('\n');
  const gw = gutterWidth(lines.length);
  const isReadonly = file.id.startsWith('gh_');
  const langColor = LANG_COLORS[lang] || '#888';

  return (
    <View style={{flex:1,backgroundColor:'#000000'}}>
      {/* Language pill */}
      <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingTop:6,paddingBottom:4,gap:8}}>
        <View style={{backgroundColor:langColor+'20',paddingHorizontal:8,paddingVertical:2,borderRadius:12,borderWidth:1,borderColor:langColor+'40'}}>
          <Text style={{color:langColor,fontSize:10,fontWeight:'700',fontFamily:MONO}}>{FILE_ICONS[lang]||'📄'} {lang.toUpperCase()}</Text>
        </View>
        <Text style={{color:'#555',fontSize:10,fontFamily:MONO}}>{lines.length} lines</Text>
      </View>

      <ScrollView style={{flex:1}} ref={scrollRef}>
        <View style={{position:'relative',minHeight:lines.length*22+32}}>
          {/* Highlighted code layer */}
          <View style={{position:'absolute',top:0,left:0,right:0,paddingTop:8,paddingBottom:16}} pointerEvents="none">
            {lines.map((line, idx) => {
              const tokens = tokenizeLine(line, lang);
              return (
                <View key={idx} style={{flexDirection:'row',minHeight:22,alignItems:'flex-start'}}>
                  {/* Line number */}
                  <Text style={{width:gw,textAlign:'right',paddingRight:12,color:'#4a4a4a',fontSize:13,fontFamily:MONO,lineHeight:22,userSelect:'none'} as any} selectable={false}>
                    {idx+1}
                  </Text>
                  {/* Tokens */}
                  <Text style={{flex:1,fontSize:13,fontFamily:MONO,lineHeight:22}}>
                    {tokens.map((tk, ti) => (
                      <Text key={ti} style={{color:TOKEN_COLORS[tk.type]}}>{tk.text}</Text>
                    ))}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Editable TextInput layer — transparent text, positioned over the highlight */}
          {!isReadonly && (
            <TextInput
              ref={inputRef}
              style={{
                position:'absolute',top:0,left:0,right:0,
                paddingTop:8,paddingBottom:16,paddingLeft:gw+4,paddingRight:16,
                color:'transparent',fontSize:13,fontFamily:MONO,lineHeight:22,
                textAlignVertical:'top',
                minHeight:lines.length*22+32,
                ...(Platform.OS==='web'?{outlineStyle:'none',caretColor:'#fff'} as any:{}),
              }}
              value={content} onChangeText={onEdit}
              multiline autoCapitalize="none" autoCorrect={false} spellCheck={false}
            />
          )}
        </View>
      </ScrollView>
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
  const [showSpawnAgent, setShowSpawnAgent] = useState(false);
  const [liveAgents, setLiveAgents] = useState<LiveAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [selectedFile, setSelectedFile]   = useState<string>('');   // file name
  const [roomFiles, setRoomFiles]  = useState<{ id: string; name: string }[]>([]);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [assigning, setAssigning]  = useState(false);
  const [agentConnections, setAgentConnections] = useState<any[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // Load agent connections from local storage (user's own OpenSwan instances)
  useEffect(() => {
    (async () => {
      try {
        const { loadConnections } = await import('../../../lib/connectionManager');
        const conns = await loadConnections();
        setAgentConnections(conns.filter((c: any) => c.enabled));
      } catch {}
    })();
  }, []);

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

  // Load live agents — same circle only (no cross-circle leakage)
  useEffect(() => {
    const query = () => {
      if (!circleId) return;
      supabase.from('circle_office_agents')
        .select('id, name, status, owner_id, color, tool_icon, owner_display_name, current_task, circle_id, provider')
        .eq('circle_id', circleId)
        .neq('status', 'offline')
        .order('status')
        .limit(50)
        .then(({ data }) => { if (data) setLiveAgents(data); });
    };
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

  const [botTyping, setBotTyping] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const content = input.trim();
    const lowerContent = content.toLowerCase();
    await supabase.from('room_messages').insert({
      room_id: roomId, user_id: user?.id || null, content, message_type: 'chat',
    });
    setInput('');

    // ─── /room commands ─────────────────────────────────────────────────
    if (lowerContent.startsWith('/room ') || lowerContent === '/room') {
      setBotTyping(true);
      try {
        const { executeRoomCommand } = await import('../../../lib/roomChatCommands');
        const result = await executeRoomCommand(content, {
          circleId: circleId || '', userId: user?.id || '', roomId, surface: 'room_chat',
        });
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: result.message || 'No response.',
          message_type: 'agent_output', metadata: { bot: true, bot_name: 'Agent' },
        });
      } catch (e: any) {
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: `Room error: ${e.message}`, message_type: 'agent_output',
          metadata: { bot: true, bot_name: 'Agent' },
        });
      } finally { setBotTyping(false); }
      return;
    }

    // ─── /gh commands ───────────────────────────────────────────────────
    if (lowerContent.startsWith('/gh ') || lowerContent === '/gh') {
      setBotTyping(true);
      try {
        const { executeGitHubCommand } = await import('../../../lib/githubChatCommands');
        const result = await executeGitHubCommand(content, {
          circleId: circleId || '', userId: user?.id || '',
        });
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: result.message || 'No response.',
          message_type: 'agent_output', metadata: { bot: true, bot_name: 'Agent' },
        });
      } catch (e: any) {
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: `GitHub error: ${e.message}`, message_type: 'agent_output',
          metadata: { bot: true, bot_name: 'Agent' },
        });
      } finally { setBotTyping(false); }
      return;
    }

    // ─── Smart command detection — special prompts that load extra context ──
    const isAtMentioningSomeoneElse = /^@(?!agent|blackswan|swanbot|swan\b)\w/i.test(content.trim());
    if (!isAtMentioningSomeoneElse) {
      const cleanContent = content.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || content;
      setBotTyping(true);
      try {
        // Build base context
        const recentMsgs = messages.slice(-8).map(m =>
          `${m.metadata?.bot ? 'Agent' : 'User'}: ${(m.content || '').slice(0, 200)}`
        ).join('\n');

        const fileContext = activeFile
          ? `\n\nCurrently viewing file: ${activeFile.name} (${activeFile.file_type || 'text'})\nFile content (first 2000 chars):\n${(activeFile.content || '').slice(0, 2000)}`
          : '';

        // ── Detect intent and load appropriate context ──────────────────
        let specialContext = '';
        let specialPromptPrefix = '';

        // REVIEW — loads all files for comprehensive code review
        const isReviewRequest = /review|audit|check.*files|look.*files|scan|analyze.*code|all.*files|code.*quality/i.test(cleanContent);
        // SECURITY — focused security audit
        const isSecurityRequest = /security|vulnerab|xss|injection|owasp|exploit|auth.*issue|secret|leak|exposed/i.test(cleanContent);
        // PERFORMANCE — performance analysis
        const isPerfRequest = /performance|optimize|slow|fast|speed|memory|bundle.*size|lazy.*load|cache|render/i.test(cleanContent);
        // REFACTOR — refactoring suggestions
        const isRefactorRequest = /refactor|simplif|clean.*up|dry|extract|decompos|split.*file|too.*long|too.*big|complex/i.test(cleanContent);
        // TESTS — test generation
        const isTestRequest = /test|spec|unit.*test|integration.*test|coverage|jest|vitest|assert|expect/i.test(cleanContent);
        // DOCS — documentation generation
        const isDocsRequest = /document|readme|jsdoc|typedoc|comment|explain.*code|what.*does.*this/i.test(cleanContent);
        // RESEARCH — deep research on a topic
        const isResearchRequest = /research|deep.*dive|how.*does|how.*to|best.*practice|compare|alternatives|pros.*cons|tradeoff/i.test(cleanContent);
        // DEBUG — help debugging
        const isDebugRequest = /debug|error|bug|crash|broken|not.*working|fix.*this|why.*fail|exception|trace/i.test(cleanContent);
        // ARCHITECTURE — architecture review
        const isArchRequest = /architect|structure|pattern|design.*pattern|dependency|coupling|solid|separation|layers/i.test(cleanContent);
        // TYPES — TypeScript type analysis
        const isTypeRequest = /type.*error|typescript|interface|generic|type.*safe|strict|any.*type|infer/i.test(cleanContent);

        // Load all files for review-type requests
        const needsAllFiles = isReviewRequest || isSecurityRequest || isPerfRequest || isRefactorRequest || isArchRequest;
        if (needsAllFiles) {
          const { data: allFiles } = await supabase
            .from('room_files')
            .select('name, file_type, content, size_bytes')
            .eq('room_id', roomId)
            .eq('is_deleted', false)
            .order('name');
          if (allFiles && allFiles.length > 0) {
            const fileSummaries = allFiles.map((f: any) => {
              const truncated = (f.content || '').slice(0, 3000);
              return `\n--- ${f.name} (${f.file_type || 'text'}, ${f.size_bytes || 0}B) ---\n${truncated}${(f.content || '').length > 3000 ? '\n... (truncated)' : ''}`;
            });
            specialContext = `\n\n## ALL ROOM FILES (${allFiles.length} files)\n${fileSummaries.join('\n')}`;
          }
        } else if (roomFiles.length > 0) {
          specialContext = `\n\nRoom files available: ${roomFiles.map(f => f.name).join(', ')}`;
        }

        // Add specialized instructions based on intent
        if (isSecurityRequest) {
          specialPromptPrefix = `[SECURITY AUDIT MODE] Analyze the code for security vulnerabilities. Check for: XSS, SQL injection, command injection, insecure secrets handling, missing auth checks, CORS issues, prototype pollution, path traversal, insecure dependencies, exposed API keys. Rate severity (Critical/High/Medium/Low) for each finding. Provide specific line-level fixes.\n\nUser request: `;
        } else if (isPerfRequest) {
          specialPromptPrefix = `[PERFORMANCE REVIEW MODE] Analyze the code for performance issues. Check for: unnecessary re-renders, missing memoization, N+1 queries, large bundle imports, unoptimized images, missing lazy loading, expensive computations in render, memory leaks from subscriptions/timers, missing virtualization for long lists. Suggest specific optimizations with code examples.\n\nUser request: `;
        } else if (isRefactorRequest) {
          specialPromptPrefix = `[REFACTOR MODE] Analyze the code and suggest refactoring improvements. Check for: DRY violations, god objects/functions, unclear naming, excessive nesting, missing abstractions, files that do too much, tightly coupled modules, dead code. Prioritize suggestions by impact. Show before/after code examples.\n\nUser request: `;
        } else if (isTestRequest) {
          specialPromptPrefix = `[TEST GENERATION MODE] Generate comprehensive tests for the code. Include: unit tests for pure functions, integration tests for API calls, edge cases, error paths, boundary values, mocking strategies for external dependencies. Use the project's testing conventions. Output complete runnable test files.\n\nUser request: `;
        } else if (isDocsRequest) {
          specialPromptPrefix = `[DOCUMENTATION MODE] Generate clear, useful documentation. Include: function/component purpose, parameters with types, return values, usage examples, edge cases, related functions. Match the project's existing doc style. Be concise but complete.\n\nUser request: `;
        } else if (isResearchRequest) {
          specialPromptPrefix = `[DEEP RESEARCH MODE] Provide thorough, well-researched analysis. Include: current best practices, comparison of approaches with tradeoffs, real-world examples, links to authoritative sources when possible, concrete recommendations with reasoning. Structure with clear headings. Go deep — this is not a quick answer.\n\nUser request: `;
        } else if (isDebugRequest) {
          specialPromptPrefix = `[DEBUG MODE] Help diagnose and fix the issue. Approach systematically: 1) Understand the expected vs actual behavior, 2) Identify potential causes, 3) Check for common pitfalls in this stack (React Native, Supabase, TypeScript), 4) Suggest debugging steps, 5) Provide the fix with explanation. Ask clarifying questions if needed.\n\nUser request: `;
        } else if (isArchRequest) {
          specialPromptPrefix = `[ARCHITECTURE REVIEW MODE] Analyze the code architecture. Evaluate: separation of concerns, dependency direction, module boundaries, data flow patterns, error handling strategy, state management approach, API design, scalability considerations. Provide specific architectural recommendations with diagrams (ASCII) where helpful.\n\nUser request: `;
        } else if (isTypeRequest) {
          specialPromptPrefix = `[TYPE ANALYSIS MODE] Analyze TypeScript types and suggest improvements. Check for: any types that should be narrowed, missing generics, interfaces vs types, discriminated unions, utility types that could simplify, incorrect nullability, missing readonly, unsafe type assertions. Show corrected type definitions.\n\nUser request: `;
        } else if (isReviewRequest) {
          specialPromptPrefix = `[CODE REVIEW MODE] Do a thorough code review. Check: correctness, error handling, edge cases, naming clarity, code style consistency, potential bugs, security issues, performance concerns, accessibility, and maintainability. Organize findings by severity. Suggest fixes with code examples.\n\nUser request: `;
        }

        const fullPrompt = specialPromptPrefix + cleanContent;

        const response = await getAIResponse(fullPrompt, {
          userId: user?.id || 'anonymous',
          circleId,
          chatHistory: recentMsgs + fileContext + specialContext,
        });
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: response, message_type: 'agent_output',
          metadata: { bot: true, bot_name: 'Agent' },
        });
      } catch {
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: 'Agent',
          content: 'Something went wrong. Try again.',
          message_type: 'agent_output', metadata: { bot: true, bot_name: 'Agent' },
        });
      } finally { setBotTyping(false); }
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
    const { error } = await supabase.from('room_messages').delete().eq('id', msgId);
    if (error) {
      console.error('Failed to delete message:', error);
      const { data } = await supabase.from('room_messages').select('*').eq('room_id', roomId).order('created_at');
      if (data) setMessages(data);
    }
  };

  const assignToAgent = async () => {
    if (!selectedAgent || !taskPrompt.trim()) return;
    setAssigning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetName = selectedFile || activeFile?.name || null;
      const filePart = targetName ? ` on \`${targetName}\`` : '';

      // Load full file content for context (both selected and active file)
      let fileContent: string | null = null;
      if (targetName) {
        const { data: fileData } = await supabase
          .from('room_files')
          .select('content')
          .eq('room_id', roomId)
          .ilike('name', targetName)
          .maybeSingle();
        fileContent = fileData?.content?.slice(0, 12000) || null;
      } else if (activeFile?.content) {
        fileContent = activeFile.content.slice(0, 12000);
      }

      const msgContent = `@${selectedAgent.name}${filePart}: ${taskPrompt.trim()}`;

      // 1. Insert the task message (shows as PENDING in chat)
      const { data: inserted } = await supabase.from('room_messages').insert({
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
          provider: selectedAgent.provider || 'unknown',
        },
      }).select('id').single();

      const taskId = inserted?.id;

      // 2. Update agent's current_task in the Office
      await supabase.from('circle_office_agents')
        .update({ current_task: `[Room] ${taskPrompt.trim().slice(0, 120)}`, status: 'building' })
        .eq('id', selectedAgent.id);

      // 3. Dispatch — try bridge first, fall back to BlackSwan AI
      const provider = (selectedAgent.provider || '').toLowerCase().replace(/\s+/g, '-');
      const bridgeProviders = ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'];

      const postResult = async (ok: boolean, content: string, via: string) => {
        await supabase.from('room_messages').insert({
          room_id: roomId, user_id: null, agent_name: selectedAgent.name,
          content, message_type: 'agent_output',
          metadata: { task_reply: true, task_id: taskId, provider, dispatched_via: via, success: ok },
        });
        await supabase.from('circle_office_agents')
          .update({ current_task: null, status: ok ? 'active' : 'idle' })
          .eq('id', selectedAgent.id);
      };

      if (bridgeProviders.includes(provider) && taskId) {
        console.log(`[Rooms] Waking & assigning task to ${provider}...`);
        try {
          const result = await wakeAndAssignTask(
            provider, selectedAgent.name, taskPrompt.trim(),
            circleId || '', selectedAgent.id,
            { fileName: targetName || undefined },
          );
          if (result.ok) {
            await postResult(true, `**${selectedAgent.name}** [executed via ${provider} bridge]:\n\n${result.response || 'Done'}`, 'bridge');
          } else {
            // Wake + dispatch failed — fall back to BlackSwan AI with file context
            console.log(`[Rooms] Wake failed (${result.error}), falling back to AI...`);
            const fileCtx = fileContent ? `\n\nFile "${targetName}":\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`` : '';
            const aiPrompt = `[Task from Rooms, assigned to ${selectedAgent.name}]${filePart}\n${taskPrompt.trim()}${fileCtx}`;
            const aiResponse = await getAIResponse(aiPrompt, {
              userId: user?.id || 'anonymous', circleId,
            });
            await postResult(true, `**${selectedAgent.name}** [AI draft — not executed by agent]:\n\n${aiResponse}`, 'ai-fallback');
          }
        } catch (err: any) {
          console.error('Dispatch failed:', err);
          // Fall back to AI
          try {
            const fileCtx = fileContent ? `\n\nFile "${targetName}":\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`` : '';
            const aiPrompt = `[Task from Rooms, assigned to ${selectedAgent.name}]${filePart}\n${taskPrompt.trim()}${fileCtx}`;
            const aiResponse = await getAIResponse(aiPrompt, {
              userId: user?.id || 'anonymous', circleId,
            });
            await postResult(true, `**${selectedAgent.name}** [AI draft — not executed by agent]:\n\n${aiResponse}`, 'ai-fallback');
          } catch {
            await postResult(false, `**${selectedAgent.name}** failed: ${err?.message || 'Unknown error'}`, 'none');
          }
        }
      } else if (taskId) {
        // Non-bridge provider — use BlackSwan AI directly with full file context
        try {
          const fileCtx = fileContent ? `\n\nFile "${targetName}":\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`` : '';
          const aiPrompt = `[Task from Rooms, assigned to ${selectedAgent.name}]${filePart}\n${taskPrompt.trim()}${fileCtx}`;
          const aiResponse = await getAIResponse(aiPrompt, {
            userId: user?.id || 'anonymous', circleId,
          });
          await postResult(true, `**${selectedAgent.name}** [AI draft — not executed by agent]:\n\n${aiResponse}`, 'ai');
        } catch (err: any) {
          await postResult(false, `**${selectedAgent.name}** failed: ${err?.message || 'Unknown error'}`, 'none');
        }
      }

      setTaskPrompt(''); setSelectedFile(''); setSelectedAgent(null); setShowAssign(false);
    } finally { setAssigning(false); }
  };

  // Subscribe to task status updates — when the edge function posts a reply
  // with task_reply: true, flip the original task's PENDING badge to DONE
  useEffect(() => {
    const ch = supabase.channel(`task_status_${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'room_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        const msg = payload.new as RoomMessage;
        if (msg.metadata?.task_reply && msg.metadata?.task_id) {
          // Edge function posted a reply — mark the original task as done
          setMessages(prev => prev.map(m =>
            m.id === msg.metadata.task_id
              ? { ...m, metadata: { ...m.metadata, status: 'done' } }
              : m
          ));
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'room_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        // Also handle direct status updates on existing messages
        const updated = payload.new as RoomMessage;
        setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, metadata: updated.metadata } : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  const STATUS_COLOR: Record<string, string> = { active: '#22c55e', idle: '#f59e0b', error: '#ef4444', offline: '#6f6f6f' };

  return (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={[s.panelTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Chat</Text>
        {botTyping && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#f59e0b' }} />
            <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '600' }}>thinking...</Text>
          </View>
        )}
        <Pressable onPress={() => { setShowSpawnAgent(p => !p); if (showAssign) setShowAssign(false); }}
          style={[chatSt.assignToggle, showSpawnAgent && { backgroundColor: '#22c55e15', borderColor: '#22c55e50' }]}>
          <Text style={[chatSt.assignToggleText, showSpawnAgent && { color: '#22c55e' }]}>+ Spawn</Text>
        </Pressable>
        <Pressable onPress={() => { setShowAssign(p => !p); if (showSpawnAgent) setShowSpawnAgent(false); }}
          style={[s.panelBtn, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700' }}>Assign</Text>
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
                      {agent.provider && <Text style={{ color: '#58a6ff', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' as any, letterSpacing: 0.5, marginTop: 1 }}>{agent.provider}</Text>}
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
                style={[chatSt.fileChip, selectedFile === f.name && { backgroundColor: '#ffffff10', borderColor: '#ffffff30' }]}>
                <Text style={[chatSt.fileChipText, selectedFile === f.name && { color: '#e8e8e8' }]}>{f.name}</Text>
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
                {selectedFile ? <Text> → <Text style={{ color: '#e8e8e8' }}>{selectedFile}</Text></Text> : null}
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

      {/* ── AI Presets Strip — explicit action buttons ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6, gap: 6 }}
        style={{ maxHeight: 38, borderBottomWidth: 1, borderBottomColor: '#1a1a28' }}
      >
        {ROOM_CHAT_PRESETS.map(preset => (
          <Pressable
            key={preset.id}
            onPress={() => { setInput(preset.prompt); }}
            accessibilityRole="button"
            accessibilityLabel={preset.label}
            style={[
              {
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                borderWidth: 1, borderColor: preset.color + '40',
                backgroundColor: preset.color + '10',
              },
              ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
            ]}
          >
            <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: preset.color + '25', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: preset.color, fontSize: 9, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{preset.icon}</Text>
            </View>
            <Text style={{ color: preset.color, fontSize: 10, fontWeight: '600' }}>{preset.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Messages */}
      <ScrollView ref={scrollRef} style={s.msgList} contentContainerStyle={{ padding: 10, gap: 6 }}>
        {messages.length === 0 && <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20, fontStyle: 'italic' }}>No messages yet</Text>}
        {messages.map(m => <MsgBubble key={m.id} msg={m} accentColor={accentColor} onDelete={handleDeleteMessage} />)}
      </ScrollView>

      {/* Active file chip */}
      {activeFile && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#0a0a10', borderTopWidth: 1, borderTopColor: '#1a1a28' }}>
          <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: accentColor + '20', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: accentColor, fontSize: 8, fontWeight: '800' }}>F</Text>
          </View>
          <Text style={{ color: '#a0a0b0', fontSize: 10 }} numberOfLines={1}>Attached: {activeFile.name}</Text>
        </View>
      )}

      {/* Input */}
      <View style={s.msgInputRow}>
        <TextInput style={s.msgInput} value={input} onChangeText={setInput}
          placeholder="Ask Agent anything..." placeholderTextColor="#555"
          onSubmitEditing={send} returnKeyType="send" multiline maxLength={2000} />
        <Pressable onPress={send} disabled={!input.trim()}
          style={[s.sendBtn, { backgroundColor: accentColor, opacity: input.trim() ? 1 : 0.4 }]}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>→</Text>
        </Pressable>
      </View>

      {/* ── Spawn Agent — full overlay within chat panel ── */}
      {showSpawnAgent && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: '#000000f5', zIndex: 50, borderRadius: 12,
        }} nativeID="section-spawn-overlay">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
            <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1 }}>SPAWN AGENT</Text>
            <Pressable onPress={() => setShowSpawnAgent(false)} accessibilityRole="button" accessibilityLabel="Close spawn panel"
              style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' }}>
              <Text style={{ color: '#9e9e9e', fontSize: 14, fontWeight: '700' }}>X</Text>
            </Pressable>
          </View>
          <SpawnAgentPanel
            circleId={circleId}
            onCreated={(_agentId: string, _agentName: string) => {
              setShowSpawnAgent(false);
              supabase.from('circle_office_agents')
                .select('id, name, status, owner_id, color, tool_icon, owner_display_name, current_task, circle_id, provider')
                .eq('circle_id', circleId || '')
                .neq('status', 'offline').order('status').limit(50)
                .then(({ data }) => { if (data) setLiveAgents(data); });
            }}
            onCancel={() => setShowSpawnAgent(false)}
          />
        </View>
      )}
    </View>
  );
}

const chatSt = StyleSheet.create({
  assignBox: { backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a', padding: 14, gap: 4 },
  assignLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  agentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1, borderColor: '#222', backgroundColor: '#0d0d0d',
    marginRight: 8, minWidth: 100,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  agentChipDot: { width: 7, height: 7, borderRadius: 4 },
  agentChipName: { color: '#ccc', fontSize: 12, fontWeight: '700' },
  agentChipModel: { color: '#555', fontSize: 9, fontFamily: MONO, marginTop: 1 },
  fileChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1,
    borderColor: '#222', backgroundColor: '#0d0d0d', marginRight: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  fileChipText: { color: '#888', fontSize: 11, fontFamily: MONO },
  assignSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#1a1a1a', marginTop: 4 },
  assignSummaryDot: { width: 7, height: 7, borderRadius: 4 },
  activeFileBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12,
    backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff15',
  },
  activeFileBannerIcon: { fontSize: 14 },
  activeFileBannerName: { color: '#e8e8e8', fontSize: 12, fontWeight: '700', fontFamily: MONO },
  activeFileBannerHint: { color: '#555', fontSize: 10, fontStyle: 'italic' },
  agentChipOwner: { color: '#555', fontSize: 9, marginTop: 1 },
  agentChipTask: { color: '#888', fontSize: 9, marginTop: 1, fontStyle: 'italic' },
  assignToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#1a1a28' },
  assignToggleText: { fontSize: 12, color: '#a0a0b0', fontWeight: '500' },
});

// ─── 3D Agent Thinking Animation ───────────────────────────────────────────
function AgentThinkingLoader() {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), 80);
    return () => clearInterval(id);
  }, []);

  const phrases = [
    'Analyzing code...',
    'Thinking deeply...',
    'Crafting solution...',
    'Writing code...',
    'Almost there...',
  ];
  const phrase = phrases[Math.floor(frame / 25) % phrases.length];

  // 3D rotating cube built from Unicode blocks
  const cubeFrames = [
    ['  ┌──┐  ', '  │▓▓│  ', '  └──┘  '],
    [' ┌───┐  ', ' │ ▓▓│  ', ' └───┘  '],
    ['┌────┐  ', '│  ▓▓│  ', '└────┘  '],
    [' ┌───┐  ', ' │▓▓ │  ', ' └───┘  '],
    ['  ┌──┐  ', '  │▓▓│  ', '  └──┘  '],
    ['  ┌───┐ ', '  │▓▓ │ ', '  └───┘ '],
    ['  ┌────┐', '  │▓▓  │', '  └────┘'],
    ['  ┌───┐ ', '  │ ▓▓│ ', '  └───┘ '],
  ];
  const cubeFrame = cubeFrames[frame % cubeFrames.length];

  // Bouncing dots
  const dotCount = 5;
  const dots = Array.from({ length: dotCount }, (_, i) => {
    const offset = (frame * 3 + i * 40) % 360;
    const y = Math.sin((offset * Math.PI) / 180) * 6;
    const scale = 0.6 + Math.cos((offset * Math.PI) / 180) * 0.4;
    const colors = ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b'];
    return { y, scale, color: colors[i] };
  });

  if (Platform.OS === 'web') {
    // Inject keyframe styles once
    React.useEffect(() => {
      if (document.getElementById('agent-thinking-css')) return;
      const style = document.createElement('style');
      style.id = 'agent-thinking-css';
      style.textContent = `
        @keyframes agentCubeSpin {
          0% { transform: perspective(60px) rotateY(0deg) rotateX(10deg); }
          100% { transform: perspective(60px) rotateY(360deg) rotateX(10deg); }
        }
        @keyframes agentPulseGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes agentDotBounce {
          0%, 100% { transform: translateY(0px) scale(0.8); }
          50% { transform: translateY(-8px) scale(1.2); }
        }
        .agent-cube {
          width: 24px; height: 24px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          border-radius: 4px;
          animation: agentCubeSpin 2s linear infinite;
          box-shadow: 0 0 12px rgba(255,255,255,0.15);
        }
        .agent-dot {
          width: 6px; height: 6px; border-radius: 50%;
          animation: agentDotBounce 1.2s ease-in-out infinite;
        }
      `;
      document.head.appendChild(style);
    }, []);

    return (
      <View style={{ marginTop: 8, padding: 12, backgroundColor: '#ffffff05', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontSize: 20 }}>🧠</Text>

          {/* Bouncing dots */}
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {dots.map((dot, i) => (
              <View
                key={i}
                {...{ className: 'agent-dot' } as any}
                style={{
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor: dot.color,
                  animationDelay: `${i * 0.15}s`,
                } as any}
              />
            ))}
          </View>

          {/* Status text */}
          <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '600', fontStyle: 'italic' }}>
            {phrase}
          </Text>
        </View>

        {/* Progress bar */}
        <View style={{ marginTop: 8, height: 3, backgroundColor: '#ffffff08', borderRadius: 2, overflow: 'hidden' }}>
          <View style={{
            height: 3, borderRadius: 2,
            backgroundColor: '#6366f1',
            width: `${Math.min(95, (frame % 120) / 120 * 100)}%` as any,
          }} />
        </View>
      </View>
    );
  }

  // Native fallback — ASCII art cube + dots
  return (
    <View style={{ marginTop: 8, padding: 10, backgroundColor: '#ffffff05', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10' }}>
      <Text style={{ color: '#e8e8e8', fontSize: 10, fontFamily: MONO, lineHeight: 12 }}>
        {cubeFrame.join('\n')}
      </Text>
      <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '600', marginTop: 4 }}>{phrase}</Text>
    </View>
  );
}

const MsgBubble = React.memo(function MsgBubble({ msg, accentColor, onDelete }: { msg: RoomMessage; accentColor: string; onDelete?: (id: string) => void }) {
  const time = new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if (msg.message_type==='edit_event')
    return <View style={{alignItems:'center',flexDirection:'row',justifyContent:'center',gap:6}}><Text style={{color:'#555',fontSize:11,fontStyle:'italic'}}>✏️ {msg.content} · {time}</Text>{onDelete && <Pressable onPress={() => onDelete(msg.id)} hitSlop={6} style={{opacity:0.4}}><Text style={{color:'#f85149',fontSize:10}}>×</Text></Pressable>}</View>;
  if (msg.message_type==='system')
    return <View style={{alignItems:'center',flexDirection:'row',justifyContent:'center',gap:6}}><Text style={{color:'#555',fontSize:11,fontStyle:'italic'}}>{msg.content}</Text>{onDelete && <Pressable onPress={() => onDelete(msg.id)} hitSlop={6} style={{opacity:0.4}}><Text style={{color:'#f85149',fontSize:10}}>×</Text></Pressable>}</View>;
  if (msg.message_type==='agent_output') {
    const isTask = msg.metadata?.task === true;
    const targetFile = msg.metadata?.target_file;
    const status = msg.metadata?.status;
    return (
      <View style={{borderLeftWidth:3,borderLeftColor:isTask?'#6366f1':'#3b82f6',paddingLeft:10,paddingVertical:7,backgroundColor:isTask?'#6366f108':'#3b82f608',borderRadius:12}}>
        <View style={{flexDirection:'row',gap:8,marginBottom:3,flexWrap:'wrap',alignItems:'center'}}>
          <Text style={{color:isTask?'#6366f1':'#3b82f6',fontSize:11,fontWeight:'700'}}>{msg.agent_name||'Agent'}</Text>
          {isTask && <View style={{backgroundColor:'#6366f115',paddingHorizontal:5,paddingVertical:2,borderRadius:12,borderWidth:1,borderColor:'#6366f130'}}>
            <Text style={{color:'#6366f1',fontSize:9,fontWeight:'800',letterSpacing:0.5}}>TASK</Text>
          </View>}
          {targetFile && <Text style={{color:'#e8e8e8',fontSize:10,fontFamily:MONO}}>→ {targetFile}</Text>}
          {status && (
            <Text style={{
              color: status==='pending' ? '#f59e0b' : status==='done' ? '#22c55e' : '#ef4444',
              fontSize: 9, fontWeight: '800', marginLeft: 'auto' as any,
            }}>
              {status === 'pending' ? '⏳ PENDING' : status === 'done' ? '✓ DONE' : '✗ ERROR'}
            </Text>
          )}
          <Text style={{color:'#444',fontSize:10}}>{time}</Text>
          {onDelete && <Pressable onPress={() => onDelete(msg.id)} hitSlop={6} style={{ marginLeft: 'auto' as any, opacity: 0.5, paddingHorizontal: 4 } as any}><Text style={{color:'#f85149',fontSize:12,fontWeight:'700'}}>×</Text></Pressable>}
        </View>
        <Text style={{color:'#ccc',fontSize:12,lineHeight:18}}>{isTask ? msg.metadata?.prompt || msg.content : msg.content}</Text>
        {isTask && msg.metadata?.status === 'pending' && <AgentThinkingLoader />}
        {isTask && msg.metadata?.status === 'error' && (
          <Text style={{color:'#ef4444',fontSize:10,marginTop:4,fontStyle:'italic'}}>
            → Failed. Check your agent connection in the Office tab.
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
        {onDelete && <Pressable onPress={() => onDelete(msg.id)} hitSlop={6} style={{ marginLeft: 'auto' as any, opacity: 0.5, paddingHorizontal: 4 } as any}><Text style={{color:'#f85149',fontSize:12,fontWeight:'700'}}>×</Text></Pressable>}
      </View>
      <Text style={{color:'#e6e6e6',fontSize:13,marginLeft:28,lineHeight:19}}>{msg.content}</Text>
    </View>
  );
});

// ─── APIs Panel ───────────────────────────────────────────────────────────────

/** Tooltip that shows on hover/press with a ? icon */
function HelpTip({ text, color }: { text: string; color: string }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ position: 'relative' }}>
      <Pressable
        onPress={() => setShow(!show)}
        {...(Platform.OS === 'web' ? { onHoverIn: () => setShow(true), onHoverOut: () => setShow(false) } : {})}
        hitSlop={8}
        style={[{
          width: 18, height: 18, borderRadius: 9,
          backgroundColor: color + '20', borderWidth: 1, borderColor: color + '40',
          alignItems: 'center', justifyContent: 'center',
        }, Platform.OS === 'web' && { cursor: 'help' } as any]}
      >
        <Text style={{ color: color + 'cc', fontSize: 10, fontWeight: '900', fontFamily: 'monospace' }}>?</Text>
      </Pressable>
      {show && (
        <View style={{
          position: 'absolute', top: 22, right: 0, zIndex: 100, width: 260,
          backgroundColor: '#161616', borderWidth: 1, borderColor: color + '40',
          borderRadius: 12, padding: 12,
          ...(Platform.OS === 'web' ? { boxShadow: `0 4px 20px ${color}30` } as any : {}),
        }}>
          <Text style={{ color: '#ccc', fontSize: 11, lineHeight: 17, fontFamily: 'monospace' }}>{text}</Text>
        </View>
      )}
    </View>
  );
}

function APIsPanel({ room, accentColor }: { room: Room; accentColor: string }) {
  const [activeApi, setActiveApi] = useState<string>('storage');

  // Use env var for project ref — never hardcode the Supabase URL
  const projectUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace('https://', '').replace('http://', '');
  // Show a safe placeholder in examples (project ref only, no full URL)
  const projectRef = projectUrl.split('.')[0] || 'your-project';

  const roomShort = room.id.slice(0, 8) + '...';

  const API_DETAILS: Record<string, { endpoint: string; example: string }> = {
    storage: {
      endpoint: `supabase.storage\n  .from('room-files')\n  .upload('{roomId}/file.txt', data)`,
      example: `import { supabase } from './lib/supabase'\n\n// Upload a file\nconst { data, error } = await supabase\n  .storage.from('room-files')\n  .upload('${roomShort}/report.pdf', file)\n\n// Download\nconst { data: blob } = await supabase\n  .storage.from('room-files')\n  .download('${roomShort}/report.pdf')\n\n// List files\nconst { data: list } = await supabase\n  .storage.from('room-files')\n  .list('${roomShort}/')`,
    },
    database: {
      endpoint: `supabase\n  .from('room_files')\n  .select('*')\n  .eq('room_id', roomId)`,
      example: `import { supabase } from './lib/supabase'\n\n// Query room files\nconst { data: files } = await supabase\n  .from('room_files')\n  .select('id, name, content, language')\n  .eq('room_id', '${roomShort}')\n  .order('updated_at', { ascending: false })\n\n// Subscribe to changes\nsupabase\n  .channel('room-files')\n  .on('postgres_changes', {\n    event: '*',\n    schema: 'public',\n    table: 'room_files',\n    filter: \`room_id=eq.${roomShort}\`\n  }, (payload) => console.log(payload))\n  .subscribe()`,
    },
    messaging: {
      endpoint: `supabase\n  .channel('room:{roomId}')\n  .on('broadcast', handler)\n  .subscribe()`,
      example: `import { supabase } from './lib/supabase'\n\n// Subscribe to room events\nconst channel = supabase\n  .channel('room:${roomShort}')\n  .on('broadcast', { event: 'message' },\n    (payload) => {\n      console.log('New message:', payload)\n    })\n  .subscribe()\n\n// Send a message\nchannel.send({\n  type: 'broadcast',\n  event: 'message',\n  payload: { text: 'Hello room!' }\n})`,
    },
    queues: {
      endpoint: `supabase.functions\n  .invoke('room-queue', { body: task })`,
      example: `import { supabase } from './lib/supabase'\n\n// Enqueue a task\nconst { data } = await supabase.functions\n  .invoke('room-queue', {\n    body: {\n      room_id: '${roomShort}',\n      task: 'generate_summary',\n      payload: {\n        file_ids: ['...'],\n        model: 'claude-haiku'\n      }\n    }\n  })\n\nconsole.log('Task ID:', data.task_id)`,
    },
    secrets: {
      endpoint: `supabase\n  .from('room_secrets')\n  .upsert({ room_id, key, value })`,
      example: `import { supabase } from './lib/supabase'\n\n// Store a secret\nawait supabase.from('room_secrets')\n  .upsert({\n    room_id: '${roomShort}',\n    key: 'OPENAI_KEY',\n    value: 'sk-...',\n    created_by: userId\n  }, { onConflict: 'room_id,key' })\n\n// Read (only accessible by room members)\nconst { data } = await supabase\n  .from('room_secrets')\n  .select('key')\n  .eq('room_id', '${roomShort}')`,
    },
    containers: {
      endpoint: `supabase.functions\n  .invoke('room-exec', { body: config })`,
      example: `import { supabase } from './lib/supabase'\n\n// Run sandboxed code\nconst { data } = await supabase.functions\n  .invoke('room-exec', {\n    body: {\n      room_id: '${roomShort}',\n      image: 'python:3.12-slim',\n      cmd: ['python', 'main.py'],\n      files: {\n        'main.py': 'print("Hello!")',\n        'data.json': jsonStr\n      },\n      timeout: 30\n    }\n  })\n\nconsole.log('Output:', data.stdout)`,
    },
  };

  const SECTION_HELP: Record<string, string> = {
    storage: 'Files are stored in a Supabase Storage bucket, organized by room ID. Each file is access-controlled via RLS — only authenticated room members can read or write. Max file size depends on your Supabase plan.',
    database: 'All database queries go through Supabase\'s PostgREST API with Row Level Security enforced. You can only access data in rooms you\'re a member of. Use the Supabase JS client for type-safe queries.',
    messaging: 'Realtime messaging uses Supabase Channels (WebSocket). Messages are ephemeral by default — they\'re broadcast to connected clients but not stored. Use the database for persistent messages.',
    queues: 'Tasks are processed by a Supabase Edge Function. Enqueue jobs with a payload, and agents or workers will process them asynchronously. Results are stored in the room_usage table.',
    secrets: 'Secrets are stored in the room_secrets table with RLS protection. Only room members can read/write secrets. Values are stored server-side — the API panel never exposes raw secret values to the client.',
    containers: 'Code runs in isolated containers via a Supabase Edge Function. Specify a Docker image, mount files, and set a timeout. Output (stdout/stderr) is captured and returned. Containers are destroyed after execution.',
  };

  return (
    <View style={s.panel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 }}>
        <Text style={s.panelTitle}>Room APIs</Text>
        <HelpTip color={accentColor} text="Room APIs provide programmatic access to this room's resources. All endpoints are scoped to this room and protected by Row Level Security — you can only access rooms you're a member of. Use the Supabase JS client or REST API with your auth token." />
      </View>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[s.apiCardTitle,{color:api.color}]}>{api.icon} {api.label}</Text>
              <HelpTip color={api.color} text={api.help} />
            </View>
            <Text style={s.apiCardDesc}>{api.desc}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.apiLabel}>HOW TO USE</Text>
            <HelpTip color={api.color} text={SECTION_HELP[api.id] || ''} />
          </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={s.apiLabel}>INTEGRATIONS</Text>
          <HelpTip color="#888" text="Supported platforms and SDKs you can use with Room APIs. Use the Supabase client library for your language to interact with any Room API. All standard Supabase SDKs (JS, Python, Flutter, etc.) work out of the box." />
        </View>
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
  // Only fetch key names + IDs — never pull secret values to the client
  const [secrets, setSecrets] = useState<Array<{ id: string; key: string }>>([]);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from('room_secrets').select('id,key').eq('room_id', roomId)
      .then(({ data }) => setSecrets((data || []).map(d => ({ id: d.id, key: d.key }))));
  }, [roomId]);

  const addSecret = async () => {
    if (!key.trim() || !val.trim()) return;
    setAdding(true);
    const { data:{ user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_secrets').upsert({
      room_id: roomId, key: key.trim(), value: val.trim(), created_by: user?.id||null,
    }, { onConflict:'room_id,key' }).select('id,key').single();
    if (!error && data) {
      setSecrets(p => [...p.filter(s=>s.key!==data.key), { id: data.id, key: data.key }]);
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 }}>
        <Text style={s.panelTitle}>Secrets</Text>
        <HelpTip color="#9e9e9e" text="Secrets are stored server-side with Row Level Security. Only room members can add, view key names, or delete secrets. Secret values are never sent to the browser after saving — they can only be read server-side by Edge Functions or agents." />
      </View>
      <Text style={{color:'#666',fontSize:11,padding:14,paddingTop:0,lineHeight:16}}>
        Encrypted KV store for this room. Store API keys, tokens, credentials.
      </Text>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:14,gap:8}}>
        {secrets.map(sec => (
          <View key={sec.id} style={s.secretRow}>
            <Text style={s.secretKey}>{sec.key}</Text>
            <Text style={s.secretVal}>••••••••</Text>
            <Pressable onPress={()=>deleteSecret(sec.id)} hitSlop={8}
              style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}}>
              <Text style={{color:'#ef4444',fontSize:12}}>🗑</Text>
            </Pressable>
          </View>
        ))}
        {secrets.length===0 && <Text style={{color:'#555',fontSize:12,textAlign:'center',fontStyle:'italic'}}>No secrets yet</Text>}
      </ScrollView>
      <View style={{padding:14,gap:8,borderTopWidth:1,borderTopColor:'#000000'}}>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 }}>
        <Text style={s.panelTitle}>Usage</Text>
        <HelpTip color="#9e9e9e" text="Track resource consumption for this room. File count, messages sent, AI tokens used, and estimated cost. The activity log shows a chronological record of all operations performed by users and agents." />
      </View>
      <ScrollView contentContainerStyle={{padding:14,gap:12}}>
        {/* Stats grid */}
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
          {[
            {label:'FILES',   value:fileCount,    color:'#3b82f6'},
            {label:'MESSAGES',value:msgCount,     color:'#a855f7'},
            {label:'TOKENS',  value:totalTokens>0?`${(totalTokens/1000).toFixed(1)}K`:0, color:'#f59e0b'},
            {label:'COST',    value:`$${totalCost.toFixed(4)}`, color:'#22c55e'},
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

const STICKY_COLORS = ['#fde68a','#bbf7d0','#bfdbfe','#e9d5ff','#fecaca','#fed7aa','#99f6e4','#fff'];

function CanvasViewer({ file, onEdit }: { file: RoomFile; onEdit: (v: string) => void }) {
  const parseNotes = (content: string): StickyNote[] => {
    try { return JSON.parse(content || '{"notes":[]}').notes ?? []; }
    catch { return []; }
  };

  const [notes, setNotes] = useState<StickyNote[]>(() => parseNotes(file.content));
  const [nextColor, setNextColor] = useState('#d0d0d0');
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
    const colors = ['#fde68a','#bbf7d0','#bfdbfe','#e9d5ff','#fecaca','#fed7aa'];
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
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
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
          style={[cvSt.toolbarBtn, { backgroundColor: '#ffffff10', borderColor: '#ffffff25' }]}>
          <Text style={{ color: '#9e9e9e', fontSize: 11, fontWeight: '800' }}>Brainstorm</Text>
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
            <Text style={{ color: '#9e9e9e', fontSize: 12, fontWeight: '800' }}>Generate</Text>
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
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    backgroundColor: '#0a0a0a', flexWrap: 'wrap',
  },
  toolbarTitle: { color: '#9e9e9e', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  colorRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  colorDot: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  colorDotActive: { borderColor: '#fff', transform: [{ scale: 1.2 }] },
  toolbarBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  noteCount: { color: '#555', fontSize: 10, marginLeft: 'auto' as any },
  brainstormRow: {
    flexDirection: 'row', gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a', backgroundColor: '#0a0a0a',
  },
  brainstormInput: {
    flex: 1, backgroundColor: '#000000', borderWidth: 1, borderColor: '#ffffff20',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: '#fff', fontSize: 13,
  },
  brainstormBtn: {
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ffffff10',
    borderRadius: 12, borderWidth: 1, borderColor: '#ffffff25',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emptyCanvas: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  emptyCanvasText: { color: '#555', fontSize: 14, fontStyle: 'italic' },
  emptyCanvasSub: { color: '#333', fontSize: 12, marginTop: 6 },
  stickyNote: {
    position: 'absolute',
    width: 180, minHeight: 130,
    borderRadius: 12, padding: 10,
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
    color: '#000000', fontSize: 13, lineHeight: 20, flex: 1,
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

const VARIANT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899'];

const PLAYGROUND_MODELS = [
  { id: 'claude-opus-4-6',     label: 'Claude Opus 4.6',    provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6',  provider: 'Anthropic' },
  { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5',   provider: 'Anthropic' },
  { id: 'gpt-4.1',             label: 'GPT-4.1',            provider: 'OpenAI' },
  { id: 'gpt-4o',              label: 'GPT-4o',             provider: 'OpenAI' },
  { id: 'gpt-4o-mini',         label: 'GPT-4o Mini',        provider: 'OpenAI' },
  { id: 'o4-mini',             label: 'O4 Mini',            provider: 'OpenAI' },
  { id: 'gemini-2.5-pro',      label: 'Gemini 2.5 Pro',     provider: 'Google' },
  { id: 'gemini-2.5-flash',    label: 'Gemini 2.5 Flash',   provider: 'Google' },
  { id: 'qwen3-32b',           label: 'Qwen 3 32B',         provider: 'Qwen' },
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
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Pressable onPress={addVariant} disabled={variants.length >= 4}
            style={[pgSt.headerBtn, { opacity: variants.length < 4 ? 1 : 0.4 }]}>
            <Text style={pgSt.headerBtnText}>+ Variant</Text>
          </Pressable>
          <Pressable onPress={saveAsFile} style={pgSt.headerBtn}>
            <Text style={pgSt.headerBtnText}>Save</Text>
          </Pressable>
          <Pressable onPress={() => setVariants([makeVariant('Variant A')])} style={pgSt.headerBtn}>
            <Text style={pgSt.headerBtnText}>Clear</Text>
          </Pressable>
          <Pressable onPress={runAll} disabled={running}
            style={[pgSt.runBtn, { backgroundColor: accentColor, opacity: running ? 0.6 : 1 }]}>
            <Text style={pgSt.runBtnText}>{running ? 'Running...' : variants.length > 1 ? `Run All (${variants.length})` : 'Run'}</Text>
          </Pressable>
        </View>
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

        {/* Variants — stacked in panels, side by side only in wide desktop view */}
        <View style={pgSt.variantsRow}>
          {variants.map((v, vi) => (
            <View key={v.id} style={[pgSt.variantCard, variants.length > 1 && { borderLeftWidth: 3, borderLeftColor: VARIANT_COLORS[vi % VARIANT_COLORS.length] }]}>
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

              {/* Model dropdown with provider groups */}
              {showModelPicker === v.id && (
                <View style={pgSt.modelDropdown}>
                  {(() => {
                    let lastProvider = '';
                    return PLAYGROUND_MODELS.map(m => {
                      const showGroup = m.provider !== lastProvider;
                      lastProvider = m.provider;
                      return (
                        <View key={m.id}>
                          {showGroup && (
                            <View style={pgSt.modelGroupHeader}>
                              <Text style={pgSt.modelGroupLabel}>{m.provider.toUpperCase()}</Text>
                            </View>
                          )}
                          <Pressable onPress={() => { updateVariant(v.id, { model: m.id }); setShowModelPicker(null); }}
                            style={[pgSt.modelOption, v.model === m.id && { backgroundColor: accentColor + '15' }]}>
                            <Text style={[pgSt.modelOptionLabel, v.model === m.id && { color: accentColor }]}>{m.label}</Text>
                          </Pressable>
                        </View>
                      );
                    });
                  })()}
                </View>
              )}

              {/* Params */}
              {showAdvanced && (
                <View style={pgSt.paramsSection}>
                  <View style={pgSt.paramsRow}>
                    <View style={pgSt.paramBox}>
                      <Text style={pgSt.paramLabel}>TEMPERATURE</Text>
                      <View style={pgSt.paramInputRow}>
                        <TextInput style={[pgSt.paramInput, { flex: 1 }]}
                          value={String(v.temperature)}
                          onChangeText={val => updateVariant(v.id, { temperature: parseFloat(val) || 0 })}
                          keyboardType="decimal-pad" />
                        <View style={pgSt.paramPresets}>
                          {[0, 0.3, 0.7, 1].map(t => (
                            <Pressable key={t} onPress={() => updateVariant(v.id, { temperature: t })}
                              style={[pgSt.paramPresetBtn, v.temperature === t && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                              <Text style={[pgSt.paramPresetText, v.temperature === t && { color: accentColor }]}>{t}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>
                    <View style={pgSt.paramBox}>
                      <Text style={pgSt.paramLabel}>MAX TOKENS</Text>
                      <View style={pgSt.paramInputRow}>
                        <TextInput style={[pgSt.paramInput, { flex: 1 }]}
                          value={String(v.maxTokens)}
                          onChangeText={val => updateVariant(v.id, { maxTokens: parseInt(val) || 1024 })}
                          keyboardType="number-pad" />
                        <View style={pgSt.paramPresets}>
                          {[256, 1024, 4096].map(t => (
                            <Pressable key={t} onPress={() => updateVariant(v.id, { maxTokens: t })}
                              style={[pgSt.paramPresetBtn, v.maxTokens === t && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                              <Text style={[pgSt.paramPresetText, v.maxTokens === t && { color: accentColor }]}>{t}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              {activeTab === 'prompt' && (
                <>
                  <View style={pgSt.promptSection}>
                    <Text style={pgSt.promptSectionLabel}>SYSTEM</Text>
                    <TextInput style={pgSt.promptInput}
                      value={v.system} onChangeText={text => updateVariant(v.id, { system: text })}
                      multiline placeholder="System prompt... use {{variable}} for inputs"
                      placeholderTextColor="#555" autoCapitalize="none" />
                  </View>
                  <View style={pgSt.promptDivider} />
                  <View style={pgSt.promptSection}>
                    <Text style={pgSt.promptSectionLabel}>USER</Text>
                    <TextInput style={[pgSt.promptInput, { minHeight: 100 }]}
                      value={v.userMsg} onChangeText={text => updateVariant(v.id, { userMsg: text })}
                      multiline placeholder="User message..."
                      placeholderTextColor="#555" autoCapitalize="none" />
                  </View>
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
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#333',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  headerBtnText: { color: '#888', fontSize: 11, fontWeight: '700' },
  runBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  runBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  sectionLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  varSection: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#000000', gap: 6 },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  varName: { color: '#9e9e9e', fontSize: 11, fontFamily: MONO, fontWeight: '700', width: 90 },
  varInput: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, color: '#fff', fontSize: 12 },
  variantsRow: { flexDirection: 'column', gap: 10 },
  variantCard: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#2a2a2a', gap: 8 },
  variantHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  variantLabel: { color: '#fff', fontSize: 12, fontWeight: '800', flex: 1 },
  modelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  modelBtnText: { color: '#aaa', fontSize: 10, fontFamily: MONO },
  modelDropdown: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, overflow: 'hidden', marginBottom: 4 },
  modelGroupHeader: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, backgroundColor: '#0f0f0f', borderBottomWidth: 1, borderBottomColor: '#000000' },
  modelGroupLabel: { color: '#444', fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  modelOption: { paddingHorizontal: 12, paddingVertical: 7, paddingLeft: 20, borderBottomWidth: 1, borderBottomColor: '#111',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  modelOptionProvider: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  modelOptionLabel: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  paramsSection: { backgroundColor: '#0a0a0a', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#000000' },
  paramsRow: { flexDirection: 'row', gap: 12 },
  paramBox: { flex: 1 },
  paramLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  paramInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, color: '#fff', fontSize: 12, fontFamily: MONO },
  paramInputRow: { gap: 6 },
  paramPresets: { flexDirection: 'row', gap: 4, marginTop: 4 },
  paramPresetBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: '#222', backgroundColor: '#111',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  paramPresetText: { color: '#666', fontSize: 9, fontWeight: '700', fontFamily: MONO },
  promptSection: { gap: 4 },
  promptSectionLabel: { color: '#666', fontSize: 9, fontWeight: '900', letterSpacing: 1, paddingLeft: 2 },
  promptDivider: { height: 1, backgroundColor: '#000000', marginVertical: 2 },
  fieldLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  promptInput: {
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12,
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
    file_write: '#22c55e', file_read: '#3b82f6', message: '#a855f7',
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
              {e.agent_name && <Text style={{ color: '#e8e8e8', fontSize: 11, fontFamily: MONO, marginBottom: 2 }}>{e.agent_name}</Text>}
              {e.metadata && Object.keys(e.metadata).length > 0 && (
                <Text style={{ color: '#555', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>
                  {JSON.stringify(e.metadata)}
                </Text>
              )}
              {e.tokens > 0 && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: '#f59e0b', fontSize: 10 }}>{e.tokens} tokens</Text>
                  <Text style={{ color: '#22c55e', fontSize: 10 }}>${parseFloat(String(e.cost_usd)).toFixed(6)}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {view === 'metrics' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#e8e8e8' }]}>{sessions.length}</Text><Text style={s.statLabel}>EVENTS</Text></View>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#9e9e9e' }]}>{totalTokens > 0 ? `${(totalTokens/1000).toFixed(1)}K` : '0'}</Text><Text style={s.statLabel}>TOKENS</Text></View>
            <View style={s.statBox}><Text style={[s.statVal, { color: '#9e9e9e' }]}>${totalCost.toFixed(4)}</Text><Text style={s.statLabel}>COST</Text></View>
          </View>

          <Text style={s.apiLabel}>BY AGENT</Text>
          {Object.entries(byAgent).length === 0
            ? <Text style={panelTabSt.empty}>No agent activity yet</Text>
            : Object.entries(byAgent).sort((a,b) => b[1]-a[1]).map(([name, count]) => (
              <View key={name} style={{ marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>{name}</Text>
                  <Text style={{ color: '#e8e8e8', fontSize: 12, fontWeight: '700' }}>{count}</Text>
                </View>
                <View style={{ height: 4, backgroundColor: '#000000', borderRadius: 2 }}>
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
    running: '#22c55e', stopped: '#6f6f6f', error: '#ef4444', deploying: '#f59e0b',
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
                style={[panelTabSt.svcBtn, { backgroundColor: svc.status === 'running' ? '#ffffff10' : '#ffffff10',
                  borderColor: svc.status === 'running' ? '#ffffff25' : '#ffffff25' }]}>
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
    owner: '#f59e0b', admin: '#6366f1', member: '#22c55e', viewer: '#6f6f6f',
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 14, paddingBottom: 10 }}>
              {ALL_PERMISSIONS.map(perm => {
                const has = member.permissions.includes(perm);
                return (
                  <Pressable key={perm} onPress={() => togglePermission(member.userId, perm)}
                    style={[panelTabSt.permBadge, has && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
                    <Text style={[{ color: '#555', fontSize: 8, fontWeight: '700', letterSpacing: 0.3 }, has && { color: accentColor }]}>{perm.toUpperCase()}</Text>
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

const TASK_TYPES = [
  { key: 'general', emoji: '💬', label: 'General' },
  { key: 'web_research', emoji: '🔍', label: 'Web Research' },
  { key: 'run_script', emoji: '⚙️', label: 'Run Script' },
  { key: 'file_ops', emoji: '📁', label: 'File Ops' },
  { key: 'db_query', emoji: '🗄️', label: 'DB Query' },
  { key: 'api_call', emoji: '🌐', label: 'API Call' },
] as const;

const TASK_TYPE_MAP: Record<string, { emoji: string; label: string }> = {
  general: { emoji: '💬', label: 'General' },
  web_research: { emoji: '🔍', label: 'Research' },
  run_script: { emoji: '⚙️', label: 'Script' },
  file_ops: { emoji: '📁', label: 'Files' },
  db_query: { emoji: '🗄️', label: 'DB' },
  api_call: { emoji: '🌐', label: 'API' },
};

function TasksPanel({ roomId, accentColor }: { roomId: string; accentColor: string }) {
  const [tasks, setTasks] = useState<RoomTask[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskType, setTaskType] = useState<string>('general');
  const [loading, setLoading] = useState(true);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const fetchTasks = useCallback(() => {
    supabase.from('room_tasks').select('*').eq('room_id', roomId).order('created_at')
      .then(({ data }) => {
        if (data) setTasks(data.map((t: any) => ({
          id: t.id, name: t.name, schedule: t.schedule,
          agent: t.agent, prompt: t.prompt, enabled: t.enabled,
          lastRun: t.last_run_at, nextRun: t.next_run_at,
          taskType: t.task_type || 'general',
          lastResult: t.last_result,
          status: t.status || 'idle',
        })));
        setLoading(false);
      });
  }, [roomId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime subscription for live status updates
  useEffect(() => {
    const ch = supabase.channel(`room_tasks_live_${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_tasks', filter: `room_id=eq.${roomId}` },
        (payload: any) => {
          const t = payload.new;
          setTasks(prev => prev.map(task => task.id === t.id ? {
            ...task, status: t.status || task.status,
            lastRun: t.last_run_at || task.lastRun,
            lastResult: t.last_result || task.lastResult,
            enabled: t.enabled ?? task.enabled,
          } : task));
          if (t.status === 'done' || t.status === 'error') setRunningTaskId(null);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  const addTask = async () => {
    if (!name.trim() || !prompt.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('room_tasks').insert({
      room_id: roomId, name: name.trim(),
      schedule: schedule.trim() || 'once',
      agent: agent.trim() || 'Assistant',
      prompt: prompt.trim(), enabled: true,
      task_type: taskType,
      created_by: user?.id || null,
    }).select().single();
    if (!error && data) {
      setTasks(p => [...p, {
        id: data.id, name: data.name, schedule: data.schedule,
        agent: data.agent, prompt: data.prompt, enabled: data.enabled,
        lastRun: data.last_run_at, nextRun: data.next_run_at,
        taskType: data.task_type || 'general',
        lastResult: data.last_result,
        status: data.status || 'idle',
      }]);
    }
    setName(''); setSchedule('0 9 * * *'); setAgent(''); setPrompt(''); setTaskType('general');
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

  const runTask = async (task: RoomTask) => {
    setRunningTaskId(task.id);
    try {
      await supabase.functions.invoke('room-task-executor', {
        body: {
          taskId: task.id,
          roomId,
          prompt: task.prompt,
          agentName: task.agent,
          task_type: task.taskType,
          taskName: task.name,
        },
      });
      fetchTasks();
    } catch (err) {
      console.error('Run task error:', err);
    } finally {
      setRunningTaskId(null);
    }
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

          <Text style={[s.label, { marginTop: 8 }]}>Task Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {TASK_TYPES.map(tt => {
              const sel = taskType === tt.key;
              return (
                <Pressable key={tt.key} onPress={() => setTaskType(tt.key)}
                  style={[panelTabSt.miniTab, sel && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
                    !sel && { backgroundColor: '#0d0d0d', borderColor: '#222' }]}>
                  <Text style={[{ color: '#666', fontSize: 10 }, sel && { color: accentColor }]}>{tt.emoji} {tt.label}</Text>
                </Pressable>
              );
            })}
          </View>

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
        {tasks.map(task => {
          const tt = TASK_TYPE_MAP[task.taskType] || TASK_TYPE_MAP.general;
          const isRunning = runningTaskId === task.id || task.status === 'running';
          const statusDotColor = isRunning ? '#f59e0b' : task.status === 'done' ? '#22c55e'
            : task.status === 'error' ? '#ef4444' : task.enabled ? '#3b82f6' : '#6f6f6f';
          const resultPreview = task.lastResult?.preview
            || task.lastResult?.error
            || (task.lastResult ? JSON.stringify(task.lastResult).slice(0, 120) : null);
          return (
            <View key={task.id} style={[panelTabSt.serviceRow, { opacity: task.enabled ? 1 : 0.5 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <View style={[panelTabSt.statusDot, { backgroundColor: statusDotColor }]} />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>{task.name}</Text>
                <View style={panelTabSt.typeBadge}>
                  <Text style={{ color: '#888', fontSize: 9, fontWeight: '700' }}>{tt.emoji} {tt.label}</Text>
                </View>
                <View style={panelTabSt.typeBadge}>
                  <Text style={{ color: '#888', fontSize: 9, fontWeight: '700' }}>{task.schedule}</Text>
                </View>
              </View>
              <Text style={{ color: '#666', fontSize: 11, marginBottom: 4 }} numberOfLines={2}>{task.prompt}</Text>
              <Text style={{ color: '#e8e8e8', fontSize: 10, marginBottom: 4, fontFamily: MONO }}>
                {'\u2192'} {task.agent}
                {task.status !== 'idle' && <Text style={{ color: statusDotColor }}> {'\u00B7'} {task.status.toUpperCase()}</Text>}
              </Text>
              {resultPreview && (
                <View style={{ backgroundColor: '#0a0a0a', borderRadius: 12, padding: 8, marginBottom: 6,
                  borderWidth: 1, borderColor: task.lastResult?.error ? '#ffffff15' : '#161616' }}>
                  <Text style={{ color: task.lastResult?.error ? '#ef4444' : '#888', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>
                    {resultPreview}
                  </Text>
                  {task.lastRun && (
                    <Text style={{ color: '#555', fontSize: 9, marginTop: 3, fontFamily: MONO }}>
                      {new Date(task.lastRun).toLocaleString()}
                    </Text>
                  )}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Pressable onPress={() => runTask(task)} disabled={isRunning}
                  style={[panelTabSt.svcBtn, { backgroundColor: isRunning ? '#ffffff08' : accentColor + '20',
                    borderColor: isRunning ? '#ffffff20' : accentColor + '50', opacity: isRunning ? 0.6 : 1 }]}>
                  <Text style={{ color: isRunning ? '#f59e0b' : accentColor, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>
                    {isRunning ? '... RUNNING' : '\u25B6 RUN'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => toggleTask(task.id)}
                  style={[panelTabSt.svcBtn, { backgroundColor: task.enabled ? '#ffffff10' : '#ffffff10',
                    borderColor: task.enabled ? '#ffffff25' : '#ffffff25' }]}>
                  <Text style={{ color: task.enabled ? '#ef4444' : '#22c55e', fontSize: 11, fontWeight: '700' }}>
                    {task.enabled ? 'Disable' : 'Enable'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => deleteTask(task.id)} style={{ marginLeft: 'auto' as any }} hitSlop={8}>
                  <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, fontWeight: '700' }}>X</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Shared panel sub-styles ──────────────────────────────────────────────────
const panelTabSt = StyleSheet.create({
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  tabText: { color: '#666', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  filterInput: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, color: '#fff', fontSize: 11 },
  empty: { color: '#444', fontSize: 12, textAlign: 'center', fontStyle: 'italic', marginTop: 24, marginBottom: 8 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#111' },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logEvent: { color: '#888', fontSize: 11, fontFamily: MONO, flex: 1 },
  logAgent: { color: '#e8e8e8', fontSize: 10, fontWeight: '700' },
  logTokens: { color: '#9e9e9e', fontSize: 10 },
  logTime: { color: '#444', fontSize: 10 },
  traceRow: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#000000' },
  addBox: { backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#000000', padding: 14 },
  serviceRow: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#000000' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  typeBadge: { backgroundColor: '#000000', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  svcBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  miniTab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  memberRow: { borderBottomWidth: 1, borderBottomColor: '#111' },
  memberAvatar: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  permBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: '#222', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
});

// ─── GitHub Panel ─────────────────────────────────────────────────────────────

function GitHubPanel({ circleId, accentColor, ghConnected, ghUser, ghRepo,
  onConnected, onDisconnected, onRepoSelected, onRepoClosed,
}: {
  circleId: string; accentColor: string;
  ghConnected: boolean; ghUser: GitHubUser | null; ghRepo: GitHubRepo | null;
  onConnected: (user: GitHubUser) => void;
  onDisconnected: () => void;
  onRepoSelected: (repo: GitHubRepo) => void;
  onRepoClosed: () => void;
}) {
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [showPatFallback, setShowPatFallback] = useState(false);
  const [oauthChecked, setOauthChecked] = useState(false);

  useEffect(() => {
    if (ghConnected) loadRepos();
  }, [ghConnected]);

  // Check for ?github_connected=1 callback on mount
  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('github_connected') === '1') {
          window.history.replaceState({}, '', window.location.pathname);
          // OAuth just completed — try loading repos via OAuth
          loadReposViaOAuth();
        }
      } catch {}
    }
  }, []);

  const loadRepos = async () => {
    // 1. Try PAT-based full repo list
    const token = await getStoredToken(circleId);
    if (token) {
      setLoadingRepos(true);
      const { repos: r, error: e } = await listRepos(token);
      setRepos(r);
      if (e) setError(e);
      setLoadingRepos(false);
      if (r.length > 0) return;
    }
    // 2. Load connected repos directly from circle_github_connections table
    try {
      setLoadingRepos(true);
      const { data: ghConns } = await supabase
        .from('circle_github_connections')
        .select('full_name, owner, repo, default_branch')
        .eq('circle_id', circleId)
        .eq('is_active', true);
      if (ghConns && ghConns.length > 0) {
        const mapped = ghConns.map((c: any) => ({
          id: 0,
          name: String(c.repo || ''),
          full_name: String(c.full_name || ''),
          owner: { login: String(c.owner || ''), avatar_url: '' },
          private: false,
          default_branch: String(c.default_branch || 'main'),
          description: null as string | null,
          language: null as string | null,
          stargazers_count: 0,
          updated_at: '',
          size: 0,
          fork: false,
          archived: false,
          open_issues_count: 0,
        })) as GitHubRepo[];
        setRepos(mapped);
        setLoadingRepos(false);
        return;
      }
    } catch {}
    // 3. Try OAuth edge function as last resort
    await loadReposViaOAuth();
    setLoadingRepos(false);
  };

  const loadReposViaOAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!user) return;
      setLoadingRepos(true);
      const { repos: r, github_username, error: e } = await getConnectedRepos(user.id);
      if (e || r.length === 0) { setLoadingRepos(false); return; }
      setRepos(r);
      if (github_username) {
        onConnected({ login: github_username, avatar_url: '', name: github_username });
      }
      setOauthChecked(true);
      setLoadingRepos(false);
    } catch {
      setLoadingRepos(false);
    }
  };

  const handleOAuthConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!user) { setError('Not authenticated'); setConnecting(false); return; }
      const { url, error: e } = await connectViaOAuth(circleId, user.id);
      if (e || !url) { setError(e || 'OAuth failed'); setConnecting(false); return; }
      // Store circle_id so callback knows where to return
      if (Platform.OS === 'web') {
        try { localStorage.setItem('uc_github_oauth_circle', circleId); } catch {}
        window.open(url, '_self');
      }
    } catch (e: any) {
      setError(e.message || 'OAuth error');
      setConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!tokenInput.trim()) { setError('Token is required'); return; }
    setConnecting(true);
    setError('');
    const { user, error: e } = await ghValidateToken(tokenInput.trim());
    if (e || !user) { setError(e || 'Invalid token'); setConnecting(false); return; }
    await storeToken(circleId, tokenInput.trim());
    setTokenInput('');
    onConnected(user);
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await removeToken(circleId);
    setRepos([]);
    onDisconnected();
  };

  const filtered = repos.filter(r =>
    r.full_name.toLowerCase().includes(repoFilter.toLowerCase())
  );

  if (!ghConnected) {
    return (
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16, alignItems:'center', justifyContent:'center', minHeight:200}}>
        <View style={{width:48,height:48,borderRadius:14,backgroundColor:accentColor+'15',justifyContent:'center',alignItems:'center',marginBottom:16}}>
          <Text style={{fontSize:20}}>{'</>'}</Text>
        </View>
        <Text style={{color:'#fff',fontSize:16,fontWeight:'700',marginBottom:8,textAlign:'center'}}>GitHub Not Connected</Text>
        <Text style={{color:'#666',fontSize:13,lineHeight:20,marginBottom:20,textAlign:'center',maxWidth:320}}>
          Connect your GitHub account from the Integrations tab to browse repos, view files, and track shipping.
        </Text>
        <Text style={{color:'#444',fontSize:11,textAlign:'center'}}>
          Go to Integrations {'→'} GitHub {'→'} Connect
        </Text>
        {/* Legacy connect UI removed — single connection point in Integrations */}
      </ScrollView>
    );
  }

  return (
    <View style={{flex:1}}>
      {/* User header */}
      <View style={ghSt.userHeader}>
        <Text style={{fontSize:14}}>🐙</Text>
        <Text style={{color:'#fff',fontSize:12,fontWeight:'700',flex:1}}>{ghUser?.login}</Text>
        <Pressable onPress={handleDisconnect} style={ghSt.disconnectBtn}>
          <Text style={{color:'#9e9e9e',fontSize:10,fontWeight:'700'}}>Disconnect</Text>
        </Pressable>
      </View>

      {/* Active repo indicator */}
      {ghRepo && (
        <View style={[ghSt.activeRepo,{backgroundColor:accentColor+'10'}]}>
          <Text style={{fontSize:11}}>{ghRepo.private ? '🔒' : '📦'}</Text>
          <Text style={{color:accentColor,fontSize:11,fontWeight:'700',flex:1}} numberOfLines={1}>{ghRepo.full_name}</Text>
          <Text style={{color:'#555',fontSize:9}}>{ghRepo.default_branch}</Text>
          <Pressable onPress={onRepoClosed} style={ghSt.closeRepoBtn}>
            <Text style={{color:'#888',fontSize:10}}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Search */}
      <View style={{paddingHorizontal:12,paddingVertical:8}}>
        <TextInput style={ghSt.filterInput}
          value={repoFilter} onChangeText={setRepoFilter}
          placeholder="Filter repositories..." placeholderTextColor="#555"
          autoCapitalize="none" />
      </View>

      {/* Repo list */}
      {loadingRepos ? (
        <View style={{padding:20,alignItems:'center'}}>
          <ActivityIndicator color={accentColor} size="small" />
          <Text style={{color:'#555',fontSize:11,marginTop:8}}>Loading repositories...</Text>
        </View>
      ) : (
        <ScrollView style={{flex:1}}>
          {filtered.map(repo => (
            <Pressable key={repo.id} onPress={() => onRepoSelected(repo)}
              style={[ghSt.repoRow,
                ghRepo?.id === repo.id && {backgroundColor:accentColor+'15'},
                Platform.OS === 'web' ? {cursor:'pointer'} as any : {},
              ]}>
              <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                <Text style={{fontSize:10}}>{repo.private ? '🔒' : '📦'}</Text>
                <Text style={{color:'#e6e6e6',fontSize:12,fontWeight:'600',flex:1}} numberOfLines={1}>{repo.full_name}</Text>
                {repo.language && (
                  <View style={[ghSt.langChip,{backgroundColor:(LANG_COLORS[repo.language.toLowerCase()]||'#888')+'30'}]}>
                    <Text style={{color:LANG_COLORS[repo.language.toLowerCase()]||'#888',fontSize:9,fontWeight:'700'}}>{repo.language}</Text>
                  </View>
                )}
              </View>
              {repo.description && (
                <Text style={{color:'#555',fontSize:10,marginLeft:18}} numberOfLines={1}>{repo.description}</Text>
              )}
              <View style={{flexDirection:'row',gap:10,marginLeft:18,marginTop:2}}>
                <Text style={{color:'#444',fontSize:9}}>★ {repo.stargazers_count}</Text>
                {repo.fork && <Text style={{color:'#444',fontSize:9}}>fork</Text>}
                <Text style={{color:'#444',fontSize:9}}>{timeAgo(repo.updated_at)}</Text>
                <Text style={{color:'#333',fontSize:9}}>{repo.default_branch}</Text>
              </View>
            </Pressable>
          ))}
          {filtered.length === 0 && !loadingRepos && (
            <View style={{padding:20,alignItems:'center'}}>
              <Text style={{color:'#555',fontSize:11}}>
                {repoFilter ? 'No matching repositories' : 'No repositories found'}
              </Text>
            </View>
          )}
          {/* Load more hint */}
          {repos.length >= 100 && (
            <Pressable onPress={async () => {
              const token = await getStoredToken(circleId);
              if (!token) return;
              const page = Math.ceil(repos.length / 100) + 1;
              const { repos: more } = await listRepos(token, page);
              if (more.length) setRepos(p => [...p, ...more]);
            }} style={{padding:12,alignItems:'center'}}>
              <Text style={{color:accentColor,fontSize:11,fontWeight:'700'}}>Load more repositories...</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {error ? <Text style={{color:'#ef4444',fontSize:10,padding:8}}>{error}</Text> : null}
    </View>
  );
}

const ghSt = StyleSheet.create({
  label: { color:'#888', fontSize:11, fontWeight:'700', marginBottom:6 },
  input: {
    backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:12,
    padding:12, color:'#fff', fontSize:13, fontFamily:MONO,
  },
  connectBtn: {
    marginTop:16, paddingVertical:12, borderRadius:12, alignItems:'center',
    ...(Platform.OS === 'web' ? { cursor:'pointer' } as any : {}),
  },
  connectText: { color:'#fff', fontSize:13, fontWeight:'700' },
  userHeader: {
    flexDirection:'row', alignItems:'center', padding:12, gap:8,
    borderBottomWidth:1, borderBottomColor:'#000000',
  },
  disconnectBtn: {
    paddingHorizontal:8, paddingVertical:4, borderRadius:12, backgroundColor:'#ffffff10',
    ...(Platform.OS === 'web' ? { cursor:'pointer' } as any : {}),
  },
  activeRepo: {
    flexDirection:'row', alignItems:'center', padding:10, gap:8,
    borderBottomWidth:1, borderBottomColor:'#000000',
  },
  closeRepoBtn: {
    paddingHorizontal:6, paddingVertical:3, borderRadius:12, backgroundColor:'#ffffff10',
    ...(Platform.OS === 'web' ? { cursor:'pointer' } as any : {}),
  },
  filterInput: {
    backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:12,
    paddingHorizontal:10, paddingVertical:6, color:'#fff', fontSize:11, fontFamily:MONO,
  },
  repoRow: {
    padding:10, borderBottomWidth:1, borderBottomColor:'#111', gap:2,
  },
  langChip: {
    paddingHorizontal:5, paddingVertical:1, borderRadius:12,
  },
});

// ─── GitHub Folder Section ────────────────────────────────────────────────────

function GitHubFolderSection({ folder, entries, activeTabId, loadingPath, onOpen, repoFullName, accentColor }: {
  folder: string; entries: GitHubTreeEntry[]; activeTabId: string | null;
  loadingPath: string | null;
  onOpen: (e: GitHubTreeEntry) => void;
  repoFullName: string; accentColor: string;
}) {
  const [expanded, setExpanded] = useState(folder === '/');
  const folderName = folder === '/' ? 'root' : folder.replace(/^\//, '');
  const lastSegment = folderName.split('/').pop() || '';
  const folderIcon = FOLDER_ICONS[lastSegment] ?? FOLDER_ICONS.default;

  return (
    <View>
      <Pressable onPress={() => setExpanded(p => !p)} style={s.folderRow}>
        <Text style={s.folderArrow}>{expanded ? '▾' : '▸'}</Text>
        <Text style={s.folderIcon}>{folderIcon}</Text>
        <Text style={s.folderName} numberOfLines={1}>{folderName}</Text>
        <Text style={s.folderCount}>{entries.length}</Text>
      </Pressable>
      {expanded && entries.map(entry => {
        const fileName = entry.path.split('/').pop() || entry.path;
        const fileType = detectFileType(fileName);
        const virtualId = `gh_${repoFullName}_${entry.path}`;
        const isActive = virtualId === activeTabId;
        const isLoading = entry.path === loadingPath;

        return (
          <Pressable key={entry.sha} onPress={() => onOpen(entry)}
            style={[s.fileRow, isActive && {backgroundColor:accentColor+'18'},
              Platform.OS === 'web' ? {cursor:'pointer'} as any : {},
            ]}>
            <Text style={[s.fileRowIcon,{color:LANG_COLORS[fileType]||'#888'}]}>
              {isLoading ? '⏳' : (FILE_ICONS[fileType] || '📄')}
            </Text>
            <Text style={[s.fileRowName, isActive && {color:'#fff'}]} numberOfLines={1}>{fileName}</Text>
            {entry.size != null && entry.size > 0 && (
              <Text style={{color:'#444',fontSize:9,marginLeft:'auto'}}>{formatBytes(entry.size)}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#000000' },
  dragging: { opacity:0.85 },
  center: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#000000' },
  loadingText: { color:'#6f6f6f', marginTop:8, fontSize:12, fontFamily:MONO },

  // List header
  listHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, paddingVertical:14, borderBottomWidth:1, borderBottomColor:'#2a2a2a' },
  listTitle: { color:'#fff', fontSize:16, fontWeight:'900', fontFamily:MONO, letterSpacing:3, textTransform:'uppercase' as any },
  listSub: { color:'#6f6f6f', fontSize:11, fontFamily:MONO, marginTop:2 },
  list: { flex:1 },
  listContent: { padding:16 },
  createBtn: { paddingHorizontal:14, paddingVertical:8, borderRadius:12, borderWidth:1, ...(Platform.OS==='web'?{cursor:'pointer',transition:'all 0.15s ease'} as any:{}) },
  createBtnText: { fontSize:12, fontWeight:'700', fontFamily:MONO },

  // Grid
  grid: { flexDirection:'row', flexWrap:'wrap', gap:12 },
  gridMobile: { flexDirection:'column' },

  // Room Card
  card: { backgroundColor:'#161616', borderWidth:1, borderColor:'#2a2a2a', borderRadius:12, padding:16, minWidth:260, maxWidth:420, flex:1, ...(Platform.OS==='web'?{cursor:'pointer',transition:'all 0.2s ease'} as any:{}) },
  cardMobile: { maxWidth:'100%' as any },
  cardHeader: { flexDirection:'row', alignItems:'center', marginBottom:10, gap:8 },
  cardIcon: { fontSize:16, fontFamily:MONO },
  cardName: { color:'#fff', fontSize:14, fontWeight:'700', fontFamily:MONO, flex:1 },
  cardPath: { color:'#6f6f6f', fontSize:11, fontFamily:MONO, marginBottom:6, backgroundColor:'#ffffff06', paddingHorizontal:6, paddingVertical:2, borderRadius:12, alignSelf:'flex-start' as any },
  cardDesc: { color:'#555555', fontSize:11, fontFamily:MONO, marginBottom:10, lineHeight:16 },
  cardFooter: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingTop:8, borderTopWidth:1, borderTopColor:'#000000' },
  cardTime: { color:'#444444', fontSize:10, fontFamily:MONO },
  cardFiles: { backgroundColor:'#ffffff08', paddingHorizontal:8, paddingVertical:3, borderRadius:12, borderWidth:1, borderColor:'#2a2a2a' },
  cardFilesText: { color:'#6f6f6f', fontSize:10, fontFamily:MONO },
  cardDelete: { paddingHorizontal:6, paddingVertical:2, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  cardDeleteText: { fontSize:12, fontFamily:MONO, fontWeight:'700', color:'#ef444460' },
  cardApiBadges: { flexDirection:'row', gap:6 },
  cardApiBadge: { fontSize:10, fontFamily:MONO, color:'#555555' },

  // Lang badge — pixel
  langBadge: { paddingHorizontal:6, paddingVertical:3, borderRadius:12, borderWidth:2 },
  langBadgeText: { fontSize:9, fontWeight:'900', fontFamily:MONO, letterSpacing:1 },

  // Empty state — pixel
  empty: { alignItems:'center', paddingVertical:48 },
  emptyIcon: { fontSize:32, fontFamily:MONO, fontWeight:'900', color:'#333333', marginBottom:12 },
  emptyTitle: { color:'#c0c0c0', fontSize:16, fontWeight:'900', fontFamily:MONO, marginBottom:8, letterSpacing:1 },
  emptySub: { color:'#6f6f6f', fontSize:12, fontFamily:MONO, textAlign:'center', maxWidth:280, marginBottom:20, lineHeight:18 },
  emptyBtn: { paddingHorizontal:16, paddingVertical:10, borderRadius:12, borderWidth:2, borderColor:'#ffffff20' },
  emptyBtnText: { color:'#fff', fontSize:13, fontWeight:'700', fontFamily:MONO },
  emptyText: { color:'#333333', fontSize:12, fontFamily:MONO },

  // Modal — pixel borders
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'center', alignItems:'center' },
  modalBox: { backgroundColor:'#222222', borderWidth:2, borderColor:'#333333', borderRadius:16, padding:20, width:'90%', maxWidth:540, maxHeight:'90%', ...(Platform.OS==='web'?{boxShadow:'6px 6px 0px #000000'} as any:{}) },
  modalTitle: { color:'#fff', fontSize:16, fontWeight:'900', fontFamily:MONO, letterSpacing:1, marginBottom:4 },
  modalSub: { color:'#6f6f6f', fontSize:11, fontFamily:MONO, marginBottom:16, lineHeight:16 },
  label: { color:'#6f6f6f', fontSize:10, fontWeight:'700', fontFamily:MONO, marginBottom:6, marginTop:12, letterSpacing:1, textTransform:'uppercase' as any },
  input: { backgroundColor:'#000000', borderWidth:2, borderColor:'#333333', borderRadius:12, paddingHorizontal:12, paddingVertical:10, color:'#fff', fontSize:13, fontFamily:MONO },
  langPicker: { marginBottom:4 },
  langOpt: { paddingHorizontal:10, paddingVertical:6, borderRadius:12, borderWidth:2, borderColor:'#2a2a2a', marginRight:6, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  langOptText: { color:'#6f6f6f', fontSize:11, fontWeight:'700', fontFamily:MONO },
  modalActions: { flexDirection:'row', justifyContent:'flex-end', gap:8, marginTop:16 },
  cancelBtn: { paddingHorizontal:14, paddingVertical:8, borderRadius:12 },
  cancelText: { color:'#6f6f6f', fontSize:13, fontWeight:'600', fontFamily:MONO },
  submitBtn: { paddingHorizontal:16, paddingVertical:8, borderRadius:12, borderWidth:2, borderColor:'#ffffff20' },
  submitText: { color:'#fff', fontSize:13, fontWeight:'700', fontFamily:MONO },

  // Detail Top Bar
  detailBar: { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#2a2a2a', gap:10, backgroundColor:'#0d0d0d' },
  backBtn: { paddingHorizontal:10, paddingVertical:6, borderRadius:12, backgroundColor:'#ffffff08', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  backText: { color:'#888', fontSize:13, fontWeight:'600' },
  detailName: { color:'#fff', fontSize:15, fontWeight:'700', flex:1 },
  detailActions: { flexDirection:'row', gap:6 },
  barBtn: { paddingHorizontal:10, paddingVertical:5, borderRadius:12, borderWidth:1, borderColor:'#333', ...(Platform.OS==='web'?{cursor:'pointer',transition:'all 0.15s ease'} as any:{}) },

  // Right Panel Tabs
  rightPanelTabs: { flexDirection:'row', paddingHorizontal:8, paddingVertical:6, gap:4, borderBottomWidth:1, borderBottomColor:'#2a2a2a', backgroundColor:'#111' },
  rpTab: { paddingHorizontal:10, paddingVertical:5, borderRadius:12, borderWidth:1, borderColor:'#222', ...(Platform.OS==='web'?{cursor:'pointer',transition:'all 0.15s ease'} as any:{}) },
  rpTabText: { color:'#888', fontSize:11, fontWeight:'600' },

  // Body
  body: { flex:1, flexDirection:'row' },

  // Sidebar
  sidebar: { width:210, borderRightWidth:1, borderRightColor:'#2a2a2a', backgroundColor:'#0a0a0a' },
  sidebarMobile: { width:160 },
  sidebarHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:12, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#2a2a2a' },
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
  dropHint: { padding:12, margin:10, borderRadius:12, borderWidth:1, borderColor:'#000000', borderStyle:'dashed', alignItems:'center' },
  dropHintText: { color:'#555', fontSize:10, textAlign:'center' },

  // Editor Pane
  editorPane: { flex:1, flexDirection:'column' },
  tabBar: { maxHeight:36, borderBottomWidth:1, borderBottomColor:'#000000', backgroundColor:'#080808' },
  editorTab: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:8, gap:5, borderBottomWidth:2, borderBottomColor:'transparent', minWidth:120, maxWidth:180, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  editorTabIcon: { fontSize:12 },
  editorTabName: { color:'#888', fontSize:12, flex:1 },
  tabClose: { padding:2, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  tabCloseText: { color:'#555', fontSize:14, lineHeight:14 },

  // File Toolbar
  fileToolbar: { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#000000', backgroundColor:'#000000', gap:10 },
  fileToolbarPath: { color:'#888', fontSize:12, fontFamily:MONO, flex:1 },
  fileToolbarRight: { flexDirection:'row', alignItems:'center', gap:8 },
  fileToolbarMeta: { color:'#555', fontSize:11 },
  fileAction: { paddingHorizontal:8, paddingVertical:3, borderRadius:12, backgroundColor:'#ffffff08', borderWidth:1, borderColor:'#222', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  fileActionText: { color:'#888', fontSize:11, fontWeight:'600' },
  tag: { backgroundColor:'#ffffff10', paddingHorizontal:6, paddingVertical:2, borderRadius:12, borderWidth:1, borderColor:'#ffffff20' },
  tagText: { color:'#e8e8e8', fontSize:10, fontWeight:'600' },

  // No file
  noFile: { flex:1, justifyContent:'center', alignItems:'center', gap:8 },
  noFileIcon: { fontSize:48, opacity:0.3 },
  noFileText: { color:'#555', fontSize:14 },
  noFileSub: { color:'#444', fontSize:12 },

  // Code
  codeScroll: { flex:1, backgroundColor:'#000000' },
  codeEditor: { flex:1, backgroundColor:'#000000', color:'#e6e6e6', fontFamily:MONO, fontSize:13, lineHeight:22, padding:16, textAlignVertical:'top' },

  // Markdown
  mdContent: { padding:20, gap:4 },
  mdH1: { color:'#fff', fontSize:22, fontWeight:'800', marginBottom:6, marginTop:8 },
  mdH2: { color:'#e6e6e6', fontSize:18, fontWeight:'700', marginBottom:4, marginTop:6 },
  mdH3: { color:'#ccc', fontSize:15, fontWeight:'700', marginBottom:3 },
  mdP: { color:'#bbb', fontSize:13, lineHeight:21 },
  mdLi: { color:'#bbb', fontSize:13, lineHeight:21, paddingLeft:8 },
  mdQuote: { borderLeftWidth:3, borderLeftColor:'#e8e8e8', paddingLeft:12, backgroundColor:'#ffffff05', paddingVertical:6, borderRadius:12, marginVertical:4 },
  mdQuoteText: { color:'#888', fontSize:13, fontStyle:'italic' },

  // CSV
  csvRow: { flexDirection:'row' },
  csvCell: { minWidth:100, paddingHorizontal:10, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#000000', borderRightWidth:1, borderRightColor:'#000000' },
  csvHead: { backgroundColor:'#161616' },
  csvHeadText: { color:'#e8e8e8', fontSize:12, fontWeight:'700', fontFamily:MONO },
  csvCellText: { color:'#ccc', fontSize:12, fontFamily:MONO },

  // Image
  fileImage: { width:'100%' as any, maxWidth:700, height:380, borderRadius:12, backgroundColor:'#111' },

  // Resize handle
  resizeHandle: {
    width: 6,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: '#0d0d0d',
    ...(Platform.OS === 'web' ? { cursor: 'col-resize', userSelect: 'none' } as any : {}),
  },
  resizeGrip: {
    gap: 3,
    alignItems: 'center' as const,
  },
  resizeGripDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#444',
  },

  // Right panel
  rightPanel: { width:320, borderLeftWidth:1, borderLeftColor:'#2a2a2a' },
  bottomSheet: { borderTopWidth:1, borderTopColor:'#000000' },
  bottomSheetExpanded: { flex:1, maxHeight:'55%' as any },
  bottomSheetCollapsed: { height:45 },
  panel: { flex:1, backgroundColor:'#000000', flexDirection:'column', position:'relative' as any },
  panelHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#000000' },
  panelTitle: { color:'#fff', fontSize:13, fontWeight:'700', paddingHorizontal:14, paddingTop:12, paddingBottom:4 },
  panelBtn: { paddingHorizontal:10, paddingVertical:5, borderRadius:12, borderWidth:1, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },

  // Chat
  taskBox: { padding:12, backgroundColor:'#0a0a0a', borderBottomWidth:1, borderBottomColor:'#1a1a1a' },
  taskInput: { backgroundColor:'#000000', borderWidth:1, borderColor:'#1a1a1a', borderRadius:12, paddingHorizontal:12, paddingVertical:8, color:'#fff', fontSize:13, minHeight:50 },
  taskSubmit: { marginTop:8, alignSelf:'flex-end', backgroundColor:'#ffffff10', borderWidth:1, borderColor:'#ffffff30', paddingHorizontal:14, paddingVertical:6, borderRadius:12 },
  msgList: { flex:1 },
  msgInputRow: { flexDirection:'row', alignItems:'center', padding:12, gap:8, borderTopWidth:1, borderTopColor:'#000000' },
  msgInput: { flex:1, backgroundColor:'#111', borderWidth:1, borderColor:'#222', borderRadius:12, paddingHorizontal:12, paddingVertical:8, color:'#fff', fontSize:13 },
  sendBtn: { width:36, height:36, borderRadius:18, justifyContent:'center', alignItems:'center', ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },

  // APIs
  apiTab: { paddingHorizontal:10, paddingVertical:5, borderRadius:12, borderWidth:1, borderColor:'#222', marginRight:6, ...(Platform.OS==='web'?{cursor:'pointer'} as any:{}) },
  apiTabText: { color:'#888', fontSize:11, fontWeight:'700' },
  apiCard: { borderWidth:1, borderRadius:12, padding:12, backgroundColor:'#0d0d0d' },
  apiCardTitle: { fontSize:14, fontWeight:'800', marginBottom:4 },
  apiCardDesc: { color:'#888', fontSize:12, lineHeight:18 },
  apiLabel: { color:'#555', fontSize:10, fontWeight:'800', letterSpacing:1 },
  codeBlock: { backgroundColor:'#000000', borderRadius:12, padding:12, borderWidth:1, borderColor:'#2a2a2a' },
  codeBlockText: { color:'#b5b5b5', fontSize:12, fontFamily:MONO, lineHeight:18 },
  integrationsSection: { padding:14, borderTopWidth:1, borderTopColor:'#000000', gap:8 },
  integrationBadge: { alignItems:'center', marginRight:10, gap:2 },
  integrationIcon: { fontSize:20 },
  integrationName: { color:'#555', fontSize:9, fontWeight:'700' },

  // Secrets
  secretRow: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#000000' },
  secretKey: { color:'#e8e8e8', fontSize:12, fontWeight:'700', fontFamily:MONO, flex:1 },
  secretVal: { color:'#555', fontSize:12, fontFamily:MONO, flex:1 },

  // Usage
  statBox: { alignItems:'center', backgroundColor:'#111', borderRadius:12, padding:12, flex:1, minWidth:70, borderWidth:1, borderColor:'#000000' },
  statVal: { fontSize:18, fontWeight:'900', fontFamily:MONO },
  statLabel: { color:'#555', fontSize:9, fontWeight:'800', letterSpacing:0.5, marginTop:2 },
  usageRow: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#111' },
  usageEvent: { color:'#888', fontSize:11, fontFamily:MONO, flex:1 },
  usageAgent: { color:'#e8e8e8', fontSize:11, fontWeight:'700' },
  usageTokens: { color:'#9e9e9e', fontSize:10 },
  usageTime: { color:'#555', fontSize:10 },

  // Drop overlay
  dropOverlay: { position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(255,255,255,0.08)', borderWidth:2, borderColor:'#e8e8e8', borderStyle:'dashed', justifyContent:'center', alignItems:'center', zIndex:100 },
  dropOverlayText: { fontSize:64, marginBottom:8 },
  dropOverlayLabel: { color:'#e8e8e8', fontSize:20, fontWeight:'800' },
});
