/**
 * Backpack3DScene — Main R3F Canvas wrapper for the SolarPunk 3D backpack.
 * Three particle systems: cyan spores + golden pollen + pink fireflies.
 * Distant planets orbiting in the background — SolarPunk space garden.
 */
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import BackpackCamera from './BackpackCamera';
import BackpackLighting from './BackpackLighting';
import BackpackModel from './BackpackModel';
import { getAllCompartmentStats } from './compartmentActivity';
import { SCENE_BG, SOLAR } from './backpackMaterials';
import type { BackpackData } from '../../hooks/useBackpackData';

interface Props {
  data: BackpackData;
  onOpenCompartment: (key: string) => void;
}

// ─── Particle Systems ────────────────────────────────────────────────────────

/** Floating SolarPunk spores — cyan-green, drifting upward */
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
      <pointsMaterial
        color={SOLAR.neonCyan}
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.6}
      />
    </points>
  );
}

/** Golden pollen particles — warm, slower, slightly larger */
function GoldenPollen({ count = 30 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 14;
      pos[i + 1] = (Math.random() - 0.5) * 10;
      pos[i + 2] = (Math.random() - 0.5) * 8;
      vel[i] = (Math.random() - 0.5) * 0.002;
      vel[i + 1] = Math.random() * 0.003 + 0.0005;
      vel[i + 2] = (Math.random() - 0.5) * 0.002;
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
      if (pos[i + 1] > 5) { pos[i + 1] = -4; pos[i] = (Math.random() - 0.5) * 14; }
      if (Math.abs(pos[i]) > 7) velocities[i] *= -1;
      if (Math.abs(pos[i + 2]) > 4) velocities[i + 2] *= -1;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={SOLAR.gold}
        size={0.045}
        sizeAttenuation
        transparent
        opacity={0.5}
      />
    </points>
  );
}

/** Tiny pink firefly particles — sparse, magical */
function Fireflies({ count = 15 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 10;
      pos[i + 1] = (Math.random() - 0.5) * 8;
      pos[i + 2] = (Math.random() - 0.5) * 6;
      vel[i] = (Math.random() - 0.5) * 0.006;
      vel[i + 1] = (Math.random() - 0.5) * 0.004;
      vel[i + 2] = (Math.random() - 0.5) * 0.006;
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
      if (Math.abs(pos[i]) > 5) velocities[i] *= -1;
      if (Math.abs(pos[i + 1]) > 4) velocities[i + 1] *= -1;
      if (Math.abs(pos[i + 2]) > 3) velocities[i + 2] *= -1;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color="#ff69b4"
        size={0.08}
        sizeAttenuation
        transparent
        opacity={0.4}
      />
    </points>
  );
}

// ─── Background Stars ────────────────────────────────────────────────────────

