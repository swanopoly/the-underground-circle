/**
 * SplineBackpackScene — Loads a real 3D backpack from Spline.
 *
 * SETUP:
 *   1. Design your backpack in Spline (spline.design)
 *   2. Name clickable objects: compartment-terminal, compartment-trading, etc.
 *   3. Publish the scene → copy the production URL
 *   4. Paste the URL in SPLINE_SCENE_URL below
 *
 * The R3F background (planets, stars, particles) renders behind the Spline canvas.
 */
import React, { useRef, useMemo, useCallback, Suspense } from 'react';
import Spline from '@splinetool/react-spline';
import type { Application as SplineApp } from '@splinetool/runtime';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import BackpackCamera from './BackpackCamera';
import { getAllCompartmentStats } from './compartmentActivity';
import { SCENE_BG, SOLAR } from './backpackMaterials';
import type { BackpackData } from '../../hooks/useBackpackData';

// ─── PASTE YOUR SPLINE SCENE URL HERE ────────────────────────────────────────
const SPLINE_SCENE_URL = 'https://prod.spline.design/Ah5Z7wGOiFbQfiJv/scene.splinecode';
// To get a URL: Open Spline → File → Export → Code (Production URL)
// ─────────────────────────────────────────────────────────────────────────────

/** Map of Spline object names → compartment keys */
const SPLINE_OBJECT_MAP: Record<string, string> = {
  'compartment-terminal': 'terminal',
  'compartment-trading': 'trading',
  'compartment-cost': 'cost',
  'compartment-traces': 'traces',
  'compartment-farm': 'farm',
  'compartment-analytics': 'analytics',
  'compartment-llm-bench': 'llm-bench',
  'compartment-canvas': 'canvas',
  'compartment-performance': 'performance',
  'compartment-prompts': 'prompts',
  'compartment-projects': 'projects',
  // Also support clicking the whole backpack body
  'backpack-body': '',
  'backpack': '',
};

interface Props {
  data: BackpackData;
  onOpenCompartment: (key: string) => void;
}

// ─── Background Effects (R3F) ────────────────────────────────────────────────

/** Distant starfield */
function Starfield({ count = 400 }: { count?: number }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 40 + Math.random() * 20;
      pos[i] = r * Math.sin(phi) * Math.cos(theta);
      pos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, [count]);

  return (
    <points geometry={geometry}>
      <pointsMaterial color="#ffffff" size={0.08} sizeAttenuation transparent opacity={0.7} />
    </points>
  );
}

/** Floating cyan spores */
function CyanSpores({ count = 60 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 12;
      pos[i + 1] = (Math.random() - 0.5) * 10;
      pos[i + 2] = (Math.random() - 0.5) * 8;
      vel[i] = (Math.random() - 0.5) * 0.004;
      vel[i + 1] = Math.random() * 0.005 + 0.001;
      vel[i + 2] = (Math.random() - 0.5) * 0.004;
    }
    return { positions: pos, velocities: vel };
  }, [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame(() => {
    if (!pointsRef.current) return;
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += velocities[i];
      pos[i + 1] += velocities[i + 1];
      pos[i + 2] += velocities[i + 2];
      if (pos[i + 1] > 5) { pos[i + 1] = -4; pos[i] = (Math.random() - 0.5) * 12; }
      if (Math.abs(pos[i]) > 6) velocities[i] *= -1;
      if (Math.abs(pos[i + 2]) > 4) velocities[i + 2] *= -1;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={SOLAR.neonCyan} size={0.06} sizeAttenuation transparent opacity={0.6} />
    </points>
  );
}

/** Orbiting planet */
function Planet({ radius, color, emissive, orbitRadius, orbitSpeed, offset, yOffset }: {
  radius: number; color: string; emissive: string;
  orbitRadius: number; orbitSpeed: number; offset: number; yOffset: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.x = Math.cos(t * orbitSpeed + offset) * orbitRadius;
    ref.current.position.z = Math.sin(t * orbitSpeed + offset) * orbitRadius * 0.5;
    ref.current.position.y = yOffset + Math.sin(t * 0.1 + offset) * 0.5;
    ref.current.rotation.y += 0.002;
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.2} roughness={0.5} metalness={0.2} />
    </mesh>
  );
}

