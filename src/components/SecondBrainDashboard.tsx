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
  DIGITAL_BRAIN_DB_TABLES,
  buildDigitalBrainSystemMap,
  type DigitalBrainDbStat,
  type DigitalBrainSystemMap,
  type DigitalBrainSystemNode,
} from '../lib/digitalBrainSystemMap';
import { autoMapSiteToSecondBrain } from '../lib/secondBrainSiteMap';
import {
  buildSecondBrainAgentBrief,
  buildSecondBrainBaseViews,
  buildSecondBrainGraph,
  createSecondBrainNote,
  createSecondBrainNoteFromMemory,
  getSecondBrainReviewState,
  promoteSecondBrainNoteToMemory,
  reviewSecondBrainNote,
  searchSecondBrain,
  shareSecondBrainNote,
  summarizeSecondBrainContent,
  updateSecondBrainNote,
  type SecondBrainBaseView,
  type SecondBrainGraph,
  type SecondBrainNote,
  type SecondBrainReviewState,
  type SecondBrainSearchResult,
  type SecondBrainVisibility,
} from '../lib/secondBrain';
import { supabase } from '../lib/supabase';
import { PIXEL_COLORS, GRID } from '../lib/pixelDesign';
import {
  SECOND_BRAIN_KNOWLEDGE_PROFILE_OPTIONS,
  runSecondBrainKnowledgeProfile,
} from '../lib/researchControl';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  userId?: string;
  accentColor?: string;
  onOpenCompartment?: (key: string) => void;
}

type BrainFilter = 'active' | 'inbox' | 'evergreen' | 'processed';
type ViewMode = 'graph' | 'system' | 'nodes' | 'review' | 'upload' | 'other';
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
  trackTarget: { rotX: number; rotY: number; zoom?: number } | null;
  lastSelectTime: number;
}

interface OtherCircle { id: string; name: string; }

type ReviewQueueItem = { note: SecondBrainNote; state: SecondBrainReviewState };

interface SystemSimNode extends DigitalBrainSystemNode {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  radius: number;
  sx?: number;
  sy?: number;
  scale?: number;
  depth?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_COLORS = [
  '#22d3ee', '#22c55e', '#a855f7', '#f59e0b',
  '#38bdf8', '#f43f5e', '#84cc16', '#fb923c',
] as const;

const PHYSICS = {
  repulsion: 9500,     // stronger push → nodes don't pile on top of each other
  springK: 0.022,      // slightly softer spring so links don't crush clusters
  springLen: 160,      // wider rest length → connected nodes breathe more
  gravity: 0.013,      // looser center-pull to let nodes spread into full volume
  damping: 0.92,       // less dissipation → nodes keep momentum, escape local minima
  clusterPull: 0.026,  // stronger cluster cohesion to compensate for higher repulsion
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
  // Z-offset by status keeps workflow stages on distinct depth layers
  const statusZ: Record<string, number> = {
    evergreen: 80, processed: 25, inbox: -35, archived: -90,
  };
  const noteNodes: SimNode[] = notes.map((n) => {
    const prev = existing.get(n.id);
    const baseZ = statusZ[n.status] ?? 0;
    return {
      id: n.id,
      title: n.title,
      tags: n.tags,
      importance: n.importance || 1,
      note_kind: n.note_kind,
      status: n.status,
      // Wider initial volume → nodes start spread so repulsion doesn't collapse them
      x: prev?.x ?? (Math.random() - 0.5) * 340,
      y: prev?.y ?? (Math.random() - 0.5) * 340,
      z: prev?.z ?? baseZ + (Math.random() - 0.5) * 160,
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
    // Wider circle + real Z spread → clusters fill 3D volume not just XY plane
    x: Math.cos((i / clusters.length) * Math.PI * 2) * 200,
    y: Math.sin((i / clusters.length) * Math.PI * 2) * 200,
    z: Math.sin((i / clusters.length) * Math.PI * 4) * 90,
    vx: 0, vy: 0, vz: 0,
    pinned: false,
    isCluster: true,
    color: NODE_COLORS[i % NODE_COLORS.length],
  }));
  return [...clusterNodes, ...noteNodes];
}

// Status Z-targets: each workflow stage occupies its own depth band
const STATUS_Z: Record<string, number> = {
  evergreen: 80, processed: 25, inbox: -35, archived: -90,
};

function physicsTick(s: CanvasState): void {
  const { nodes } = s;
  const clusterMap: Record<string, SimNode> = {};
  for (const n of nodes) {
    if (n.isCluster) clusterMap[n.tags[0]] = n;
  }

  // Repulsion — scale-aware epsilon prevents sticking; importance scales push radius
  for (let i = 0; i < nodes.length; i++) {
    const ni = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const nj = nodes[j];
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = nj.z - ni.z;
      // Minimum d² of 25 (= 5 world-units) to prevent singularity sticking
      const d2 = Math.max(25, dx * dx + dy * dy + dz * dz);
      // High-importance nodes push harder, so they carve out more personal space
      const impScale = 0.55 + 0.45 * Math.sqrt(ni.importance * nj.importance);
      const f = (PHYSICS.repulsion * impScale) / d2 * s.simCooling;
      const d = Math.sqrt(d2);
      ni.vx -= dx / d * f; ni.vy -= dy / d * f; ni.vz -= dz / d * f;
      nj.vx += dx / d * f; nj.vy += dy / d * f; nj.vz += dz / d * f;
    }
  }

  // Spring attraction / repulsion along edges (contradicts links push apart)
  for (const link of s.links) {
    const a = s.nodeMap[link.from];
    const b = s.nodeMap[link.to];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    const isContradict = link.label === 'contradicts';
    // Contradicting notes repel to 1.8× rest length; everything else attracts
    const target = isContradict
      ? PHYSICS.springLen * 1.8
      : PHYSICS.springLen * (1.1 - link.strength * 0.4);
    const kMod = isContradict ? -0.018 : PHYSICS.springK;
    const f = kMod * (dist - target) * s.simCooling;
    a.vx += dx / dist * f; a.vy += dy / dist * f; a.vz += dz / dist * f;
    b.vx -= dx / dist * f; b.vy -= dy / dist * f; b.vz -= dz / dist * f;
  }

  // Multi-tag cluster gravity: pull weighted toward every matching cluster, not just tags[0]
  for (const n of nodes) {
    if (n.isCluster) continue;
    const tagCount = Math.max(1, n.tags.length);
    for (const tag of n.tags) {
      const cluster = clusterMap[tag];
      if (!cluster) continue;
      const dx = cluster.x - n.x, dy = cluster.y - n.y, dz = cluster.z - n.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      // Divide pull evenly across all matching tags so multi-topic notes sit between clusters
      const f = (PHYSICS.clusterPull / tagCount) * dist * s.simCooling;
      n.vx += dx / dist * f; n.vy += dy / dist * f; n.vz += dz / dist * f;
    }
    // Weak status-based Z gravity: evergreen floats forward, inbox sinks back
    if (!n.isCluster) {
      const targetZ = STATUS_Z[n.status] ?? 0;
      n.vz += (targetZ - n.z) * 0.0018 * s.simCooling;
    }
  }

  for (const n of nodes) {
    if (n.pinned) { n.vx = 0; n.vy = 0; n.vz = 0; continue; }
    n.vx -= n.x * PHYSICS.gravity * s.simCooling;
    n.vy -= n.y * PHYSICS.gravity * s.simCooling;
    n.vz -= n.z * PHYSICS.gravity * s.simCooling;
    n.vx *= PHYSICS.damping; n.vy *= PHYSICS.damping; n.vz *= PHYSICS.damping;
    n.x += n.vx; n.y += n.vy; n.z += n.vz;
  }

  // Higher floor (0.52) — simulation never goes completely cold; stays slightly alive
  s.simCooling = Math.max(0.52, s.simCooling * 0.9998);
}

const DIRECTED_LINK_TYPES = new Set(['supports', 'contradicts', 'next_step', 'source']);

