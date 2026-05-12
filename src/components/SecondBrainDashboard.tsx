import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MemoryEntry } from '../lib/agentRunSystem';
import {
  buildSecondBrainGraph,
  createSecondBrainNote,
  createSecondBrainNoteFromMemory,
  promoteSecondBrainNoteToMemory,
  searchSecondBrain,
  summarizeSecondBrainContent,
  updateSecondBrainNote,
  type SecondBrainGraph,
  type SecondBrainNote,
  type SecondBrainSearchResult,
} from '../lib/secondBrain';
import { supabase } from '../lib/supabase';
import { PIXEL_COLORS, GRID } from '../lib/pixelDesign';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  userId?: string;
  accentColor?: string;
  onOpenCompartment?: (key: string) => void;
}

type BrainFilter = 'active' | 'inbox' | 'evergreen' | 'processed';
type ViewMode = 'graph' | 'nodes' | 'upload' | 'other';
type BrainLink = SecondBrainGraph['links'][0];

interface SimNode {
  id: string;
  title: string;
  tags: string[];
  importance: number;
  note_kind: string;
  status: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  pinned: boolean;
  isCluster: boolean;
  color: string;
}

interface CanvasState {
  canvas: any;
  ctx: any;
  W: number; H: number;
  nodes: SimNode[];
  links: BrainLink[];
  nodeMap: Record<string, SimNode>;
  rotX: number; rotY: number;
  zoom: number; panX: number; panY: number;
  isDragging: boolean;
  dragNodeIdx: number;
  mouseDownX: number; mouseDownY: number;
  lastMX: number; lastMY: number;
  hoveredId: string | null;
  selectedId: string | null;
  connectedIds: Set<string> | null;
  accentColor: string;
  stars: Array<{ x: number; y: number; r: number }>;
  animId: number;
  simCooling: number;
}

interface OtherCircle { id: string; name: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_COLORS = [
  '#22d3ee', '#22c55e', '#a855f7', '#f59e0b',
  '#38bdf8', '#f43f5e', '#84cc16', '#fb923c',
] as const;

const PHYSICS = {
  repulsion: 6000,
  springK: 0.025,
  springLen: 110,
  gravity: 0.018,
  damping: 0.86,
  clusterPull: 0.008,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function project3d(
  x: number, y: number, z: number,
  rotX: number, rotY: number,
  cx: number, cy: number,
  zoom: number, panX: number, panY: number,
): { sx: number; sy: number; scale: number; pz: number } {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const y2 = y * cosX - z1 * sinX;
  const pz = y * sinX + z1 * cosX;
  const fov = 520;
  const scale = (fov / (fov + pz + 200)) * zoom;
  return { sx: cx + x1 * scale + panX, sy: cy + y2 * scale + panY, scale, pz };
}

function buildTagColorMap(clusters: SecondBrainGraph['clusters']): Map<string, string> {
  const m = new Map<string, string>();
  clusters.forEach((c, i) => m.set(c.tag, NODE_COLORS[i % NODE_COLORS.length]));
  return m;
}

function initSimNodes(
  notes: SecondBrainNote[],
  clusters: SecondBrainGraph['clusters'],
  tagColors: Map<string, string>,
  existing: Map<string, SimNode>,
): SimNode[] {
  const noteNodes: SimNode[] = notes.map((n) => {
    const prev = existing.get(n.id);
    return {
      id: n.id,
      title: n.title,
      tags: n.tags,
      importance: n.importance || 1,
      note_kind: n.note_kind,
      status: n.status,
      x: prev?.x ?? (Math.random() - 0.5) * 220,
      y: prev?.y ?? (Math.random() - 0.5) * 220,
      z: prev?.z ?? (Math.random() - 0.5) * 220,
      vx: 0, vy: 0, vz: 0,
      pinned: prev?.pinned ?? false,
      isCluster: false,
      color: tagColors.get(n.tags[0]) ?? NODE_COLORS[0],
    };
  });
  const clusterNodes: SimNode[] = clusters.slice(0, NODE_COLORS.length * 2).map((c, i) => ({
    id: `cluster::${c.tag}`,
    title: `#${c.tag}`,
    tags: [c.tag],
    importance: c.count,
    note_kind: 'cluster',
    status: 'active',
    x: Math.cos((i / clusters.length) * Math.PI * 2) * 90,
    y: Math.sin((i / clusters.length) * Math.PI * 2) * 90,
    z: (Math.random() - 0.5) * 40,
    vx: 0, vy: 0, vz: 0,
    pinned: false,
    isCluster: true,
    color: NODE_COLORS[i % NODE_COLORS.length],
  }));
  return [...clusterNodes, ...noteNodes];
}

function physicsTick(s: CanvasState): void {
  const { nodes } = s;
  const clusterMap: Record<string, SimNode> = {};
  for (const n of nodes) {
    if (n.isCluster) clusterMap[n.tags[0]] = n;
  }

  // Repulsion between all nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dz = nodes[j].z - nodes[i].z;
      const d2 = dx * dx + dy * dy + dz * dz + 0.01;
      const f = PHYSICS.repulsion / d2 * s.simCooling;
      const d = Math.sqrt(d2);
      nodes[i].vx -= dx / d * f; nodes[i].vy -= dy / d * f; nodes[i].vz -= dz / d * f;
      nodes[j].vx += dx / d * f; nodes[j].vy += dy / d * f; nodes[j].vz += dz / d * f;
    }
  }

  // Spring attraction along edges
  for (const link of s.links) {
    const a = s.nodeMap[link.from];
    const b = s.nodeMap[link.to];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    const target = PHYSICS.springLen * (1.1 - link.strength * 0.4);
    const f = PHYSICS.springK * (dist - target) * s.simCooling;
    a.vx += dx / dist * f; a.vy += dy / dist * f; a.vz += dz / dist * f;
    b.vx -= dx / dist * f; b.vy -= dy / dist * f; b.vz -= dz / dist * f;
  }

  // Pull notes toward their cluster center
  for (const n of nodes) {
    if (n.isCluster) continue;
    const cluster = clusterMap[n.tags[0]];
    if (!cluster) continue;
    const dx = cluster.x - n.x, dy = cluster.y - n.y, dz = cluster.z - n.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    const f = PHYSICS.clusterPull * dist * s.simCooling;
    n.vx += dx / dist * f; n.vy += dy / dist * f; n.vz += dz / dist * f;
  }

  for (const n of nodes) {
    if (n.pinned) { n.vx = 0; n.vy = 0; n.vz = 0; continue; }
    n.vx -= n.x * PHYSICS.gravity * s.simCooling;
    n.vy -= n.y * PHYSICS.gravity * s.simCooling;
    n.vz -= n.z * PHYSICS.gravity * s.simCooling;
    n.vx *= PHYSICS.damping; n.vy *= PHYSICS.damping; n.vz *= PHYSICS.damping;
    n.x += n.vx; n.y += n.vy; n.z += n.vz;
  }

