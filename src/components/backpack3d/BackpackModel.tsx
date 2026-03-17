/**
 * BackpackModel — SolarPunk procedural backpack from Three.js primitives.
 *
 * FULLY OPAQUE: Interior fill meshes + DoubleSide body + front/back/side panels.
 * GRASS MATERIAL: Procedural canvas texture with painted grass blades.
 *
 * DETAILS:
 *   Body: Rounded ExtrudeGeometry with grass texture, interior fill, panel divisions
 *   Straps: TubeGeometry curves with adjustment buckles
 *   Flora: Edge vines (thick+thin), 15+ leaves, 7 mushrooms, 10 vine flowers,
 *          ferns, dandelion puffs, seed pods, lichen patches
 *   Tech: Solar panel flap, circuit traces, LED dots, energy coils (animated),
 *         wind turbine (animated), antenna (animated), reflective strips
 *   Hardware: Corner rivets, D-rings, buckles, webbing loops, zipper pull tabs
 *   Organic: Bark patches, water droplets, root tendrils, terrarium dome
 *   Wildlife: Animated butterfly, dragonfly
 *   Emblem: SolarPunk sun badge with rays
 */
import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SOLAR, BAG_STRAP, BAG_HARDWARE } from './backpackMaterials';
import { COMPARTMENT_LAYOUTS } from './compartmentLayout';
import CompartmentMesh from './CompartmentMesh';

interface Props {
  compartmentStats: Record<string, { miniStat: string; hasActivity: boolean }>;
  onOpenCompartment: (key: string) => void;
}

// ─── Geometry Factories ──────────────────────────────────────────────────────

function createBodyGeometry(): THREE.ExtrudeGeometry {
  const w = 1.8, h = 2.6, r = 0.25;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.9, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 4,
  });
  geo.center();
  return geo;
}

function createStrapGeometry(side: 'left' | 'right'): THREE.TubeGeometry {
  const s = side === 'left' ? -1 : 1;
  const pts = [
    new THREE.Vector3(s * 0.55, 1.2, -0.45), new THREE.Vector3(s * 0.65, 1.4, -0.6),
    new THREE.Vector3(s * 0.6, 1.0, -0.7), new THREE.Vector3(s * 0.55, 0.3, -0.6),
    new THREE.Vector3(s * 0.55, -0.4, -0.5), new THREE.Vector3(s * 0.5, -1.0, -0.45),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 8, false);
}

function createHandleGeometry(): THREE.TubeGeometry {
  const pts = [
    new THREE.Vector3(-0.2, 1.35, -0.15), new THREE.Vector3(-0.15, 1.55, -0.1),
    new THREE.Vector3(0, 1.6, -0.08), new THREE.Vector3(0.15, 1.55, -0.1),
    new THREE.Vector3(0.2, 1.35, -0.15),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.045, 8, false);
}

function createEdgeVineGeometry(side: 'left' | 'right'): THREE.TubeGeometry {
  const s = side === 'left' ? -1 : 1;
  const pts = [
    new THREE.Vector3(s * 0.82, -0.95, 0.36), new THREE.Vector3(s * 0.87, -0.5, 0.28),
    new THREE.Vector3(s * 0.79, 0.0, 0.34), new THREE.Vector3(s * 0.85, 0.45, 0.26),
    new THREE.Vector3(s * 0.78, 0.85, 0.31), new THREE.Vector3(s * 0.83, 1.15, 0.23),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.028, 8, false);
}

function createSecondaryVineGeometry(side: 'left' | 'right'): THREE.TubeGeometry {
  const s = side === 'left' ? -1 : 1;
  const pts = [
    new THREE.Vector3(s * 0.78, -0.7, 0.40), new THREE.Vector3(s * 0.83, -0.2, 0.35),
    new THREE.Vector3(s * 0.76, 0.3, 0.38), new THREE.Vector3(s * 0.80, 0.7, 0.32),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.015, 6, false);
}

function createBottomVineGeometry(): THREE.TubeGeometry {
  const pts = [
    new THREE.Vector3(-0.65, -1.12, 0.38), new THREE.Vector3(-0.3, -1.17, 0.34),
    new THREE.Vector3(0.05, -1.14, 0.40), new THREE.Vector3(0.35, -1.18, 0.33),
    new THREE.Vector3(0.65, -1.11, 0.37),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.02, 6, false);
}

function createLeafGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.05, 0.08, 0, 0.15);
  s.quadraticCurveTo(-0.05, 0.08, 0, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false });
}

function createFernGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.03, 0.04, 0.01, 0.12);
  s.quadraticCurveTo(0.04, 0.16, 0.02, 0.22);
  s.quadraticCurveTo(-0.01, 0.18, -0.01, 0.12);
  s.quadraticCurveTo(-0.03, 0.06, 0, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
}