/** Distant starfield — tiny white dots far away */
function Starfield({ count = 400 }: { count?: number }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      // Spread stars on a large sphere shell
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

// ─── Planets ─────────────────────────────────────────────────────────────────

interface PlanetConfig {
  radius: number;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitOffset: number;
  yOffset: number;
  roughness: number;
  metalness: number;
  hasRing?: boolean;
  ringColor?: string;
  ringInner?: number;
  ringOuter?: number;
  hasMoon?: boolean;
  moonColor?: string;
  moonRadius?: number;
  moonOrbit?: number;
  moonSpeed?: number;
  hasAtmosphere?: boolean;
  atmosphereColor?: string;
}

const PLANETS: PlanetConfig[] = [
  // Gas giant with rings — Saturn-like, upper left distance
  {
    radius: 1.8,
    color: '#c8956a',
    emissive: '#8a5a30',
    emissiveIntensity: 0.15,
    orbitRadius: 18,
    orbitSpeed: 0.04,
    orbitOffset: 0,
    yOffset: 6,
    roughness: 0.7,
    metalness: 0.1,
    hasRing: true,
    ringColor: '#d4a86a',
    ringInner: 2.4,
    ringOuter: 3.6,
    hasMoon: true,
    moonColor: '#a0a0b0',
    moonRadius: 0.25,
    moonOrbit: 3.0,
    moonSpeed: 0.3,
  },
  // SolarPunk green planet — lush bio-world, right side
  {
    radius: 1.2,
    color: '#2d8a4e',
    emissive: '#39ff14',
    emissiveIntensity: 0.25,
    orbitRadius: 22,
    orbitSpeed: -0.03,
    orbitOffset: Math.PI * 0.7,
    yOffset: -3,
    roughness: 0.6,
    metalness: 0.05,
    hasAtmosphere: true,
    atmosphereColor: '#60ff80',
    hasMoon: true,
    moonColor: '#5aad58',
    moonRadius: 0.2,
    moonOrbit: 2.2,
    moonSpeed: 0.5,
  },
  // Ice planet — blue-white, upper right far
  {
    radius: 0.9,
    color: '#88c8ee',
    emissive: '#4488cc',
    emissiveIntensity: 0.2,
    orbitRadius: 28,
    orbitSpeed: 0.02,
    orbitOffset: Math.PI * 1.3,
    yOffset: 8,
    roughness: 0.3,
    metalness: 0.4,
    hasRing: true,
    ringColor: '#a0d8ff',
    ringInner: 1.2,
    ringOuter: 1.8,
  },
  // Volcanic planet — deep red/orange, lower left
  {
    radius: 0.7,
    color: '#8a2a1a',
    emissive: '#ff4422',
    emissiveIntensity: 0.4,
    orbitRadius: 15,
    orbitSpeed: 0.06,
    orbitOffset: Math.PI * 0.4,
    yOffset: -7,
    roughness: 0.8,
    metalness: 0.2,
    hasAtmosphere: true,
    atmosphereColor: '#ff6640',
  },
  // Purple crystal planet — mystic, far away
  {
    radius: 1.4,
    color: '#6a3d8a',
    emissive: '#b366ff',
    emissiveIntensity: 0.3,
    orbitRadius: 32,
    orbitSpeed: -0.015,
    orbitOffset: Math.PI * 1.8,
    yOffset: 2,
    roughness: 0.2,
    metalness: 0.6,
    hasMoon: true,
    moonColor: '#d4a0ff',
    moonRadius: 0.18,
    moonOrbit: 2.5,
    moonSpeed: 0.4,
    hasRing: true,
    ringColor: '#b366ff',
    ringInner: 1.8,
    ringOuter: 2.4,
  },
  // Tiny gold dwarf planet — close and warm
  {
    radius: 0.35,
    color: '#d4a020',
    emissive: '#ffc93c',
    emissiveIntensity: 0.5,
    orbitRadius: 12,
    orbitSpeed: 0.08,
    orbitOffset: Math.PI * 1.1,
    yOffset: 3,
    roughness: 0.4,
    metalness: 0.7,
  },
  // Ocean world — deep blue, distant
  {
    radius: 1.0,
    color: '#1a4a8a',
    emissive: '#0066cc',
    emissiveIntensity: 0.2,
    orbitRadius: 25,
    orbitSpeed: 0.025,
    orbitOffset: Math.PI * 0.1,
    yOffset: -5,
    roughness: 0.15,
    metalness: 0.3,
    hasAtmosphere: true,
    atmosphereColor: '#4488ff',
    hasMoon: true,
    moonColor: '#c0c0c0',
    moonRadius: 0.15,
    moonOrbit: 1.8,
    moonSpeed: 0.6,
  },
  // Tiny pink moon — floating near
  {
    radius: 0.25,
    color: '#c06080',
    emissive: '#ff69b4',
    emissiveIntensity: 0.4,
    orbitRadius: 10,
    orbitSpeed: -0.1,
    orbitOffset: Math.PI * 1.5,
    yOffset: -2,
    roughness: 0.5,
    metalness: 0.3,
  },
];

/** Creates a procedural planet surface texture */
function createPlanetTexture(baseColor: string, detail: boolean): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // Base color
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 128, 64);

  if (detail) {
    // Cloud/surface bands
    const c = new THREE.Color(baseColor);
    for (let band = 0; band < 6; band++) {
      const y = band * 11 + Math.random() * 5;
      const h = 4 + Math.random() * 6;
      const lighter = c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      ctx.fillStyle = `rgba(${Math.floor(lighter.r * 255)}, ${Math.floor(lighter.g * 255)}, ${Math.floor(lighter.b * 255)}, 0.4)`;
      ctx.fillRect(0, y, 128, h);
    }

    // Surface spots/craters
    for (let s = 0; s < 12; s++) {
      const sx = Math.random() * 128;
      const sy = Math.random() * 64;
      const sr = Math.random() * 6 + 2;
      const spotColor = c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.floor(spotColor.r * 255)}, ${Math.floor(spotColor.g * 255)}, ${Math.floor(spotColor.b * 255)}, 0.5)`;
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Single animated planet with optional ring, moon, atmosphere */
function Planet({ config }: { config: PlanetConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const planetRef = useRef<THREE.Mesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);

  const planetTex = useMemo(() => createPlanetTexture(config.color, true), [config.color]);

  const ringGeo = useMemo(() => {
    if (!config.hasRing) return null;
    return new THREE.RingGeometry(config.ringInner!, config.ringOuter!, 32);
  }, [config.hasRing, config.ringInner, config.ringOuter]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    // Orbit
    if (groupRef.current) {
      const angle = t * config.orbitSpeed + config.orbitOffset;
      groupRef.current.position.x = Math.cos(angle) * config.orbitRadius;
      groupRef.current.position.z = Math.sin(angle) * config.orbitRadius * 0.5; // elliptical
      groupRef.current.position.y = config.yOffset + Math.sin(t * 0.1 + config.orbitOffset) * 0.5;
    }

    // Spin
    if (planetRef.current) {
      planetRef.current.rotation.y += 0.002;
    }

    // Moon orbit
    if (moonRef.current && config.hasMoon) {
      const moonAngle = t * config.moonSpeed!;
      moonRef.current.position.x = Math.cos(moonAngle) * config.moonOrbit!;
      moonRef.current.position.z = Math.sin(moonAngle) * config.moonOrbit!;
      moonRef.current.position.y = Math.sin(moonAngle * 0.7) * 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Planet body */}
      <mesh ref={planetRef}>
        <sphereGeometry args={[config.radius, 24, 24]} />
        <meshStandardMaterial
          color={config.color}
          map={planetTex}
          emissive={config.emissive}
          emissiveIntensity={config.emissiveIntensity}
          roughness={config.roughness}
          metalness={config.metalness}
        />
      </mesh>

      {/* Atmosphere glow */}
      {config.hasAtmosphere && (
        <mesh scale={1.12}>
          <sphereGeometry args={[config.radius, 24, 24]} />
          <meshBasicMaterial
            color={config.atmosphereColor!}
            transparent
            opacity={0.12}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* Ring */}
      {ringGeo && (
        <mesh geometry={ringGeo} rotation={[Math.PI / 2.5, 0, 0.2]}>
          <meshStandardMaterial
            color={config.ringColor!}
            emissive={config.ringColor!}
            emissiveIntensity={0.1}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            roughness={0.4}
            metalness={0.3}
          />
        </mesh>
      )}

      {/* Moon */}
      {config.hasMoon && (
        <mesh ref={moonRef}>
          <sphereGeometry args={[config.moonRadius!, 12, 12]} />
          <meshStandardMaterial
            color={config.moonColor!}
            roughness={0.6}
            metalness={0.2}
            emissive={config.moonColor!}
            emissiveIntensity={0.1}
          />
        </mesh>
      )}
    </group>
  );
}

// ─── Distant Nebula Glow ─────────────────────────────────────────────────────

/** Soft colored nebula clouds in the far background */
function NebulaGlow() {
  return (
    <>
      {/* Large soft glow — upper right */}
      <mesh position={[25, 15, -30]}>
        <sphereGeometry args={[8, 16, 16]} />
        <meshBasicMaterial color="#1a3060" transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>
      {/* Greenish nebula — lower left */}
      <mesh position={[-20, -10, -25]}>
        <sphereGeometry args={[6, 16, 16]} />
        <meshBasicMaterial color="#0a3020" transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>
      {/* Purple haze — far center */}
      <mesh position={[0, 5, -35]}>
        <sphereGeometry args={[10, 16, 16]} />
        <meshBasicMaterial color="#1a1030" transparent opacity={0.1} side={THREE.BackSide} />
      </mesh>
      {/* Warm glow — lower right */}
      <mesh position={[15, -8, -20]}>
        <sphereGeometry args={[5, 16, 16]} />
        <meshBasicMaterial color="#301a0a" transparent opacity={0.1} side={THREE.BackSide} />
      </mesh>
    </>
  );
}

// ─── Main Scene ──────────────────────────────────────────────────────────────

export default function Backpack3DScene({ data, onOpenCompartment }: Props) {
  const stats = useMemo(() => getAllCompartmentStats(data), [data]);

  return (
    <div style={{
      width: '100%',
      height: 520,
      borderRadius: 4,
      overflow: 'hidden',
      border: '2px solid #2d501630',
    }}>
      <Canvas
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        style={{ background: SCENE_BG }}
        onPointerMissed={() => {
          if (typeof document !== 'undefined') document.body.style.cursor = 'default';
        }}
      >
        <BackpackCamera />
        <BackpackLighting />
        <BackpackModel
          compartmentStats={stats}
          onOpenCompartment={onOpenCompartment}
        />

        {/* Particle systems */}
        <CyanSpores count={60} />
        <GoldenPollen count={30} />
        <Fireflies count={15} />

        {/* Background */}
        <Starfield count={400} />
        <NebulaGlow />

        {/* Distant planets */}
        {PLANETS.map((config, i) => (
          <Planet key={`planet-${i}`} config={config} />
        ))}
      </Canvas>
    </div>
  );
}