  s.simCooling = Math.max(0.35, s.simCooling * 0.9998);
}

function drawFrame(s: CanvasState): void {
  const { ctx, W, H, nodes, links, rotX, rotY, zoom, panX, panY } = s;
  if (!ctx) return;
  const cx = W / 2, cy = H / 2;

  // Background
  ctx.fillStyle = '#020914';
  ctx.fillRect(0, 0, W, H);

  // Radial gradient nebula
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.65);
  grd.addColorStop(0, 'rgba(34,211,238,0.055)');
  grd.addColorStop(0.45, 'rgba(168,85,247,0.025)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Star field
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const st of s.stars) {
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Project all nodes
  const proj = nodes.map((n) => {
    const p = project3d(n.x, n.y, n.z, rotX, rotY, cx, cy, zoom, panX, panY);
    return { ...n, ...p };
  });
  proj.sort((a, b) => a.pz - b.pz);

  const projMap: Record<string, (typeof proj)[0]> = {};
  for (const p of proj) projMap[p.id] = p;

  // Edges
  for (const link of links) {
    const a = projMap[link.from];
    const b = projMap[link.to];
    if (!a || !b) continue;
    const isActive = s.selectedId && (link.from === s.selectedId || link.to === s.selectedId);
    const alpha = isActive
      ? 0.55 + link.strength * 0.35
      : s.selectedId
        ? 0.04
        : 0.08 + link.strength * 0.1;
    const avgScale = (a.scale + b.scale) * 0.5;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    if (isActive) {
      const [r, g, b_] = hexToRgb(s.accentColor);
      ctx.strokeStyle = `rgba(${r},${g},${b_},${alpha})`;
    } else {
      ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
    }
    ctx.lineWidth = avgScale * (isActive ? 1.8 : 0.7);
    ctx.stroke();
  }

  // Nodes (back to front)
  for (const n of proj) {
    const isNote = !n.isCluster;
    const r = isNote
      ? (7 + Math.min(6, n.importance * 1.2)) * n.scale
      : (12 + Math.min(10, n.importance * 1.5)) * n.scale;
    const isSelected = n.id === s.selectedId;
    const isHovered = n.id === s.hoveredId;
    const isConnected = s.connectedIds?.has(n.id) ?? false;
    const dimmed = !!(s.selectedId && !isSelected && !isConnected && isNote);
    const [cr, cg, cb] = hexToRgb(n.color);

    ctx.globalAlpha = dimmed ? 0.15 : 1;

    // Outer glow
    if (isSelected || isHovered || n.isCluster) {
      const glowR = r * (isSelected ? 4.5 : n.isCluster ? 3 : 3);
      const glowGrd = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, glowR);
      glowGrd.addColorStop(0, `rgba(${cr},${cg},${cb},${isSelected ? 0.55 : n.isCluster ? 0.22 : 0.35})`);
      glowGrd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = glowGrd;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cluster node: ring only
    if (n.isCluster) {
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.5)`;
      ctx.lineWidth = 1.5 * n.scale;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.45)`;
      ctx.fill();
      ctx.globalAlpha = 0.7 * (dimmed ? 0.15 : 1);
      ctx.font = `bold ${Math.max(8, Math.round(9 * n.scale))}px monospace`;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.textAlign = 'center';
      ctx.fillText(n.title.slice(0, 14), n.sx, n.sy + r + 11 * n.scale);
      ctx.textAlign = 'left';
      ctx.globalAlpha = dimmed ? 0.15 : 1;
      continue;
    }

    // Note node core
    ctx.beginPath();
    ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? '#ffffff'
      : `rgba(${cr},${cg},${cb},${isConnected ? 1 : 0.9})`;
    ctx.fill();

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r + 3.5 * n.scale, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.85)`;
      ctx.lineWidth = 1.5 * n.scale;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r + 7 * n.scale, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.3)`;
      ctx.lineWidth = 1 * n.scale;
      ctx.stroke();
    }

    // Labels — selected always, hovered always, big nodes at normal zoom
    if (isSelected || isHovered) {
      ctx.globalAlpha = isSelected ? 0.95 : 0.8;
      const fs = Math.max(9, Math.round(10 * n.scale));
      ctx.font = `${isSelected ? 'bold ' : ''}${fs}px monospace`;
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(n.title.slice(0, 26), n.sx + r + 4, n.sy + 4);
    } else if (n.scale > 0.85 && r > 9) {
      ctx.globalAlpha = 0.38;
      ctx.font = `${Math.round(8 * n.scale)}px monospace`;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillText(n.title.slice(0, 18), n.sx + r + 3, n.sy + 3);
    }

    ctx.globalAlpha = 1;
  }

  // HUD
  ctx.globalAlpha = 0.35;
  ctx.font = '8px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `${nodes.filter(n => !n.isCluster).length} nodes · ${links.length} edges  |  drag to rotate · scroll to zoom · click to select`,
    10, H - 10,
  );
  ctx.globalAlpha = 1;
}

// ─── 3D Canvas component ──────────────────────────────────────────────────────

interface CanvasProps {
  notes: SecondBrainNote[];
  clusters: SecondBrainGraph['clusters'];
  links: BrainLink[];
  selectedNoteId: string | null;
  accentColor: string;
  onSelectNote: (id: string | null) => void;
  height?: number;
}