function drawFrame(s: CanvasState): void {
  const { ctx, W, H, nodes, links, rotX, rotY, zoom, panX, panY } = s;
  if (!ctx) return;
  const cx = W / 2, cy = H / 2;

  ctx.fillStyle = '#020914';
  ctx.fillRect(0, 0, W, H);

  // Nebula glow
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.65);
  grd.addColorStop(0, 'rgba(34,211,238,0.055)');
  grd.addColorStop(0.45, 'rgba(168,85,247,0.025)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const st of s.stars) {
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Project + sort back-to-front
  const proj = nodes.map((n) => {
    const p = project3d(n.x, n.y, n.z, rotX, rotY, cx, cy, zoom, panX, panY);
    return { ...n, ...p };
  });
  proj.sort((a, b) => a.pz - b.pz);

  const projMap: Record<string, (typeof proj)[0]> = {};
  for (const p of proj) projMap[p.id] = p;

  // Depth fog: pz ~[-200, +200] → alpha [0.12, 1]
  const fogAlpha = (pz: number) => Math.max(0.12, 1 - (pz + 110) / 380);

  // ── Edges ──
  for (const link of links) {
    const a = projMap[link.from];
    const b = projMap[link.to];
    if (!a || !b) continue;
    const isActive = !!(s.selectedId && (link.from === s.selectedId || link.to === s.selectedId));
    const baseFog = fogAlpha((a.pz + b.pz) * 0.5);
    const baseAlpha = isActive
      ? (0.55 + link.strength * 0.35) * baseFog
      : s.selectedId
        ? 0.04 * baseFog
        : (0.08 + link.strength * 0.1) * baseFog;
    const avgScale = (a.scale + b.scale) * 0.5;

    // Gradient edge: source color → target color
    const eg = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
    if (isActive) {
      const [r, g, bv] = hexToRgb(s.accentColor);
      eg.addColorStop(0, `rgba(${r},${g},${bv},${baseAlpha})`);
      eg.addColorStop(1, `rgba(${r},${g},${bv},${baseAlpha * 0.45})`);
    } else {
      const [ar, ag, ab] = hexToRgb(a.color);
      const [br2, bg2, bb2] = hexToRgb(b.color);
      eg.addColorStop(0, `rgba(${ar},${ag},${ab},${baseAlpha})`);
      eg.addColorStop(1, `rgba(${br2},${bg2},${bb2},${baseAlpha * 0.5})`);
    }
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.strokeStyle = eg;
    ctx.lineWidth = avgScale * (isActive ? 1.8 : 0.7);
    ctx.stroke();

    // Arrowhead for directed types on active edge
    if (isActive && DIRECTED_LINK_TYPES.has(link.label)) {
      const dx = b.sx - a.sx, dy = b.sy - a.sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const bR = (!b.isCluster ? 7 + Math.min(6, b.importance * 1.2) : 12 + b.importance * 1.5) * b.scale;
      const tipX = b.sx - (dx / len) * (bR + 2);
      const tipY = b.sy - (dy / len) * (bR + 2);
      const angle = Math.atan2(dy, dx);
      const aSize = Math.max(4, 6 * b.scale);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.45) * aSize, tipY - Math.sin(angle - 0.45) * aSize);
      ctx.lineTo(tipX - Math.cos(angle + 0.45) * aSize, tipY - Math.sin(angle + 0.45) * aSize);
      ctx.closePath();
      const [r, g, bv] = hexToRgb(s.accentColor);
      ctx.fillStyle = `rgba(${r},${g},${bv},${Math.min(1, baseAlpha * 1.6)})`;
      ctx.fill();
    }
  }

  // ── Nodes (back to front) ──
  for (const n of proj) {
    const r = n.isCluster
      ? (12 + Math.min(10, n.importance * 1.5)) * n.scale
      : (7 + Math.min(6, n.importance * 1.2)) * n.scale;
    const isSelected = n.id === s.selectedId;
    const isHovered = n.id === s.hoveredId;
    const isConnected = s.connectedIds?.has(n.id) ?? false;
    const dimmed = !!(s.selectedId && !isSelected && !isConnected && !n.isCluster);
    const [cr, cg, cb] = hexToRgb(n.color);
    const fog = fogAlpha(n.pz);

    ctx.globalAlpha = dimmed ? 0.12 : fog;

    // Importance rings (notes with importance ≥ 0.72)
    if (!n.isCluster && n.importance >= 0.72) {
      const rings = n.importance >= 0.88 ? 2 : 1;
      for (let ri = 1; ri <= rings; ri++) {
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r + ri * 5.5 * n.scale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.17 - ri * 0.04) * fog})`;
        ctx.lineWidth = 0.8 * n.scale;
        ctx.stroke();
      }
    }

    // Outer glow
    if (isSelected || isHovered || n.isCluster) {
      const glowR = r * (isSelected ? 4.5 : 3);
      const glowGrd = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, glowR);
      glowGrd.addColorStop(0, `rgba(${cr},${cg},${cb},${isSelected ? 0.55 : n.isCluster ? 0.22 : 0.35})`);
      glowGrd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = glowGrd;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cluster: ring + center dot + label
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
      ctx.globalAlpha = 0.7 * fog;
      const fs = Math.max(8, Math.round(9 * n.scale));
      ctx.font = `bold ${fs}px monospace`;
      const lbl = n.title.slice(0, 14);
      const tw = ctx.measureText(lbl).width;
      const lx = n.sx - tw / 2, ly = n.sy + r + 13 * n.scale;
      ctx.fillStyle = 'rgba(2,9,20,0.7)';
      ctx.fillRect(lx - 2, ly - fs + 1, tw + 4, fs + 3);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.textAlign = 'center';
      ctx.fillText(lbl, n.sx, ly + 2);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      continue;
    }

    // Note core
    ctx.beginPath();
    ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? '#ffffff'
      : `rgba(${cr},${cg},${cb},${isConnected ? 1 : 0.9})`;
    ctx.fill();

    // Selection rings
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

    // Labels with dark background box
    if (isSelected || isHovered) {
      const lbl = n.title.slice(0, 26);
      const fs = Math.max(9, Math.round(10 * n.scale));
      ctx.font = `${isSelected ? 'bold ' : ''}${fs}px monospace`;
      const tw = ctx.measureText(lbl).width;
      const lx = n.sx + r + 4, ly = n.sy;
      const pad = 3;
      ctx.globalAlpha = (isSelected ? 0.92 : 0.75) * fog;
      ctx.fillStyle = 'rgba(2,9,20,0.84)';
      ctx.fillRect(lx - pad, ly - fs * 0.72 - pad, tw + pad * 2, fs + pad * 2);
      ctx.fillStyle = isSelected ? '#ffffff' : '#e8e8e8';
      ctx.fillText(lbl, lx, ly + fs * 0.28);
    } else if (n.scale > 0.85 && r > 9) {
      const lbl = n.title.slice(0, 18);
      const fs = Math.round(8 * n.scale);
      ctx.font = `${fs}px monospace`;
      const tw = ctx.measureText(lbl).width;
      const lx = n.sx + r + 3, ly = n.sy;
      const pad = 2;
      ctx.globalAlpha = 0.28 * fog;
      ctx.fillStyle = 'rgba(2,9,20,0.72)';
      ctx.fillRect(lx - pad, ly - fs * 0.72 - pad, tw + pad * 2, fs + pad * 2);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillText(lbl, lx, ly + fs * 0.28);
    }

    ctx.globalAlpha = 1;
  }

  // ── Mini-map ──
  const MM_W = 142, MM_H = 102;
  const MM_X = W - MM_W - 10, MM_Y = H - MM_H - 28;
  ctx.globalAlpha = 0.68;
  ctx.fillStyle = 'rgba(2,9,20,0.9)';
  ctx.fillRect(MM_X, MM_Y, MM_W, MM_H);
  ctx.strokeStyle = 'rgba(34,211,238,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(MM_X, MM_Y, MM_W, MM_H);
  ctx.globalAlpha = 0.38;
  ctx.font = '7px monospace';
  ctx.fillStyle = '#64748b';
  ctx.fillText('MAP', MM_X + 5, MM_Y + 10);

  const mmNotes = nodes.filter(n => !n.isCluster);
  if (mmNotes.length) {
    const mmXs = mmNotes.map(n => n.x), mmYs = mmNotes.map(n => n.y);
    const mnX = Math.min(...mmXs), mxX = Math.max(...mmXs);
    const mnY = Math.min(...mmYs), mxY = Math.max(...mmYs);
    const mmSc = Math.min((MM_W - 20) / Math.max(mxX - mnX, 80), (MM_H - 20) / Math.max(mxY - mnY, 80));
    const mmCX = MM_X + MM_W / 2 - ((mnX + mxX) / 2) * mmSc;
    const mmCY = MM_Y + MM_H / 2 - ((mnY + mxY) / 2) * mmSc;
    for (const n of mmNotes) {
      const mx = mmCX + n.x * mmSc, my = mmCY + n.y * mmSc;
      if (mx < MM_X + 2 || mx > MM_X + MM_W - 2 || my < MM_Y + 2 || my > MM_Y + MM_H - 2) continue;
      const [cr, cg, cb] = hexToRgb(n.color);
      const mr = 1.2 + n.importance * 1.6;
      ctx.globalAlpha = n.id === s.selectedId ? 1 : 0.55;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fillStyle = n.id === s.selectedId ? '#ffffff' : `rgba(${cr},${cg},${cb},0.85)`;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // HUD
  ctx.globalAlpha = 0.32;
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
    trackTarget: null, lastSelectTime: 0,
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
    const animate = () => {
      s.animId = (window as any).requestAnimationFrame(animate);
      if (!s.isDragging) {
        if (s.trackTarget) {
          // Lerp camera rotation + zoom toward selected node
          s.rotX += (s.trackTarget.rotX - s.rotX) * 0.055;
          s.rotY += (s.trackTarget.rotY - s.rotY) * 0.055;
          if (s.trackTarget.zoom !== undefined) {
            s.zoom += (s.trackTarget.zoom - s.zoom) * 0.055;
          }
          if (
            Math.abs(s.trackTarget.rotX - s.rotX) < 0.005 &&
            Math.abs(s.trackTarget.rotY - s.rotY) < 0.005 &&
            (s.trackTarget.zoom === undefined || Math.abs(s.trackTarget.zoom - s.zoom) < 0.01)
          ) {
            s.trackTarget = null;
          }
        } else {
          // Auto-rotate, paused for 3s after selection
          if (Date.now() - s.lastSelectTime > 3000) {
            s.rotY += 0.0018;
          }
        }
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

  // Sync selectedNoteId + camera tracking
  useEffect(() => {
    const s = stateRef.current;
    s.selectedId = selectedNoteId;
    if (selectedNoteId) {
      s.lastSelectTime = Date.now();
      const node = s.nodeMap[selectedNoteId];
      if (node) {
        const targetRotY = Math.atan2(-node.x, node.z + 0.01);
        const dist2d = Math.sqrt(node.x * node.x + node.z * node.z);
        const targetRotX = Math.atan2(node.y, dist2d + 0.01);
        // Zoom-to-fit: nodes with many connections zoom out a bit; isolated nodes zoom in
        const neighborCount = links.filter(
          l => l.from === selectedNoteId || l.to === selectedNoteId,
        ).length;
        const targetZoom = neighborCount >= 6 ? 0.85 : neighborCount >= 3 ? 1.1 : 1.5;
        s.trackTarget = {
          rotX: Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, targetRotX)),
          rotY: targetRotY,
          zoom: targetZoom,
        };
      }
      s.connectedIds = new Set(
        links
          .filter(l => l.from === selectedNoteId || l.to === selectedNoteId)
          .flatMap(l => [l.from, l.to]),
      );
    } else {
      s.connectedIds = null;
      s.trackTarget = null;
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

function hashUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function DigitalBrainSystemFlowCanvas({
  map, selectedNodeId, accentColor, onSelectNode, height = 620,
}: {
  map: DigitalBrainSystemMap;
  selectedNodeId: string | null;
  accentColor: string;
  onSelectNode: (id: string) => void;
  height?: number;
}) {
  const containerRef = useRef<any>(null);
  const layoutRef = useRef<SystemSimNode[]>([]);
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const container = containerRef.current as HTMLElement | null;
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;
    canvas.style.display = 'block';
    canvas.style.cursor = 'grab';
    container.innerHTML = '';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clusterColors = new Map(map.clusters.map(c => [c.id, c.color]));
    const centers = new Map<string, { x: number; y: number; z: number }>();
    const byCluster = new Map<string, DigitalBrainSystemNode[]>();
    map.nodes.forEach((node) => {
      const list = byCluster.get(node.cluster) || [];
      list.push(node);
      byCluster.set(node.cluster, list);
    });

    let rotX = -0.34;
    let rotY = 0.58;
    let zoom = 1;
    let isDragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let hoverId: string | null = null;

    const clusterCenter = (clusterId: string, index: number, total: number) => {
      const fixed: Record<string, [number, number, number]> = {
        site:       [0,    -360, -110],
        chat:       [-400, -175,  180],
        models:     [-430,   90, -110],
        workflow:   [-330,  340,  110],
        brain:      [0,      30,  310],
        database:   [0,     370, -260],
        automation: [400,  -165,  180],
        security:   [430,   110,  -95],
        agents:     [340,   330,  140],
      };
      if (fixed[clusterId]) return { x: fixed[clusterId][0], y: fixed[clusterId][1], z: fixed[clusterId][2] };
      const angle = -Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
      return { x: Math.cos(angle) * 420, y: Math.sin(angle) * 300, z: Math.sin(angle * 1.7) * 220 };
    };

    const layout = () => {
      centers.clear();
      map.clusters.forEach((cluster, index) => {
        centers.set(cluster.id, clusterCenter(cluster.id, index, map.clusters.length));
      });
      const placed: SystemSimNode[] = [];
      for (const [clusterId, clusterNodes] of byCluster.entries()) {
        const center = centers.get(clusterId) || { x: 0, y: 0, z: 0 };
        const count = clusterNodes.length;
        clusterNodes.forEach((node, index) => {
          // Even distribution: combine hash-seeded offset with uniform angle step
          const baseAngle = hashUnit(node.id) * Math.PI * 0.4;
          const angle = baseAngle + (index / Math.max(1, count)) * Math.PI * 2;
          // Ring radius: much wider, scales with cluster size
          // Memory nodes form outer ring; database nodes mid; surface/agent inner
          const ring = node.type === 'memory'
            ? 55 + Math.sqrt(index) * 22          // was 26 + sqrt*9  → 2.5× wider
            : node.type === 'database'
              ? 42 + Math.sqrt(index) * 18
              : count === 1
                ? 18                               // single node: small offset instead of 0
                : 60 + Math.sqrt(index) * 26;      // was 34 + sqrt*12 → ~2× wider
          // Z wave: larger amplitude → real 3D depth variation per cluster
          const zAmp = node.type === 'memory' ? 90 : 130;
          const zWave = Math.sin(angle * 1.9 + index * 0.55) * zAmp;
          const base = node.type === 'memory' ? 4 : node.type === 'database' ? 9 : 10;
          placed.push({
            ...node,
            x: center.x + Math.cos(angle) * ring,
            y: center.y + Math.sin(angle) * ring,
            z: center.z + zWave,
            vx: 0,
            vy: 0,
            radius: base + Math.max(0.2, node.weight) * (node.type === 'memory' ? 5 : 9),
          });
        });
      }
      layoutRef.current = placed;
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout();
    };

    const nodeColor = (node: DigitalBrainSystemNode) => node.color || clusterColors.get(node.cluster) || accentColor;
    const project = (p: { x: number; y: number; z: number }) => {
      const W = canvas.clientWidth || 1;
      const H = height;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = p.x * cosY + p.z * sinY;
      const z1 = -p.x * sinY + p.z * cosY;
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = p.y * cosX - z1 * sinX;
      const z2 = p.y * sinX + z1 * cosX;
      const fov = 700;
      const scale = (fov / (fov + z2 + 520)) * zoom;
      return {
        sx: W / 2 + x1 * scale,
        sy: H / 2 + y2 * scale,
        scale,
        depth: z2,
      };
    };
    const flowColor = (kind: string) => {
      if (kind === 'credential') return '#f43f5e';
      if (kind === 'memory') return '#a855f7';
      if (kind === 'model') return '#84cc16';
      if (kind === 'write') return '#f59e0b';
      if (kind === 'sync') return '#22c55e';
      return '#38bdf8';
    };

    let requestId = 0;
    const draw = (time: number) => {
      const W = canvas.clientWidth || 1;
      const H = height;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#020711');
      bg.addColorStop(0.5, '#061322');
      bg.addColorStop(1, '#020711');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();

      for (const cluster of map.clusters) {
        const center = centers.get(cluster.id);
        if (!center) continue;
        const p = project(center);
        const count = byCluster.get(cluster.id)?.length || 0;
        const radius = Math.max(42, Math.min(130, 36 + Math.sqrt(count) * 16)) * p.scale;
        ctx.save();
        ctx.globalAlpha = 0.10 + Math.max(0.04, p.scale * 0.08);
        ctx.fillStyle = cluster.color;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, radius * 1.35, radius * 0.72, rotY * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = cluster.color;
        ctx.setLineDash([5, 8]);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '800 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(cluster.label.toUpperCase(), p.sx, p.sy - radius - 8);
      }

      const nodes = layoutRef.current;
      for (const node of nodes) {
        const p = project(node);
        node.sx = p.sx;
        node.sy = p.sy;
        node.scale = p.scale;
        node.depth = p.depth;
      }
      const nodeById = new Map(nodes.map(node => [node.id, node]));
      for (let i = 0; i < map.edges.length; i++) {
        const edge = map.edges[i];
        const a = nodeById.get(edge.from);
        const b = nodeById.get(edge.to);
        if (!a || !b || a.sx == null || b.sx == null || a.sy == null || b.sy == null) continue;
        const color = flowColor(edge.kind);
        const activeSelectedId = selectedRef.current;
        const selected = activeSelectedId && (edge.from === activeSelectedId || edge.to === activeSelectedId);
        const avgScale = ((a.scale || 1) + (b.scale || 1)) / 2;
        const mx = ((a.sx || 0) + (b.sx || 0)) / 2;
        const my = ((a.sy || 0) + (b.sy || 0)) / 2 - (32 * avgScale) * Math.sin(i);
        ctx.save();
        ctx.globalAlpha = selected ? 0.72 : 0.20 + edge.strength * 0.18;
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 2.4 : Math.max(0.7, edge.strength * 1.8 * avgScale);
        ctx.beginPath();
        ctx.moveTo(a.sx || 0, a.sy || 0);
        ctx.quadraticCurveTo(mx, my, b.sx || 0, b.sy || 0);
        ctx.stroke();
        ctx.restore();

        const particles = selected ? 3 : 1;
        for (let p = 0; p < particles; p++) {
          const phase = (time * (0.00008 + edge.strength * 0.00006) + i * 0.031 + p / particles) % 1;
          const x1 = (a.sx || 0) + (mx - (a.sx || 0)) * phase;
          const y1 = (a.sy || 0) + (my - (a.sy || 0)) * phase;
          const x2 = mx + ((b.sx || 0) - mx) * phase;
          const y2 = my + ((b.sy || 0) - my) * phase;
          const px = x1 + (x2 - x1) * phase;
          const py = y1 + (y2 - y1) * phase;
          ctx.save();
          ctx.globalAlpha = selected ? 0.95 : 0.68;
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = selected ? 18 : 10;
          ctx.beginPath();
          ctx.arc(px, py, selected ? 3.5 : 2.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // ── Icon silhouettes ────────────────────────────────────────────────────
      const traceNodeShape = (type: string, cx: number, cy: number, r: number) => {
        ctx.beginPath();
        if (type === 'surface') {
          // Monitor / screen: landscape rounded rect with notch stand
          const hw = r * 1.18, hh = r * 0.80, cr = r * 0.16;
          ctx.moveTo(cx - hw + cr, cy - hh);
          ctx.lineTo(cx + hw - cr, cy - hh);
          ctx.arcTo(cx + hw, cy - hh, cx + hw, cy - hh + cr, cr);
          ctx.lineTo(cx + hw, cy + hh - cr);
          ctx.arcTo(cx + hw, cy + hh, cx + hw - cr, cy + hh, cr);
          // Stand notch indent
          ctx.lineTo(cx + r * 0.30, cy + hh);
          ctx.lineTo(cx + r * 0.20, cy + hh + r * 0.28);
          ctx.lineTo(cx - r * 0.20, cy + hh + r * 0.28);
          ctx.lineTo(cx - r * 0.30, cy + hh);
          ctx.lineTo(cx - hw + cr, cy + hh);
          ctx.arcTo(cx - hw, cy + hh, cx - hw, cy + hh - cr, cr);
          ctx.lineTo(cx - hw, cy - hh + cr);
          ctx.arcTo(cx - hw, cy - hh, cx - hw + cr, cy - hh, cr);
          ctx.closePath();

        } else if (type === 'database') {
          // Cylinder side-view: straight body + curved caps
          const hw = r * 0.80, capH = r * 0.30;
          ctx.moveTo(cx - hw, cy - r + capH);
          ctx.bezierCurveTo(cx - hw, cy - r - capH * 0.6, cx + hw, cy - r - capH * 0.6, cx + hw, cy - r + capH);
          ctx.lineTo(cx + hw, cy + r - capH);
          ctx.bezierCurveTo(cx + hw, cy + r + capH * 0.6, cx - hw, cy + r + capH * 0.6, cx - hw, cy + r - capH);
          ctx.closePath();

        } else if (type === 'memory') {
          // Faceted gem: 8 points — elongated top/bottom, wider equator
          const pts = [
            [0, -r], [r*0.50, -r*0.42], [r*0.85, 0], [r*0.50, r*0.42],
            [0, r], [-r*0.50, r*0.42], [-r*0.85, 0], [-r*0.50, -r*0.42],
          ] as [number, number][];
          ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0], cy + pts[i][1]);
          ctx.closePath();

        } else if (type === 'model') {
          // Hexagon (flat-top) — clean AI/chip form factor
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          }
          ctx.closePath();

        } else if (type === 'automation') {
          // Gear: 8 teeth via alternating inner/outer radius
          const teeth = 8, outer = r, inner = r * 0.66;
          const notch = (Math.PI / teeth) * 0.40;
          for (let i = 0; i < teeth; i++) {
            const base = (i / teeth) * Math.PI * 2 - Math.PI / 2;
            const t1 = base - notch, t2 = base + notch;
            const t3 = base + Math.PI / teeth - notch, t4 = base + Math.PI / teeth + notch;
            if (i === 0) ctx.moveTo(cx + inner * Math.cos(t1), cy + inner * Math.sin(t1));
            else ctx.lineTo(cx + inner * Math.cos(t1), cy + inner * Math.sin(t1));
            ctx.lineTo(cx + outer * Math.cos(t2), cy + outer * Math.sin(t2));
            ctx.lineTo(cx + outer * Math.cos(t3), cy + outer * Math.sin(t3));
            ctx.lineTo(cx + inner * Math.cos(t4), cy + inner * Math.sin(t4));
          }
          ctx.closePath();

        } else if (type === 'security') {
          // Shield: curved shoulder, tapers to sharp bottom point
          const sw = r * 0.88, sh = r * 0.82;
          ctx.moveTo(cx, cy + r);
          ctx.bezierCurveTo(cx - sw * 0.55, cy + sh * 0.38, cx - sw, cy - sh * 0.08, cx - sw, cy - sh * 0.52);
          ctx.bezierCurveTo(cx - sw, cy - r, cx - sw * 0.35, cy - r, cx, cy - r);
          ctx.bezierCurveTo(cx + sw * 0.35, cy - r, cx + sw, cy - r, cx + sw, cy - sh * 0.52);
          ctx.bezierCurveTo(cx + sw, cy - sh * 0.08, cx + sw * 0.55, cy + sh * 0.38, cx, cy + r);
          ctx.closePath();

        } else if (type === 'agent') {
          // Lightning bolt: sharp Z-path — suggests speed and autonomy
          ctx.moveTo(cx + r * 0.24, cy - r);
          ctx.lineTo(cx - r * 0.36, cy - r * 0.06);
          ctx.lineTo(cx + r * 0.12, cy - r * 0.06);
          ctx.lineTo(cx - r * 0.24, cy + r);
          ctx.lineTo(cx + r * 0.36, cy + r * 0.06);
          ctx.lineTo(cx - r * 0.12, cy + r * 0.06);
          ctx.closePath();

        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
      };

      // ── Inner icon details drawn on top of sphere shading ───────────────────
      const drawNodeIcon = (type: string, cx: number, cy: number, r: number, selected: boolean) => {
        const a = selected ? 0.80 : 0.52;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(0.7, r * 0.07);

        if (type === 'surface') {
          // Title bar + 3 buttons + 2 content lines
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.88, cy - r * 0.28);
          ctx.lineTo(cx + r * 0.88, cy - r * 0.28);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
          [-0.58, -0.38, -0.18].forEach(dx => {
            ctx.beginPath();
            ctx.arc(cx + dx * r, cy - r * 0.52, r * 0.075, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.55})`;
          ctx.lineWidth = Math.max(0.5, r * 0.055);
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.70, cy - r * 0.04);
          ctx.lineTo(cx + r * 0.70, cy - r * 0.04);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.70, cy + r * 0.22);
          ctx.lineTo(cx + r * 0.30, cy + r * 0.22);
          ctx.stroke();

        } else if (type === 'database') {
          // 2 horizontal dividers + curved top ellipse suggestion
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.75, cy - r * 0.30);
          ctx.lineTo(cx + r * 0.75, cy - r * 0.30);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.75, cy + r * 0.30);
          ctx.lineTo(cx + r * 0.75, cy + r * 0.30);
          ctx.stroke();
          // Top ellipse arc
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
          ctx.beginPath();
          ctx.ellipse(cx, cy - r * 0.68, r * 0.62, r * 0.20, 0, 0, Math.PI * 2);
          ctx.stroke();

        } else if (type === 'memory') {
          // Facet web: center to each vertex + equator cross
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.72})`;
          ctx.lineWidth = Math.max(0.5, r * 0.055);
          [[0,-r*0.75],[r*0.62,0],[0,r*0.75],[-r*0.62,0]].forEach(([tx, ty]) => {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + tx, cy + ty);
            ctx.stroke();
          });
          // Horizontal equator
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.45})`;
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.78, cy);
          ctx.lineTo(cx + r * 0.78, cy);
          ctx.stroke();

        } else if (type === 'model') {
          // Neural net: lines from center to each vertex + vertex dots + center
          ctx.lineWidth = Math.max(0.5, r * 0.055);
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2 - Math.PI / 2;
            ctx.strokeStyle = `rgba(255,255,255,${a * (i % 2 === 0 ? 0.80 : 0.45)})`;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + r * 0.80 * Math.cos(ang), cy + r * 0.80 * Math.sin(ang));
            ctx.stroke();
            ctx.fillStyle = `rgba(255,255,255,${a * 0.90})`;
            ctx.beginPath();
            ctx.arc(cx + r * 0.72 * Math.cos(ang), cy + r * 0.72 * Math.sin(ang), r * 0.085, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
          ctx.fill();

        } else if (type === 'automation') {
          // Gear center hole + inner ring
          ctx.fillStyle = 'rgba(0,0,0,0.60)';
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.65})`;
          ctx.lineWidth = Math.max(0.5, r * 0.055);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.44, 0, Math.PI * 2);
          ctx.stroke();

        } else if (type === 'security') {
          // Lock arc + keyhole
          const lcy = cy - r * 0.10;
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.lineWidth = Math.max(0.8, r * 0.08);
          ctx.beginPath();
          ctx.arc(cx, lcy - r * 0.14, r * 0.24, Math.PI, 0);
          ctx.stroke();
          // Lock body
          ctx.fillStyle = `rgba(255,255,255,${a * 0.80})`;
          ctx.beginPath();
          const lbw = r * 0.36, lbh = r * 0.30;
          if ((ctx as any).roundRect) {
            (ctx as any).roundRect(cx - lbw, lcy, lbw * 2, lbh, r * 0.08);
          } else {
            ctx.rect(cx - lbw, lcy, lbw * 2, lbh);
          }
          ctx.fill();
          // Keyhole dot
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath();
          ctx.arc(cx, lcy + r * 0.10, r * 0.08, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.07, lcy + r * 0.14);
          ctx.lineTo(cx - r * 0.07, lcy + lbh - r * 0.07);
          ctx.lineTo(cx + r * 0.07, lcy + lbh - r * 0.07);
          ctx.lineTo(cx + r * 0.07, lcy + r * 0.14);
          ctx.fill();

        } else if (type === 'agent') {
          // Lightning bolt needs no inner overlay — shape is the icon
          // Add subtle center highlight stripe
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.55})`;
          ctx.lineWidth = Math.max(0.5, r * 0.06);
          ctx.beginPath();
          ctx.moveTo(cx + r * 0.06, cy - r * 0.50);
          ctx.lineTo(cx - r * 0.06, cy + r * 0.50);
          ctx.stroke();
        }

        ctx.restore();
      };

      const sortedNodes = nodes.slice().sort((a, b) => (a.depth || 0) - (b.depth || 0));
      for (const node of sortedNodes) {
        if (node.sx == null || node.sy == null) continue;
        const color = nodeColor(node);
        const activeSelectedId = selectedRef.current;
        const selected = node.id === activeSelectedId;
        const hovered = node.id === hoverId;
        const scale = node.scale || 1;
        const r = (selected ? node.radius + 5 : hovered ? node.radius + 3 : node.radius) * scale;
        ctx.save();
        ctx.globalAlpha = node.type === 'memory' && !selected ? 0.62 + Math.min(0.26, scale * 0.18) : 1;
        ctx.shadowColor = color;
        ctx.shadowBlur = selected ? 38 : hovered ? 26 : node.type === 'memory' ? 9 : 16;
        // base fill
        ctx.fillStyle = color;
        traceNodeShape(node.type, node.sx, node.sy, r);
        ctx.fill();
        ctx.shadowBlur = 0;
        // sphere highlight overlay — white radial at top-left
        const hl = ctx.createRadialGradient(
          node.sx - r * 0.32, node.sy - r * 0.34, r * 0.04,
          node.sx - r * 0.22, node.sy - r * 0.22, r * 0.92,
        );
        hl.addColorStop(0, 'rgba(255,255,255,0.58)');
        hl.addColorStop(0.42, 'rgba(255,255,255,0.12)');
        hl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = hl;
        traceNodeShape(node.type, node.sx, node.sy, r);
        ctx.fill();
        // dark rim at bottom-right
        const rim = ctx.createRadialGradient(
          node.sx + r * 0.26, node.sy + r * 0.28, r * 0.05,
          node.sx, node.sy, r * 1.08,
        );
        rim.addColorStop(0, 'rgba(0,0,0,0)');
        rim.addColorStop(0.55, 'rgba(0,0,0,0)');
        rim.addColorStop(1, 'rgba(0,0,0,0.52)');
        ctx.fillStyle = rim;
        traceNodeShape(node.type, node.sx, node.sy, r);
        ctx.fill();
        // inner icon details on top of shading
        if (r >= 6) drawNodeIcon(node.type, node.sx, node.sy, r, selected);
        // outline
        ctx.strokeStyle = selected ? '#ffffff' : hovered ? color : '#020711';
        ctx.lineWidth = selected ? 2.2 : hovered ? 1.4 : 0.9;
        traceNodeShape(node.type, node.sx, node.sy, r);
        ctx.stroke();
        // label
        if (selected || hovered || node.type !== 'memory' || map.stats.memories <= 18) {
          ctx.fillStyle = selected ? '#ffffff' : '#dbeafe';
          ctx.font = `${selected ? '900' : '800'} ${selected ? 12 : 10}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label.slice(0, selected ? 34 : 22), node.sx, node.sy + r + 15);
        }
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('3D SYSTEM FLOW · drag to orbit · scroll to zoom · click nodes', 12, H - 14);
      ctx.restore();

      requestId = requestAnimationFrame(draw);
    };

    const hitTest = (x: number, y: number) => {
      let best: SystemSimNode | null = null;
      let bestDist = Infinity;
      for (const node of layoutRef.current) {
        if (node.sx == null || node.sy == null) continue;
        const r = Math.max(14, node.radius * (node.scale || 1) + 8);
        const d = Math.hypot(node.sx - x, node.sy - y);
        if (d < bestDist && d <= r) {
          best = node;
          bestDist = d;
        }
      }
      return best;
    };

    const getXY = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e: MouseEvent) => {
      const p = getXY(e);
      isDragging = true;
      moved = false;
      lastX = p.x;
      lastY = p.y;
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      const p = getXY(e);
      if (isDragging) {
        const dx = p.x - lastX;
        const dy = p.y - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        rotY += dx * 0.0065;
        rotX += dy * 0.0055;
        rotX = Math.max(-1.25, Math.min(1.25, rotX));
        lastX = p.x;
        lastY = p.y;
      } else {
        const hit = hitTest(p.x, p.y);
        hoverId = hit?.id || null;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const p = getXY(e);
      if (!moved) {
        const hit = hitTest(p.x, p.y);
        if (hit) onSelectNode(hit.id);
      }
      isDragging = false;
      canvas.style.cursor = hoverId ? 'pointer' : 'grab';
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom *= e.deltaY > 0 ? 0.92 : 1.08;
      zoom = Math.max(0.45, Math.min(2.8, zoom));
    };

    const handleDoubleClick = () => {
      rotX = -0.34;
      rotY = 0.58;
      zoom = 1;
    };

    const handleMouseLeave = () => {
      isDragging = false;
      hoverId = null;
      canvas.style.cursor = 'grab';
    };

    resize();
    requestId = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dblclick', handleDoubleClick);
    return () => {
      cancelAnimationFrame(requestId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      canvas.remove();
    };
  }, [accentColor, height, map, onSelectNode]);

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
  const [brainMode, setBrainMode] = useState<'mine' | 'circle'>('mine');
  const [mapping, setMapping] = useState(false);
  const [mapStatus, setMapStatus] = useState('');
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
  const [viewMode, setViewMode] = useState<ViewMode>('system');
  const [activeBaseViewId, setActiveBaseViewId] = useState('all-active');
  const [otherCircles, setOtherCircles] = useState<OtherCircle[]>([]);
  const [otherCircleId, setOtherCircleId] = useState<string | null>(null);
  const [otherGraph, setOtherGraph] = useState<SecondBrainGraph | null>(null);
  const [otherLoading, setOtherLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [dbStats, setDbStats] = useState<Record<string, DigitalBrainDbStat>>({});
  const [systemNodeId, setSystemNodeId] = useState<string | null>(null);
  const [knowledgeSeeding, setKnowledgeSeeding] = useState(false);
  const memorySyncRef = useRef('');
  const autoMapFiredRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const graphOpts = brainMode === 'mine' ? { userId, mode: 'mine' as const } : { mode: 'circle' as const };
    const [graphResult, memoryResult] = await Promise.all([
      buildSecondBrainGraph(circleId, graphOpts),
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
  }, [circleId, userId, brainMode]);

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
    const result = await buildSecondBrainGraph(id, { mode: 'circle' });
    setOtherGraph(result.graph);
    setOtherLoading(false);
  };

  const loadDbStats = useCallback(async () => {
    const entries = await Promise.all(DIGITAL_BRAIN_DB_TABLES.map(async (cfg) => {
      if ((cfg.filter === 'user' || cfg.filter === 'owner') && !userId) {
        return [cfg.table, { table: cfg.table, label: cfg.label, count: null, ok: false, error: 'No user session' }] as const;
      }
      try {
        let query = (supabase as any)
          .from(cfg.table)
          .select('id', { count: 'exact', head: true });
        if (cfg.filter === 'circle') query = query.eq('circle_id', circleId);
        if (cfg.filter === 'id') query = query.eq('id', circleId);
        if (cfg.filter === 'user') query = query.eq('user_id', userId);
        if (cfg.filter === 'owner') query = query.eq('owner_id', userId);
        const { count, error } = await query;
        return [cfg.table, {
          table: cfg.table,
          label: cfg.label,
          count: typeof count === 'number' ? count : null,
          ok: !error,
          error: error?.message,
        }] as const;
      } catch (err: any) {
        return [cfg.table, {
          table: cfg.table,
          label: cfg.label,
          count: null,
          ok: false,
          error: err?.message || 'Count failed',
        }] as const;
      }
    }));
    setDbStats(Object.fromEntries(entries));
  }, [circleId, userId]);

  useEffect(() => {
    if (viewMode === 'system') void loadDbStats();
  }, [viewMode, loadDbStats]);

  useEffect(() => {
    if (loading || autoMapFiredRef.current || brainMode !== 'mine' || !userId || Platform.OS !== 'web') return;
    const siteMapCount = notes.filter(n => (n.metadata as any)?.siteMapKey).length;
    if (siteMapCount < 5) {
      autoMapFiredRef.current = true;
      autoMapSiteToSecondBrain(circleId, userId, () => {}).then(result => {
        if (!result.error && result.created > 0) load();
      });
    }
  }, [loading, brainMode, userId, notes, circleId, load]);

  const processBrainFiles = useCallback(async (files: File[]) => {
    if (Platform.OS !== 'web') return;
    if (!userId) { setStatus('Sign in to upload files.'); return; }
    if (!files.length) return;

    setUploadStatus(`Processing ${files.length} file(s)...`);
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
          visibility: brainMode === 'circle' ? 'circle_shared' : 'private',
          metadata: {
            source: 'file_upload',
            filename: file.name,
            fileExt: ext,
            reviewDueAt: new Date().toISOString(),
            reviewIntervalDays: 1,
          },
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
  }, [brainMode, userId, circleId, load]);

  const handleFileUpload = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    if (!userId) { setStatus('Sign in to upload files.'); return; }

    const input = (document as any).createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,.json,.csv';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files: File[] = Array.from(e.target.files || []);
      await processBrainFiles(files);
    };
    (document as any).body.appendChild(input);
    input.click();
    (document as any).body.removeChild(input);
  }, [userId, processBrainFiles]);

  const handleDropUpload = useCallback(async (e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault();
    const files: File[] = Array.from(e.dataTransfer?.files || []);
    await processBrainFiles(files);
  }, [processBrainFiles]);

  const baseViews = useMemo(() => buildSecondBrainBaseViews(notes), [notes]);
  const activeBaseView = useMemo<SecondBrainBaseView | null>(
    () => baseViews.find(view => view.id === activeBaseViewId) || baseViews[0] || null,
    [baseViews, activeBaseViewId],
  );
  const activeBaseNoteIds = useMemo(
    () => new Set(activeBaseView?.noteIds || []),
    [activeBaseView],
  );
  const reviewQueue = useMemo<ReviewQueueItem[]>(() => notes
    .filter(note => note.status !== 'archived')
    .map(note => ({ note, state: getSecondBrainReviewState(note) }))
    .filter(item => item.state.urgency === 'due' || item.state.urgency === 'soon')
    .sort((a, b) => b.state.priorityScore - a.state.priorityScore)
    .slice(0, 14), [notes]);
  const agentBrief = useMemo(
    () => buildSecondBrainAgentBrief(notes, memories),
    [notes, memories],
  );
  const systemMap = useMemo<DigitalBrainSystemMap>(
    () => buildDigitalBrainSystemMap({ notes, memories, dbStats }),
    [notes, memories, dbStats],
  );
  const selectedSystemNode = useMemo(
    () => systemMap.nodes.find(node => node.id === systemNodeId) || systemMap.nodes.find(node => node.id === 'backpack-brain') || null,
    [systemMap.nodes, systemNodeId],
  );
  const linkedMemoryIds = useMemo(
    () => new Set(notes.map(note => note.source_memory_id).filter(Boolean) as string[]),
    [notes],
  );
  const missingMemories = useMemo(
    () => memories.filter(mem => !linkedMemoryIds.has(mem.id)),
    [linkedMemoryIds, memories],
  );
  const memoriesByAgent = useMemo(() => {
    const groups = new Map<string, typeof memories>();
    for (const mem of memories) {
      const key = mem.source_surface || mem.scope || 'general';
      const list = groups.get(key) || [];
      list.push(mem);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [memories]);

  const visibleNotes = useMemo(() => {
    const scoped = activeBaseViewId === 'all-active'
      ? notes
      : notes.filter(n => activeBaseNoteIds.has(n.id));
    const source = filter === 'active'
      ? scoped.filter(n => n.status !== 'archived')
      : scoped.filter(n => n.status === filter);
    return source.slice().sort((a, b) => {
      const r = (b.importance || 0) - (a.importance || 0);
      return r !== 0 ? r : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [activeBaseNoteIds, activeBaseViewId, filter, notes]);

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
  const privateCount = notes.filter(n => n.visibility === 'private').length;
  const reviewDueCount = reviewQueue.length;
  const allGraphLinkCount = graph?.links.length || graphLinks.length;

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
      visibility: brainMode === 'circle' ? 'circle_shared' : 'private',
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
    const result = await createSecondBrainNoteFromMemory(
      mem,
      userId,
      circleId,
      brainMode === 'circle' ? undefined : 'private',
    );
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

  const handleSyncAllMemories = useCallback(async (silent = false) => {
    if (!userId) {
      if (!silent) setStatus('Sign in before syncing memories.');
      return;
    }
    const toSync = memories.filter(mem => !linkedMemoryIds.has(mem.id));
    if (!toSync.length) {
      if (!silent) setStatus('All loaded memories are already present in your Digital Brain.');
      return;
    }
    setSaving(true);
    if (!silent) setStatus(`Syncing ${toSync.length} memories into your Digital Brain...`);
    let synced = 0;
    let skipped = 0;
    for (const mem of toSync) {
      const result = await createSecondBrainNoteFromMemory(mem, userId, circleId, 'private');
      if (result.note) synced++;
      else skipped++;
    }
    setSaving(false);
    setStatus(skipped
      ? `Synced ${synced} memories into your Digital Brain. ${skipped} could not be attached to this circle.`
      : `Synced ${synced} memories into your Digital Brain.`);
    await load();
  }, [circleId, linkedMemoryIds, load, memories, userId]);

  useEffect(() => {
    if (viewMode !== 'system' || !userId || missingMemories.length === 0) return;
    const key = `${circleId}:${userId}:${missingMemories.map(mem => mem.id).sort().join('|')}`;
    if (memorySyncRef.current === key) return;
    memorySyncRef.current = key;
    void handleSyncAllMemories(true);
  }, [circleId, handleSyncAllMemories, missingMemories, userId, viewMode]);

  const handleShare = async (note: SecondBrainNote, visibility: SecondBrainVisibility) => {
    setSaving(true);
    const result = await shareSecondBrainNote(note.id, visibility);
    setSaving(false);
    if (result.note) {
      setStatus(visibility === 'private'
        ? `"${note.title}" is now private.`
        : `"${note.title}" shared with the circle.`);
      await load();
    } else {
      setStatus(result.error || 'Could not update visibility.');
    }
  };

  const handleReviewAction = async (note: SecondBrainNote, action: 'reviewed' | 'snoozed' | 'evergreen') => {
    setSaving(true);
    const result = await reviewSecondBrainNote(note, action);
    setSaving(false);
    if (result.note) {
      setStatus(action === 'snoozed'
        ? `Snoozed "${note.title}" for review.`
        : `Reviewed "${note.title}" and scheduled the next resurfacing.`);
      await load();
    } else {
      setStatus(result.error || 'Could not update review schedule.');
    }
  };

  const handleCopyAgentBrief = async () => {
    if (Platform.OS !== 'web') {
      setStatus('Agent brief copy is available in the web app.');
      return;
    }
    try {
      await (globalThis as any).navigator?.clipboard?.writeText(agentBrief);
      setStatus('Agent-ready Digital Brain brief copied.');
    } catch {
      setStatus('Could not copy the agent brief from this browser.');
    }
  };

  const handleSaveAgentBrief = async () => {
    if (!userId) { setStatus('Sign in before saving the agent brief.'); return; }
    setSaving(true);
    const result = await createSecondBrainNote({
      circleId,
      userId,
      title: `.web Digital Brain brief - ${new Date().toLocaleDateString()}`,
      content: agentBrief,
      noteKind: 'agent_summary',
      status: 'processed',
      visibility: brainMode === 'circle' ? 'circle_shared' : 'private',
      tags: ['agent-brief', 'digital-brain', 'openswan'],
      importance: 0.82,
      metadata: {
        source: 'digital_brain_agent_brief',
        generatedAt: new Date().toISOString(),
        reviewDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        reviewIntervalDays: 7,
      },
    });
    setSaving(false);
    if (result.note) {
      setSelectedNoteId(result.note.id);
      setStatus('Saved an agent-ready brief back into the Digital Brain.');
      await load();
    } else {
      setStatus(result.error || 'Could not save the agent brief.');
    }
  };

  const handleMapSite = async () => {
    if (!userId) { setStatus('Sign in before mapping the site.'); return; }
    if (mapping) return;
    setMapping(true);
    setMapStatus('Starting site map…');
    const result = await autoMapSiteToSecondBrain(
      circleId,
      userId,
      (msg, _pct) => setMapStatus(msg),
    );
    setMapping(false);
    if (result.error) {
      setMapStatus(`Map error: ${result.error}`);
    } else {
      setMapStatus(`Mapped: +${result.created} new, ${result.updated} refreshed, ${result.linked} links`);
      await load();
    }
    setTimeout(() => setMapStatus(''), 4000);
  };

  const handleSeedKnowledge = async () => {
    if (!userId) { setStatus('Sign in before running Digital Brain knowledge intake.'); return; }
    if (knowledgeSeeding) return;
    setKnowledgeSeeding(true);
    setMapStatus('Running Wiki + .web knowledge intake...');
    const result = await runSecondBrainKnowledgeProfile({
      profileKeys: SECOND_BRAIN_KNOWLEDGE_PROFILE_OPTIONS.map(profile => profile.key),
      circleId,
      userId,
      visibility: brainMode === 'circle' ? 'circle_shared' : 'private',
    });
    setKnowledgeSeeding(false);
    if (!result.ok) {
      setMapStatus(`Knowledge intake failed: ${result.error || 'unknown error'}`);
      setTimeout(() => setMapStatus(''), 5000);
      return;
    }
    setMapStatus('Knowledge intake complete. Wiki and Digital Brain were refreshed.');
    await load();
    setTimeout(() => setMapStatus(''), 4500);
  };

  const resultNotes = (searchResults || []).filter(i => i.kind === 'note');
  const resultMemories = (searchResults || []).filter(i => i.kind === 'memory');
  const webDropHandlers = Platform.OS === 'web'
    ? ({
      onDrop: handleDropUpload,
      onDragOver: (e: any) => e.preventDefault(),
    } as any)
    : {};

  return (
    <View style={styles.shell}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dotWebMark, { borderColor: accentColor }]}>
            <Text style={[styles.dotWebText, { color: accentColor }]}>.web</Text>
          </View>
          <View>
            <Text style={styles.heroEyebrow}>
              {brainMode === 'mine' ? 'MY DIGITAL BRAIN' : 'CIRCLE SHARED BRAIN'}
            </Text>
            <Text style={styles.heroTitle}>Digital Brain Graph</Text>
          </View>
          <View style={styles.brainModeToggle}>
            <Pressable
              onPress={() => setBrainMode('mine')}
              style={[
                styles.modeBtn,
                brainMode === 'mine' ? { borderColor: accentColor, backgroundColor: `${accentColor}15` } : null,
              ]}
            >
              <Text style={[styles.modeBtnText, brainMode === 'mine' ? { color: accentColor } : null]}>
                MY BRAIN
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setBrainMode('circle')}
              style={[
                styles.modeBtn,
                brainMode === 'circle' ? { borderColor: '#a855f7', backgroundColor: '#a855f715' } : null,
              ]}
            >
              <Text style={[styles.modeBtnText, brainMode === 'circle' ? { color: '#a855f7' } : null]}>
                CIRCLE
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.heroActions}>
          <Pressable
            onPress={load}
            style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
          >
            <Text style={styles.ghostBtnText}>REFRESH</Text>
          </Pressable>
          {brainMode === 'mine' && (
            <Pressable
              onPress={handleMapSite}
              disabled={mapping}
              style={({ hovered, pressed }: any) => [
                styles.ghostBtn,
                { borderColor: '#22d3ee55', backgroundColor: mapping ? '#22d3ee08' : undefined },
                hovered && !mapping && webLift,
                pressed && webPressed,
              ]}
            >
              <Text style={[styles.ghostBtnText, { color: '#22d3ee' }]}>
                {mapping ? 'MAPPING…' : 'MAP SITE'}
              </Text>
            </Pressable>
          )}
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
        <BrainStat label="Private" value={String(privateCount)} color="#f59e0b" />
        <BrainStat label="Clusters" value={String(graph?.clusters.length || 0)} color="#22c55e" />
        <BrainStat label="Edges" value={String(allGraphLinkCount)} color="#a855f7" />
        <BrainStat label="Review" value={String(reviewDueCount)} color="#f59e0b" />
        <BrainStat label=".web" value={String(webCount)} color="#38bdf8" />
        <BrainStat label="Memory" value={String(linkedMemoryCount)} color="#a855f7" />
        <BrainStat label="Inbox" value={String(inboxCount)} color="#f59e0b" />
        <BrainStat label="Evergreen" value={String(evergreenCount)} color="#22c55e" />
      </View>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {([
          { key: 'system', label: 'SYSTEM FLOW' },
          { key: 'graph', label: 'GRAPH' },
          { key: 'nodes', label: 'BASES' },
          { key: 'review', label: 'REVIEW' },
          ...(Platform.OS === 'web' ? [{ key: 'upload', label: 'UPLOAD' }] : []),
          { key: 'other', label: 'OTHER BRAINS' },
        ] as { key: ViewMode; label: string }[]).map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (tab.key === 'system') setBrainMode('mine');
              setViewMode(tab.key);
            }}
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
      {(mapStatus || status || uploadStatus) ? (
        <View style={[styles.statusBar, mapStatus ? { borderColor: '#22d3ee33', backgroundColor: '#22d3ee0a' } : null]}>
          <Text style={[styles.statusText, mapStatus ? { color: '#22d3ee' } : null]}>
            {mapStatus || uploadStatus || status}
          </Text>
        </View>
      ) : null}

      {/* ── SYSTEM FLOW VIEW ───────────────────────────────────────────── */}
      {viewMode === 'system' && (
        <View style={styles.systemFlowPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelLabel}>MY PRIVATE SYSTEM FLOW MAP</Text>
              <Text style={styles.panelHint}>
                3D map of site surfaces, database tables, memories, credentials, model routing, agent runs, and information movement.
              </Text>
            </View>
            <View style={styles.heroActions}>
              <Pressable
                onPress={handleMapSite}
                disabled={mapping}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && !mapping && webLift, pressed && webPressed]}
              >
                <Text style={[styles.ghostBtnText, { color: '#22d3ee' }]}>{mapping ? 'MAPPING' : 'MAP SITE'}</Text>
              </Pressable>
              <Pressable
                onPress={() => handleSyncAllMemories(false)}
                disabled={saving || !missingMemories.length}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && !saving && webLift, pressed && webPressed]}
              >
                <Text style={[styles.ghostBtnText, { color: missingMemories.length ? '#a855f7' : PIXEL_COLORS.text3 }]}>
                  {missingMemories.length ? `SYNC ${missingMemories.length} MEMORIES` : 'MEMORIES SYNCED'}
                </Text>
              </Pressable>
              <Pressable
                onPress={loadDbStats}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
              >
                <Text style={styles.ghostBtnText}>DB COUNTS</Text>
              </Pressable>
              <Pressable
                onPress={handleSeedKnowledge}
                disabled={knowledgeSeeding}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && !knowledgeSeeding && webLift, pressed && webPressed]}
              >
                <Text style={[styles.ghostBtnText, { color: '#22c55e' }]}>
                  {knowledgeSeeding ? 'LEARNING...' : 'LEARN'}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.knowledgeIntakeRail}>
            {SECOND_BRAIN_KNOWLEDGE_PROFILE_OPTIONS.map(profile => (
              <View key={profile.key} style={[styles.knowledgeProfileCard, { borderColor: `${profile.color}44`, backgroundColor: `${profile.color}10` }]}>
                <Text style={[styles.cardTitle, { color: profile.color }]}>{profile.label}</Text>
                <Text style={styles.cardMeta}>{profile.cadence.toUpperCase()} INTAKE</Text>
                <Text style={styles.cardBody}>{profile.description}</Text>
              </View>
            ))}
          </View>

          <View style={styles.systemStatStrip}>
            <BrainStat label="Surfaces" value={String(systemMap.stats.appSurfaces)} color="#22d3ee" />
            <BrainStat label="DB tables" value={String(systemMap.stats.databaseTables)} color="#64748b" />
            <BrainStat label="Memories" value={String(systemMap.stats.memories)} color="#a855f7" />
            <BrainStat label="Synced" value={String(systemMap.stats.syncedMemories)} color="#22c55e" />
            <BrainStat label="Flows" value={String(systemMap.edges.length)} color="#f59e0b" />
            <BrainStat label="Clusters" value={String(systemMap.clusters.length)} color="#38bdf8" />
          </View>

          <View style={styles.systemCanvasShell}>
            {Platform.OS === 'web' ? (
              <DigitalBrainSystemFlowCanvas
                map={systemMap}
                selectedNodeId={selectedSystemNode?.id || null}
                accentColor={accentColor}
                onSelectNode={setSystemNodeId}
                height={640}
              />
            ) : (
              <View style={[styles.graphArea, { minHeight: 260, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.emptyText}>The animated 3D system-flow map is available in the web app.</Text>
              </View>
            )}
          </View>

          <View style={styles.systemDetailGrid}>
            <View style={styles.systemDetailCard}>
              <Text style={styles.columnTitle}>SELECTED NODE</Text>
              {selectedSystemNode ? (
                <>
                  <View style={styles.nodeDetailHeader}>
                    <View style={[styles.kindBadge, { borderColor: selectedSystemNode.color || accentColor }]}>
                      <Text style={[styles.kindBadgeText, { color: selectedSystemNode.color || accentColor }]}>
                        {selectedSystemNode.type.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.cardMeta}>{selectedSystemNode.cluster} · weight {Math.round(selectedSystemNode.weight * 100)}%</Text>
                  </View>
                  <Text style={styles.cardTitle}>{selectedSystemNode.label}</Text>
                  <Text style={styles.sourceUrl}>{selectedSystemNode.subtitle}</Text>
                  <Text style={styles.cardBody}>
                    {summarizeSecondBrainContent(selectedSystemNode.description, 420)}
                  </Text>
                  {Array.isArray(selectedSystemNode.metadata?.tables) ? (
                    <View style={styles.tagRow}>
                      {(selectedSystemNode.metadata?.tables as string[]).map(table => (
                        <Text key={table} style={styles.tag}>{table}</Text>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.emptyText}>Click a node in the map to inspect what it does and where information flows.</Text>
              )}
            </View>

            <View style={styles.systemDetailCard}>
              <Text style={styles.columnTitle}>CLUSTERS</Text>
              <ScrollView style={styles.systemList} nestedScrollEnabled>
                {systemMap.clusters.map(cluster => (
                  <Pressable
                    key={cluster.id}
                    onPress={() => setSystemNodeId(cluster.nodeIds[0] || null)}
                    style={({ hovered, pressed }: any) => [styles.clusterRow, hovered && webLift, pressed && webPressed]}
                  >
                    <View style={[styles.clusterDot, { backgroundColor: cluster.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{cluster.label}</Text>
                      <Text style={styles.cardMeta}>{cluster.nodeIds.length} nodes</Text>
                      <Text style={styles.cardBody}>{summarizeSecondBrainContent(cluster.description, 120)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={styles.systemDetailCard}>
              <Text style={styles.columnTitle}>DATABASE COVERAGE</Text>
              <ScrollView style={styles.systemList} nestedScrollEnabled>
                {DIGITAL_BRAIN_DB_TABLES.map(cfg => {
                  const stat = dbStats[cfg.table];
                  return (
                    <View key={cfg.table} style={styles.dbRow}>
                      <View style={styles.dbRowHeader}>
                        <Text style={styles.cardTitle}>{cfg.label}</Text>
                        <Text style={[styles.cardMeta, { color: stat?.ok ? '#22c55e' : '#f59e0b' }]}>
                          {stat?.ok ? `${stat.count ?? 0}` : 'pending'}
                        </Text>
                      </View>
                      <Text style={styles.sourceUrl}>{cfg.table}</Text>
                      <Text style={styles.cardBody}>{summarizeSecondBrainContent(cfg.description, 120)}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.systemDetailCard}>
              <Text style={styles.columnTitle}>MEMORY COVERAGE</Text>
              <Text style={styles.panelHint}>
                {systemMap.stats.syncedMemories}/{systemMap.stats.memories} loaded memories are linked as Digital Brain notes.
              </Text>
              <ScrollView style={styles.systemList} nestedScrollEnabled>
                {memories.map(mem => {
                  const synced = linkedMemoryIds.has(mem.id);
                  return (
                    <Pressable
                      key={mem.id}
                      onPress={() => setSystemNodeId(`memory-${mem.id}`)}
                      style={({ hovered, pressed }: any) => [styles.memoryCoverageRow, hovered && webLift, pressed && webPressed]}
                    >
                      <View style={[styles.clusterDot, { backgroundColor: synced ? '#22c55e' : '#a855f7' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{mem.title}</Text>
                        <Text style={styles.cardMeta}>{mem.scope}/{mem.memory_kind} · {synced ? 'synced' : 'live node'}</Text>
                        <Text style={styles.cardBody}>{summarizeSecondBrainContent(mem.content, 110)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {!memories.length ? <Text style={styles.emptyText}>No memories loaded yet.</Text> : null}
              </ScrollView>
            </View>
          </View>

          {/* ── Agent memories breakdown ──────────────────────────────── */}
          {memoriesByAgent.length > 0 && (
            <View style={styles.agentMemoriesPanel}>
              <Text style={styles.columnTitle}>AGENT MEMORIES</Text>
              <Text style={styles.panelHint}>
                Memories grouped by the agent or surface that created them. Click a memory to highlight its node in the 3D map.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {memoriesByAgent.map(([agent, agentMems]) => (
                  <View key={agent} style={styles.agentMemoryGroup}>
                    <View style={styles.agentMemoryGroupHeader}>
                      <View style={[styles.clusterDot, { backgroundColor: '#a855f7', width: 8, height: 8 }]} />
                      <Text style={[styles.cardTitle, { color: '#a855f7', fontSize: 11 }]}>
                        {agent.toUpperCase()}
                      </Text>
                      <Text style={[styles.cardMeta, { marginLeft: 6 }]}>{agentMems.length}</Text>
                    </View>
                    {agentMems.slice(0, 6).map(mem => {
                      const synced = linkedMemoryIds.has(mem.id);
                      return (
                        <Pressable
                          key={mem.id}
                          onPress={() => setSystemNodeId(`memory-${mem.id}`)}
                          style={({ hovered, pressed }: any) => [styles.agentMemoryItem, hovered && webLift, pressed && webPressed]}
                        >
                          <View style={[styles.clusterDot, { backgroundColor: synced ? '#22c55e' : '#a855f7', width: 6, height: 6, flexShrink: 0 }]} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{mem.title}</Text>
                            <Text style={[styles.cardMeta, { fontSize: 9 }]}>{mem.memory_kind}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    {agentMems.length > 6 && (
                      <Text style={[styles.cardMeta, { marginTop: 4, fontSize: 9 }]}>+{agentMems.length - 6} more</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

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

            <View style={styles.selectedPanel}>
              <Text style={styles.columnTitle}>OPERATING PLAN</Text>
              <Text style={styles.panelHint}>
                The graph is the launch surface. Bases organize it, Review keeps it fresh, and Agent Brief turns it into automation context.
              </Text>
              <View style={styles.planMiniGrid}>
                <PlanStep label="1. Capture" body="Clip research, files, agent findings, and open questions into .web." color="#38bdf8" />
                <PlanStep label="2. Connect" body="Let shared tags and saved links cluster related nodes for graph navigation." color="#a855f7" />
                <PlanStep label="3. Resurface" body={`${reviewDueCount} nodes need review before they become stale automation context.`} color="#f59e0b" />
                <PlanStep label="4. Brief agents" body="Copy or save a context brief for chat, OpenSwan, Codex, and Claude sessions." color="#22c55e" />
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── NODES VIEW ─────────────────────────────────────────────────── */}
      {viewMode === 'nodes' && (
        <View style={styles.mainGrid}>
          <View style={styles.leftColumn}>
            <View style={styles.baseViewGrid}>
              {baseViews.map(view => (
                <Pressable
                  key={view.id}
                  onPress={() => setActiveBaseViewId(view.id)}
                  style={({ hovered, pressed }: any) => [
                    styles.baseViewCard,
                    activeBaseViewId === view.id ? { borderColor: view.color, backgroundColor: `${view.color}14` } : null,
                    hovered && webLift,
                    pressed && webPressed,
                  ]}
                >
                  <View style={styles.baseViewTop}>
                    <Text style={[styles.baseViewCount, { color: view.color }]}>{view.count}</Text>
                    <Text style={styles.cardMeta}>{view.queryHint}</Text>
                  </View>
                  <Text style={[styles.cardTitle, activeBaseViewId === view.id ? { color: view.color } : null]}>
                    {view.title}
                  </Text>
                  <Text style={styles.cardBody}>{view.description}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelLabel}>KNOWLEDGE BASES</Text>
                <Text style={styles.panelHint}>
                  {activeBaseView ? `${activeBaseView.title}: ${activeBaseView.description}` : 'Database-style views over the circle brain.'}
                </Text>
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
                  onShare={handleShare}
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

      {/* ── REVIEW VIEW ───────────────────────────────────────────────── */}
      {viewMode === 'review' && (
        <View style={styles.reviewGrid}>
          <View style={styles.reviewColumn}>
            <View style={styles.reviewPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelLabel}>RESURFACING QUEUE</Text>
                  <Text style={styles.panelHint}>Due and soon-due notes are reviewed before agents reuse them.</Text>
                </View>
                <Text style={[styles.baseViewCount, { color: '#f59e0b' }]}>{reviewQueue.length}</Text>
              </View>
              {reviewQueue.length ? reviewQueue.map(({ note, state }) => (
                <View key={note.id} style={styles.reviewCard}>
                  <View style={styles.noteTop}>
                    <View style={[styles.kindBadge, { borderColor: state.urgency === 'due' ? '#f59e0b' : '#38bdf8' }]}>
                      <Text style={[styles.kindBadgeText, { color: state.urgency === 'due' ? '#f59e0b' : '#38bdf8' }]}>
                        {state.label.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.cardMeta}>reviewed {state.reviewCount}x · interval {state.intervalDays}d</Text>
                  </View>
                  <Text style={styles.cardTitle}>{note.title}</Text>
                  <Text style={styles.cardBody}>{summarizeSecondBrainContent(note.summary || note.content, 180)}</Text>
                  {note.tags.length ? (
                    <View style={styles.tagRow}>
                      {note.tags.slice(0, 6).map(tag => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
                    </View>
                  ) : null}
                  <View style={styles.actionRow}>
                    <Pressable onPress={() => handleReviewAction(note, 'reviewed')} style={styles.miniBtn}>
                      <Text style={styles.miniBtnText}>REVIEWED</Text>
                    </Pressable>
                    <Pressable onPress={() => handleReviewAction(note, 'snoozed')} style={styles.miniBtn}>
                      <Text style={styles.miniBtnText}>SNOOZE</Text>
                    </Pressable>
                    <Pressable onPress={() => handleReviewAction(note, 'evergreen')} style={styles.miniBtn}>
                      <Text style={styles.miniBtnText}>EVERGREEN</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setSelectedNoteId(note.id); setViewMode('graph'); }}
                      style={styles.miniBtn}
                    >
                      <Text style={styles.miniBtnText}>OPEN</Text>
                    </Pressable>
                  </View>
                </View>
              )) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>REVIEW QUEUE CLEAR</Text>
                  <Text style={styles.emptyText}>Capture or import new material and it will appear here when it needs resurfacing.</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.reviewColumn}>
            <View style={styles.agentBriefPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelLabel}>AGENT BRIEF</Text>
                  <Text style={styles.panelHint}>Compressed context for chat, OpenSwan, terminal agents, and browser tasks.</Text>
                </View>
                <View style={styles.heroActions}>
                  <Pressable onPress={handleCopyAgentBrief} style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}>
                    <Text style={styles.ghostBtnText}>COPY</Text>
                  </Pressable>
                  <Pressable onPress={handleSaveAgentBrief} style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}>
                    <Text style={styles.ghostBtnText}>{saving ? 'SAVING' : 'SAVE'}</Text>
                  </Pressable>
                </View>
              </View>
              <ScrollView style={styles.briefScroll} nestedScrollEnabled>
                <Text style={styles.briefText}>{agentBrief}</Text>
              </ScrollView>
            </View>

            <View style={styles.roadmapPanel}>
              <Text style={styles.panelLabel}>LONG-TERM DIGITAL BRAIN PLAN</Text>
              <Text style={styles.panelHint}>Build toward a private, circle-aware second brain that actively feeds every agent workflow.</Text>
              <View style={styles.planMiniGrid}>
                <PlanStep label="Now" body="Graph, bases, capture, search, memory import, and review queue for the Backpack dashboard." color="#22d3ee" />
                <PlanStep label="Next" body="Pipe agent briefs into chat model selection, OpenSwan task planning, and terminal session launches." color="#22c55e" />
                <PlanStep label="Scale" body="Add per-project knowledge packs, permissions, provenance, conflict detection, and local model indexing." color="#a855f7" />
                <PlanStep label="Enterprise" body="Support customer-owned models, local-only vaults, compliance exports, and business-specific automations." color="#f59e0b" />
              </View>
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
            {...webDropHandlers}
            onPress={handleFileUpload}
            style={({ hovered, pressed }: any) => [
              styles.dropZone,
              hovered ? { borderColor: accentColor, backgroundColor: `${accentColor}12` } : null,
              pressed && webPressed,
            ]}
          >
            <Text style={styles.dropZoneIcon}>+</Text>
            <Text style={[styles.dropZoneText, { color: accentColor }]}>Click or drag files here</Text>
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

function PlanStep({ label, body, color }: { label: string; body: string; color: string }) {
  return (
    <View style={[styles.planStepCard, { borderColor: `${color}35` }]}>
      <Text style={[styles.planStepLabel, { color }]}>{label}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({
  note, active, accentColor, onSelect, onMark, onPromote, onShare,
}: {
  note: SecondBrainNote; active: boolean; accentColor: string;
  onSelect: () => void;
  onMark: (note: SecondBrainNote, status: SecondBrainNote['status']) => void;
  onPromote: (note: SecondBrainNote, scope: 'circle' | 'user') => void;
  onShare: (note: SecondBrainNote, visibility: SecondBrainVisibility) => void;
}) {
  const sourceUrl = typeof note.metadata?.sourceUrl === 'string' ? note.metadata.sourceUrl : '';
  const review = getSecondBrainReviewState(note);
  const isPrivate = note.visibility === 'private';
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
        <View style={[styles.visibilityBadge, { borderColor: isPrivate ? '#f59e0b55' : '#22c55e55' }]}>
          <Text style={[styles.visibilityBadgeText, { color: isPrivate ? '#f59e0b' : '#22c55e' }]}>
            {isPrivate ? 'PRIVATE' : 'SHARED'}
          </Text>
        </View>
        <Text style={styles.cardMeta}>{note.status.toUpperCase()} · {review.label} · {dateLabel(note.updated_at)}</Text>
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
        {isPrivate ? (
          <Pressable onPress={() => onShare(note, 'circle_shared')} style={[styles.miniBtn, { borderColor: '#22c55e44' }]}>
            <Text style={[styles.miniBtnText, { color: '#22c55e' }]}>SHARE</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => onShare(note, 'private')} style={[styles.miniBtn, { borderColor: '#f59e0b44' }]}>
            <Text style={[styles.miniBtnText, { color: '#f59e0b' }]}>MAKE PRIVATE</Text>
          </Pressable>
        )}
        <Pressable onPress={() => onPromote(note, 'circle')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>MEMORY</Text>
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
  planMiniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  planStepCard: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 3,
    backgroundColor: '#050b14',
    padding: GRID.sm,
    gap: 5,
  },
  planStepLabel: {
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
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

  // System flow
  systemFlowPanel: {
    borderWidth: 1,
    borderColor: '#22d3ee28',
    borderRadius: 4,
    backgroundColor: '#030711',
    padding: GRID.md,
    gap: GRID.md,
    ...Platform.select({
      web: {
        backgroundImage: [
          'radial-gradient(circle at 22% 18%, rgba(34,211,238,0.16), transparent 28%)',
          'radial-gradient(circle at 78% 18%, rgba(245,158,11,0.14), transparent 28%)',
          'radial-gradient(circle at 50% 88%, rgba(168,85,247,0.14), transparent 30%)',
        ].join(', '),
      } as any,
      default: {},
    }),
  },
  systemStatStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  knowledgeIntakeRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  knowledgeProfileCard: {
    flex: 1,
    minWidth: 220,
    borderWidth: 1,
    borderRadius: 3,
    padding: GRID.md,
    gap: 4,
  },
  systemCanvasShell: {
    borderWidth: 1,
    borderColor: '#ffffff12',
    borderRadius: 4,
    backgroundColor: '#020711',
    overflow: 'hidden',
  },
  systemDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  systemDetailCard: {
    flex: 1,
    minWidth: 280,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: '#07101d',
    padding: GRID.md,
    gap: GRID.sm,
  },
  systemList: {
    maxHeight: 340,
  },
  clusterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GRID.sm,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    marginBottom: GRID.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  clusterDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  dbRow: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    marginBottom: GRID.sm,
    gap: 4,
  },
  dbRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: GRID.sm,
  },
  memoryCoverageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GRID.sm,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    marginBottom: GRID.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  agentMemoriesPanel: {
    borderWidth: 1,
    borderColor: '#a855f730',
    borderRadius: 6,
    backgroundColor: '#a855f708',
    padding: GRID.md,
    marginTop: GRID.md,
  },
  agentMemoryGroup: {
    width: 200,
    marginRight: GRID.md,
    borderWidth: 1,
    borderColor: '#a855f722',
    borderRadius: 4,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
  },
  agentMemoryGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.xs,
    marginBottom: GRID.sm,
    paddingBottom: GRID.xs,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  agentMemoryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GRID.xs,
    padding: GRID.xs,
    borderRadius: 3,
    marginBottom: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.12s ease' } as any : {}),
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
  baseViewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  baseViewCard: {
    flex: 1,
    minWidth: 180,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: GRID.xs,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  baseViewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: GRID.sm,
  },
  baseViewCount: {
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'monospace',
    lineHeight: 24,
  },
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

  // Review
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  reviewColumn: {
    flex: 1,
    minWidth: 320,
    gap: GRID.md,
  },
  reviewPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.sm,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: GRID.sm,
  },
  agentBriefPanel: {
    borderWidth: 1,
    borderColor: '#22d3ee30',
    borderRadius: 3,
    backgroundColor: '#06101b',
    padding: GRID.md,
    gap: GRID.md,
  },
  briefScroll: {
    maxHeight: 360,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: '#020711',
    padding: GRID.md,
  },
  briefText: {
    color: PIXEL_COLORS.text1,
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  roadmapPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.sm,
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

  // Brain mode toggle
  brainModeToggle: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    marginLeft: GRID.sm,
  },
  modeBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  modeBtnText: {
    color: PIXEL_COLORS.text2,
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Visibility badge
  visibilityBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: '#00000025',
  },
  visibilityBadgeText: {
    fontSize: 7,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