/** Nebula glow clouds */
function NebulaGlow() {
  return (
    <>
      <mesh position={[25, 15, -30]}>
        <sphereGeometry args={[8, 16, 16]} />
        <meshBasicMaterial color="#1a3060" transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>
      <mesh position={[-20, -10, -25]}>
        <sphereGeometry args={[6, 16, 16]} />
        <meshBasicMaterial color="#0a3020" transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 5, -35]}>
        <sphereGeometry args={[10, 16, 16]} />
        <meshBasicMaterial color="#1a1030" transparent opacity={0.1} side={THREE.BackSide} />
      </mesh>
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SplineBackpackScene({ data, onOpenCompartment }: Props) {
  const splineRef = useRef<SplineApp | null>(null);
  const stats = useMemo(() => getAllCompartmentStats(data), [data]);

  const handleSplineLoad = useCallback((splineApp: SplineApp) => {
    splineRef.current = splineApp;

    // Set up activity indicators on compartments if the Spline scene supports it
    for (const [objName, key] of Object.entries(SPLINE_OBJECT_MAP)) {
      if (!key) continue;
      const stat = stats[key];
      if (stat?.hasActivity) {
        try {
          const obj = splineApp.findObjectByName(objName);
          if (obj) {
            // Trigger activity animation if the scene has one
            splineApp.emitEvent('start', objName);
          }
        } catch {
          // Object not found in scene — that's fine
        }
      }
    }
  }, [stats]);

  const handleSplineMouseDown = useCallback((e: any) => {
    const targetName = e?.target?.name;
    if (!targetName) return;

    // Check direct compartment mapping
    const compartmentKey = SPLINE_OBJECT_MAP[targetName];
    if (compartmentKey) {
      onOpenCompartment(compartmentKey);
      return;
    }

    // Check partial name match (e.g., "pocket-terminal" or "terminal-pocket")
    for (const [, key] of Object.entries(SPLINE_OBJECT_MAP)) {
      if (key && targetName.toLowerCase().includes(key.toLowerCase())) {
        onOpenCompartment(key);
        return;
      }
    }
  }, [onOpenCompartment]);

  return (
    <div style={{
      width: '100%',
      height: 520,
      borderRadius: 4,
      overflow: 'hidden',
      border: '2px solid #2d501630',
      position: 'relative',
    }}>
      {/* R3F background layer — stars, planets, particles */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 0,
      }}>
        <Canvas
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
          style={{ background: SCENE_BG }}
        >
          <ambientLight intensity={0.3} />
          <BackpackCamera />
          <Starfield count={400} />
          <CyanSpores count={40} />
          <NebulaGlow />

          {/* Planets */}
          <Planet radius={1.8} color="#c8956a" emissive="#8a5a30" orbitRadius={18} orbitSpeed={0.04} offset={0} yOffset={6} />
          <Planet radius={1.2} color="#2d8a4e" emissive="#39ff14" orbitRadius={22} orbitSpeed={-0.03} offset={2.2} yOffset={-3} />
          <Planet radius={0.9} color="#88c8ee" emissive="#4488cc" orbitRadius={28} orbitSpeed={0.02} offset={4.1} yOffset={8} />
          <Planet radius={0.7} color="#8a2a1a" emissive="#ff4422" orbitRadius={15} orbitSpeed={0.06} offset={1.3} yOffset={-7} />
          <Planet radius={1.4} color="#6a3d8a" emissive="#b366ff" orbitRadius={32} orbitSpeed={-0.015} offset={5.7} yOffset={2} />
          <Planet radius={0.35} color="#d4a020" emissive="#ffc93c" orbitRadius={12} orbitSpeed={0.08} offset={3.5} yOffset={3} />
          <Planet radius={1.0} color="#1a4a8a" emissive="#0066cc" orbitRadius={25} orbitSpeed={0.025} offset={0.3} yOffset={-5} />
          <Planet radius={0.25} color="#c06080" emissive="#ff69b4" orbitRadius={10} orbitSpeed={-0.1} offset={4.7} yOffset={-2} />
        </Canvas>
      </div>

      {/* Spline foreground — the real 3D backpack */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1,
      }}>
        <Spline
          scene={SPLINE_SCENE_URL}
          onLoad={handleSplineLoad}
          onSplineMouseDown={handleSplineMouseDown}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