/** Procedural grass texture — realistic blades painted on canvas */
function createGrassTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base: rich earth-green gradient
  const baseGrad = ctx.createRadialGradient(256, 256, 50, 256, 256, 360);
  baseGrad.addColorStop(0, '#3d7a22');
  baseGrad.addColorStop(0.4, '#2d6518');
  baseGrad.addColorStop(0.7, '#1e5510');
  baseGrad.addColorStop(1, '#1a4a0e');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Earthy patches (darker spots where soil shows through)
  for (let p = 0; p < 20; p++) {
    const px = Math.random() * 512;
    const py = Math.random() * 512;
    const pr = Math.random() * 30 + 10;
    const earthGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
    earthGrad.addColorStop(0, 'rgba(40, 30, 15, 0.3)');
    earthGrad.addColorStop(1, 'rgba(40, 30, 15, 0)');
    ctx.fillStyle = earthGrad;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }

  // Draw hundreds of grass blades
  const bladeColors = [
    '#4a9028', '#3d7a22', '#56a832', '#2d6518', '#5ab838',
    '#68c44a', '#3a7020', '#48982e', '#5cba3c', '#2e5c14',
    '#72cc52', '#3c7520', '#50a530', '#44901e', '#60c040',
  ];

  for (let i = 0; i < 600; i++) {
    const bx = Math.random() * 512;
    const by = Math.random() * 512;
    const bladeLen = Math.random() * 18 + 6;
    const angle = (Math.random() - 0.5) * 0.8 - Math.PI / 2; // mostly upward
    const curve = (Math.random() - 0.5) * 0.3;

    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(
      bx + Math.cos(angle + curve) * bladeLen * 0.6,
      by + Math.sin(angle + curve) * bladeLen * 0.6,
      bx + Math.cos(angle) * bladeLen,
      by + Math.sin(angle) * bladeLen,
    );
    ctx.strokeStyle = bladeColors[Math.floor(Math.random() * bladeColors.length)];
    ctx.lineWidth = Math.random() * 2 + 0.5;
    ctx.stroke();
  }

  // Tiny wildflower dots scattered
  const flowerColors = ['#ffeb3b', '#ff69b4', '#ffffff', '#da70d6', '#ff6b6b'];
  for (let f = 0; f < 30; f++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 2 + 1, 0, Math.PI * 2);
    ctx.fillStyle = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    ctx.fill();
  }

  // Subtle noise overlay for organic feel
  for (let ny = 0; ny < 512; ny += 4) {
    for (let nx = 0; nx < 512; nx += 4) {
      const noise = Math.random() * 20 - 10;
      ctx.fillStyle = noise > 0
        ? `rgba(255, 255, 255, ${noise / 100})`
        : `rgba(0, 0, 0, ${-noise / 80})`;
      ctx.fillRect(nx, ny, 4, 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

function createSolarTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1e5520'); grad.addColorStop(1, '#0d3510');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ffc93c70'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  ctx.strokeStyle = '#ffc93c25'; ctx.lineWidth = 0.5;
  for (let i = 16; i < 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function createEdgeCircuitPoints(side: 'left' | 'right'): THREE.Vector3[] {
  const s = side === 'left' ? -1 : 1;
  return [
    new THREE.Vector3(s * 0.66, 0.48, 0.47), new THREE.Vector3(s * 0.71, 0.32, 0.47),
    new THREE.Vector3(s * 0.67, 0.15, 0.47), new THREE.Vector3(s * 0.73, -0.02, 0.47),
    new THREE.Vector3(s * 0.68, -0.18, 0.47), new THREE.Vector3(s * 0.72, -0.30, 0.47),
  ];
}

/** Root tendril geometry — organic roots growing from bottom */
function createRootGeometry(index: number): THREE.TubeGeometry {
  const xOff = (index - 2) * 0.28;
  const pts = [
    new THREE.Vector3(xOff, -1.25, 0.3),
    new THREE.Vector3(xOff + (Math.random() - 0.5) * 0.15, -1.38, 0.25),
    new THREE.Vector3(xOff + (Math.random() - 0.5) * 0.2, -1.48, 0.18),
    new THREE.Vector3(xOff + (Math.random() - 0.5) * 0.25, -1.55, 0.12),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008 + Math.random() * 0.006, 6, false);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BackpackModel({ compartmentStats, onOpenCompartment }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const turbineRef = useRef<THREE.Group>(null);
  const antennaRef = useRef<THREE.Group>(null);
  const coil1MatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coil2MatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coil3MatRef = useRef<THREE.MeshStandardMaterial>(null);
  const butterfly1Ref = useRef<THREE.Group>(null);
  const butterfly2Ref = useRef<THREE.Group>(null);
  const dragonfly1Ref = useRef<THREE.Group>(null);
  const dropletRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  // Geometries
  const bodyGeo = useMemo(() => createBodyGeometry(), []);
  const leftStrapGeo = useMemo(() => createStrapGeometry('left'), []);
  const rightStrapGeo = useMemo(() => createStrapGeometry('right'), []);
  const handleGeo = useMemo(() => createHandleGeometry(), []);
  const leftVineGeo = useMemo(() => createEdgeVineGeometry('left'), []);
  const rightVineGeo = useMemo(() => createEdgeVineGeometry('right'), []);
  const leftVine2Geo = useMemo(() => createSecondaryVineGeometry('left'), []);
  const rightVine2Geo = useMemo(() => createSecondaryVineGeometry('right'), []);
  const bottomVineGeo = useMemo(() => createBottomVineGeometry(), []);
  const leafGeo = useMemo(() => createLeafGeometry(), []);
  const fernGeo = useMemo(() => createFernGeometry(), []);
  const grassTex = useMemo(() => createGrassTexture(), []);
  const solarTex = useMemo(() => createSolarTexture(), []);
  const rootGeos = useMemo(() => [0, 1, 2, 3, 4].map(i => createRootGeometry(i)), []);

  const circuitLeftPts = useMemo(() => createEdgeCircuitPoints('left'), []);
  const circuitRightPts = useMemo(() => createEdgeCircuitPoints('right'), []);
  const circuitLeftGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints(circuitLeftPts), [circuitLeftPts]);
  const circuitRightGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints(circuitRightPts), [circuitRightPts]);
  const circuitLeftLine = useMemo(() => new THREE.Line(circuitLeftGeo, new THREE.LineBasicMaterial({ color: SOLAR.neonCyan })), [circuitLeftGeo]);
  const circuitRightLine = useMemo(() => new THREE.Line(circuitRightGeo, new THREE.LineBasicMaterial({ color: SOLAR.neonBlue })), [circuitRightGeo]);

  // Entrance + animated elements
  const scaleRef = useRef(0);
  useFrame(({ clock }, delta) => {
    // Entrance
    if (scaleRef.current < 1) {
      scaleRef.current = Math.min(1, scaleRef.current + delta * 1.8);
      groupRef.current?.scale.setScalar(easeOutBack(scaleRef.current));
    }
    // Wind turbine spin
    if (turbineRef.current) {
      turbineRef.current.rotation.z += delta * 4;
    }
    // Antenna sway
    if (antennaRef.current) {
      antennaRef.current.rotation.z = Math.sin(clock.elapsedTime * 1.5) * 0.12;
    }
    // Energy coil pulse
    const t = clock.elapsedTime;
    if (coil1MatRef.current) coil1MatRef.current.emissiveIntensity = 0.8 + Math.sin(t * 2) * 0.6;
    if (coil2MatRef.current) coil2MatRef.current.emissiveIntensity = 0.8 + Math.sin(t * 2.5 + 1) * 0.6;
    if (coil3MatRef.current) coil3MatRef.current.emissiveIntensity = 0.8 + Math.sin(t * 3 + 2) * 0.6;

    // Butterfly 1 — figure-8 path near top-right
    if (butterfly1Ref.current) {
      const bx = Math.sin(t * 0.7) * 0.3;
      const by = Math.cos(t * 1.4) * 0.15;
      const bz = Math.sin(t * 0.5) * 0.2;
      butterfly1Ref.current.position.set(0.6 + bx, 1.1 + by, 0.5 + bz);
      butterfly1Ref.current.rotation.y = Math.sin(t * 0.7) * 0.4;
      // Wing flap
      const wingAngle = Math.sin(t * 8) * 0.6;
      const bChildren = butterfly1Ref.current.children;
      if (bChildren[1]) bChildren[1].rotation.z = wingAngle;
      if (bChildren[2]) bChildren[2].rotation.z = -wingAngle;
    }

    // Butterfly 2 — slower orbit near left
    if (butterfly2Ref.current) {
      const bx2 = Math.sin(t * 0.5 + 2) * 0.25;
      const by2 = Math.cos(t * 1.0 + 1) * 0.2;
      const bz2 = Math.cos(t * 0.4) * 0.15;
      butterfly2Ref.current.position.set(-0.7 + bx2, 0.6 + by2, 0.6 + bz2);
      butterfly2Ref.current.rotation.y = Math.sin(t * 0.5 + 2) * 0.5;
      const b2Children = butterfly2Ref.current.children;
      if (b2Children[1]) b2Children[1].rotation.z = Math.sin(t * 10) * 0.5;
      if (b2Children[2]) b2Children[2].rotation.z = -Math.sin(t * 10) * 0.5;
    }

    // Dragonfly — fast darting path
    if (dragonfly1Ref.current) {
      const dx = Math.sin(t * 1.2) * 0.5;
      const dy = Math.cos(t * 0.8 + 3) * 0.3;
      const dz = Math.sin(t * 0.6 + 1) * 0.3;
      dragonfly1Ref.current.position.set(dx, 0.3 + dy, 0.7 + dz);
      dragonfly1Ref.current.rotation.y = t * 1.2;
    }

    // Water droplet shimmer
    for (const mat of dropletRefs.current) {
      if (mat) {
        mat.emissiveIntensity = 0.5 + Math.sin(t * 3 + Math.random() * 0.1) * 0.4;
      }
    }
  });

  return (
    <group ref={groupRef} rotation={[0, -0.3, 0]} scale={0}>

      {/* ═══ MAIN BODY — FULLY OPAQUE WITH GRASS TEXTURE ══════════ */}
      <mesh geometry={bodyGeo}>
        <meshStandardMaterial
          color={SOLAR.body}
          map={grassTex}
          roughness={0.75}
          metalness={0.05}
          emissive="#1a3a10"
          emissiveIntensity={0.08}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ═══ INTERIOR FILL — prevents see-through ═════════════════ */}
      {/* Solid inner box fills the entire body volume */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.7, 2.5, 0.85]} />
        <meshStandardMaterial color="#1a3510" roughness={0.9} metalness={0} />
      </mesh>
      {/* Front panel behind compartments — solid wall */}
      <mesh position={[0, 0, 0.42]}>
        <boxGeometry args={[1.72, 2.52, 0.04]} />
        <meshStandardMaterial color={SOLAR.body} map={grassTex} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Back panel — solid wall */}
      <mesh position={[0, 0, -0.42]}>
        <boxGeometry args={[1.72, 2.52, 0.04]} />
        <meshStandardMaterial color={SOLAR.bodyDark} map={grassTex} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Side panels */}
      <mesh position={[-0.87, 0, 0]}>
        <boxGeometry args={[0.04, 2.52, 0.82]} />
        <meshStandardMaterial color={SOLAR.bodyDark} map={grassTex} roughness={0.7} metalness={0.05} />
      </mesh>
      <mesh position={[0.87, 0, 0]}>
        <boxGeometry args={[0.04, 2.52, 0.82]} />
        <meshStandardMaterial color={SOLAR.bodyDark} map={grassTex} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Top panel */}
      <mesh position={[0, 1.27, 0]}>
        <boxGeometry args={[1.72, 0.04, 0.82]} />
        <meshStandardMaterial color={SOLAR.body} map={grassTex} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Bottom panel */}
      <mesh position={[0, -1.27, 0]}>
        <boxGeometry args={[1.72, 0.04, 0.82]} />
        <meshStandardMaterial color="#1a3510" map={grassTex} roughness={0.8} metalness={0.05} />
      </mesh>

      {/* Body rim glow */}
      <mesh geometry={bodyGeo} scale={1.015}>
        <meshBasicMaterial color={SOLAR.neonCyan} transparent opacity={0.04} side={THREE.BackSide} />
      </mesh>

      {/* ═══ WOVEN GRASS PATCHES (organic texture variation) ═══════ */}
      {[
        [0.3, 0.6, 0.465, 0.3, 0.2],
        [-0.4, -0.2, 0.465, 0.25, 0.15],
        [0.1, -0.85, 0.465, 0.2, 0.12],
        [-0.55, 0.3, 0.465, 0.18, 0.18],
        [0.5, 0.15, 0.465, 0.22, 0.14],
      ].map(([x, y, z, w, h], i) => (
        <mesh key={`grass-patch-${i}`} position={[x, y, z]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial
            color="#4a9028"
            map={grassTex}
            roughness={0.85}
            metalness={0}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* ═══ PANEL DIVISIONS & STITCHING ═════════════════════════ */}
      {[0.92, 0.56, -0.28, -0.82].map((y, i) => (
        <mesh key={`hs-${i}`} position={[0, y, 0.465]}>
          <boxGeometry args={[1.55, 0.008, 0.004]} />
          <meshStandardMaterial color="#2a4518" roughness={0.7} />
        </mesh>
      ))}
      {[-0.72, 0.72].map((x, i) => (
        <mesh key={`vs-${i}`} position={[x, 0.1, 0.465]}>
          <boxGeometry args={[0.008, 1.7, 0.004]} />
          <meshStandardMaterial color="#2a4518" roughness={0.7} />
        </mesh>
      ))}

      {/* ═══ BARK PATCHES (rough organic texture spots) ════════════ */}
      {[
        [-0.62, -0.95, 0.465, 0.14, 0.1],
        [0.68, -0.92, 0.465, 0.12, 0.08],
        [-0.7, 0.7, 0.465, 0.10, 0.12],
        [0.6, 0.95, 0.465, 0.13, 0.07],
      ].map(([x, y, z, w, h], i) => (
        <mesh key={`bark-${i}`} position={[x, y, z]}>
          <boxGeometry args={[w, h, 0.008]} />
          <meshStandardMaterial color="#5a3a20" roughness={0.95} metalness={0} emissive="#3a2510" emissiveIntensity={0.1} />
        </mesh>
      ))}

      {/* ═══ LICHEN SPOTS (pale green-blue organic patches) ════════ */}
      {[
        [-0.5, -0.7, 0.466], [0.55, -0.5, 0.466],
        [-0.35, 0.92, 0.466], [0.4, 0.85, 0.466],
        [0.15, -0.92, 0.466], [-0.6, 0.15, 0.466],
      ].map(([x, y, z], i) => (
        <mesh key={`lichen-${i}`} position={[x, y, z]}>
          <circleGeometry args={[0.04 + Math.random() * 0.02, 8]} />
          <meshStandardMaterial
            color="#7ab89e"
            emissive="#3a9070"
            emissiveIntensity={0.2}
            roughness={0.9}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* ═══ MOSS PATCHES (fluffy organic patches) ═════════════════ */}
      {[
        [-0.55, -0.85, 0.467, 0.22, 0.08],
        [0.60, -0.88, 0.467, 0.18, 0.06],
        [-0.65, 0.82, 0.467, 0.15, 0.07],
        [0.55, 0.90, 0.467, 0.20, 0.05],
        [0.0, -1.1, 0.467, 0.25, 0.06],
        [-0.3, 1.08, 0.467, 0.12, 0.05],
      ].map(([x, y, z, w, h], i) => (
        <mesh key={`moss-${i}`} position={[x, y, z]}>
          <boxGeometry args={[w, h, 0.006]} />
          <meshStandardMaterial color="#1a5025" emissive="#39ff14" emissiveIntensity={0.15} roughness={0.95} />
        </mesh>
      ))}

      {/* ═══ WATER DROPLETS (glistening on surface) ════════════════ */}
      {[
        [0.2, 0.92, 0.468], [-0.3, 0.8, 0.468], [0.45, 0.4, 0.468],
        [-0.5, -0.1, 0.468], [0.35, -0.45, 0.468], [-0.15, -0.8, 0.468],
        [0.6, 0.7, 0.468], [-0.65, -0.5, 0.468],
      ].map(([x, y, z], i) => (
        <mesh key={`drop-${i}`} position={[x, y, z]}>
          <sphereGeometry args={[0.012 + Math.random() * 0.008, 8, 8]} />
          <meshStandardMaterial
            ref={(ref) => { dropletRefs.current[i] = ref; }}
            color="#a0e8ff"
            emissive="#60c0ff"
            emissiveIntensity={0.5}
            metalness={0.9}
            roughness={0.1}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}

      {/* ═══ SOLAR PANEL FLAP ════════════════════════════════════ */}
      <mesh position={[0, 1.08, 0.25]} rotation={[-0.1, 0, 0]}>
        <boxGeometry args={[1.65, 0.45, 0.06]} />
        <meshStandardMaterial color={SOLAR.body} roughness={0.4} metalness={0.25} map={solarTex} emissive={SOLAR.gold} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 1.08, 0.29]} rotation={[-0.1, 0, 0]}>
        <boxGeometry args={[1.67, 0.02, 0.02]} />
        <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={0.5} metalness={0.7} roughness={0.2} />
      </mesh>

      {/* ═══ BOTTOM BASE ═════════════════════════════════════════ */}
      <mesh position={[0, -1.25, 0]}>
        <boxGeometry args={[1.75, 0.12, 0.85]} />
        <meshStandardMaterial color="#2a5520" map={grassTex} roughness={0.8} metalness={0.05} />
      </mesh>
      <mesh position={[0, -1.0, 0.455]}>
        <boxGeometry args={[1.55, 0.35, 0.01]} />
        <meshStandardMaterial color="#2a5018" map={grassTex} roughness={0.75} metalness={0.05} />
      </mesh>

      {/* ═══ ROOT TENDRILS (growing from bottom) ═══════════════════ */}
      {rootGeos.map((geo, i) => (
        <mesh key={`root-${i}`} geometry={geo}>
          <meshStandardMaterial color="#5a3a20" emissive="#3a2510" emissiveIntensity={0.1} roughness={0.85} />
        </mesh>
      ))}

      {/* ═══ CORNER RIVETS ═══════════════════════════════════════ */}
      {[
        [-0.78, 1.1, 0.47], [0.78, 1.1, 0.47], [-0.78, -0.9, 0.47],
        [0.78, -0.9, 0.47], [-0.78, 0.1, 0.47], [0.78, 0.1, 0.47],
      ].map(([x, y, z], i) => (
        <mesh key={`rivet-${i}`} position={[x, y, z]}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshStandardMaterial color={SOLAR.copper} emissive={SOLAR.gold} emissiveIntensity={0.3} metalness={0.9} roughness={0.2} />
        </mesh>
      ))}

      {/* ═══ STRAPS ══════════════════════════════════════════════ */}
      <mesh geometry={leftStrapGeo}><meshStandardMaterial {...BAG_STRAP} /></mesh>
      <mesh geometry={rightStrapGeo}><meshStandardMaterial {...BAG_STRAP} /></mesh>
      {[-0.52, 0.52].map((x, i) => (
        <mesh key={`sb-${i}`} position={[x, -0.2, -0.52]}>
          <boxGeometry args={[0.08, 0.12, 0.02]} />
          <meshStandardMaterial {...BAG_HARDWARE} />
        </mesh>
      ))}
      <mesh geometry={handleGeo}>
        <meshStandardMaterial color={SOLAR.strap} roughness={0.5} metalness={0.15} />
      </mesh>
      {[-0.55, 0.55].map((x, i) => (
        <mesh key={`bk-${i}`} position={[x, -0.85, -0.47]}>
          <boxGeometry args={[0.12, 0.06, 0.03]} />
          <meshStandardMaterial {...BAG_HARDWARE} />
        </mesh>
      ))}

      {/* ═══ WEBBING LOOPS ═══════════════════════════════════════ */}
      {[
        [-0.74, 0.4, 0.46], [-0.74, -0.15, 0.46],
        [0.74, 0.4, 0.46], [0.74, -0.15, 0.46],
      ].map(([x, y, z], i) => (
        <mesh key={`web-${i}`} position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.025, 0.007, 6, 12]} />
          <meshStandardMaterial color={SOLAR.strap} emissive="#5aad58" emissiveIntensity={0.15} roughness={0.6} />
        </mesh>
      ))}

      {/* ═══ ZIPPER LINES + LED DOTS + PULL TABS ═════════════════ */}
      <mesh position={[0, 0.56, 0.47]}>
        <boxGeometry args={[1.4, 0.02, 0.008]} />
        <meshStandardMaterial color={SOLAR.neonCyan} emissive={SOLAR.neonCyan} emissiveIntensity={1.2} metalness={0.5} roughness={0.2} />
      </mesh>
      {[-0.5, -0.25, 0, 0.25, 0.5].map((x, i) => (
        <mesh key={`lu-${i}`} position={[x, 0.56, 0.48]}>
          <sphereGeometry args={[0.012, 6, 6]} />
          <meshStandardMaterial color="#ffffff" emissive={SOLAR.neonCyan} emissiveIntensity={2.0} />
        </mesh>
      ))}
      {[-0.62, 0.62].map((x, i) => (
        <mesh key={`zpu-${i}`} position={[x, 0.56, 0.49]}>
          <boxGeometry args={[0.04, 0.06, 0.015]} />
          <meshStandardMaterial color={SOLAR.copper} emissive={SOLAR.gold} emissiveIntensity={0.3} metalness={0.8} roughness={0.25} />
        </mesh>
      ))}

      <mesh position={[0, -0.28, 0.47]}>
        <boxGeometry args={[1.2, 0.02, 0.008]} />
        <meshStandardMaterial color={SOLAR.neonCyan} emissive={SOLAR.neonCyan} emissiveIntensity={0.8} metalness={0.5} roughness={0.2} />
      </mesh>
      {[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => (
        <mesh key={`ll-${i}`} position={[x, -0.28, 0.48]}>
          <sphereGeometry args={[0.01, 6, 6]} />
          <meshStandardMaterial color="#ffffff" emissive={SOLAR.neonBlue} emissiveIntensity={1.5} />
        </mesh>
      ))}
      {[-0.52, 0.52].map((x, i) => (
        <mesh key={`zpl-${i}`} position={[x, -0.28, 0.49]}>
          <boxGeometry args={[0.035, 0.05, 0.012]} />
          <meshStandardMaterial color={SOLAR.copper} emissive={SOLAR.gold} emissiveIntensity={0.2} metalness={0.8} roughness={0.25} />
        </mesh>
      ))}

      {/* ═══ REFLECTIVE SAFETY STRIPS ════════════════════════════ */}
      {[
        [-0.65, 0.85, 0.47, 0.25], [0.65, 0.85, 0.47, -0.25],
        [-0.65, -0.65, 0.47, 0.25], [0.65, -0.65, 0.47, -0.25],
      ].map(([x, y, z, rot], i) => (
        <mesh key={`refl-${i}`} position={[x, y, z]} rotation={[0, 0, rot]}>
          <boxGeometry args={[0.06, 0.015, 0.003]} />
          <meshStandardMaterial color="#fffff0" emissive="#ffc93c" emissiveIntensity={0.4} metalness={0.6} roughness={0.2} />
        </mesh>
      ))}

      {/* ═══ EDGE VINES ══════════════════════════════════════════ */}
      <mesh geometry={leftVineGeo}>
        <meshStandardMaterial color={SOLAR.vine} roughness={0.65} emissive="#1a5025" emissiveIntensity={0.2} />
      </mesh>
      <mesh geometry={rightVineGeo}>
        <meshStandardMaterial color="#4a7a4a" roughness={0.65} emissive="#1a5025" emissiveIntensity={0.2} />
      </mesh>
      <mesh geometry={leftVine2Geo}><meshStandardMaterial color="#5a9058" roughness={0.7} /></mesh>
      <mesh geometry={rightVine2Geo}><meshStandardMaterial color="#4a8048" roughness={0.7} /></mesh>
      <mesh geometry={bottomVineGeo}><meshStandardMaterial color={SOLAR.vine} roughness={0.65} /></mesh>

      {/* ═══ DENSE FOLIAGE ═══════════════════════════════════════ */}
      {[
        [-0.84, -0.5, 0.33, 0.4], [-0.80, -0.1, 0.36, -0.6], [-0.83, 0.3, 0.30, 0.3],
        [-0.78, 0.7, 0.32, -0.4], [-0.82, 1.0, 0.26, 0.5],
        [0.84, -0.4, 0.32, -0.5], [0.80, 0.1, 0.35, 0.6], [0.83, 0.5, 0.29, -0.3], [0.78, 0.85, 0.31, 0.4],
        [-0.45, -1.14, 0.38, 0.2], [-0.1, -1.15, 0.39, -0.4], [0.25, -1.16, 0.36, 0.3], [0.55, -1.12, 0.38, -0.2],
        // Extra leaves for density
        [-0.86, -0.3, 0.31, 0.7], [0.82, -0.2, 0.34, -0.7],
      ].map(([x, y, z, rot], i) => (
        <mesh key={`leaf-${i}`} geometry={leafGeo} position={[x, y, z]} rotation={[0, 0, rot]}>
          <meshStandardMaterial color="#5aad58" emissive="#39ff14" emissiveIntensity={0.35} roughness={0.55} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* ═══ FERN FRONDS ═════════════════════════════════════════ */}
      {[
        [-0.82, -0.7, 0.35, 0.3], [0.83, -0.65, 0.33, -0.3],
        [-0.80, 0.5, 0.30, -0.5], [0.81, 0.6, 0.32, 0.4],
        [-0.5, -1.18, 0.36, 0.1], [0.35, -1.15, 0.37, -0.15],
      ].map(([x, y, z, rot], i) => (
        <mesh key={`fern-${i}`} geometry={fernGeo} position={[x, y, z]} rotation={[0, 0, rot]}>
          <meshStandardMaterial color="#3d8a35" emissive="#2a6525" emissiveIntensity={0.25} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* ═══ VINE FLOWERS ════════════════════════════════════════ */}
      {[
        [-0.84, -0.3, 0.35, '#ff69b4'], [-0.81, 0.5, 0.31, '#ff1493'],
        [-0.79, 0.9, 0.29, '#ff69b4'],
        [0.83, -0.1, 0.34, '#ff1493'], [0.80, 0.4, 0.30, '#ff69b4'],
        [0.78, 0.75, 0.32, '#ff1493'],
        [-0.35, -1.15, 0.37, '#ff69b4'], [0.45, -1.13, 0.37, '#ff1493'],
        [-0.82, 0.15, 0.33, '#ffb6c1'], [0.82, 0.0, 0.33, '#ffb6c1'],
      ].map(([x, y, z, color], i) => (
        <mesh key={`flower-${i}`} position={[x as number, y as number, z as number]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial
            color={color as string} emissive={color as string}
            emissiveIntensity={0.8} roughness={0.4}
          />
        </mesh>
      ))}

      {/* ═══ DANDELION PUFFS (fuzzy white spheres on stems) ════════ */}
      {[
        [-0.78, 1.12, 0.27], [0.76, 1.08, 0.25], [-0.40, -1.20, 0.36],
      ].map(([x, y, z], i) => (
        <group key={`dandelion-${i}`} position={[x, y, z]}>
          {/* Stem */}
          <mesh position={[0, -0.04, 0]}>
            <cylinderGeometry args={[0.003, 0.003, 0.08, 4]} />
            <meshStandardMaterial color="#6a8a40" roughness={0.7} />
          </mesh>
          {/* Puff */}
          <mesh>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshStandardMaterial color="#f0f0e8" emissive="#ffffff" emissiveIntensity={0.3} transparent opacity={0.7} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* ═══ SEED PODS (hanging from vines) ════════════════════════ */}
      {[
        [-0.85, -0.6, 0.34], [0.84, -0.55, 0.33],
        [-0.80, 0.2, 0.35], [0.82, 0.25, 0.34],
      ].map(([x, y, z], i) => (
        <group key={`seed-${i}`} position={[x, y, z]}>
          {/* Thread */}
          <mesh position={[0, 0.025, 0]}>
            <cylinderGeometry args={[0.002, 0.002, 0.05, 3]} />
            <meshStandardMaterial color="#5a9058" roughness={0.8} />
          </mesh>
          {/* Pod */}
          <mesh>
            <sphereGeometry args={[0.018, 6, 6]} />
            <meshStandardMaterial color="#6b4226" emissive="#3a2210" emissiveIntensity={0.15} roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* ═══ BIOLUMINESCENT MUSHROOM CLUSTERS ════════════════════ */}
      {/* Cluster 1: bottom-left */}
      <group position={[-0.75, -1.05, 0.4]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.012, 0.015, 0.12, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <sphereGeometry args={[0.04, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ff69b4" emissive="#ff69b4" emissiveIntensity={1.2} roughness={0.3} />
        </mesh>
        <mesh position={[0.06, 0.04, 0.02]}>
          <cylinderGeometry args={[0.01, 0.012, 0.08, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[0.06, 0.09, 0.02]}>
          <sphereGeometry args={[0.03, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#da70d6" emissive="#da70d6" emissiveIntensity={1.0} roughness={0.3} />
        </mesh>
        <mesh position={[-0.04, 0.03, 0.03]}>
          <cylinderGeometry args={[0.008, 0.01, 0.06, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[-0.04, 0.065, 0.03]}>
          <sphereGeometry args={[0.022, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ff69b4" emissive="#ff69b4" emissiveIntensity={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* Cluster 2: bottom-right */}
      <group position={[0.70, -1.08, 0.38]}>
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.01, 0.013, 0.10, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <sphereGeometry args={[0.035, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#da70d6" emissive="#da70d6" emissiveIntensity={1.0} roughness={0.3} />
        </mesh>
        <mesh position={[-0.05, 0.035, 0.02]}>
          <cylinderGeometry args={[0.008, 0.01, 0.07, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[-0.05, 0.075, 0.02]}>
          <sphereGeometry args={[0.025, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ff69b4" emissive="#ff69b4" emissiveIntensity={0.9} roughness={0.3} />
        </mesh>
      </group>

      {/* Cluster 3: top-left (new) */}
      <group position={[-0.72, 0.95, 0.28]}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.008, 0.011, 0.08, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.085, 0]}>
          <sphereGeometry args={[0.028, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#b366ff" emissive="#b366ff" emissiveIntensity={1.0} roughness={0.3} />
        </mesh>
        <mesh position={[0.04, 0.03, 0.01]}>
          <cylinderGeometry args={[0.006, 0.008, 0.06, 6]} />
          <meshStandardMaterial color="#8B7355" roughness={0.7} />
        </mesh>
        <mesh position={[0.04, 0.065, 0.01]}>
          <sphereGeometry args={[0.02, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#b366ff" emissive="#b366ff" emissiveIntensity={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* ═══ TERRARIUM DOME (small glass dome with mini garden) ════ */}
      <group position={[0.65, 0.95, 0.47]}>
        {/* Glass dome */}
        <mesh>
          <sphereGeometry args={[0.06, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#a0e8ff" transparent opacity={0.25} metalness={0.8} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
        {/* Soil base */}
        <mesh position={[0, -0.005, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.01, 12]} />
          <meshStandardMaterial color="#3a2510" roughness={0.9} />
        </mesh>
        {/* Tiny plant inside */}
        <mesh position={[0, 0.025, 0]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={0.6} roughness={0.5} />
        </mesh>
        {/* Tiny stem */}
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.003, 0.003, 0.02, 4]} />
          <meshStandardMaterial color="#2a5518" roughness={0.7} />
        </mesh>
      </group>

      {/* ═══ CRYSTALS / GEODES (embedded in bag surface) ═══════════ */}
      {[
        { pos: [-0.72, -0.4, 0.47] as [number, number, number], color: '#7b68ee', size: 0.035 },
        { pos: [0.73, 0.2, 0.47] as [number, number, number], color: '#00e5ff', size: 0.03 },
        { pos: [-0.68, 0.55, 0.47] as [number, number, number], color: '#b366ff', size: 0.025 },
      ].map(({ pos, color, size }, i) => (
        <group key={`crystal-${i}`} position={pos}>
          {/* Crystal shard */}
          <mesh rotation={[0, 0, 0.3 + i * 0.4]}>
            <coneGeometry args={[size * 0.4, size * 2, 4]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} metalness={0.6} roughness={0.1} transparent opacity={0.85} />
          </mesh>
          {/* Smaller shard */}
          <mesh position={[size * 0.4, -size * 0.3, 0]} rotation={[0, 0, -0.5 + i * 0.3]}>
            <coneGeometry args={[size * 0.25, size * 1.2, 4]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} metalness={0.6} roughness={0.1} transparent opacity={0.8} />
          </mesh>
        </group>
      ))}

      {/* ═══ WIND TURBINE (top of bag, animated) ═════════════════ */}
      <group position={[-0.35, 1.35, -0.15]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.12, 6]} />
          <meshStandardMaterial color={SOLAR.copper} metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
        </mesh>
        <group ref={turbineRef} position={[0, 0.13, 0.025]}>
          {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
            <mesh key={`blade-${i}`} rotation={[0, 0, angle]} position={[Math.cos(angle) * 0.06, Math.sin(angle) * 0.06, 0]}>
              <boxGeometry args={[0.12, 0.02, 0.003]} />
              <meshStandardMaterial color="#4a8030" emissive={SOLAR.neonCyan} emissiveIntensity={0.2} metalness={0.3} roughness={0.5} />
            </mesh>
          ))}
        </group>
      </group>

      {/* ═══ ANTENNA (top-right, animated sway) ══════════════════ */}
      <group ref={antennaRef} position={[0.5, 1.3, -0.1]}>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.006, 0.012, 0.2, 6]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.21, 0]}>
          <sphereGeometry args={[0.015, 6, 6]} />
          <meshStandardMaterial color={SOLAR.neonCyan} emissive={SOLAR.neonCyan} emissiveIntensity={1.5} />
        </mesh>
        <mesh position={[0.03, 0.07, 0]}>
          <cylinderGeometry args={[0.004, 0.008, 0.14, 6]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0.03, 0.15, 0]}>
          <sphereGeometry args={[0.01, 6, 6]} />
          <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={1.0} />
        </mesh>
      </group>

      {/* ═══ ENERGY COILS (left side, pulsing glow) ══════════════ */}
      {[
        { y: 0.5, scale: 1.0, ref: coil1MatRef },
        { y: 0.25, scale: 0.85, ref: coil2MatRef },
        { y: 0.0, scale: 0.7, ref: coil3MatRef },
      ].map(({ y, scale, ref }, i) => (
        <mesh key={`coil-${i}`} position={[-0.86, y, 0.2]} rotation={[0, Math.PI / 2, 0]} scale={scale}>
          <torusGeometry args={[0.06, 0.01, 8, 16]} />
          <meshStandardMaterial
            ref={ref}
            color={SOLAR.copper}
            emissive={SOLAR.gold}
            emissiveIntensity={0.8}
            metalness={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}

      {/* ═══ BUTTERFLIES (animated, floating near the bag) ═════════ */}
      <group ref={butterfly1Ref} position={[0.6, 1.1, 0.5]}>
        {/* Body */}
        <mesh>
          <cylinderGeometry args={[0.005, 0.003, 0.04, 4]} />
          <meshStandardMaterial color="#222" roughness={0.5} />
        </mesh>
        {/* Left wing */}
        <mesh position={[-0.015, 0, 0]} rotation={[0, 0, 0.3]}>
          <planeGeometry args={[0.04, 0.025]} />
          <meshStandardMaterial color="#ff8c00" emissive="#ff6600" emissiveIntensity={0.5} side={THREE.DoubleSide} transparent opacity={0.85} />
        </mesh>
        {/* Right wing */}
        <mesh position={[0.015, 0, 0]} rotation={[0, 0, -0.3]}>
          <planeGeometry args={[0.04, 0.025]} />
          <meshStandardMaterial color="#ff8c00" emissive="#ff6600" emissiveIntensity={0.5} side={THREE.DoubleSide} transparent opacity={0.85} />
        </mesh>
      </group>

      <group ref={butterfly2Ref} position={[-0.7, 0.6, 0.6]}>
        <mesh>
          <cylinderGeometry args={[0.004, 0.003, 0.035, 4]} />
          <meshStandardMaterial color="#222" roughness={0.5} />
        </mesh>
        <mesh position={[-0.013, 0, 0]} rotation={[0, 0, 0.3]}>
          <planeGeometry args={[0.035, 0.022]} />
          <meshStandardMaterial color="#00e5ff" emissive="#0099cc" emissiveIntensity={0.6} side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
        <mesh position={[0.013, 0, 0]} rotation={[0, 0, -0.3]}>
          <planeGeometry args={[0.035, 0.022]} />
          <meshStandardMaterial color="#00e5ff" emissive="#0099cc" emissiveIntensity={0.6} side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
      </group>

      {/* ═══ DRAGONFLY (fast-moving, iridescent) ═══════════════════ */}
      <group ref={dragonfly1Ref} position={[0, 0.3, 0.7]}>
        {/* Body */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.004, 0.006, 0.06, 4]} />
          <meshStandardMaterial color="#1a8a4a" emissive="#00ff88" emissiveIntensity={0.4} metalness={0.5} roughness={0.3} />
        </mesh>
        {/* Wings (4) */}
        {[-0.02, 0.02].map((z, wi) => (
          <React.Fragment key={`dw-${wi}`}>
            <mesh position={[-0.018, 0, z]}>
              <planeGeometry args={[0.04, 0.008]} />
              <meshStandardMaterial color="#c0e8ff" transparent opacity={0.4} side={THREE.DoubleSide} metalness={0.5} roughness={0.1} />
            </mesh>
            <mesh position={[0.018, 0, z]}>
              <planeGeometry args={[0.04, 0.008]} />
              <meshStandardMaterial color="#c0e8ff" transparent opacity={0.4} side={THREE.DoubleSide} metalness={0.5} roughness={0.1} />
            </mesh>
          </React.Fragment>
        ))}
      </group>

      {/* ═══ CIRCUIT TRACES ═══════════════════════════════════════ */}
      <primitive object={circuitLeftLine} />
      <primitive object={circuitRightLine} />

      {/* ═══ GOLD NODE DOTS ══════════════════════════════════════ */}
      {[
        [-0.68, 0.32, 0.48], [-0.73, -0.02, 0.48], [-0.68, -0.18, 0.48],
        [0.68, 0.32, 0.48], [0.73, -0.02, 0.48], [0.68, -0.18, 0.48],
      ].map(([x, y, z], i) => (
        <mesh key={`node-${i}`} position={[x, y, z]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={1.5} metalness={0.85} roughness={0.15} />
        </mesh>
      ))}

      {/* ═══ D-RINGS ═════════════════════════════════════════════ */}
      {[-0.88, 0.88].map((x, i) => (
        <mesh key={`dr-${i}`} position={[x, -0.3, 0.15]}>
          <torusGeometry args={[0.04, 0.012, 8, 16]} />
          <meshStandardMaterial {...BAG_HARDWARE} />
        </mesh>
      ))}

      {/* ═══ SOLARPUNK SUN EMBLEM ════════════════════════════════ */}
      <mesh position={[0, -0.28, 0.475]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.035, 0.006, 6, 16]} />
        <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={0.8} metalness={0.8} roughness={0.2} />
      </mesh>
      {[0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4].map((angle, i) => (
        <mesh key={`ray-${i}`} position={[Math.cos(angle) * 0.055, -0.28 + Math.sin(angle) * 0.055, 0.475]} rotation={[0, 0, angle]}>
          <boxGeometry args={[0.02, 0.004, 0.004]} />
          <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={0.6} metalness={0.8} roughness={0.2} />
        </mesh>
      ))}

      {/* ═══ RAIN COLLECTOR FUNNEL (top feature) ═══════════════════ */}
      <group position={[0.2, 1.38, -0.2]}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.04, 0.06, 8, 1, true]} />
          <meshStandardMaterial color={SOLAR.copper} metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        {/* Water inside */}
        <mesh position={[0, -0.015, 0]} rotation={[Math.PI, 0, 0]}>
          <circleGeometry args={[0.025, 8]} />
          <meshStandardMaterial color="#4488cc" emissive="#2266aa" emissiveIntensity={0.3} metalness={0.8} roughness={0.1} />
        </mesh>
      </group>

      {/* ═══ COMPASS ROSE EMBLEM (back of bag) ════════════════════ */}
      <group position={[0, 0.8, -0.465]}>
        {/* Outer ring */}
        <mesh rotation={[0, 0, 0]}>
          <torusGeometry args={[0.06, 0.005, 6, 16]} />
          <meshStandardMaterial color={SOLAR.gold} emissive={SOLAR.gold} emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Cardinal direction arrows */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, i) => (
          <mesh key={`compass-${i}`} position={[Math.cos(angle) * 0.04, Math.sin(angle) * 0.04, 0]} rotation={[0, 0, angle - Math.PI / 2]}>
            <coneGeometry args={[0.008, 0.025, 3]} />
            <meshStandardMaterial color={i === 0 ? '#ff4444' : SOLAR.cream} emissive={i === 0 ? '#ff2222' : SOLAR.gold} emissiveIntensity={0.3} metalness={0.5} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* ═══ COMPARTMENT POCKETS ═════════════════════════════════ */}
      {COMPARTMENT_LAYOUTS.map((layout) => {
        const stats = compartmentStats[layout.key] || { miniStat: '', hasActivity: false };
        return (
          <CompartmentMesh
            key={layout.key}
            layout={layout}
            miniStat={stats.miniStat}
            hasActivity={stats.hasActivity}
            onOpen={onOpenCompartment}
          />
        );
      })}
    </group>
  );
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