function BrainGraph3DCanvas({
  notes, clusters, links, selectedNoteId, accentColor, onSelectNote, height = 520,
}: CanvasProps) {
  const containerRef = useRef<any>(null);
  const onSelectRef = useRef(onSelectNote);
  onSelectRef.current = onSelectNote;

  const stateRef = useRef<CanvasState>({
    canvas: null, ctx: null, W: 0, H: 0,
    nodes: [], links: [], nodeMap: {},
    rotX: 0.28, rotY: 0.18,
    zoom: 1, panX: 0, panY: 0,
    isDragging: false, dragNodeIdx: -1,
    mouseDownX: 0, mouseDownY: 0, lastMX: 0, lastMY: 0,
    hoveredId: null, selectedId: null, connectedIds: null,
    accentColor,
    stars: [], animId: 0, simCooling: 1,
  });

  // Init canvas once on mount
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = containerRef.current;
    if (!el) return;
    const s = stateRef.current;

    const canvas = (document as any).createElement('canvas');
    const dpr = (window as any).devicePixelRatio || 1;
    const rect = el.getBoundingClientRect();
    const W = rect.width || el.clientWidth || 800;
    const H = rect.height || el.clientHeight || height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;cursor:grab;`;
    el.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    s.canvas = canvas;
    s.ctx = ctx;
    s.W = W;
    s.H = H;

    // Generate star field once
    s.stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() < 0.08 ? 1.2 : 0.5,
    }));

    // Mouse handlers
    const getXY = (e: any) => {
      const r = canvas.getBoundingClientRect();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    };

    const hitTest = (mx: number, my: number): number => {
      const proj = s.nodes.map((n, idx) => {
        const p = project3d(n.x, n.y, n.z, s.rotX, s.rotY, s.W / 2, s.H / 2, s.zoom, s.panX, s.panY);
        const r = (!n.isCluster ? 7 + Math.min(6, n.importance * 1.2) : 12 + n.importance * 1.5) * p.scale;
        const d = Math.sqrt((p.sx - mx) ** 2 + (p.sy - my) ** 2);
        return { idx, d, r };
      });
      const hit = proj
        .filter(p => p.d < Math.max(p.r * 1.8, 12))
        .sort((a, b) => a.d - b.d)[0];
      return hit?.idx ?? -1;
    };

    const onMouseDown = (e: any) => {
      const { mx, my } = getXY(e);
      s.isDragging = true;
      s.mouseDownX = mx; s.mouseDownY = my;
      s.lastMX = mx; s.lastMY = my;
      s.dragNodeIdx = hitTest(mx, my);
      canvas.style.cursor = s.dragNodeIdx >= 0 ? 'grabbing' : 'grabbing';
    };

    const onMouseMove = (e: any) => {
      const { mx, my } = getXY(e);
      const dx = mx - s.lastMX;
      const dy = my - s.lastMY;
      s.lastMX = mx; s.lastMY = my;

      if (s.isDragging) {
        if (s.dragNodeIdx >= 0) {
          // Drag node in screen space (approximate world-space move)
          const n = s.nodes[s.dragNodeIdx];
          const p = project3d(n.x, n.y, n.z, s.rotX, s.rotY, s.W/2, s.H/2, s.zoom, s.panX, s.panY);
          n.x += dx / p.scale;
          n.y += dy / p.scale;
          n.vx = 0; n.vy = 0; n.vz = 0;
          n.pinned = true;
          s.simCooling = 1;
        } else {
          s.rotY += dx * 0.006;
          s.rotX += dy * 0.006;
          s.rotX = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, s.rotX));
        }
      }

      // Hover
      const hi = hitTest(mx, my);
      s.hoveredId = hi >= 0 ? s.nodes[hi].id : null;
      canvas.style.cursor = s.hoveredId ? 'pointer' : s.isDragging ? 'grabbing' : 'grab';
    };

    const onMouseUp = (e: any) => {
      const { mx, my } = getXY(e);
      const moved = Math.sqrt((mx - s.mouseDownX) ** 2 + (my - s.mouseDownY) ** 2) < 8;
      if (moved) {
        const hi = hitTest(mx, my);
        if (hi >= 0 && !s.nodes[hi].isCluster) {
          onSelectRef.current(s.nodes[hi].id);
        } else if (hi < 0) {
          onSelectRef.current(null);
        }
      }
      s.isDragging = false;
      s.dragNodeIdx = -1;
      canvas.style.cursor = s.hoveredId ? 'pointer' : 'grab';
    };

    const onWheel = (e: any) => {
      e.preventDefault();
      s.zoom *= e.deltaY > 0 ? 0.92 : 1.09;
      s.zoom = Math.max(0.25, Math.min(4, s.zoom));
    };

    const onDblClick = () => {
      s.rotX = 0.28; s.rotY = 0.18; s.zoom = 1; s.panX = 0; s.panY = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', () => { s.isDragging = false; s.dragNodeIdx = -1; s.hoveredId = null; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);

    // Resize
    const ro = new (window as any).ResizeObserver((entries: any[]) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        canvas.width = width * dpr;
        canvas.height = h * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        s.W = width; s.H = h;
        s.stars = Array.from({ length: 120 }, () => ({
          x: Math.random() * width, y: Math.random() * h,
          r: Math.random() < 0.08 ? 1.2 : 0.5,
        }));
      }
    });
    ro.observe(el);

    // Animation loop
    let autoRotY = 0;
    const animate = () => {
      s.animId = (window as any).requestAnimationFrame(animate);
      if (!s.isDragging) {
        autoRotY += 0.0018;
        s.rotY += 0.0018;
      }
      for (let t = 0; t < 2; t++) physicsTick(s);
      drawFrame(s);
    };
    animate();

    return () => {
      (window as any).cancelAnimationFrame(s.animId);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
      ro.disconnect();
      if (el.contains(canvas)) el.removeChild(canvas);
      s.canvas = null; s.ctx = null;
    };
  }, []);

  // Sync notes/links → simulation nodes
  useEffect(() => {
    const s = stateRef.current;
    const tagColors = buildTagColorMap(clusters);
    const existing = new Map(s.nodes.map(n => [n.id, n]));
    s.nodes = initSimNodes(notes, clusters, tagColors, existing);
    s.links = links;
    s.nodeMap = Object.fromEntries(s.nodes.map(n => [n.id, n]));
    s.simCooling = 1;
  }, [notes, clusters, links]);

  // Sync selectedNoteId
  useEffect(() => {
    const s = stateRef.current;
    s.selectedId = selectedNoteId;
    if (selectedNoteId) {
      s.connectedIds = new Set(
        links
          .filter(l => l.from === selectedNoteId || l.to === selectedNoteId)
          .flatMap(l => [l.from, l.to]),
      );
    } else {
      s.connectedIds = null;
    }
  }, [selectedNoteId, links]);

  // Sync accentColor
  useEffect(() => { stateRef.current.accentColor = accentColor; }, [accentColor]);

  return (
    <View
      ref={containerRef}
      style={{ flex: 1, minHeight: height, position: 'relative', overflow: 'hidden' }}
    />
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SecondBrainDashboard({
  circleId, userId, accentColor = '#22d3ee', onOpenCompartment,
}: Props) {
  const [notes, setNotes] = useState<SecondBrainNote[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [graph, setGraph] = useState<SecondBrainGraph | null>(null);
  const [filter, setFilter] = useState<BrainFilter>('active');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SecondBrainSearchResult[] | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [otherCircles, setOtherCircles] = useState<OtherCircle[]>([]);
  const [otherCircleId, setOtherCircleId] = useState<string | null>(null);
  const [otherGraph, setOtherGraph] = useState<SecondBrainGraph | null>(null);
  const [otherLoading, setOtherLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [graphResult, memoryResult] = await Promise.all([
      buildSecondBrainGraph(circleId),
      import('../lib/agentMemory')
        .then(mod => mod.getUserMemories(circleId, userId))
        .catch(() => ({ circle: [], user: [], session: [], agent: [], total: 0 })),
    ]);
    setGraph(graphResult.graph);
    setNotes(graphResult.graph.notes);
    const loaded = [
      ...(memoryResult.circle || []),
      ...(memoryResult.user || []),
      ...(memoryResult.session || []),
      ...((memoryResult as any).agent || []),
    ];
    setMemories(loaded);
    setStatus(graphResult.missing
      ? 'Second brain migration is not deployed yet. Run the SQL migration and refresh.'
      : graphResult.error || '');
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  const loadOtherCircles = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('circle_members')
      .select('circle_id, circles(id, name)')
      .eq('user_id', userId)
      .neq('circle_id', circleId);
    setOtherCircles((data || []).map((m: any) => ({
      id: m.circle_id,
      name: m.circles?.name || m.circle_id.slice(0, 10),
    })));
  }, [userId, circleId]);

  useEffect(() => {
    if (viewMode === 'other' && !otherCircles.length) loadOtherCircles();
  }, [viewMode, otherCircles.length, loadOtherCircles]);

  const loadOtherCircleGraph = async (id: string) => {
    setOtherCircleId(id);
    setOtherLoading(true);
    const result = await buildSecondBrainGraph(id);
    setOtherGraph(result.graph);
    setOtherLoading(false);
  };

  const handleFileUpload = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    if (!userId) { setStatus('Sign in to upload files.'); return; }

    const input = (document as any).createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,.json,.csv';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files: File[] = Array.from(e.target.files || []);
      if (!files.length) return;
      setUploadStatus(`Processing ${files.length} file(s)…`);
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        let noteTitle = file.name.replace(/\.[^.]+$/, '');
        let noteContent = '';
        try {
          if (['md', 'txt', 'json', 'csv'].includes(ext)) {
            noteContent = await (file as any).text();
            if (ext === 'md') {
              const h = noteContent.match(/^#\s+(.+)$/m)?.[1];
              if (h) noteTitle = h.trim();
            }
          } else {
            noteContent = `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          }
          const result = await createSecondBrainNote({
            circleId, userId, title: noteTitle,
            content: noteContent.slice(0, 8000),
            noteKind: 'note',
            status: 'inbox',
            visibility: 'circle_shared',
            metadata: { source: 'file_upload', filename: file.name, fileExt: ext },
          });
          if (result.note) {
            setSelectedNoteId(result.note.id);
            setUploadStatus(`Saved: ${noteTitle}`);
          } else {
            setUploadStatus(result.error || 'Failed to save');
          }
        } catch (err: any) {
          setUploadStatus(`Error with ${file.name}`);
        }
      }
      await load();
      setTimeout(() => setUploadStatus(''), 2500);
    };
    (document as any).body.appendChild(input);
    input.click();
    (document as any).body.removeChild(input);
  }, [userId, circleId, load]);

  const handleDropUpload = useCallback(async (e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault();
    const files: File[] = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      const syntheticEvent = { target: { files } };
      // Re-use same logic as file input
      await handleFileUpload();
    }
  }, [handleFileUpload]);

  const visibleNotes = useMemo(() => {
    const source = filter === 'active'
      ? notes.filter(n => n.status !== 'archived')
      : notes.filter(n => n.status === filter);
    return source.slice().sort((a, b) => {
      const r = (b.importance || 0) - (a.importance || 0);
      return r !== 0 ? r : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [filter, notes]);

  const selectedNote = useMemo(
    () => notes.find(n => n.id === selectedNoteId) ?? visibleNotes[0] ?? null,
    [notes, selectedNoteId, visibleNotes],
  );

  const graphNotes = useMemo(
    () => (graph?.notes || notes).filter(n => n.status !== 'archived').slice(0, 24),
    [graph?.notes, notes],
  );
  const graphNoteIds = useMemo(() => new Set(graphNotes.map(n => n.id)), [graphNotes]);
  const graphLinks = useMemo(
    () => (graph?.links || []).filter(l => graphNoteIds.has(l.from) && graphNoteIds.has(l.to)).slice(0, 60),
    [graph?.links, graphNoteIds],
  );

  const selectedLinks = useMemo(() => {
    if (!selectedNote) return graphLinks.slice(0, 8);
    return graphLinks.filter(l => l.from === selectedNote.id || l.to === selectedNote.id).slice(0, 8);
  }, [graphLinks, selectedNote]);

  const inboxCount = notes.filter(n => n.status === 'inbox').length;
  const evergreenCount = notes.filter(n => n.status === 'evergreen').length;
  const webCount = notes.filter(n => n.note_kind === 'web_clip').length;
  const linkedMemoryCount = notes.filter(n => Boolean(n.source_memory_id)).length;

  const handleCapture = async (kind: 'note' | 'web_clip') => {
    if (!userId) { setStatus('Sign in before saving to the circle digital brain.'); return; }
    const body = content.trim(), sourceUrl = url.trim();
    if (!body && !sourceUrl) { setStatus('Add note content or a URL first.'); return; }
    setSaving(true);
    const result = await createSecondBrainNote({
      circleId, userId, title,
      url: sourceUrl || undefined,
      content: body || sourceUrl,
      noteKind: kind,
      status: kind === 'web_clip' ? 'inbox' : 'processed',
      visibility: 'circle_shared',
      metadata: { surface: 'backpack', captureMode: kind },
    });
    setSaving(false);
    if (result.note) {
      setTitle(''); setUrl(''); setContent('');
      setSelectedNoteId(result.note.id);
      setStatus('Saved to the .web digital brain.');
      await load();
    } else {
      setStatus(result.missing
        ? 'Second brain database migration is not deployed yet.'
        : result.error || 'Could not save note.');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSaving(true);
    const result = await searchSecondBrain(circleId, searchQuery, { includeMemories: true, limit: 14 });
    setSearchResults(result.results);
    setSaving(false);
    if (result.error) setStatus(result.error);
  };

  const handlePromoteNote = async (note: SecondBrainNote, scope: 'circle' | 'user') => {
    if (!userId) { setStatus('Sign in before promoting notes into memory.'); return; }
    setSaving(true);
    const result = await promoteSecondBrainNoteToMemory(note, { userId, scope });
    setSaving(false);
    if (result.memory) {
      setStatus(`Promoted "${note.title}" into ${scope} agent memory.`);
      await load();
    } else {
      setStatus(result.error || 'Could not promote note.');
    }
  };

  const handleMark = async (note: SecondBrainNote, nextStatus: SecondBrainNote['status']) => {
    setSaving(true);
    const result = await updateSecondBrainNote(note.id, { status: nextStatus });
    setSaving(false);
    if (result.note) {
      setStatus(`Marked "${note.title}" as ${nextStatus}.`);
      await load();
    } else {
      setStatus(result.error || 'Could not update note.');
    }
  };

  const handleImportMemory = async (mem: MemoryEntry) => {
    if (!userId) { setStatus('Sign in before importing agent memory.'); return; }
    setSaving(true);
    const result = await createSecondBrainNoteFromMemory(mem, userId);
    setSaving(false);
    if (result.note) {
      setSelectedNoteId(result.note.id);
      setStatus('Agent memory linked into the .web digital brain.');
      await load();
    } else {
      setStatus(result.missing
        ? 'Second brain database migration is not deployed yet.'
        : result.error || 'Could not import memory.');
    }
  };

  const resultNotes = (searchResults || []).filter(i => i.kind === 'note');
  const resultMemories = (searchResults || []).filter(i => i.kind === 'memory');

  return (
    <View style={styles.shell}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dotWebMark, { borderColor: accentColor }]}>
            <Text style={[styles.dotWebText, { color: accentColor }]}>.web</Text>
          </View>
          <View>
            <Text style={styles.heroEyebrow}>CIRCLE SECOND BRAIN</Text>
            <Text style={styles.heroTitle}>Digital Brain Graph</Text>
          </View>
        </View>
        <View style={styles.heroActions}>
          <Pressable
            onPress={load}
            style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
          >
            <Text style={styles.ghostBtnText}>REFRESH</Text>
          </Pressable>
          {onOpenCompartment && (
            <Pressable
              onPress={() => onOpenCompartment('projects')}
              style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
            >
              <Text style={styles.ghostBtnText}>PROJECTS</Text>
            </Pressable>
          )}
          {Platform.OS === 'web' && (
            <Pressable
              onPress={handleFileUpload}
              style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
            >
              <Text style={styles.ghostBtnText}>+ UPLOAD</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Stat strip ─────────────────────────────────────────────────── */}
      <View style={styles.statStrip}>
        <BrainStat label="Nodes" value={String(notes.length)} color={accentColor} />
        <BrainStat label="Clusters" value={String(graph?.clusters.length || 0)} color="#22c55e" />
        <BrainStat label="Edges" value={String(graphLinks.length)} color="#a855f7" />
        <BrainStat label=".web" value={String(webCount)} color="#38bdf8" />
        <BrainStat label="Inbox" value={String(inboxCount)} color="#f59e0b" />
        <BrainStat label="Evergreen" value={String(evergreenCount)} color="#22c55e" />
      </View>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {([
          { key: 'graph', label: 'GRAPH' },
          { key: 'nodes', label: 'NODES' },
          ...(Platform.OS === 'web' ? [{ key: 'upload', label: 'UPLOAD' }] : []),
          { key: 'other', label: 'OTHER BRAINS' },
        ] as { key: ViewMode; label: string }[]).map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => setViewMode(tab.key)}
            style={({ hovered, pressed }: any) => [
              styles.tabBtn,
              viewMode === tab.key ? { borderColor: accentColor, backgroundColor: `${accentColor}15` } : null,
              hovered && webLift,
              pressed && webPressed,
            ]}
          >
            <Text style={[styles.tabBtnText, viewMode === tab.key ? { color: accentColor } : null]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Status ─────────────────────────────────────────────────────── */}
      {(status || uploadStatus) ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{uploadStatus || status}</Text>
        </View>
      ) : null}

      {/* ── GRAPH VIEW ─────────────────────────────────────────────────── */}
      {viewMode === 'graph' && (
        <View style={styles.graphStage}>
          {loading ? (
            <View style={[styles.graphArea, { alignItems: 'center', justifyContent: 'center', minHeight: 480 }]}>
              <ActivityIndicator color={accentColor} size="large" />
              <Text style={[styles.emptyText, { marginTop: GRID.md }]}>Building brain graph…</Text>
            </View>
          ) : graphNotes.length === 0 ? (
            <View style={[styles.graphArea, styles.graphEmptyState]}>
              <Text style={styles.emptyTitle}>NO BRAIN NODES YET</Text>
              <Text style={styles.emptyText}>
                Capture a note, upload a file, or link an agent memory.{'\n'}
                The 3D graph will build automatically as you add nodes.
              </Text>
            </View>
          ) : Platform.OS === 'web' ? (
            <BrainGraph3DCanvas
              notes={graphNotes}
              clusters={graph?.clusters || []}
              links={graphLinks}
              selectedNoteId={selectedNote?.id || null}
              accentColor={accentColor}
              onSelectNote={setSelectedNoteId}
              height={520}
            />
          ) : (
            <View style={[styles.graphArea, { alignItems: 'center', justifyContent: 'center', minHeight: 280 }]}>
              <Text style={styles.emptyText}>3D graph view is available in the web app.</Text>
              <Text style={[styles.emptyText, { marginTop: 6 }]}>{notes.length} nodes · {graphLinks.length} edges</Text>
            </View>
          )}

          {/* Detail dock */}
          <View style={styles.graphDetailDock}>
            <View style={styles.selectedPanel}>
              <Text style={styles.columnTitle}>SELECTED NODE</Text>
              {selectedNote ? (
                <>
                  <View style={styles.nodeDetailHeader}>
                    <View style={[styles.kindBadge, { borderColor: accentColor }]}>
                      <Text style={[styles.kindBadgeText, { color: accentColor }]}>
                        {selectedNote.note_kind.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      {selectedNote.status} · {dateLabel(selectedNote.updated_at)}
                    </Text>
                  </View>
                  <Text style={styles.cardTitle}>{selectedNote.title}</Text>
                  <Text style={styles.cardBody}>
                    {summarizeSecondBrainContent(selectedNote.content, 260)}
                  </Text>
                  {selectedNote.tags.length ? (
                    <View style={styles.tagRow}>
                      {selectedNote.tags.slice(0, 8).map(tag => (
                        <Text key={tag} style={styles.tag}>#{tag}</Text>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.emptyText}>
                  Click any node in the graph to inspect it.{'\n'}
                  Drag background to rotate · scroll to zoom · double-click to reset.
                </Text>
              )}
            </View>

            <View style={styles.selectedPanel}>
              <Text style={styles.columnTitle}>
                CONNECTIONS{selectedLinks.length ? ` (${selectedLinks.length})` : ''}
              </Text>
              {selectedLinks.length ? selectedLinks.map((link, i) => {
                const peerId = link.from === selectedNote?.id ? link.to : link.from;
                const peer = notes.find(n => n.id === peerId);
                return (
                  <Pressable
                    key={`${link.from}:${link.to}:${i}`}
                    onPress={() => setSelectedNoteId(peerId)}
                    style={({ hovered, pressed }: any) => [styles.linkRow, hovered && webLift, pressed && webPressed]}
                  >
                    <View style={styles.linkRowHeader}>
                      <Text style={styles.linkType}>{link.label || 'related'}</Text>
                      <Text style={styles.linkStrength}>{Math.round(link.strength * 100)}%</Text>
                    </View>
                    {peer && <Text style={styles.linkPeerTitle} numberOfLines={1}>{peer.title}</Text>}
                    {link.reason && <Text style={styles.linkReason}>{link.reason}</Text>}
                  </Pressable>
                );
              }) : (
                <Text style={styles.emptyText}>
                  Connections form as notes share tags or get promoted into memory.
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* ── NODES VIEW ─────────────────────────────────────────────────── */}
      {viewMode === 'nodes' && (
        <View style={styles.mainGrid}>
          <View style={styles.leftColumn}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelLabel}>KNOWLEDGE NODES</Text>
                <Text style={styles.panelHint}>Promote inbox notes to evergreen or agent memory.</Text>
              </View>
              <View style={styles.filterRow}>
                {(['active', 'inbox', 'processed', 'evergreen'] as BrainFilter[]).map(item => (
                  <Pressable
                    key={item}
                    onPress={() => setFilter(item)}
                    style={({ hovered, pressed }: any) => [
                      styles.filterBtn,
                      filter === item ? { borderColor: accentColor, backgroundColor: `${accentColor}18` } : null,
                      hovered && webLift, pressed && webPressed,
                    ]}
                  >
                    <Text style={[styles.filterText, filter === item ? { color: accentColor } : null]}>
                      {item.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {loading ? <ActivityIndicator color={accentColor} style={{ padding: 20 }} /> :
              visibleNotes.length ? visibleNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  active={selectedNote?.id === note.id}
                  accentColor={accentColor}
                  onSelect={() => { setSelectedNoteId(note.id); setViewMode('graph'); }}
                  onMark={handleMark}
                  onPromote={handlePromoteNote}
                />
              )) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>NO NODES YET</Text>
                  <Text style={styles.emptyText}>
                    Save a web clip, import an agent memory, or capture a note.
                  </Text>
                </View>
              )}
          </View>

          <View style={styles.rightColumn}>
            <View style={styles.searchPanel}>
              <Text style={styles.panelLabel}>SEMANTIC SEARCH</Text>
              <View style={styles.searchRow}>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={handleSearch}
                  placeholder="Ask the brain anything…"
                  placeholderTextColor={PIXEL_COLORS.text3}
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable
                  onPress={handleSearch}
                  style={({ hovered, pressed }: any) => [
                    styles.primaryBtn, { borderColor: accentColor, backgroundColor: accentColor },
                    hovered && webLift, pressed && webPressed,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>{saving ? '…' : 'SEARCH'}</Text>
                </Pressable>
                {searchResults && (
                  <Pressable
                    onPress={() => { setSearchQuery(''); setSearchResults(null); }}
                    style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
                  >
                    <Text style={styles.ghostBtnText}>CLEAR</Text>
                  </Pressable>
                )}
              </View>
              {searchResults && (
                <View style={styles.resultGrid}>
                  <View style={styles.resultColumn}>
                    <Text style={styles.columnTitle}>NOTE MATCHES</Text>
                    {resultNotes.length ? resultNotes.map(item => {
                      const note = (item.raw as SecondBrainNote)?.note_kind ? item.raw as SecondBrainNote : null;
                      return (
                        <Pressable
                          key={`note-${item.id}`}
                          onPress={() => note && setSelectedNoteId(note.id)}
                          style={({ hovered, pressed }: any) => [styles.resultCard, hovered && webLift, pressed && webPressed]}
                        >
                          <Text style={styles.cardTitle}>{item.title}</Text>
                          <Text style={styles.cardMeta}>{item.source || 'note'}{item.similarity != null ? ` · ${Math.round(item.similarity * 100)}%` : ''}</Text>
                          <Text style={styles.cardBody}>{summarizeSecondBrainContent(item.summary || item.content, 160)}</Text>
                        </Pressable>
                      );
                    }) : <Text style={styles.emptyText}>No note matches.</Text>}
                  </View>
                  <View style={styles.resultColumn}>
                    <Text style={styles.columnTitle}>MEMORY MATCHES</Text>
                    {resultMemories.length ? resultMemories.map(item => (
                      <View key={`mem-${item.id}`} style={styles.resultCard}>
                        <Text style={styles.cardTitle}>{item.title}</Text>
                        <Text style={styles.cardMeta}>{item.source || 'agent memory'}{item.similarity != null ? ` · ${Math.round(item.similarity * 100)}%` : ''}</Text>
                        <Text style={styles.cardBody}>{summarizeSecondBrainContent(item.content, 160)}</Text>
                      </View>
                    )) : <Text style={styles.emptyText}>No memory matches.</Text>}
                  </View>
                </View>
              )}
            </View>

            <View style={styles.memoryPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelLabel}>AGENT MEMORIES</Text>
                  <Text style={styles.panelHint}>Pull durable memories into the digital brain.</Text>
                </View>
                {onOpenCompartment && (
                  <Pressable
                    onPress={() => onOpenCompartment('terminal')}
                    style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
                  >
                    <Text style={styles.ghostBtnText}>COMMAND</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView style={styles.memoryList} nestedScrollEnabled>
                {memories.slice(0, 8).map(mem => (
                  <View key={mem.id} style={styles.memoryCard}>
                    <Text style={styles.cardTitle}>{mem.title}</Text>
                    <Text style={styles.cardMeta}>{mem.scope}/{mem.memory_kind}{mem.source_surface ? ` · ${mem.source_surface}` : ''}</Text>
                    <Text style={styles.cardBody}>{summarizeSecondBrainContent(mem.content, 120)}</Text>
                    <Pressable
                      onPress={() => handleImportMemory(mem)}
                      style={({ hovered, pressed }: any) => [styles.miniBtn, hovered && webLift, pressed && webPressed]}
                    >
                      <Text style={styles.miniBtnText}>LINK TO BRAIN</Text>
                    </Pressable>
                  </View>
                ))}
                {!memories.length && <Text style={styles.emptyText}>No circle memories loaded yet.</Text>}
              </ScrollView>
            </View>
          </View>
        </View>
      )}

      {/* ── UPLOAD VIEW ────────────────────────────────────────────────── */}
      {viewMode === 'upload' && Platform.OS === 'web' && (
        <View style={styles.uploadPanel}>
          <Text style={styles.panelLabel}>UPLOAD FILES TO BRAIN</Text>
          <Text style={styles.panelHint}>Supported: .md, .txt, .json, .csv — up to 8 KB content per file.</Text>

          <Pressable
            onPress={handleFileUpload}
            style={({ hovered, pressed }: any) => [
              styles.dropZone,
              hovered ? { borderColor: accentColor, backgroundColor: `${accentColor}12` } : null,
              pressed && webPressed,
            ]}
          >
            <Text style={styles.dropZoneIcon}>+</Text>
            <Text style={[styles.dropZoneText, { color: accentColor }]}>Click to choose files</Text>
            <Text style={styles.panelHint}>Markdown files get their # heading as the note title</Text>
          </Pressable>

          {uploadStatus ? (
            <View style={styles.statusBar}>
              <Text style={styles.statusText}>{uploadStatus}</Text>
            </View>
          ) : null}

          <View style={styles.capturePanelBelow}>
            <Text style={styles.panelLabel}>OR CAPTURE MANUALLY</Text>
            <Text style={styles.panelHint}>Everything captured here feeds the graph.</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Optional title" placeholderTextColor={PIXEL_COLORS.text3} style={styles.input} />
            <TextInput value={url} onChangeText={setUrl} placeholder="https:// source URL" placeholderTextColor={PIXEL_COLORS.text3} autoCapitalize="none" style={styles.input} />
            <TextInput value={content} onChangeText={setContent} placeholder="Paste research, decisions, agent findings…" placeholderTextColor={PIXEL_COLORS.text3} multiline style={[styles.input, styles.textArea]} />
            <View style={styles.heroActions}>
              <Pressable
                onPress={() => handleCapture('web_clip')}
                style={({ hovered, pressed }: any) => [
                  styles.primaryBtn, { backgroundColor: accentColor, borderColor: accentColor },
                  hovered && webLift, pressed && webPressed,
                ]}
              >
                <Text style={styles.primaryBtnText}>{saving ? 'SAVING…' : 'SAVE WEB CLIP'}</Text>
              </Pressable>
              <Pressable
                onPress={() => handleCapture('note')}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
              >
                <Text style={styles.ghostBtnText}>SAVE NOTE</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── OTHER BRAINS VIEW ──────────────────────────────────────────── */}
      {viewMode === 'other' && (
        <View style={styles.otherPanel}>
          <Text style={styles.panelLabel}>OTHER CIRCLE BRAINS</Text>
          <Text style={styles.panelHint}>
            View the knowledge graph of any circle you are a member of.
          </Text>

          {!otherCircles.length ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>NO OTHER CIRCLES</Text>
              <Text style={styles.emptyText}>Join additional circles to see their brain graphs here.</Text>
            </View>
          ) : (
            <View style={styles.circleGrid}>
              {otherCircles.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => loadOtherCircleGraph(c.id)}
                  style={({ hovered, pressed }: any) => [
                    styles.circleCard,
                    otherCircleId === c.id ? { borderColor: accentColor, backgroundColor: `${accentColor}15` } : null,
                    hovered && webLift, pressed && webPressed,
                  ]}
                >
                  <Text style={[styles.cardTitle, otherCircleId === c.id ? { color: accentColor } : null]}>
                    {c.name}
                  </Text>
                  <Text style={styles.cardMeta}>{c.id.slice(0, 12)}…</Text>
                </Pressable>
              ))}
            </View>
          )}

          {otherCircleId && (
            <View style={styles.graphStage}>
              <View style={styles.graphCanvasBar}>
                <Text style={styles.graphCanvasTitle}>
                  {otherCircles.find(c => c.id === otherCircleId)?.name || otherCircleId} — Brain Graph
                </Text>
                <Text style={styles.graphCanvasMeta}>
                  {otherGraph ? `${otherGraph.notes.length} nodes · ${otherGraph.clusters.length} clusters` : 'Loading…'}
                </Text>
              </View>
              {otherLoading ? (
                <ActivityIndicator color={accentColor} style={{ padding: 40 }} />
              ) : otherGraph && Platform.OS === 'web' ? (
                <BrainGraph3DCanvas
                  notes={otherGraph.notes.filter(n => n.status !== 'archived').slice(0, 24)}
                  clusters={otherGraph.clusters}
                  links={otherGraph.links.slice(0, 60)}
                  selectedNoteId={null}
                  accentColor="#a855f7"
                  onSelectNote={() => {}}
                  height={420}
                />
              ) : otherGraph ? (
                <View style={[styles.graphArea, { minHeight: 180, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={styles.emptyText}>
                    {otherGraph.notes.length} nodes · {otherGraph.clusters.length} clusters · {otherGraph.links.length} edges
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}

    </View>
  );
}

// ─── BrainStat ────────────────────────────────────────────────────────────────

function BrainStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.brainStat, { borderColor: `${color}28` }]}>
      <Text style={[styles.brainStatValue, { color }]}>{value}</Text>
      <Text style={styles.brainStatLabel}>{label}</Text>
    </View>
  );
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({
  note, active, accentColor, onSelect, onMark, onPromote,
}: {
  note: SecondBrainNote; active: boolean; accentColor: string;
  onSelect: () => void;
  onMark: (note: SecondBrainNote, status: SecondBrainNote['status']) => void;
  onPromote: (note: SecondBrainNote, scope: 'circle' | 'user') => void;
}) {
  const sourceUrl = typeof note.metadata?.sourceUrl === 'string' ? note.metadata.sourceUrl : '';
  return (
    <Pressable
      onPress={onSelect}
      style={({ hovered, pressed }: any) => [
        styles.noteCard,
        active ? { borderColor: accentColor, backgroundColor: `${accentColor}0f` } : null,
        hovered && webLift, pressed && webPressed,
      ]}
    >
      <View style={styles.noteTop}>
        <View style={[styles.kindBadge, { borderColor: active ? accentColor : PIXEL_COLORS.border1 }]}>
          <Text style={[styles.kindBadgeText, { color: active ? accentColor : PIXEL_COLORS.text2 }]}>
            {note.note_kind.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.cardMeta}>{note.status.toUpperCase()} · {dateLabel(note.updated_at)}</Text>
      </View>
      <Text style={styles.cardTitle}>{note.title}</Text>
      {sourceUrl ? <Text style={styles.sourceUrl} numberOfLines={1}>{sourceUrl}</Text> : null}
      <Text style={styles.cardBody}>{summarizeSecondBrainContent(note.summary || note.content, 200)}</Text>
      {note.tags.length ? (
        <View style={styles.tagRow}>
          {note.tags.slice(0, 6).map(tag => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
        </View>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable onPress={() => onMark(note, 'evergreen')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>EVERGREEN</Text>
        </Pressable>
        <Pressable onPress={() => onPromote(note, 'circle')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>MEMORY</Text>
        </Pressable>
        <Pressable onPress={() => onPromote(note, 'user')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>PRIVATE</Text>
        </Pressable>
        <Pressable onPress={() => onMark(note, 'archived')} style={styles.miniBtnDanger}>
          <Text style={styles.miniBtnDangerText}>ARCHIVE</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateLabel(value?: string | null): string {
  if (!value) return 'unknown';
  try { return new Date(value).toLocaleDateString(); } catch { return 'unknown'; }
}

const webLift = Platform.OS === 'web' ? ({
  transform: [{ translateY: -1 }],
  boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
} as any) : null;

const webPressed = Platform.OS === 'web' ? ({ transform: [{ scale: 0.99 }] } as any) : null;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: GRID.lg,
    marginBottom: GRID.xl,
    gap: GRID.md,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: GRID.md,
    paddingVertical: GRID.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
  },
  heroEyebrow: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  dotWebMark: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: GRID.sm,
    paddingVertical: 4,
    backgroundColor: '#00000055',
  },
  dotWebText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  brainStat: {
    flexGrow: 1,
    minWidth: 80,
    borderWidth: 1,
    borderRadius: 3,
    backgroundColor: '#0a0f1c',
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    gap: 2,
  },
  brainStatValue: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'monospace',
    lineHeight: 26,
  },
  brainStatLabel: {
    color: PIXEL_COLORS.text3,
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tabBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: GRID.md,
    paddingVertical: 9,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  tabBtnText: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Graph stage
  graphStage: {
    borderWidth: 1,
    borderColor: '#22d3ee28',
    borderRadius: 4,
    backgroundColor: '#040b14',
    overflow: 'hidden',
    gap: GRID.md,
    ...Platform.select({
      web: {
        backgroundImage: [
          'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.16), transparent 30%)',
          'radial-gradient(circle at 75% 18%, rgba(168,85,247,0.14), transparent 28%)',
          'radial-gradient(circle at 50% 82%, rgba(34,197,94,0.1), transparent 28%)',
        ].join(', '),
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      } as any,
      default: {},
    }),
  },
  graphArea: {
    flex: 1,
    minHeight: 480,
    position: 'relative',
    overflow: 'hidden',
  },
  graphEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: GRID.xl,
    gap: GRID.sm,
  },
  graphCanvasBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GRID.md,
    paddingTop: GRID.sm,
  },
  graphCanvasTitle: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  graphCanvasMeta: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  graphDetailDock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
    padding: GRID.md,
  },
  selectedPanel: {
    flexGrow: 1,
    minWidth: 280,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: '#0c1220',
    padding: GRID.md,
    gap: GRID.sm,
  },
  nodeDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    flexWrap: 'wrap',
  },
  linkRow: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: '#060c14',
    padding: GRID.sm,
    gap: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  linkRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GRID.sm,
  },
  linkType: {
    color: '#38bdf8',
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  linkStrength: { color: PIXEL_COLORS.text3, fontSize: 9, fontFamily: 'monospace' },
  linkPeerTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  linkReason: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
  },

  // Upload panel
  uploadPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.md,
  },
  dropZone: {
    borderWidth: 2,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 4,
    borderStyle: 'dashed' as any,
    padding: GRID.xl * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: GRID.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  dropZoneIcon: {
    color: PIXEL_COLORS.text2,
    fontSize: 32,
    fontWeight: '300',
    fontFamily: 'monospace',
    lineHeight: 36,
  },
  dropZoneText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },

  // Other circles panel
  otherPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.md,
  },
  circleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  circleCard: {
    flex: 1,
    minWidth: 180,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },

  // Main grid
  mainGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  leftColumn: { flex: 1.2, minWidth: 320, gap: GRID.sm },
  rightColumn: { flex: 0.9, minWidth: 300, gap: GRID.md },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: GRID.sm,
    flexWrap: 'wrap',
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  filterBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  filterText: { color: PIXEL_COLORS.text2, fontSize: 8, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.6 },

  // Note cards
  noteCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: GRID.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  noteTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: GRID.sm, flexWrap: 'wrap' },
  kindBadge: { borderWidth: 1, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: '#00000030' },
  kindBadgeText: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.6, textTransform: 'uppercase' },
  cardTitle: { color: PIXEL_COLORS.text0, fontSize: 13, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.3 },
  cardMeta: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace' },
  cardBody: { color: PIXEL_COLORS.text1, fontSize: 11, fontFamily: 'monospace', lineHeight: 17 },
  sourceUrl: { color: '#38bdf8', fontSize: 10, fontFamily: 'monospace' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: {
    color: '#94a3b8',
    backgroundColor: '#ffffff09',
    borderWidth: 1,
    borderColor: '#ffffff14',
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  miniBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg1,
    paddingHorizontal: 7,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  miniBtnText: { color: PIXEL_COLORS.text1, fontSize: 8, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.4 },
  miniBtnDanger: {
    borderWidth: 1,
    borderColor: '#ef444440',
    borderRadius: 2,
    backgroundColor: '#ef444410',
    paddingHorizontal: 7,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  miniBtnDangerText: { color: '#f87171', fontSize: 8, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.4 },

  // Search + memory
  searchPanel: { borderWidth: 1, borderColor: PIXEL_COLORS.border0, borderRadius: 3, backgroundColor: PIXEL_COLORS.bg1, padding: GRID.md, gap: GRID.sm },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID.sm, alignItems: 'stretch' },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID.md },
  resultColumn: { flex: 1, minWidth: 240, gap: GRID.sm },
  resultCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    gap: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  memoryPanel: { borderWidth: 1, borderColor: PIXEL_COLORS.border0, borderRadius: 3, backgroundColor: PIXEL_COLORS.bg1, padding: GRID.md, gap: GRID.md },
  memoryList: { maxHeight: 440 },
  memoryCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    gap: 5,
    marginBottom: GRID.sm,
  },

  // Capture
  capturePanelBelow: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: GRID.sm,
  },
  input: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    fontFamily: 'monospace',
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  primaryBtn: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  primaryBtnText: { color: '#040c14', fontSize: 10, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  ghostBtnText: { color: PIXEL_COLORS.text1, fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.8 },

  // Status
  statusBar: {
    borderWidth: 1,
    borderColor: '#f59e0b33',
    backgroundColor: '#f59e0b0d',
    borderRadius: 3,
    padding: GRID.md,
  },
  statusText: { color: PIXEL_COLORS.text1, fontSize: 11, fontFamily: 'monospace' },

  // Common
  panelLabel: { color: PIXEL_COLORS.text2, fontSize: 9, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 2.5, textTransform: 'uppercase' },
  panelHint: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  columnTitle: { color: PIXEL_COLORS.text2, fontSize: 9, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1.8, textTransform: 'uppercase' },
  emptyCard: { borderWidth: 1, borderColor: PIXEL_COLORS.border0, borderRadius: 3, backgroundColor: PIXEL_COLORS.bg2, padding: GRID.lg, gap: GRID.sm },
  emptyTitle: { color: PIXEL_COLORS.text1, fontSize: 11, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1.2, textTransform: 'uppercase' },
  emptyText: { color: PIXEL_COLORS.text3, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
});
