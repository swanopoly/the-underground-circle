/**
 * LoginBackground3D — Living Pixel Planet.
 * A massive voxel planet with energy flowing through its core.
 * The crater pulses with light, energy particles erupt into the air,
 * and veins of green energy glow across the surface. Interactive
 * drag-to-orbit camera. No pixel agents — just the planet alive.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Platform } from 'react-native';

const ACCENT_HEX = 0xb8ff61;

// ─── Global mouse position for swan head tracking ──────────────────────────
// Module-level so it persists across renders and is readable from useFrame
const _globalMouse = { x: 0, y: 0 };
let _mouseListenerAttached = false;
function attachMouseListener() {
  if (_mouseListenerAttached || typeof window === 'undefined') return;
  _mouseListenerAttached = true;
  window.addEventListener('mousemove', (e: MouseEvent) => {
    _globalMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    _globalMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
}

// ─── Portal dive trigger (global event) ─────────────────────────────────────
// LoginScreen dispatches 'uc-portal-dive' on window to trigger camera rush

// ─── Interactive Camera ─────────────────────────────────────────────────────

function InteractiveCamera() {
  const isDragging = useRef(false);
  const hasInteracted = useRef(false);
  const prev = useRef({ x: 0, y: 0 });
  const userOffset = useRef({ x: 0, y: 0 });
  const rot = useRef({ x: 0.15, y: 0 });
  const diving = useRef(false);
  const diveStart = useRef(0);
  const diveStartPos = useRef(new THREE.Vector3());

  // Crater direction — where the portal is
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const portalCenter = useMemo(() => {
    const d = craterDir.clone().multiplyScalar(5.5);
    return new THREE.Vector3(d.x, d.y - 2, d.z);
  }, [craterDir]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (diving.current) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') return;
      isDragging.current = true;
      hasInteracted.current = true;
      prev.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isDragging.current = false; };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current || diving.current) return;
      userOffset.current.y += (e.clientX - prev.current.x) * 0.003;
      userOffset.current.x += (e.clientY - prev.current.y) * 0.002;
      userOffset.current.x = Math.max(-0.8, Math.min(0.8, userOffset.current.x));
      prev.current = { x: e.clientX, y: e.clientY };
    };
    // Listen for portal dive event
    const onDive = () => { diving.current = true; diveStart.current = 0; diveStartPos.current.set(0, 0, 0); /* will be set on first frame */ };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('uc-portal-dive', onDive);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('uc-portal-dive', onDive);
    };
  }, []);

  useFrame(({ camera, clock }, delta) => {
    const t = clock.elapsedTime;

    if (diving.current) {
      // Capture camera position on first dive frame
      if (diveStartPos.current.lengthSq() === 0) {
        diveStartPos.current.copy(camera.position);
      }

      diveStart.current += delta;
      const diveDuration = 1.5;
      const progress = Math.min(diveStart.current / diveDuration, 1);
      // Smooth ease that starts moving IMMEDIATELY — no stall at the beginning
      // Using sine ease-in: gentle at first but visibly moving from frame 1
      const eased = 1 - Math.cos(progress * Math.PI * 0.5);

      // Just zoom straight forward along the camera's look direction into the portal
      const target = portalCenter.clone();
      // Move straight toward portal center — only zoom, no lateral movement
      const dir = target.clone().sub(diveStartPos.current).normalize();
      const totalDist = diveStartPos.current.distanceTo(target) + 4; // overshoot into tunnel

      camera.position.copy(diveStartPos.current).addScaledVector(dir, eased * totalDist);

      // Keep looking at the same point — no jarring lookAt change
      camera.lookAt(target);

      // Slight FOV widening for speed feel
      (camera as THREE.PerspectiveCamera).fov = 55 + eased * 15;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      return;
    }

    // Normal idle/interactive camera
    const idleY = hasInteracted.current ? 0 : Math.sin(t * 0.15) * 0.3;
    const idleX = hasInteracted.current ? 0 : Math.sin(t * 0.1) * 0.08;

    const targetX = 0.15 + userOffset.current.x + idleX;
    const targetY = userOffset.current.y + idleY;

    rot.current.x += (targetX - rot.current.x) * 0.04;
    rot.current.y += (targetY - rot.current.y) * 0.04;

    const d = 22;
    camera.position.x = Math.sin(rot.current.y) * Math.cos(rot.current.x) * d;
    camera.position.y = Math.sin(rot.current.x) * d * 0.5 + 2;
    camera.position.z = Math.cos(rot.current.y) * Math.cos(rot.current.x) * d;
    camera.lookAt(0, -1, 0);
  });

  return null;
}

// ─── Voxel Planet with Energy Veins ─────────────────────────────────────────

interface PlanetVoxel { x: number; y: number; z: number; color: THREE.Color; isVein: boolean }

function VoxelPlanet() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const veinIndices = useRef<number[]>([]);

  const voxels = useMemo(() => {
    const list: PlanetVoxel[] = [];
    const radius = 8;
    const step = 0.65;
    const craterDir = new THREE.Vector3(0.0, 0.35, 1.0).normalize();
    const craterAngle = 0.65; // wider entrance opening, but thicker shell keeps blocks dense around rim

    // Seed energy vein paths (3D noise-like paths along surface)
    const veinSeeds = Array.from({ length: 8 }, (_, i) => ({
      theta: (i / 8) * Math.PI * 2 + Math.random() * 0.5,
      phi: 0.8 + Math.random() * 1.4,
      width: 0.15 + Math.random() * 0.1,
    }));

    for (let x = -radius; x <= radius; x += step) {
      for (let y = -radius; y <= radius; y += step) {
        for (let z = -radius; z <= radius; z += step) {
          const dist = Math.sqrt(x * x + y * y + z * z);
          // Thicker shell near the crater rim for more block coverage
          const norm = new THREE.Vector3(x, y, z).normalize();
          const dotCrater = norm.dot(craterDir);
          const nearRim = dotCrater > Math.cos(craterAngle + 0.35);
          const shellThickness = nearRim ? step * 3.5 : step * 2.5;
          if (dist > radius || dist < radius - shellThickness) continue;
          if (dotCrater > Math.cos(craterAngle)) continue;

          const isEdge = dotCrater > Math.cos(craterAngle + 0.12);
          const isNearEdge = dotCrater > Math.cos(craterAngle + 0.3);
          const ny = y / radius;
          const noise = Math.random();

          // Check if near an energy vein
          const vTheta = Math.atan2(z, x);
          const vPhi = Math.acos(y / radius);
          let isVein = false;
          for (const seed of veinSeeds) {
            const dTheta = Math.abs(((vTheta - seed.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            const dPhi = Math.abs(vPhi - seed.phi);
            if (dTheta < seed.width && dPhi < 0.8) { isVein = true; break; }
            // Branches
            if (dTheta < seed.width * 0.6 && dPhi < 1.4) { isVein = true; break; }
          }
          // Crater connection veins
          if (isNearEdge && noise > 0.4) isVein = true;

          let color: THREE.Color;
          if (isEdge) {
            color = noise > 0.5 ? new THREE.Color('#d4ff9f') : new THREE.Color('#b8ff61');
          } else if (isVein) {
            color = noise > 0.6 ? new THREE.Color('#4ade80') : noise > 0.3 ? new THREE.Color('#22c55e') : new THREE.Color('#16a34a');
          } else if (ny > 0.6) {
            color = new THREE.Color('#a7f3d0');
          } else if (ny > 0.15) {
            color = noise > 0.6 ? new THREE.Color('#1a5c2a') : noise > 0.3 ? new THREE.Color('#15803d') : new THREE.Color('#0f5132');
          } else if (ny > -0.3) {
            color = noise > 0.5 ? new THREE.Color('#5c3d2e') : new THREE.Color('#3d2b1f');
          } else if (ny > -0.7) {
            color = noise > 0.5 ? new THREE.Color('#3a3a3a') : new THREE.Color('#2a2a2a');
          } else {
            color = noise > 0.4 ? new THREE.Color('#a7f3d0') : new THREE.Color('#2a2a2a');
          }

          list.push({ x, y, z, color, isVein });
        }
      }
    }
    return list;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const veins: number[] = [];
    voxels.forEach((v, i) => {
      dummy.position.set(v.x, v.y, v.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, v.color);
      if (v.isVein) veins.push(i);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    veinIndices.current = veins;
  }, [voxels]);

  // Animate energy veins — pulse their colors
  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.instanceColor) return;
    // Gentle wobble — crater stays facing front
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.08) * 0.15;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.06) * 0.05;
    }

    const t = state.clock.elapsedTime;
    const bright = new THREE.Color('#b8ff61');
    const dim = new THREE.Color('#16a34a');
    const temp = new THREE.Color();

    // Only update a subset each frame for perf
    const veins = veinIndices.current;
    const len = veins.length;
    for (let vi = 0; vi < len; vi++) {
      const idx = veins[vi];
      const v = voxels[idx];
      // Wave based on angle from crater
      const angle = Math.atan2(v.z, v.x);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 + angle * 3 + v.y * 0.8);
      temp.copy(dim).lerp(bright, pulse);
      mesh.setColorAt(idx, temp);
    }
    mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={groupRef} position={[0, -2, 0]}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, voxels.length]}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial vertexColors roughness={0.15} metalness={0.4} />
      </instancedMesh>

    </group>
  );
}

// ─── Energy Core (pulsing glow inside the planet) ───────────────────────────

function EnergyCore() {
  const coreRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      const s = 2.5 + Math.sin(t * 1.2) * 0.4;
      coreRef.current.scale.setScalar(s);
      (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(t * 1.8) * 0.6;
    }
    if (pulseRef.current) {
      const s = 4.0 + Math.sin(t * 0.8) * 1.0;
      pulseRef.current.scale.setScalar(s);
      (pulseRef.current.material as THREE.MeshStandardMaterial).opacity = 0.06 + Math.sin(t * 1.5) * 0.03;
    }
  });

  return (
    <group position={[0, -2, 0]}>
      {/* Inner core — neon green like R&M portal */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial color={0x224422} emissive={0x224422} emissiveIntensity={0.1} transparent opacity={0.04} depthWrite={false} />
      </mesh>
      {/* Outer pulse — bright green bloom */}
      <mesh ref={pulseRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial color={0x114422} emissive={0x114422} emissiveIntensity={0.05} transparent opacity={0.01} depthWrite={false} />
      </mesh>
      {/* Bright green core light */}
      <pointLight color={0x44dd66} intensity={1} distance={4} decay={2} />
    </group>
  );
}

// ─── Underground Circle (glowing rings inside crater) ───────────────────────

function BubblyRing({ radius, tube, speed, wobbleAmt, wobbleFreq, wobbleSeed, color, emissive, brightness, opacity, zOffset = 0 }: {
  radius: number; tube: number; speed: number; wobbleAmt: number; wobbleFreq: number; wobbleSeed: number;
  color: number; emissive: number; brightness: number; opacity: number; zOffset?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const basePositions = useRef<Float32Array | null>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const geo = meshRef.current.geometry;
    const pos = geo.attributes.position;

    // Store original positions on first frame
    if (!basePositions.current) {
      basePositions.current = new Float32Array(pos.array.length);
      basePositions.current.set(pos.array as Float32Array);
    }

    const base = basePositions.current;
    const arr = pos.array as Float32Array;

    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const bx = base[i3], by = base[i3 + 1], bz = base[i3 + 2];
      // Angle around the ring center
      const angle = Math.atan2(by, bx);
      // Wobble: distort radius with layered sine waves
      const wobble = wobbleAmt * (
        Math.sin(angle * wobbleFreq + t * speed * 2 + wobbleSeed) * 0.5 +
        Math.sin(angle * (wobbleFreq * 1.7) - t * speed * 1.3 + wobbleSeed * 2.3) * 0.3 +
        Math.sin(angle * (wobbleFreq * 3.1) + t * speed * 0.8 + wobbleSeed * 4.1) * 0.2
      );
      // Push vertex radially
      const dist = Math.sqrt(bx * bx + by * by);
      if (dist > 0.001) {
        const nx = bx / dist, ny = by / dist;
        arr[i3] = bx + nx * wobble;
        arr[i3 + 1] = by + ny * wobble;
      }
      // Slight z wobble for bubbly depth
      arr[i3 + 2] = bz + Math.sin(angle * wobbleFreq * 2 + t * speed + wobbleSeed * 3) * wobbleAmt * 0.3;
    }
    pos.needsUpdate = true;

    // Slow rotation
    meshRef.current.rotation.z = t * speed;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, zOffset]}>
      <torusGeometry args={[radius, tube, 12, 80]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={brightness}
        transparent
        opacity={opacity}
        toneMapped={false}
      />
    </mesh>
  );
}

function UndergroundCircle() {
  const ringCount = 5;
  const ringData = useMemo(() => {
    // 5 rings forming a tunnel: deep inside (small, far back) to entrance (large, front)
    // Each ring has a radius and z-depth along the tunnel
    const rings = [
      { r: 1.1,  z: -5.5 },  // deepest — matches tunnel at this depth
      { r: 1.9,  z: -4.0 },
      { r: 2.7,  z: -2.5 },
      { r: 3.4,  z: -1.2 },
      { r: 4.0,  z: 0.0 },   // entrance — matches tunnel mouth exactly
    ];
    return rings.map(({ r, z }, i) => {
      const t = i / (rings.length - 1);
      return {
        radius: r,
        tube: 0.04 + (1 - t) * 0.02,
        speed: (0.2 - t * 0.15) * (i % 2 === 0 ? 1 : -1),
        wobbleAmt: 0.08 + t * 0.14,
        wobbleFreq: 3 + i * 0.8,
        wobbleSeed: i * 2.3,
        brightness: 1.5 + t * 1.8,
        opacity: 0.5 + t * 0.4,
        zOffset: z,
      };
    });
  }, []);

  const craterDir = new THREE.Vector3(0.0, 0.35, 1.0).normalize();

  const ringColors = [0x009933, 0x00bb44, 0x00dd55, 0x00ff4c, 0x44ff77];
  const emissiveColors = [0x00cc44, 0x00ee55, 0x11ff66, 0x22ff77, 0x55ff99];

  return (
    <group position={[0, -2, 0]}>
      <group position={[craterDir.x * 5.5, craterDir.y * 5.5, craterDir.z * 5.5]} rotation={[-0.35, 0, 0]}>
        {/* Dark void center */}
        <mesh>
          <circleGeometry args={[3.5, 64]} />
          <meshStandardMaterial color={0x002a10} emissive={0x004422} emissiveIntensity={0.15} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>

        {/* Bubbly wobbling portal rings */}
        {ringData.map((ring, i) => (
          <BubblyRing
            key={i}
            {...ring}
            color={ringColors[i]}
            emissive={emissiveColors[i]}
            zOffset={ring.zOffset}
          />
        ))}



        {/* Portal light */}
        <pointLight color={0x44ff66} intensity={3} distance={6} decay={2} />
        <pointLight color={0x88ffaa} intensity={2} distance={5} decay={2} position={[0, 0, 1]} />
      </group>
    </group>
  );
}

// ─── Portal Vortex (spiraling particles inside crater) ──────────────────────

function PortalVortex({ count = 80 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);
  // Build a local coordinate system for the crater face
  const craterUp = useMemo(() => new THREE.Vector3(0, 1, 0).cross(craterDir).normalize(), [craterDir]);
  const craterRight = useMemo(() => new THREE.Vector3().crossVectors(craterDir, craterUp).normalize(), [craterDir, craterUp]);

  const { positions, initAngles, initRadii, initDepths, spiralSpeeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const ang = new Float32Array(count);
    const rad = new Float32Array(count);
    const dep = new Float32Array(count);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      ang[i] = Math.random() * Math.PI * 2;
      rad[i] = 0.3 + Math.random() * 2.5;
      dep[i] = (Math.random() - 0.5) * 3;
      spd[i] = 1.5 + Math.random() * 3.0;
    }
    return { positions: pos, initAngles: ang, initRadii: rad, initDepths: dep, spiralSpeeds: spd };
  }, [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const angle = initAngles[i] + t * spiralSpeeds[i];
      // Radius pulses inward — particles spiral toward center
      const r = initRadii[i] * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.3));
      const depth = initDepths[i] + Math.sin(t * 0.5 + i) * 0.5;
      // Position in crater-local coordinates
      const localX = Math.cos(angle) * r;
      const localY = Math.sin(angle) * r;
      pos[i3] = craterCenter.x + craterUp.x * localX + craterRight.x * localY + craterDir.x * depth;
      pos[i3 + 1] = craterCenter.y + craterUp.y * localX + craterRight.y * localY + craterDir.y * depth;
      pos[i3 + 2] = craterCenter.z + craterUp.z * localX + craterRight.z * localY + craterDir.z * depth;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={0x00ff4c} size={0.12} sizeAttenuation transparent opacity={0.75} depthWrite={false} toneMapped={false} />
    </points>
  );
}

// ─── Portal Rings + Abstract Detail ─────────────────────────────────────────

// ─── Tunnel ring data (procedural, receding into depth) ─────────────────────
const TUNNEL_RING_COUNT = 16;

function PortalRings() {
  const tunnelRefs = useRef<(THREE.Mesh | null)[]>(Array(TUNNEL_RING_COUNT).fill(null));
  const coreRef = useRef<THREE.Mesh>(null);
  const core2Ref = useRef<THREE.Mesh>(null);
  const core3Ref = useRef<THREE.Mesh>(null);
  const windGroupRef = useRef<THREE.Group>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);

  // Wind particles — streaks rushing into the portal
  const windCount = 80;
  const windGeo = useMemo(() => {
    const pos = new Float32Array(windCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, []);
  const windData = useMemo(() => {
    return Array.from({ length: windCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 1 + Math.random() * 3.5,
      depth: Math.random() * 8,
      speed: 0.05 + Math.random() * 0.1,
      driftSpeed: 0.3 + Math.random() * 0.8,
    }));
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Animate tunnel rings — each spins at different speed, recedes in z
    for (let i = 0; i < TUNNEL_RING_COUNT; i++) {
      const mesh = tunnelRefs.current[i];
      if (!mesh) continue;
      const depth = (i / TUNNEL_RING_COUNT);
      mesh.rotation.z = t * (0.15 + depth * 0.8) * (i % 2 === 0 ? 1 : -1);
      // Subtle wobble on deeper rings
      mesh.rotation.x = Math.sin(t * 0.3 + i * 0.5) * depth * 0.15;
      mesh.rotation.y = Math.cos(t * 0.2 + i * 0.7) * depth * 0.1;
      // Pulsing opacity
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = (0.12 + depth * 0.25) + Math.sin(t * 1.5 + i * 0.4) * 0.05;
      mat.emissiveIntensity = 0.8 + depth * 1.5 + Math.sin(t * 2 + i) * 0.3;
    }

    // Animate uranium diamond — slow rotation, radioactive pulse
    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.35;
      coreRef.current.rotation.x = t * 0.12;
      coreRef.current.rotation.z = Math.sin(t * 0.2) * 0.15;
      // Hover bob
      coreRef.current.position.y = Math.sin(t * 0.5) * 0.1;
      // Radioactive pulse — bright surge then dim
      const pulse = 5 + Math.sin(t * 1.0) * 2.5 + Math.sin(t * 2.3) * 1.0;
      (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
    // Inner uranium core — counter-rotates, hot center
    if (core2Ref.current) {
      core2Ref.current.rotation.y = -t * 0.5;
      core2Ref.current.rotation.x = t * 0.3;
      const corePulse = 1.0 + Math.sin(t * 1.5) * 0.15;
      core2Ref.current.scale.setScalar(corePulse);
      (core2Ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 8 + Math.sin(t * 2.0) * 3;
    }
    // Radioactive aura — pulsing halo
    if (core3Ref.current) {
      core3Ref.current.rotation.y = t * 0.08;
      const aura = 1.0 + Math.sin(t * 0.7) * 0.2;
      core3Ref.current.scale.setScalar(aura);
      (core3Ref.current.material as THREE.MeshStandardMaterial).opacity = 0.12 + Math.sin(t * 0.6) * 0.06;
      (core3Ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + Math.sin(t * 0.8) * 1.0;
    }

    // Animate wind particles — streaking into the tunnel
    const pos = windGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < windCount; i++) {
      const w = windData[i];
      const i3 = i * 3;
      w.depth += w.speed;
      if (w.depth > 8) { w.depth = 0; w.angle = Math.random() * Math.PI * 2; w.radius = 1 + Math.random() * 3.5; }
      const depthFrac = w.depth / 8;
      const r = w.radius * (1 - depthFrac * 0.9);
      const a = w.angle + t * w.driftSpeed + depthFrac * 2;
      // In portal-local space (will be transformed by group)
      pos[i3] = Math.cos(a) * r;
      pos[i3 + 1] = Math.sin(a) * r;
      pos[i3 + 2] = -w.depth;
    }
    windGeo.attributes.position.needsUpdate = true;
  });

  // Generate tunnel rings procedurally
  const tunnelRings = useMemo(() => {
    return Array.from({ length: TUNNEL_RING_COUNT }, (_, i) => {
      const depth = i / TUNNEL_RING_COUNT;
      const radius = 4.0 - depth * 3.2; // shrinks from 4.0 to 0.8
      const thickness = 0.04 - depth * 0.02;
      const zPos = -depth * 6; // recedes into planet
      const isGreen = i % 3 === 1;
      const isBright = i % 3 === 2;
      return { radius, thickness, zPos, isGreen, isBright, depth };
    });
  }, []);

  return (
    <group position={[craterCenter.x, craterCenter.y, craterCenter.z]} rotation={[-0.35, 0, 0]}>
      {/* ═══ TUNNEL RINGS — receding into depth ═══ */}
      {tunnelRings.map((ring, i) => (
        <mesh
          key={i}
          ref={el => { tunnelRefs.current[i] = el; }}
          position={[0, 0, ring.zPos]}
        >
          <torusGeometry args={[ring.radius, Math.max(0.015, ring.thickness), 12, 64]} />
          <meshStandardMaterial
            color={ring.isBright ? 0xccffcc : ring.isGreen ? 0x44ff88 : 0x97ce4c}
            emissive={ring.isBright ? 0xaaffaa : ring.isGreen ? 0x55ff99 : 0x97ce4c}
            emissiveIntensity={1.0}
            transparent
            opacity={0.2}
          />
        </mesh>
      ))}

      {/* ═══ URANIUM DIAMOND — radioactive faceted gem ═══ */}
      {/* Outer diamond shell — icosahedron for maximum facets, glass-like */}
      <mesh ref={coreRef} position={[0, 0, -5]}>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial
          color={0x44ffaa}
          emissive={0x22ff77}
          emissiveIntensity={5.0}
          transparent
          opacity={0.7}
          metalness={1.0}
          roughness={0.0}
          toneMapped={false}
        />
      </mesh>
      {/* Inner uranium core — smaller octahedron, blazing hot */}
      <mesh ref={core2Ref} position={[0, 0, -5]}>
        <octahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial
          color={0xeeffcc}
          emissive={0xbbff44}
          emissiveIntensity={10.0}
          transparent
          opacity={0.95}
          metalness={1.0}
          roughness={0.0}
          toneMapped={false}
        />
      </mesh>
      {/* Wireframe facet overlay — shows diamond cut lines */}
      <mesh position={[0, 0, -5]} rotation={[0, 0, 0]}>
        <icosahedronGeometry args={[0.58, 1]} />
        <meshStandardMaterial
          color={0xb8ff61}
          emissive={0xb8ff61}
          emissiveIntensity={2.0}
          wireframe
          transparent
          opacity={0.3}
          toneMapped={false}
        />
      </mesh>
      {/* Radioactive aura — toxic green halo */}
      <mesh ref={core3Ref} position={[0, 0, -5]}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshStandardMaterial
          color={0x113311}
          emissive={0x44ff66}
          emissiveIntensity={2.0}
          transparent
          opacity={0.1}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Diamond light — intense green uranium glow */}
      <pointLight position={[0, 0, -5]} color={0x66ff88} intensity={12} distance={12} decay={2} />
      <pointLight position={[0, 0, -5]} color={0xbbff44} intensity={5} distance={8} decay={2} />
      {/* Secondary purple undertone from the tiger deeper in */}
      <pointLight position={[0, 0, -4.5]} color={0x6622aa} intensity={2} distance={5} decay={2} />

      {/* ═══ WIND STREAKS — particles rushing into the tunnel ═══ */}
      <points geometry={windGeo}>
        <pointsMaterial color={0x22ff66} size={0.08} sizeAttenuation transparent opacity={0.6} depthWrite={false} toneMapped={false} />
      </points>

      {/* ═══ GLOW LAYERS ═══ */}
      {/* Entrance glow */}
      <mesh>
        <circleGeometry args={[4.2, 32]} />
        <meshStandardMaterial color={0x0a2a14} emissive={0x44ff66} emissiveIntensity={0.6} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Mid-tunnel glow */}
      <mesh position={[0, 0, -2.5]}>
        <circleGeometry args={[2.5, 32]} />
        <meshStandardMaterial color={0x0a2a14} emissive={0x55ff88} emissiveIntensity={0.8} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Deep glow around core */}
      <mesh position={[0, 0, -4.5]}>
        <circleGeometry args={[1.2, 32]} />
        <meshStandardMaterial color={0x0a2a14} emissive={0xccffcc} emissiveIntensity={1.2} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ─── DNA Double Helix Spiraling Into Portal ─────────────────────────────────

function PortalDNA({ count = 300 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);

  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  // Each particle has a fixed slot along the helix — it flows through
  const particleData = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      slot: Math.random(), // 0-1 position along the helix length
      strand: Math.random() > 0.65 ? 2 : Math.random() > 0.5 ? 1 : 0, // 0=strand1, 1=strand2, 2=rung
      rungPos: Math.random(), // 0-1 interpolation between strands (for rungs)
      flowSpeed: 0.03 + Math.random() * 0.04,
      jitter: Math.random() * 0.15,
    }));
  }, [count]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pos = positions;

    for (let i = 0; i < count; i++) {
      const p = particleData[i];
      const i3 = i * 3;

      // Flow particles along the helix — slot advances over time, wraps
      const slot = (p.slot + t * p.flowSpeed) % 1;
      const depth = slot * 7; // 0 to 7 depth into tunnel
      const frac = slot;

      const helixRadius = 2.2 * (1 - frac * 0.75);
      const angle = frac * Math.PI * 5 + t * 0.15; // 2.5 full twists + slow rotation

      let x: number, y: number;
      if (p.strand === 0) {
        // Strand 1
        x = Math.cos(angle) * helixRadius + (Math.sin(t * 3 + i) * p.jitter);
        y = Math.sin(angle) * helixRadius + (Math.cos(t * 2.5 + i) * p.jitter);
      } else if (p.strand === 1) {
        // Strand 2 (opposite side)
        x = Math.cos(angle + Math.PI) * helixRadius + (Math.sin(t * 2.8 + i) * p.jitter);
        y = Math.sin(angle + Math.PI) * helixRadius + (Math.cos(t * 3.2 + i) * p.jitter);
      } else {
        // Rung — interpolate between strand positions
        const x1 = Math.cos(angle) * helixRadius;
        const y1 = Math.sin(angle) * helixRadius;
        const x2 = Math.cos(angle + Math.PI) * helixRadius;
        const y2 = Math.sin(angle + Math.PI) * helixRadius;
        x = x1 + (x2 - x1) * p.rungPos + (Math.sin(t * 4 + i) * p.jitter * 0.5);
        y = y1 + (y2 - y1) * p.rungPos + (Math.cos(t * 3.5 + i) * p.jitter * 0.5);
      }

      // Transform to portal-local space (tunnel goes along -z)
      pos[i3] = craterCenter.x + x * Math.cos(-0.35) - (-depth) * Math.sin(-0.35) * 0.33;
      pos[i3 + 1] = craterCenter.y + y;
      pos[i3 + 2] = craterCenter.z + (-depth) * Math.cos(-0.35) * 0.95 + x * Math.sin(-0.35) * 0.1;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={ACCENT_HEX} size={0.07} sizeAttenuation transparent opacity={0.6} depthWrite={false} />
    </points>
  );
}

// ─── Detailed Voxel Furniture (multi-box constructions spiraling in) ────────

function DetailedFurniture() {
  const groupRef = useRef<THREE.Group>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);
  const craterUp = useMemo(() => new THREE.Vector3(0, 1, 0).cross(craterDir).normalize(), [craterDir]);
  const craterRight = useMemo(() => new THREE.Vector3().crossVectors(craterDir, craterUp).normalize(), [craterDir, craterUp]);

  // Each furniture piece is a group of boxes with relative positions
  interface FurniturePiece {
    boxes: { pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }[];
    orbitRadius: number; orbitSpeed: number; orbitPhase: number;
    spiralSpeed: number; heightOffset: number; tumbleSpeed: THREE.Vector3;
    scale: number;
  }

  const pieces: FurniturePiece[] = useMemo(() => {
    const wood = new THREE.Color('#8B6914');
    const woodDk = new THREE.Color('#5a4210');
    const fabric = new THREE.Color('#4a3728');
    const fabricLt = new THREE.Color('#6B4F3A');
    const metal = new THREE.Color('#787878');
    const metalDk = new THREE.Color('#4a4a4a');
    const black = new THREE.Color('#1a1a1a');
    const screenGlow = new THREE.Color('#3b82f6');
    const white = new THREE.Color('#e5e5e5');
    const red = new THREE.Color('#ef4444');
    const green = new THREE.Color('#22c55e');
    const purple = new THREE.Color('#a855f7');
    const orange = new THREE.Color('#f97316');

    return [
      // ═══ COUCH — armrests, cushions, legs ═══
      { scale: 2.2, orbitRadius: 5.5, orbitSpeed: 0.18, orbitPhase: 1.0, spiralSpeed: 0.03, heightOffset: -0.8, tumbleSpeed: new THREE.Vector3(0.1, 0.12, 0.06),
        boxes: [
          // Seat cushions
          { pos: [-0.2, 0, 0], size: [0.2, 0.08, 0.2], color: fabric },
          { pos: [0.0, 0, 0], size: [0.2, 0.08, 0.2], color: fabricLt },
          { pos: [0.2, 0, 0], size: [0.2, 0.08, 0.2], color: fabric },
          // Back cushions
          { pos: [-0.2, 0.12, 0.08], size: [0.18, 0.16, 0.06], color: fabricLt },
          { pos: [0.0, 0.12, 0.08], size: [0.18, 0.16, 0.06], color: fabric },
          { pos: [0.2, 0.12, 0.08], size: [0.18, 0.16, 0.06], color: fabricLt },
          // Armrests
          { pos: [-0.32, 0.06, 0], size: [0.04, 0.14, 0.2], color: woodDk },
          { pos: [0.32, 0.06, 0], size: [0.04, 0.14, 0.2], color: woodDk },
          // Legs
          { pos: [-0.28, -0.08, -0.07], size: [0.03, 0.08, 0.03], color: wood },
          { pos: [0.28, -0.08, -0.07], size: [0.03, 0.08, 0.03], color: wood },
          { pos: [-0.28, -0.08, 0.07], size: [0.03, 0.08, 0.03], color: wood },
          { pos: [0.28, -0.08, 0.07], size: [0.03, 0.08, 0.03], color: wood },
        ]},
      // ═══ TV ON STAND ═══
      { scale: 2.0, orbitRadius: 5.2, orbitSpeed: 0.22, orbitPhase: 4.0, spiralSpeed: 0.035, heightOffset: 0.6, tumbleSpeed: new THREE.Vector3(0.1, 0.18, 0.08),
        boxes: [
          // Screen
          { pos: [0, 0.15, 0], size: [0.5, 0.3, 0.02], color: black },
          // Screen glow
          { pos: [0, 0.15, -0.012], size: [0.44, 0.24, 0.005], color: screenGlow },
          // Bezel bottom
          { pos: [0, -0.01, 0], size: [0.5, 0.02, 0.02], color: metalDk },
          // Stand neck
          { pos: [0, -0.06, 0], size: [0.04, 0.1, 0.04], color: metal },
          // Stand base
          { pos: [0, -0.12, 0], size: [0.2, 0.02, 0.12], color: metalDk },
        ]},
      // ═══ BOOKSHELF WITH BOOKS ═══
      { scale: 1.8, orbitRadius: 6.0, orbitSpeed: 0.15, orbitPhase: 3.0, spiralSpeed: 0.025, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(0.06, 0.1, 0.05),
        boxes: [
          // Frame
          { pos: [-0.22, 0, 0], size: [0.02, 0.5, 0.12], color: wood },
          { pos: [0.22, 0, 0], size: [0.02, 0.5, 0.12], color: wood },
          { pos: [0, 0.24, 0], size: [0.44, 0.02, 0.12], color: wood },
          { pos: [0, -0.24, 0], size: [0.44, 0.02, 0.12], color: woodDk },
          // Shelves
          { pos: [0, 0.08, 0], size: [0.42, 0.015, 0.11], color: wood },
          { pos: [0, -0.08, 0], size: [0.42, 0.015, 0.11], color: wood },
          // Books (different colors)
          { pos: [-0.12, 0.17, 0], size: [0.04, 0.12, 0.09], color: red },
          { pos: [-0.06, 0.16, 0], size: [0.04, 0.14, 0.09], color: screenGlow },
          { pos: [0.0, 0.17, 0], size: [0.04, 0.12, 0.09], color: green },
          { pos: [0.06, 0.15, 0], size: [0.04, 0.16, 0.09], color: purple },
          { pos: [0.12, 0.17, 0], size: [0.04, 0.12, 0.09], color: orange },
          { pos: [-0.1, 0.01, 0], size: [0.04, 0.12, 0.09], color: purple },
          { pos: [-0.04, 0.0, 0], size: [0.04, 0.14, 0.09], color: red },
          { pos: [0.04, 0.01, 0], size: [0.04, 0.12, 0.09], color: screenGlow },
          { pos: [0.1, 0.0, 0], size: [0.04, 0.14, 0.09], color: green },
        ]},
      // ═══ DESK WITH DRAWERS ═══
      { scale: 2.0, orbitRadius: 5.8, orbitSpeed: 0.2, orbitPhase: 5.5, spiralSpeed: 0.03, heightOffset: -0.4, tumbleSpeed: new THREE.Vector3(0.12, 0.08, 0.15),
        boxes: [
          // Desktop
          { pos: [0, 0.04, 0], size: [0.5, 0.025, 0.25], color: wood },
          // Legs
          { pos: [-0.22, -0.12, -0.1], size: [0.025, 0.3, 0.025], color: metalDk },
          { pos: [0.22, -0.12, -0.1], size: [0.025, 0.3, 0.025], color: metalDk },
          { pos: [-0.22, -0.12, 0.1], size: [0.025, 0.3, 0.025], color: metalDk },
          { pos: [0.22, -0.12, 0.1], size: [0.025, 0.3, 0.025], color: metalDk },
          // Drawer unit (right side)
          { pos: [0.14, -0.06, 0], size: [0.14, 0.08, 0.2], color: white },
          { pos: [0.14, -0.15, 0], size: [0.14, 0.08, 0.2], color: white },
          // Drawer handles
          { pos: [0.08, -0.06, -0.11], size: [0.04, 0.015, 0.005], color: metal },
          { pos: [0.08, -0.15, -0.11], size: [0.04, 0.015, 0.005], color: metal },
        ]},
      // ═══ GAMING CHAIR ═══
      { scale: 1.8, orbitRadius: 4.8, orbitSpeed: 0.28, orbitPhase: 2.2, spiralSpeed: 0.04, heightOffset: -0.6, tumbleSpeed: new THREE.Vector3(0.15, 0.2, 0.1),
        boxes: [
          // Seat
          { pos: [0, 0, 0], size: [0.18, 0.03, 0.18], color: black },
          // Seat cushion
          { pos: [0, 0.02, 0], size: [0.16, 0.02, 0.16], color: metalDk },
          // Back
          { pos: [0, 0.15, 0.08], size: [0.16, 0.26, 0.03], color: black },
          // Back accent stripes
          { pos: [0, 0.15, 0.065], size: [0.04, 0.2, 0.005], color: green },
          { pos: [-0.06, 0.15, 0.065], size: [0.02, 0.2, 0.005], color: green },
          { pos: [0.06, 0.15, 0.065], size: [0.02, 0.2, 0.005], color: green },
          // Headrest
          { pos: [0, 0.3, 0.08], size: [0.12, 0.04, 0.04], color: black },
          // Armrests
          { pos: [-0.1, 0.05, 0], size: [0.02, 0.02, 0.12], color: metalDk },
          { pos: [0.1, 0.05, 0], size: [0.02, 0.02, 0.12], color: metalDk },
          // Pole
          { pos: [0, -0.08, 0.04], size: [0.03, 0.12, 0.03], color: metal },
          // Star base
          { pos: [-0.08, -0.15, 0], size: [0.02, 0.02, 0.02], color: black },
          { pos: [0.08, -0.15, 0], size: [0.02, 0.02, 0.02], color: black },
          { pos: [0, -0.15, -0.08], size: [0.02, 0.02, 0.02], color: black },
          { pos: [0, -0.15, 0.08], size: [0.02, 0.02, 0.02], color: black },
          // Wheels
          { pos: [-0.08, -0.17, 0], size: [0.015, 0.015, 0.015], color: metalDk },
          { pos: [0.08, -0.17, 0], size: [0.015, 0.015, 0.015], color: metalDk },
        ]},
      // ═══ COFFEE MUG (large, recognizable) ═══
      { scale: 2.5, orbitRadius: 3.5, orbitSpeed: 0.35, orbitPhase: 0.8, spiralSpeed: 0.05, heightOffset: 0.3, tumbleSpeed: new THREE.Vector3(0.3, 0.5, 0.2),
        boxes: [
          { pos: [0, 0, 0], size: [0.12, 0.16, 0.12], color: white },
          { pos: [0, -0.06, 0], size: [0.13, 0.02, 0.13], color: metalDk },
          { pos: [0.08, 0, 0], size: [0.04, 0.1, 0.04], color: white },
          { pos: [0, 0.06, 0], size: [0.1, 0.04, 0.1], color: new THREE.Color('#553311') },
        ]},
      // ═══ LAPTOP (open) ═══
      { scale: 2.2, orbitRadius: 4.2, orbitSpeed: 0.28, orbitPhase: 2.5, spiralSpeed: 0.04, heightOffset: -0.2, tumbleSpeed: new THREE.Vector3(0.15, 0.2, 0.1),
        boxes: [
          { pos: [0, 0, 0], size: [0.3, 0.01, 0.2], color: metalDk },
          { pos: [0, 0, 0.03], size: [0.28, 0.005, 0.18], color: new THREE.Color('#444444') },
          { pos: [0, 0.1, 0.1], size: [0.3, 0.2, 0.01], color: metalDk },
          { pos: [0, 0.1, 0.095], size: [0.26, 0.16, 0.005], color: screenGlow },
        ]},
      // ═══ PIZZA BOX ═══
      { scale: 2.0, orbitRadius: 5.0, orbitSpeed: 0.2, orbitPhase: 1.5, spiralSpeed: 0.035, heightOffset: 0.8, tumbleSpeed: new THREE.Vector3(0.1, 0.08, 0.15),
        boxes: [
          { pos: [0, 0, 0], size: [0.3, 0.04, 0.3], color: new THREE.Color('#c49670') },
          { pos: [0, 0.025, 0], size: [0.3, 0.02, 0.3], color: new THREE.Color('#dabb88') },
          { pos: [0, 0.04, 0], size: [0.2, 0.01, 0.2], color: new THREE.Color('#ee8833') },
        ]},
      // ═══ POTTED PLANT ═══
      { scale: 2.0, orbitRadius: 4.5, orbitSpeed: 0.25, orbitPhase: 3.8, spiralSpeed: 0.04, heightOffset: -0.5, tumbleSpeed: new THREE.Vector3(0.12, 0.18, 0.08),
        boxes: [
          { pos: [0, -0.05, 0], size: [0.1, 0.12, 0.1], color: new THREE.Color('#884422') },
          { pos: [0, 0.04, 0], size: [0.08, 0.04, 0.08], color: new THREE.Color('#553311') },
          { pos: [0, 0.1, 0], size: [0.06, 0.08, 0.06], color: green },
          { pos: [0.04, 0.14, 0.02], size: [0.04, 0.06, 0.04], color: green },
          { pos: [-0.03, 0.16, -0.02], size: [0.03, 0.06, 0.03], color: green },
        ]},
      // ═══ HEADPHONES ═══
      { scale: 2.5, orbitRadius: 3.8, orbitSpeed: 0.32, orbitPhase: 5.2, spiralSpeed: 0.05, heightOffset: 0.4, tumbleSpeed: new THREE.Vector3(0.2, 0.3, 0.15),
        boxes: [
          { pos: [0, 0.08, 0], size: [0.18, 0.02, 0.02], color: black },
          { pos: [-0.09, 0, 0], size: [0.02, 0.12, 0.02], color: black },
          { pos: [0.09, 0, 0], size: [0.02, 0.12, 0.02], color: black },
          { pos: [-0.09, -0.05, 0], size: [0.04, 0.06, 0.04], color: metalDk },
          { pos: [0.09, -0.05, 0], size: [0.04, 0.06, 0.04], color: metalDk },
        ]},
      // ═══ RED STAPLER ═══
      { scale: 3.0, orbitRadius: 3.2, orbitSpeed: 0.4, orbitPhase: 4.5, spiralSpeed: 0.06, heightOffset: -0.1, tumbleSpeed: new THREE.Vector3(0.5, 0.3, 0.8),
        boxes: [
          { pos: [0, 0, 0], size: [0.06, 0.03, 0.15], color: red },
          { pos: [0, 0.02, 0], size: [0.05, 0.02, 0.14], color: red },
          { pos: [0, -0.02, 0.06], size: [0.04, 0.01, 0.03], color: metalDk },
        ]},
      // ═══ STACK OF BOOKS ═══
      { scale: 2.0, orbitRadius: 5.5, orbitSpeed: 0.18, orbitPhase: 0.3, spiralSpeed: 0.03, heightOffset: 0.6, tumbleSpeed: new THREE.Vector3(0.08, 0.12, 0.06),
        boxes: [
          { pos: [0, 0, 0], size: [0.15, 0.03, 0.22], color: new THREE.Color('#3b82f6') },
          { pos: [0, 0.035, 0], size: [0.15, 0.03, 0.22], color: purple },
          { pos: [0, 0.07, 0], size: [0.15, 0.03, 0.22], color: green },
          { pos: [0, 0.105, 0], size: [0.15, 0.03, 0.22], color: orange },
        ]},
      // ═══ LOBSTER (claws, body, tail, legs) ═══
      { scale: 2.8, orbitRadius: 4.0, orbitSpeed: 0.3, orbitPhase: 1.2, spiralSpeed: 0.05, heightOffset: 0.2, tumbleSpeed: new THREE.Vector3(0.2, 0.15, 0.3),
        boxes: [
          // Body segments
          { pos: [0, 0, 0], size: [0.08, 0.05, 0.12], color: red },
          { pos: [0, 0, -0.1], size: [0.07, 0.04, 0.08], color: red },
          { pos: [0, 0, 0.1], size: [0.06, 0.04, 0.06], color: red },
          // Head
          { pos: [0, 0.01, 0.12], size: [0.06, 0.04, 0.05], color: new THREE.Color('#ff4422') },
          // Eyes on stalks
          { pos: [-0.03, 0.04, 0.14], size: [0.015, 0.03, 0.015], color: new THREE.Color('#ff3300') },
          { pos: [0.03, 0.04, 0.14], size: [0.015, 0.03, 0.015], color: new THREE.Color('#ff3300') },
          { pos: [-0.03, 0.06, 0.14], size: [0.01, 0.01, 0.01], color: black },
          { pos: [0.03, 0.06, 0.14], size: [0.01, 0.01, 0.01], color: black },
          // Antennae
          { pos: [-0.02, 0.03, 0.18], size: [0.005, 0.005, 0.06], color: new THREE.Color('#ff5533') },
          { pos: [0.02, 0.03, 0.18], size: [0.005, 0.005, 0.06], color: new THREE.Color('#ff5533') },
          // Big claws
          { pos: [-0.08, 0, 0.08], size: [0.04, 0.03, 0.06], color: new THREE.Color('#ff4422') },
          { pos: [-0.12, 0, 0.1], size: [0.03, 0.04, 0.05], color: new THREE.Color('#ff5533') },
          { pos: [-0.12, 0.02, 0.1], size: [0.02, 0.015, 0.04], color: new THREE.Color('#ff7744') },
          { pos: [0.08, 0, 0.08], size: [0.04, 0.03, 0.06], color: new THREE.Color('#ff4422') },
          { pos: [0.12, 0, 0.1], size: [0.03, 0.04, 0.05], color: new THREE.Color('#ff5533') },
          { pos: [0.12, 0.02, 0.1], size: [0.02, 0.015, 0.04], color: new THREE.Color('#ff7744') },
          // Legs (3 pairs)
          { pos: [-0.05, -0.03, 0.02], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          { pos: [0.05, -0.03, 0.02], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          { pos: [-0.05, -0.03, -0.02], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          { pos: [0.05, -0.03, -0.02], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          { pos: [-0.04, -0.03, -0.06], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          { pos: [0.04, -0.03, -0.06], size: [0.02, 0.02, 0.01], color: new THREE.Color('#cc2200') },
          // Tail fan
          { pos: [0, 0, -0.16], size: [0.06, 0.02, 0.04], color: new THREE.Color('#ee3311') },
          { pos: [-0.03, 0, -0.19], size: [0.03, 0.01, 0.03], color: new THREE.Color('#ff5533') },
          { pos: [0.03, 0, -0.19], size: [0.03, 0.01, 0.03], color: new THREE.Color('#ff5533') },
          { pos: [0, 0, -0.19], size: [0.03, 0.01, 0.03], color: new THREE.Color('#ff4422') },
        ]},
      // ═══ CRAB (wide, flat, big claws) ═══
      { scale: 3.0, orbitRadius: 3.5, orbitSpeed: 0.38, orbitPhase: 4.0, spiralSpeed: 0.06, heightOffset: -0.3, tumbleSpeed: new THREE.Vector3(0.25, 0.2, 0.35),
        boxes: [
          // Shell (wide, flat)
          { pos: [0, 0, 0], size: [0.14, 0.04, 0.1], color: new THREE.Color('#ee5522') },
          { pos: [0, 0.01, 0], size: [0.12, 0.03, 0.08], color: new THREE.Color('#ff6633') },
          // Eyes
          { pos: [-0.04, 0.04, 0.04], size: [0.01, 0.03, 0.01], color: new THREE.Color('#dd4411') },
          { pos: [0.04, 0.04, 0.04], size: [0.01, 0.03, 0.01], color: new THREE.Color('#dd4411') },
          { pos: [-0.04, 0.06, 0.04], size: [0.008, 0.008, 0.008], color: black },
          { pos: [0.04, 0.06, 0.04], size: [0.008, 0.008, 0.008], color: black },
          // Big claws (left)
          { pos: [-0.1, 0, 0.03], size: [0.04, 0.03, 0.04], color: new THREE.Color('#ff4422') },
          { pos: [-0.14, 0.01, 0.03], size: [0.03, 0.04, 0.035], color: new THREE.Color('#ff5533') },
          { pos: [-0.14, 0.03, 0.03], size: [0.025, 0.015, 0.03], color: new THREE.Color('#ff7744') },
          // Big claws (right)
          { pos: [0.1, 0, 0.03], size: [0.04, 0.03, 0.04], color: new THREE.Color('#ff4422') },
          { pos: [0.14, 0.01, 0.03], size: [0.03, 0.04, 0.035], color: new THREE.Color('#ff5533') },
          { pos: [0.14, 0.03, 0.03], size: [0.025, 0.015, 0.03], color: new THREE.Color('#ff7744') },
          // Walking legs (4 pairs)
          { pos: [-0.07, -0.03, 0.02], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [0.07, -0.03, 0.02], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [-0.06, -0.03, -0.01], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [0.06, -0.03, -0.01], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [-0.05, -0.03, -0.04], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [0.05, -0.03, -0.04], size: [0.015, 0.02, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [-0.04, -0.02, -0.06], size: [0.015, 0.015, 0.01], color: new THREE.Color('#cc3311') },
          { pos: [0.04, -0.02, -0.06], size: [0.015, 0.015, 0.01], color: new THREE.Color('#cc3311') },
        ]},
      // ═══ SECOND LOBSTER (different orbit) ═══
      { scale: 2.2, orbitRadius: 5.8, orbitSpeed: 0.15, orbitPhase: 5.5, spiralSpeed: 0.03, heightOffset: 0.9, tumbleSpeed: new THREE.Vector3(0.15, 0.1, 0.2),
        boxes: [
          { pos: [0, 0, 0], size: [0.08, 0.05, 0.12], color: new THREE.Color('#dd2200') },
          { pos: [0, 0, -0.1], size: [0.07, 0.04, 0.08], color: new THREE.Color('#cc1100') },
          { pos: [0, 0, 0.1], size: [0.06, 0.04, 0.06], color: new THREE.Color('#dd2200') },
          { pos: [0, 0.01, 0.12], size: [0.06, 0.04, 0.05], color: new THREE.Color('#ee3322') },
          { pos: [-0.03, 0.04, 0.14], size: [0.015, 0.03, 0.015], color: new THREE.Color('#dd2200') },
          { pos: [0.03, 0.04, 0.14], size: [0.015, 0.03, 0.015], color: new THREE.Color('#dd2200') },
          { pos: [-0.03, 0.06, 0.14], size: [0.01, 0.01, 0.01], color: black },
          { pos: [0.03, 0.06, 0.14], size: [0.01, 0.01, 0.01], color: black },
          { pos: [-0.08, 0, 0.08], size: [0.04, 0.03, 0.06], color: new THREE.Color('#ee3322') },
          { pos: [-0.12, 0, 0.1], size: [0.03, 0.04, 0.05], color: new THREE.Color('#ff4433') },
          { pos: [0.08, 0, 0.08], size: [0.04, 0.03, 0.06], color: new THREE.Color('#ee3322') },
          { pos: [0.12, 0, 0.1], size: [0.03, 0.04, 0.05], color: new THREE.Color('#ff4433') },
          { pos: [0, 0, -0.16], size: [0.06, 0.02, 0.04], color: new THREE.Color('#cc1100') },
        ]},
      // ═══ SECOND CRAB (smaller, faster orbit) ═══
      { scale: 2.5, orbitRadius: 3.0, orbitSpeed: 0.45, orbitPhase: 2.8, spiralSpeed: 0.07, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(0.3, 0.25, 0.4),
        boxes: [
          { pos: [0, 0, 0], size: [0.14, 0.04, 0.1], color: new THREE.Color('#dd4411') },
          { pos: [0, 0.01, 0], size: [0.12, 0.03, 0.08], color: new THREE.Color('#ee5522') },
          { pos: [-0.04, 0.04, 0.04], size: [0.01, 0.03, 0.01], color: new THREE.Color('#cc3300') },
          { pos: [0.04, 0.04, 0.04], size: [0.01, 0.03, 0.01], color: new THREE.Color('#cc3300') },
          { pos: [-0.04, 0.06, 0.04], size: [0.008, 0.008, 0.008], color: black },
          { pos: [0.04, 0.06, 0.04], size: [0.008, 0.008, 0.008], color: black },
          { pos: [-0.1, 0, 0.03], size: [0.04, 0.03, 0.04], color: new THREE.Color('#ee3311') },
          { pos: [-0.14, 0.01, 0.03], size: [0.03, 0.04, 0.035], color: new THREE.Color('#ff4422') },
          { pos: [0.1, 0, 0.03], size: [0.04, 0.03, 0.04], color: new THREE.Color('#ee3311') },
          { pos: [0.14, 0.01, 0.03], size: [0.03, 0.04, 0.035], color: new THREE.Color('#ff4422') },
        ]},
      // ═══ GENIE LAMP — golden, ornate, magical ═══
      { scale: 2.8, orbitRadius: 4.5, orbitSpeed: 0.22, orbitPhase: 3.5, spiralSpeed: 0.04, heightOffset: 0.2, tumbleSpeed: new THREE.Vector3(0.08, 0.12, 0.06),
        boxes: [
          // Base — wide flat oval
          { pos: [0, -0.08, 0], size: [0.16, 0.02, 0.1], color: new THREE.Color('#d4940a') },
          { pos: [0, -0.06, 0], size: [0.14, 0.02, 0.09], color: new THREE.Color('#fbbf24') },
          // Body — bulbous belly
          { pos: [0, 0, 0], size: [0.12, 0.08, 0.08], color: new THREE.Color('#fbbf24') },
          { pos: [0, 0.02, 0], size: [0.1, 0.06, 0.07], color: new THREE.Color('#e8a810') },
          // Neck — thin
          { pos: [0, 0.06, 0], size: [0.04, 0.04, 0.04], color: new THREE.Color('#d4940a') },
          // Rim / lip — wider ring at top
          { pos: [0, 0.09, 0], size: [0.07, 0.02, 0.05], color: new THREE.Color('#fbbf24') },
          // Spout — curves out to one side
          { pos: [0.08, 0.04, 0], size: [0.06, 0.02, 0.02], color: new THREE.Color('#d4940a') },
          { pos: [0.12, 0.05, 0], size: [0.04, 0.015, 0.015], color: new THREE.Color('#fbbf24') },
          { pos: [0.15, 0.06, 0], size: [0.02, 0.01, 0.01], color: new THREE.Color('#e8a810') },
          // Handle — opposite side
          { pos: [-0.08, 0.04, 0], size: [0.02, 0.06, 0.02], color: new THREE.Color('#d4940a') },
          { pos: [-0.09, 0.07, 0], size: [0.02, 0.02, 0.02], color: new THREE.Color('#d4940a') },
          // Lid — little dome on top
          { pos: [0, 0.11, 0], size: [0.05, 0.02, 0.04], color: new THREE.Color('#e8a810') },
          { pos: [0, 0.13, 0], size: [0.02, 0.02, 0.02], color: new THREE.Color('#fbbf24') },
          // Gem on lid
          { pos: [0, 0.14, -0.01], size: [0.015, 0.015, 0.01], color: new THREE.Color('#ef4444') },
          // Purple smoke wisps coming out of spout
          { pos: [0.17, 0.08, 0], size: [0.02, 0.03, 0.02], color: new THREE.Color('#8844cc') },
          { pos: [0.19, 0.11, 0.01], size: [0.025, 0.025, 0.025], color: new THREE.Color('#9955dd') },
          { pos: [0.17, 0.14, -0.01], size: [0.03, 0.03, 0.03], color: new THREE.Color('#7733bb') },
          { pos: [0.2, 0.17, 0.02], size: [0.035, 0.035, 0.035], color: new THREE.Color('#6622aa') },
        ]},
    ];
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const children = groupRef.current.children;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const grp = children[i] as THREE.Group;
      if (!grp) continue;

      // Faster cycle — items approach from in front of portal, get sucked in, disappear, repeat
      const phase = ((t * piece.spiralSpeed * 0.45) + piece.orbitPhase) % 1;

      // Ease-in: drifts at start, accelerates into tunnel
      const eased = Math.pow(phase, 2.8);

      // Some items start further out in front of the portal (along its axis)
      // ALL items stay on the portal axis so they never clip through planet walls
      const startsOutside = i % 3 === 0;

      // Radius: outside items start wider but capped to portal mouth size (~4)
      // so they funnel naturally into the entrance without hitting planet walls
      const entranceRadius = startsOutside
        ? 4.5 + piece.orbitRadius * 0.2  // slightly wider than portal mouth
        : 3.2 + piece.orbitRadius * 0.25; // near portal mouth
      const coreRadius = 0.15;
      const radius = entranceRadius * (1 - eased) + coreRadius * eased;

      // Clamp radius to tunnel taper — as depth increases, max allowed radius shrinks
      // This prevents items from going through the tunnel walls at any point
      const tunnelMaxR = 4.0 - eased * 3.5; // matches tunnel shape: 4.0 at entrance → 0.5 deep
      const clampedRadius = Math.min(radius, tunnelMaxR);

      // Angle: moderate orbit outside, spins faster deeper in
      const slowSpin = phase * 1.2 * Math.PI * 2;
      const fastSpin = eased * 5.0 * Math.PI * 2;
      const totalAngle = piece.orbitPhase * Math.PI * 2 + slowSpin + fastSpin;

      // Depth along portal axis: outside items start well in front of portal
      // then all items funnel through the entrance and down the tunnel
      const startDepth = startsOutside ? -5.0 : -1.0; // negative = in front of portal
      const endDepth = 6.0; // deep in tunnel
      const depth = startDepth + (endDepth - startDepth) * eased;

      // Position in portal-local space (along portal axis)
      const localX = Math.cos(totalAngle) * clampedRadius;
      const localY = Math.sin(totalAngle) * clampedRadius;

      // Use craterDir for depth (portal axis direction) — items travel along this axis
      grp.position.set(
        craterCenter.x + craterUp.x * localX + craterRight.x * localY + craterDir.x * (-depth),
        craterCenter.y + craterUp.y * localX + craterRight.y * localY + craterDir.y * (-depth),
        craterCenter.z + craterUp.z * localX + craterRight.z * localY + craterDir.z * (-depth),
      );

      // Tumble: very gentle drift, only slightly faster deeper in
      const tumbleMultiplier = 0.05 + eased * 0.3;
      grp.rotation.x = t * piece.tumbleSpeed.x * tumbleMultiplier;
      grp.rotation.y = t * piece.tumbleSpeed.y * tumbleMultiplier;
      grp.rotation.z = t * piece.tumbleSpeed.z * tumbleMultiplier;

      // Scale: shrinks as it goes deeper, disappears at the back
      const shrink = 1.0 - eased;
      const scale = piece.scale * shrink;

      // Opacity: fade in at start of cycle, fade out at end
      const fadeIn = Math.min(phase / 0.1, 1.0);
      const fadeOut = Math.min((1.0 - phase) / 0.08, 1.0);
      const opacity = fadeIn * fadeOut;

      grp.scale.setScalar(Math.max(scale, 0.01));
      grp.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.opacity = opacity * 0.85;
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      {pieces.map((piece, i) => (
        <group key={i}>
          {piece.boxes.map((box, j) => (
            <mesh key={j} position={box.pos}>
              <boxGeometry args={box.size} />
              <meshStandardMaterial color={box.color} emissive={box.color} emissiveIntensity={0.3} transparent opacity={0.85} roughness={0.4} metalness={0.05} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ─── Office Supplies Being Sucked Into Portal ───────────────────────────────

interface OfficeItem {
  geometry: 'box' | 'cylinder' | 'plane';
  size: [number, number, number];
  color: THREE.Color;
  emissive: THREE.Color;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  spiralSpeed: number;
  heightOffset: number;
  tumbleSpeed: THREE.Vector3;
}

function OfficeSupplies() {
  const groupRef = useRef<THREE.Group>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);
  const craterUp = useMemo(() => new THREE.Vector3(0, 1, 0).cross(craterDir).normalize(), [craterDir]);
  const craterRight = useMemo(() => new THREE.Vector3().crossVectors(craterDir, craterUp).normalize(), [craterDir, craterUp]);

  const items: OfficeItem[] = useMemo(() => [
    // Coffee mug
    { geometry: 'cylinder', size: [0.12, 0.12, 0.2], color: new THREE.Color('#e5e5e5'), emissive: new THREE.Color('#e5e5e5'), orbitRadius: 3.5, orbitSpeed: 0.6, orbitPhase: 0, spiralSpeed: 0.08, heightOffset: 0, tumbleSpeed: new THREE.Vector3(1.2, 0.8, 0.5) },
    // Pencil
    { geometry: 'cylinder', size: [0.03, 0.03, 0.35], color: new THREE.Color('#fbbf24'), emissive: new THREE.Color('#fbbf24'), orbitRadius: 4.2, orbitSpeed: 0.45, orbitPhase: 1.2, spiralSpeed: 0.06, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(2.0, 1.5, 0.3) },
    // Paper / document
    { geometry: 'plane', size: [0.25, 0.35, 0.01], color: new THREE.Color('#f0f0f0'), emissive: new THREE.Color('#f0f0f0'), orbitRadius: 3.0, orbitSpeed: 0.55, orbitPhase: 2.5, spiralSpeed: 0.07, heightOffset: -0.3, tumbleSpeed: new THREE.Vector3(0.5, 0.3, 1.8) },
    // Red stapler
    { geometry: 'box', size: [0.15, 0.08, 0.06], color: new THREE.Color('#ef4444'), emissive: new THREE.Color('#ef4444'), orbitRadius: 2.8, orbitSpeed: 0.7, orbitPhase: 3.8, spiralSpeed: 0.09, heightOffset: 0.2, tumbleSpeed: new THREE.Vector3(0.8, 1.0, 1.5) },
    // Keyboard
    { geometry: 'box', size: [0.35, 0.02, 0.12], color: new THREE.Color('#333333'), emissive: new THREE.Color('#4a4a4a'), orbitRadius: 4.5, orbitSpeed: 0.35, orbitPhase: 5.0, spiralSpeed: 0.05, heightOffset: -0.5, tumbleSpeed: new THREE.Vector3(0.3, 0.2, 0.8) },
    // Book
    { geometry: 'box', size: [0.18, 0.25, 0.04], color: new THREE.Color('#3b82f6'), emissive: new THREE.Color('#3b82f6'), orbitRadius: 3.8, orbitSpeed: 0.5, orbitPhase: 4.2, spiralSpeed: 0.07, heightOffset: 0.4, tumbleSpeed: new THREE.Vector3(0.6, 1.2, 0.4) },
    // Another paper
    { geometry: 'plane', size: [0.2, 0.3, 0.01], color: new THREE.Color('#fde68a'), emissive: new THREE.Color('#fde68a'), orbitRadius: 3.3, orbitSpeed: 0.65, orbitPhase: 1.8, spiralSpeed: 0.08, heightOffset: -0.1, tumbleSpeed: new THREE.Vector3(1.0, 0.5, 2.0) },
    // Pen
    { geometry: 'cylinder', size: [0.02, 0.02, 0.28], color: new THREE.Color('#1a1a1a'), emissive: new THREE.Color('#333333'), orbitRadius: 2.5, orbitSpeed: 0.8, orbitPhase: 0.6, spiralSpeed: 0.1, heightOffset: 0.3, tumbleSpeed: new THREE.Vector3(1.5, 2.0, 0.8) },
    // Sticky note
    { geometry: 'plane', size: [0.12, 0.12, 0.01], color: new THREE.Color('#b8ff61'), emissive: new THREE.Color('#b8ff61'), orbitRadius: 2.2, orbitSpeed: 0.9, orbitPhase: 3.0, spiralSpeed: 0.12, heightOffset: -0.2, tumbleSpeed: new THREE.Vector3(0.7, 1.8, 1.2) },
    // Coffee cup lid
    { geometry: 'cylinder', size: [0.14, 0.14, 0.03], color: new THREE.Color('#8B5CF6'), emissive: new THREE.Color('#8B5CF6'), orbitRadius: 4.0, orbitSpeed: 0.4, orbitPhase: 5.5, spiralSpeed: 0.06, heightOffset: 0.1, tumbleSpeed: new THREE.Vector3(1.0, 0.6, 1.0) },
    // Eraser
    { geometry: 'box', size: [0.08, 0.04, 0.15], color: new THREE.Color('#fca5a5'), emissive: new THREE.Color('#fca5a5'), orbitRadius: 3.6, orbitSpeed: 0.55, orbitPhase: 2.0, spiralSpeed: 0.07, heightOffset: -0.4, tumbleSpeed: new THREE.Vector3(1.3, 0.9, 0.6) },
    // Phone
    { geometry: 'box', size: [0.08, 0.16, 0.02], color: new THREE.Color('#1a1a1a'), emissive: new THREE.Color('#00ccff'), orbitRadius: 2.0, orbitSpeed: 1.0, orbitPhase: 4.8, spiralSpeed: 0.11, heightOffset: 0.6, tumbleSpeed: new THREE.Vector3(0.4, 1.0, 1.5) },
    // Office chair (large)
    { geometry: 'box', size: [0.3, 0.3, 0.3], color: new THREE.Color('#333333'), emissive: new THREE.Color('#4a4a4a'), orbitRadius: 5.0, orbitSpeed: 0.25, orbitPhase: 0.3, spiralSpeed: 0.04, heightOffset: -0.8, tumbleSpeed: new THREE.Vector3(0.2, 0.3, 0.15) },
    // Monitor screen (large)
    { geometry: 'box', size: [0.4, 0.28, 0.03], color: new THREE.Color('#1a1a1a'), emissive: new THREE.Color('#b8ff61'), orbitRadius: 4.8, orbitSpeed: 0.3, orbitPhase: 2.8, spiralSpeed: 0.045, heightOffset: 0.7, tumbleSpeed: new THREE.Vector3(0.15, 0.5, 0.3) },
    // Desk lamp
    { geometry: 'cylinder', size: [0.04, 0.08, 0.3], color: new THREE.Color('#fbbf24'), emissive: new THREE.Color('#fbbf24'), orbitRadius: 3.2, orbitSpeed: 0.55, orbitPhase: 1.5, spiralSpeed: 0.07, heightOffset: 0.3, tumbleSpeed: new THREE.Vector3(1.0, 0.7, 1.2) },
    // Filing folder
    { geometry: 'box', size: [0.22, 0.3, 0.02], color: new THREE.Color('#f97316'), emissive: new THREE.Color('#f97316'), orbitRadius: 3.9, orbitSpeed: 0.42, orbitPhase: 3.5, spiralSpeed: 0.06, heightOffset: -0.3, tumbleSpeed: new THREE.Vector3(0.4, 0.8, 1.5) },
    // Plant pot
    { geometry: 'cylinder', size: [0.1, 0.08, 0.12], color: new THREE.Color('#8B6914'), emissive: new THREE.Color('#22c55e'), orbitRadius: 4.4, orbitSpeed: 0.35, orbitPhase: 5.8, spiralSpeed: 0.05, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(0.3, 0.4, 0.6) },
    // Ruler
    { geometry: 'box', size: [0.03, 0.4, 0.01], color: new THREE.Color('#fde68a'), emissive: new THREE.Color('#fde68a'), orbitRadius: 2.6, orbitSpeed: 0.75, orbitPhase: 0.8, spiralSpeed: 0.09, heightOffset: -0.1, tumbleSpeed: new THREE.Vector3(2.0, 1.0, 0.5) },
    // Scissors
    { geometry: 'box', size: [0.04, 0.2, 0.02], color: new THREE.Color('#a0a0a0'), emissive: new THREE.Color('#a0a0a0'), orbitRadius: 3.1, orbitSpeed: 0.62, orbitPhase: 4.0, spiralSpeed: 0.08, heightOffset: 0.2, tumbleSpeed: new THREE.Vector3(1.5, 1.8, 0.8) },
    // Whiteboard marker
    { geometry: 'cylinder', size: [0.025, 0.025, 0.2], color: new THREE.Color('#ef4444'), emissive: new THREE.Color('#ef4444'), orbitRadius: 2.3, orbitSpeed: 0.85, orbitPhase: 1.0, spiralSpeed: 0.1, heightOffset: -0.5, tumbleSpeed: new THREE.Vector3(1.2, 2.2, 0.6) },
    // Notebook (large)
    { geometry: 'box', size: [0.2, 0.28, 0.03], color: new THREE.Color('#a855f7'), emissive: new THREE.Color('#a855f7'), orbitRadius: 4.6, orbitSpeed: 0.32, orbitPhase: 3.2, spiralSpeed: 0.05, heightOffset: -0.6, tumbleSpeed: new THREE.Vector3(0.3, 0.6, 1.0) },
    // USB drive (tiny)
    { geometry: 'box', size: [0.04, 0.02, 0.1], color: new THREE.Color('#e5e5e5'), emissive: new THREE.Color('#00ccff'), orbitRadius: 1.8, orbitSpeed: 1.1, orbitPhase: 2.2, spiralSpeed: 0.13, heightOffset: 0.4, tumbleSpeed: new THREE.Vector3(2.5, 1.5, 1.0) },
    // Headphones
    { geometry: 'cylinder', size: [0.15, 0.15, 0.04], color: new THREE.Color('#1a1a1a'), emissive: new THREE.Color('#333333'), orbitRadius: 3.7, orbitSpeed: 0.48, orbitPhase: 5.2, spiralSpeed: 0.06, heightOffset: 0.1, tumbleSpeed: new THREE.Vector3(0.5, 0.3, 0.8) },

    // ═══ BIG FURNITURE ═══
    // Couch (big, chunky)
    { geometry: 'box', size: [0.6, 0.25, 0.25], color: new THREE.Color('#4a3728'), emissive: new THREE.Color('#5c3d2e'), orbitRadius: 5.5, orbitSpeed: 0.18, orbitPhase: 1.0, spiralSpeed: 0.03, heightOffset: -1.0, tumbleSpeed: new THREE.Vector3(0.1, 0.15, 0.08) },
    // Bookshelf
    { geometry: 'box', size: [0.5, 0.6, 0.12], color: new THREE.Color('#8B6914'), emissive: new THREE.Color('#6B4F10'), orbitRadius: 6.0, orbitSpeed: 0.15, orbitPhase: 3.5, spiralSpeed: 0.025, heightOffset: 0.8, tumbleSpeed: new THREE.Vector3(0.08, 0.12, 0.06) },
    // Flatscreen TV
    { geometry: 'box', size: [0.55, 0.35, 0.02], color: new THREE.Color('#1a1a1a'), emissive: new THREE.Color('#3b82f6'), orbitRadius: 5.2, orbitSpeed: 0.22, orbitPhase: 5.0, spiralSpeed: 0.035, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(0.12, 0.2, 0.1) },
    // Standing desk
    { geometry: 'box', size: [0.5, 0.03, 0.3], color: new THREE.Color('#e5e5e5'), emissive: new THREE.Color('#a0a0a0'), orbitRadius: 5.8, orbitSpeed: 0.2, orbitPhase: 0.5, spiralSpeed: 0.03, heightOffset: -0.5, tumbleSpeed: new THREE.Vector3(0.15, 0.1, 0.2) },
    // Filing cabinet
    { geometry: 'box', size: [0.2, 0.4, 0.2], color: new THREE.Color('#787878'), emissive: new THREE.Color('#4a4a4a'), orbitRadius: 4.9, orbitSpeed: 0.28, orbitPhase: 2.2, spiralSpeed: 0.04, heightOffset: -0.7, tumbleSpeed: new THREE.Vector3(0.18, 0.25, 0.12) },
    // Whiteboard
    { geometry: 'box', size: [0.5, 0.35, 0.02], color: new THREE.Color('#f0f0f0'), emissive: new THREE.Color('#e5e5e5'), orbitRadius: 5.4, orbitSpeed: 0.19, orbitPhase: 4.3, spiralSpeed: 0.03, heightOffset: 1.0, tumbleSpeed: new THREE.Vector3(0.1, 0.18, 0.08) },
    // Bean bag chair
    { geometry: 'cylinder', size: [0.2, 0.25, 0.18], color: new THREE.Color('#a855f7'), emissive: new THREE.Color('#8B5CF6'), orbitRadius: 4.7, orbitSpeed: 0.3, orbitPhase: 1.8, spiralSpeed: 0.04, heightOffset: -0.3, tumbleSpeed: new THREE.Vector3(0.2, 0.15, 0.25) },

    // ═══ ANIMALS ═══
    // 🦞 Lobster (red, wide + long)
    { geometry: 'box', size: [0.3, 0.1, 0.15], color: new THREE.Color('#dc2626'), emissive: new THREE.Color('#ef4444'), orbitRadius: 4.0, orbitSpeed: 0.52, orbitPhase: 0.2, spiralSpeed: 0.065, heightOffset: 0.6, tumbleSpeed: new THREE.Vector3(0.6, 0.4, 1.8) },
    // Lobster claws (pair — slightly ahead in orbit)
    { geometry: 'box', size: [0.12, 0.06, 0.08], color: new THREE.Color('#b91c1c'), emissive: new THREE.Color('#dc2626'), orbitRadius: 3.8, orbitSpeed: 0.54, orbitPhase: 0.15, spiralSpeed: 0.066, heightOffset: 0.7, tumbleSpeed: new THREE.Vector3(1.0, 0.8, 2.0) },
    // Lobster tail
    { geometry: 'box', size: [0.08, 0.06, 0.2], color: new THREE.Color('#991b1b'), emissive: new THREE.Color('#dc2626'), orbitRadius: 4.2, orbitSpeed: 0.5, orbitPhase: 0.25, spiralSpeed: 0.064, heightOffset: 0.55, tumbleSpeed: new THREE.Vector3(0.5, 0.3, 1.5) },
    // 🦢 Swan (white, elegant body + long neck)
    { geometry: 'cylinder', size: [0.15, 0.12, 0.25], color: new THREE.Color('#f5f5f5'), emissive: new THREE.Color('#ffffff'), orbitRadius: 5.0, orbitSpeed: 0.32, orbitPhase: 2.0, spiralSpeed: 0.04, heightOffset: 0.3, tumbleSpeed: new THREE.Vector3(0.15, 0.3, 0.2) },
    // Swan neck (thin, tall cylinder)
    { geometry: 'cylinder', size: [0.03, 0.03, 0.3], color: new THREE.Color('#f0f0f0'), emissive: new THREE.Color('#ffffff'), orbitRadius: 4.8, orbitSpeed: 0.33, orbitPhase: 1.95, spiralSpeed: 0.041, heightOffset: 0.5, tumbleSpeed: new THREE.Vector3(0.3, 0.5, 0.15) },
    // Swan head (tiny sphere-like box)
    { geometry: 'box', size: [0.06, 0.06, 0.06], color: new THREE.Color('#ffffff'), emissive: new THREE.Color('#ffffff'), orbitRadius: 4.6, orbitSpeed: 0.34, orbitPhase: 1.9, spiralSpeed: 0.042, heightOffset: 0.7, tumbleSpeed: new THREE.Vector3(0.4, 0.6, 0.2) },
    // Swan beak
    { geometry: 'box', size: [0.04, 0.02, 0.06], color: new THREE.Color('#f97316'), emissive: new THREE.Color('#f97316'), orbitRadius: 4.5, orbitSpeed: 0.345, orbitPhase: 1.88, spiralSpeed: 0.043, heightOffset: 0.72, tumbleSpeed: new THREE.Vector3(0.5, 0.7, 0.25) },
    // 🦀 Crab (orange-red, wide + flat)
    { geometry: 'box', size: [0.22, 0.08, 0.18], color: new THREE.Color('#ea580c'), emissive: new THREE.Color('#f97316'), orbitRadius: 3.4, orbitSpeed: 0.65, orbitPhase: 4.5, spiralSpeed: 0.075, heightOffset: -0.4, tumbleSpeed: new THREE.Vector3(0.8, 0.5, 2.2) },
    // Crab left claw
    { geometry: 'box', size: [0.1, 0.06, 0.05], color: new THREE.Color('#dc2626'), emissive: new THREE.Color('#ef4444'), orbitRadius: 3.2, orbitSpeed: 0.67, orbitPhase: 4.6, spiralSpeed: 0.076, heightOffset: -0.3, tumbleSpeed: new THREE.Vector3(1.2, 0.9, 2.5) },
    // Crab right claw
    { geometry: 'box', size: [0.1, 0.06, 0.05], color: new THREE.Color('#dc2626'), emissive: new THREE.Color('#ef4444'), orbitRadius: 3.6, orbitSpeed: 0.63, orbitPhase: 4.4, spiralSpeed: 0.074, heightOffset: -0.35, tumbleSpeed: new THREE.Vector3(1.1, 1.0, 2.3) },
    // Crab legs (small sticks)
    { geometry: 'cylinder', size: [0.015, 0.015, 0.1], color: new THREE.Color('#ea580c'), emissive: new THREE.Color('#f97316'), orbitRadius: 3.3, orbitSpeed: 0.66, orbitPhase: 4.55, spiralSpeed: 0.075, heightOffset: -0.45, tumbleSpeed: new THREE.Vector3(2.0, 1.5, 1.0) },
  ], []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const children = groupRef.current.children;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mesh = children[i] as THREE.Mesh;
      if (!mesh) continue;

      // Spiral inward over time, then reset
      const cycle = 10 + i * 1.5;
      const phase = (t * item.spiralSpeed + item.orbitPhase) % 1;
      const spiralPhase = phase;
      const angle = item.orbitPhase + t * item.orbitSpeed;
      const r = item.orbitRadius * (1 - spiralPhase * 0.85);

      const localX = Math.cos(angle) * r;
      const localY = Math.sin(angle) * r;
      const depth = item.heightOffset + spiralPhase * 2;

      mesh.position.set(
        craterCenter.x + craterUp.x * localX + craterRight.x * localY + craterDir.x * depth,
        craterCenter.y + craterUp.y * localX + craterRight.y * localY + craterDir.y * depth,
        craterCenter.z + craterUp.z * localX + craterRight.z * localY + craterDir.z * depth,
      );

      // Tumble as it spirals
      mesh.rotation.x = t * item.tumbleSpeed.x;
      mesh.rotation.y = t * item.tumbleSpeed.y;
      mesh.rotation.z = t * item.tumbleSpeed.z;

      // Shrink as it approaches center
      const scale = 0.3 + (1 - spiralPhase) * 0.7;
      mesh.scale.setScalar(scale);

      // Fade as approaching center
      (mesh.material as THREE.MeshStandardMaterial).opacity = 0.5 + (1 - spiralPhase) * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      {items.map((item, i) => (
        <mesh key={i}>
          {item.geometry === 'box' && <boxGeometry args={item.size} />}
          {item.geometry === 'cylinder' && <cylinderGeometry args={[item.size[0], item.size[1], item.size[2], 8]} />}
          {item.geometry === 'plane' && <planeGeometry args={[item.size[0], item.size[1]]} />}
          <meshStandardMaterial
            color={item.color}
            emissive={item.emissive}
            emissiveIntensity={0.3}
            transparent
            opacity={0.8}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Portal Spiral (galaxy-like spiral arms inside the portal) ──────────────

function PortalSpiral({ count = 150 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);
  const craterUp = useMemo(() => new THREE.Vector3(0, 1, 0).cross(craterDir).normalize(), [craterDir]);
  const craterRight = useMemo(() => new THREE.Vector3().crossVectors(craterDir, craterUp).normalize(), [craterDir, craterUp]);

  const { positions, arms, radii, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const arm = new Float32Array(count); // which spiral arm (0-3)
    const rad = new Float32Array(count);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arm[i] = Math.floor(Math.random() * 3);
      rad[i] = Math.random() * 3.5;
      spd[i] = 0.3 + Math.random() * 0.5;
    }
    return { positions: pos, arms: arm, radii: rad, speeds: spd };
  }, [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const r = radii[i];
      const armOffset = arms[i] * (Math.PI * 2 / 3); // 3 spiral arms like R&M
      // Logarithmic spiral: angle increases with radius
      const angle = armOffset + r * 2.0 + t * speeds[i] * 1.5;
      const localX = Math.cos(angle) * r;
      const localY = Math.sin(angle) * r;
      const depth = Math.sin(t * 0.3 + i * 0.1) * 0.5;
      pos[i3] = craterCenter.x + craterUp.x * localX + craterRight.x * localY + craterDir.x * depth;
      pos[i3 + 1] = craterCenter.y + craterUp.y * localX + craterRight.y * localY + craterDir.y * depth;
      pos[i3 + 2] = craterCenter.z + craterUp.z * localX + craterRight.z * localY + craterDir.z * depth;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={0x00ff4c} size={0.09} sizeAttenuation transparent opacity={0.6} depthWrite={false} toneMapped={false} />
    </points>
  );
}

// ─── Subtle Ambient Wisps (few particles drifting near surface) ─────────────

function AmbientWisps({ count = 20 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, angles, heights, speeds, radii } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const ang = new Float32Array(count);
    const hts = new Float32Array(count);
    const spd = new Float32Array(count);
    const rad = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      ang[i] = Math.random() * Math.PI * 2;
      hts[i] = (Math.random() - 0.5) * 10;
      spd[i] = 0.03 + Math.random() * 0.06;
      rad[i] = 8.8 + Math.random() * 1.5;
    }
    return { positions: pos, angles: ang, heights: hts, speeds: spd, radii: rad };
  }, [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const a = angles[i] + t * speeds[i];
      pos[i3] = Math.cos(a) * radii[i];
      pos[i3 + 1] = heights[i] + Math.sin(t * 0.3 + i) * 0.8 - 2;
      pos[i3 + 2] = Math.sin(a) * radii[i];
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={0x22c55e} size={0.06} sizeAttenuation transparent opacity={0.3} depthWrite={false} />
    </points>
  );
}

// ─── Space Debris (solid collisions, no clipping) ───────────────────────────

function SpaceDebris({ count = 20 }: { count?: number }) {
  const PLANET_R = 8.5;
  // Recognizable debris types with distinct shapes and colors
  const debrisTypes = useMemo(() => [
    { name: 'wrench', color: 0x999999, emissive: 0x666666 },
    { name: 'coffee-mug', color: 0xddccbb, emissive: 0xaa9988 },
    { name: 'keyboard', color: 0x333333, emissive: 0x222222 },
    { name: 'monitor', color: 0x222222, emissive: 0x00ff4c },
    { name: 'chair-wheel', color: 0x1a1a1a, emissive: 0x333333 },
    { name: 'book', color: 0x8844aa, emissive: 0x6633aa },
    { name: 'pizza-slice', color: 0xddaa44, emissive: 0xcc8833 },
    { name: 'sneaker', color: 0xee3344, emissive: 0xcc2233 },
    { name: 'phone', color: 0x222222, emissive: 0x1155cc },
    { name: 'plant-pot', color: 0x885522, emissive: 0x22aa44 },
  ], []);

  const state = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    tumbles: Float32Array;
    tumbleSpeeds: Float32Array;
    scales: number[];
    radii: number[];
    types: number[];
    inited: boolean;
  }>({ positions: new Float32Array(0), velocities: new Float32Array(0), tumbles: new Float32Array(0), tumbleSpeeds: new Float32Array(0), scales: [], radii: [], types: [], inited: false });

  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  if (!state.current.inited) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const tum = new Float32Array(count * 3);
    const tumSpd = new Float32Array(count * 3);
    const scales: number[] = [];
    const radii: number[] = [];
    const types: number[] = [];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = PLANET_R + 1.5 + Math.random() * 12;
      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i3 + 2] = r * Math.cos(phi);
      vel[i3] = (Math.random() - 0.5) * 0.008;
      vel[i3 + 1] = (Math.random() - 0.5) * 0.008;
      vel[i3 + 2] = (Math.random() - 0.5) * 0.008;
      tum[i3] = Math.random() * Math.PI * 2;
      tum[i3 + 1] = Math.random() * Math.PI * 2;
      tum[i3 + 2] = Math.random() * Math.PI * 2;
      tumSpd[i3] = (Math.random() - 0.5) * 0.4;
      tumSpd[i3 + 1] = (Math.random() - 0.5) * 0.4;
      tumSpd[i3 + 2] = (Math.random() - 0.5) * 0.4;
      const s = 0.12 + Math.random() * 0.15;
      scales.push(s);
      radii.push(s * 1.5);
      types.push(Math.floor(Math.random() * debrisTypes.length));
    }
    state.current = { positions: pos, velocities: vel, tumbles: tum, tumbleSpeeds: tumSpd, scales, radii, types, inited: true };
    groupRefs.current = new Array(count).fill(null);
  }

  useFrame((_, delta) => {
    const s = state.current;
    const dt = Math.min(delta, 0.05);
    const N = count;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      s.positions[i3] += s.velocities[i3];
      s.positions[i3 + 1] += s.velocities[i3 + 1];
      s.positions[i3 + 2] += s.velocities[i3 + 2];
      s.tumbles[i3] += s.tumbleSpeeds[i3] * dt;
      s.tumbles[i3 + 1] += s.tumbleSpeeds[i3 + 1] * dt;
      s.tumbles[i3 + 2] += s.tumbleSpeeds[i3 + 2] * dt;
      const px = s.positions[i3], py = s.positions[i3 + 1], pz = s.positions[i3 + 2];
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      if (dist > 0.01) {
        const nx = px / dist, ny = py / dist, nz = pz / dist;
        if (dist < PLANET_R) {
          s.positions[i3] = nx * PLANET_R; s.positions[i3+1] = ny * PLANET_R; s.positions[i3+2] = nz * PLANET_R;
          const vDotN = s.velocities[i3]*nx + s.velocities[i3+1]*ny + s.velocities[i3+2]*nz;
          if (vDotN < 0) { s.velocities[i3] -= vDotN*nx; s.velocities[i3+1] -= vDotN*ny; s.velocities[i3+2] -= vDotN*nz; }
        }
        if (dist > 24) {
          const pull = (dist - 24) * 0.0005;
          s.velocities[i3] -= nx*pull; s.velocities[i3+1] -= ny*pull; s.velocities[i3+2] -= nz*pull;
        }
      }
    }
    // Overlap resolution
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      for (let j = i + 1; j < N; j++) {
        const j3 = j * 3;
        const dx = s.positions[j3]-s.positions[i3], dy = s.positions[j3+1]-s.positions[i3+1], dz = s.positions[j3+2]-s.positions[i3+2];
        const minD = s.radii[i] + s.radii[j];
        const dSq = dx*dx + dy*dy + dz*dz;
        if (dSq < minD*minD && dSq > 0.0001) {
          const d = Math.sqrt(dSq); const nx=dx/d, ny=dy/d, nz=dz/d; const ov=(minD-d)*0.5;
          s.positions[i3]-=nx*ov; s.positions[i3+1]-=ny*ov; s.positions[i3+2]-=nz*ov;
          s.positions[j3]+=nx*ov; s.positions[j3+1]+=ny*ov; s.positions[j3+2]+=nz*ov;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const g = groupRefs.current[i]; if (!g) continue;
      const i3 = i * 3;
      g.position.set(s.positions[i3], s.positions[i3+1], s.positions[i3+2]);
      g.rotation.set(s.tumbles[i3], s.tumbles[i3+1], s.tumbles[i3+2]);
    }
  });

  const s = state.current;
  return (
    <group>
      {s.scales.map((sc, i) => {
        const dt = debrisTypes[s.types[i]];
        return (
          <group key={i} ref={(el) => { groupRefs.current[i] = el; }} scale={sc}>
            {/* Wrench */}
            {dt.name === 'wrench' && <>
              <mesh><boxGeometry args={[0.3, 2.0, 0.15]} /><meshStandardMaterial color={0x999999} roughness={0.3} metalness={0.8} /></mesh>
              <mesh position={[0, 1.0, 0]}><torusGeometry args={[0.25, 0.08, 8, 12, Math.PI * 1.5]} /><meshStandardMaterial color={0x888888} roughness={0.3} metalness={0.8} /></mesh>
            </>}
            {/* Coffee mug */}
            {dt.name === 'coffee-mug' && <>
              <mesh><cylinderGeometry args={[0.4, 0.35, 0.7, 8]} /><meshStandardMaterial color={0xeeeeee} roughness={0.5} metalness={0.1} /></mesh>
              <mesh position={[0.45, 0, 0]}><torusGeometry args={[0.18, 0.05, 6, 12]} /><meshStandardMaterial color={0xdddddd} roughness={0.5} metalness={0.1} /></mesh>
              <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.35, 0.35, 0.1, 8]} /><meshStandardMaterial color={0x553311} roughness={0.8} /></mesh>
            </>}
            {/* Keyboard */}
            {dt.name === 'keyboard' && <>
              <mesh><boxGeometry args={[2.0, 0.15, 0.7]} /><meshStandardMaterial color={0x222222} roughness={0.4} metalness={0.3} /></mesh>
              <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.8, 0.05, 0.5]} /><meshStandardMaterial color={0x444444} roughness={0.5} /></mesh>
            </>}
            {/* Monitor */}
            {dt.name === 'monitor' && <>
              <mesh><boxGeometry args={[1.6, 1.0, 0.1]} /><meshStandardMaterial color={0x1a1a1a} roughness={0.3} metalness={0.5} /></mesh>
              <mesh position={[0, 0, -0.01]}><boxGeometry args={[1.4, 0.8, 0.05]} /><meshStandardMaterial color={0x002211} emissive={0x00ff4c} emissiveIntensity={0.3} /></mesh>
              <mesh position={[0, -0.6, 0.1]}><boxGeometry args={[0.2, 0.3, 0.15]} /><meshStandardMaterial color={0x222222} roughness={0.3} metalness={0.5} /></mesh>
            </>}
            {/* Chair wheel */}
            {dt.name === 'chair-wheel' && <>
              <mesh rotation={[Math.PI/2, 0, 0]}><cylinderGeometry args={[0.4, 0.4, 0.15, 12]} /><meshStandardMaterial color={0x1a1a1a} roughness={0.5} /></mesh>
              <mesh><cylinderGeometry args={[0.08, 0.08, 0.6, 6]} /><meshStandardMaterial color={0x444444} roughness={0.3} metalness={0.7} /></mesh>
            </>}
            {/* Book */}
            {dt.name === 'book' && <>
              <mesh><boxGeometry args={[0.8, 1.1, 0.15]} /><meshStandardMaterial color={0x7733aa} roughness={0.7} /></mesh>
              <mesh position={[0, 0, -0.01]}><boxGeometry args={[0.7, 1.0, 0.12]} /><meshStandardMaterial color={0xeeeecc} roughness={0.8} /></mesh>
            </>}
            {/* Pizza slice */}
            {dt.name === 'pizza-slice' && <>
              <mesh rotation={[Math.PI/2, 0, 0]}><coneGeometry args={[0.6, 1.2, 3]} /><meshStandardMaterial color={0xddaa33} roughness={0.7} /></mesh>
              <mesh rotation={[Math.PI/2, 0, 0]} position={[0, 0.02, 0]}><coneGeometry args={[0.5, 1.0, 3]} /><meshStandardMaterial color={0xcc4422} roughness={0.6} /></mesh>
            </>}
            {/* Sneaker */}
            {dt.name === 'sneaker' && <>
              <mesh><boxGeometry args={[0.5, 0.4, 1.0]} /><meshStandardMaterial color={0xee3344} roughness={0.6} /></mesh>
              <mesh position={[0, -0.15, 0]}><boxGeometry args={[0.55, 0.12, 1.1]} /><meshStandardMaterial color={0xeeeeee} roughness={0.5} /></mesh>
              <mesh position={[0, 0.15, -0.1]}><boxGeometry args={[0.45, 0.2, 0.5]} /><meshStandardMaterial color={0xdd2233} roughness={0.6} /></mesh>
            </>}
            {/* Phone */}
            {dt.name === 'phone' && <>
              <mesh><boxGeometry args={[0.5, 1.0, 0.06]} /><meshStandardMaterial color={0x1a1a1a} roughness={0.2} metalness={0.6} /></mesh>
              <mesh position={[0, 0, -0.01]}><boxGeometry args={[0.42, 0.85, 0.03]} /><meshStandardMaterial color={0x111133} emissive={0x2244cc} emissiveIntensity={0.2} /></mesh>
            </>}
            {/* Plant pot */}
            {dt.name === 'plant-pot' && <>
              <mesh><cylinderGeometry args={[0.3, 0.4, 0.5, 8]} /><meshStandardMaterial color={0x884422} roughness={0.7} /></mesh>
              <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.25, 0.25, 0.1, 8]} /><meshStandardMaterial color={0x553311} roughness={0.8} /></mesh>
              <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.3, 6, 6]} /><meshStandardMaterial color={0x22aa44} roughness={0.6} /></mesh>
              <mesh position={[0.15, 0.7, 0]}><sphereGeometry args={[0.15, 6, 6]} /><meshStandardMaterial color={0x33bb55} roughness={0.6} /></mesh>
            </>}
          </group>
        );
      })}
    </group>
  );
}

// ─── Star Dust ──────────────────────────────────────────────────────────────

function StarDust({ count = 300 }: { count?: number }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 25 + Math.random() * 30;
      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, [count]);

  return (
    <points geometry={geometry}>
      <pointsMaterial color={0xffffff} size={0.06} sizeAttenuation transparent opacity={0.4} depthWrite={false} />
    </points>
  );
}

// ─── Underground Agent at Desk (gets sucked into portal) ────────────────────

/**
 * Pixel art built from colored boxes:
 *   - Cute agent (head, body, arms, legs)
 *   - Desk with monitor, keyboard
 *   - Chair
 * All slowly spiral into the portal ring, then reset.
 */
function UndergroundAgent() {
  const groupRef = useRef<THREE.Group>(null);
  const swanHeadRef = useRef<THREE.Group>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const basePos = useMemo(() => craterDir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, -2, 0)), [craterDir]);

  const s = 0.13; // voxel size

  // Color palette with shading variants
  const c = useMemo(() => ({
    // Skin with form shadows + monitor glow
    skin: new THREE.Color('#f5d6b8'), skinHi: new THREE.Color('#ffe8d0'), skinSh: new THREE.Color('#d4a574'),
    skinGlow: new THREE.Color('#c8e8b0'), // green monitor glow on face
    // Hair with highlights
    hair: new THREE.Color('#2a1a10'), hairHi: new THREE.Color('#5c3d2e'), hairSh: new THREE.Color('#1a0e08'),
    // Hoodie (green themed)
    hood: new THREE.Color('#22c55e'), hoodHi: new THREE.Color('#4ade80'), hoodSh: new THREE.Color('#16a34a'), hoodDk: new THREE.Color('#0f5132'),
    hoodStr: new THREE.Color('#b8ff61'), // stripe accent
    // Pants
    pant: new THREE.Color('#2a2a3a'), pantSh: new THREE.Color('#1a1a28'),
    // Shoes
    shoe: new THREE.Color('#1a1a1a'), shoeSole: new THREE.Color('#333333'),
    // Eyes / expression
    eyeW: new THREE.Color('#ffffff'), eyeP: new THREE.Color('#1a1a1a'), eyeIris: new THREE.Color('#22c55e'),
    mouth: new THREE.Color('#c44'),
    // Furniture
    wood: new THREE.Color('#8B6914'), woodHi: new THREE.Color('#a67c1a'), woodSh: new THREE.Color('#5a4210'),
    metal: new THREE.Color('#787878'), metalDk: new THREE.Color('#4a4a4a'), metalLt: new THREE.Color('#a0a0a0'),
    // Monitor
    monFrame: new THREE.Color('#1a1a1a'), monBez: new THREE.Color('#2a2a2a'),
    scr1: new THREE.Color('#b8ff61'), scr2: new THREE.Color('#22c55e'), scr3: new THREE.Color('#4ade80'), scrBg: new THREE.Color('#0a2a14'),
    // Keyboard
    kb: new THREE.Color('#333333'), kbKey: new THREE.Color('#5a5a5a'), kbHi: new THREE.Color('#6a6a6a'),
    // Chair
    chrSeat: new THREE.Color('#3a3a3a'), chrBack: new THREE.Color('#2a2a2a'), chrArm: new THREE.Color('#333333'),
    chrWheel: new THREE.Color('#1a1a1a'), chrPole: new THREE.Color('#4a4a4a'),
    // Extras
    mug: new THREE.Color('#e5e5e5'), mugHi: new THREE.Color('#ffffff'), mugSh: new THREE.Color('#a0a0a0'),
    mugCoffee: new THREE.Color('#3d2b1f'),
    plant: new THREE.Color('#22c55e'), plantDk: new THREE.Color('#16a34a'), pot: new THREE.Color('#8B6914'),
    paper: new THREE.Color('#f0f0f0'), paperLn: new THREE.Color('#c0c8d8'),
    headphone: new THREE.Color('#1a1a1a'), headCush: new THREE.Color('#3a3a3a'),
  }), []);

  const { voxels, swanHeadVoxels, swanNeckBase } = useMemo(() => {
    const v: { pos: [number, number, number]; color: THREE.Color }[] = [];
    const swanHeadV: { pos: [number, number, number]; color: THREE.Color }[] = [];
    const add = (x: number, y: number, z: number, col: THREE.Color) => {
      v.push({ pos: [x * s, y * s, z * s], color: col });
    };

    // ═══ GOGGLE GUY WITH LOBSTER ON HEAD ═══

    // Colors
    const skin = new THREE.Color('#ffcc88');
    const skinHi = new THREE.Color('#ffddaa');
    const skinSh = new THREE.Color('#c49670');
    const hair = new THREE.Color('#3a2211');
    const hairHi = new THREE.Color('#5c3d2e');
    const gogFrame = new THREE.Color('#333333');
    const gogLens = new THREE.Color('#ffaa22'); // amber lenses
    const gogLensHi = new THREE.Color('#ffcc44');
    const gogStrap = new THREE.Color('#444444');
    const jacket = new THREE.Color('#1a1a3a'); // dark navy jacket
    const jacketHi = new THREE.Color('#2a2a55');
    const jacketSh = new THREE.Color('#0f0f28');
    const tee = new THREE.Color('#1a1a1a'); // black t-shirt
    const teeGfx = new THREE.Color('#ffdd00'); // yellow graphic on tee
    const jean = new THREE.Color('#334466'); // blue jeans
    const jeanSh = new THREE.Color('#223355');
    const boot = new THREE.Color('#2a2211');
    const bootSole = new THREE.Color('#1a1a1a');
    const bootLace = new THREE.Color('#888888');
    // Lobster colors
    const lobR = new THREE.Color('#ff3300'); // bright red shell
    const lobRHi = new THREE.Color('#ff6633');
    const lobRDk = new THREE.Color('#881100');
    const lobClaw = new THREE.Color('#ff4422');
    const lobClawTip = new THREE.Color('#ff7744');
    const lobEye = new THREE.Color('#111111');
    const lobEyeStalk = new THREE.Color('#cc3322');
    const lobLeg = new THREE.Color('#aa2200');
    const lobTail = new THREE.Color('#bb2211');
    const lobBelly = new THREE.Color('#ee8866');

    // ── LOBSTER ON HEAD (rows 22-27) ──
    // Tail (curled up behind)
    add(0,22,2,lobTail); add(0,23,2,lobTail); add(0,24,2,lobRDk);
    add(1,22,2,lobRDk); add(-1,22,2,lobRDk);
    // Body sitting on head
    add(-1,22,0,lobR); add(0,22,0,lobRHi); add(1,22,0,lobR);
    add(-1,22,1,lobRDk); add(0,22,1,lobR); add(1,22,1,lobRDk);
    add(-2,22,0,lobLeg); add(2,22,0,lobLeg); // side legs
    add(-1,23,0,lobR); add(0,23,0,lobRHi); add(1,23,0,lobR);
    add(-1,23,1,lobR); add(0,23,1,lobRHi); add(1,23,1,lobR);
    // Lobster head
    add(-1,24,0,lobR); add(0,24,0,lobRHi); add(1,24,0,lobR);
    add(0,24,-1,lobR); // face
    // Eye stalks
    add(-1,25,0,lobEyeStalk); add(1,25,0,lobEyeStalk);
    add(-1,26,0,lobEye); add(1,26,0,lobEye);
    // Antennae
    add(-2,25,0,lobRDk); add(2,25,0,lobRDk);
    add(-3,26,-1,lobRDk); add(3,26,-1,lobRDk);
    // Big claws hanging forward
    add(-2,23,0,lobClaw); add(-3,23,-1,lobClaw); add(-3,22,-1,lobClawTip); add(-4,22,-1,lobClawTip);
    add(2,23,0,lobClaw); add(3,23,-1,lobClaw); add(3,22,-1,lobClawTip); add(4,22,-1,lobClawTip);
    // Belly underside visible
    add(0,22,-1,lobBelly); add(-1,22,-1,lobBelly); add(1,22,-1,lobBelly);
    // Extra legs dangling
    add(-2,21,0,lobLeg); add(2,21,0,lobLeg);
    add(-2,21,1,lobLeg); add(2,21,1,lobLeg);

    // ── Hair (rows 19-21, messy) ──
    add(-1,21,0,hair); add(0,21,0,hairHi); add(1,21,0,hair);
    add(-2,20,0,hair); add(-1,20,0,hairHi); add(0,20,0,hair); add(1,20,0,hairHi); add(2,20,0,hair);
    add(-2,20,1,hair); add(-1,20,1,hair); add(0,20,1,hair); add(1,20,1,hair); add(2,20,1,hair);
    add(-1,19,1,hair); add(0,19,1,hair); add(1,19,1,hair);

    // ── Head (rows 16-19) ──
    // Upper head
    add(-2,19,0,skin); add(-1,19,0,skinHi); add(0,19,0,skin); add(1,19,0,skinHi); add(2,19,0,skin);
    // Goggle row — big chunky goggles
    add(-3,18,0,gogFrame); add(-2,18,0,gogLens); add(-1,18,0,gogLensHi); add(0,18,0,gogFrame); add(1,18,0,gogLensHi); add(2,18,0,gogLens); add(3,18,0,gogFrame);
    add(-3,18,-1,gogFrame); add(-2,18,-1,gogLens); add(-1,18,-1,gogLensHi); add(0,18,-1,gogFrame); add(1,18,-1,gogLensHi); add(2,18,-1,gogLens); add(3,18,-1,gogFrame);
    // Goggle strap wraps around
    add(-3,18,1,gogStrap); add(3,18,1,gogStrap);
    add(-2,18,1,gogStrap); add(2,18,1,gogStrap);
    // Lower face — nose and mouth
    add(-2,17,0,skin); add(-1,17,0,skinHi); add(0,17,0,skinSh); add(1,17,0,skinHi); add(2,17,0,skin);
    add(-2,17,1,skinSh); add(-1,17,1,skin); add(0,17,1,skin); add(1,17,1,skin); add(2,17,1,skinSh);
    add(0,17,-1,skinHi); // nose
    // Chin/jaw
    add(-1,16,0,skin); add(0,16,0,skinSh); add(1,16,0,skin);
    add(-1,16,1,skinSh); add(0,16,1,skin); add(1,16,1,skinSh);

    // ── Neck (row 15) ──
    add(0,15,0,skin); add(-1,15,0,skinSh); add(1,15,0,skinSh);

    // ── Utility Jacket + Black Tee (rows 7-14) ──
    // Collar
    add(-2,14,0,jacket); add(-1,14,0,jacketHi); add(0,14,0,jacket); add(1,14,0,jacketHi); add(2,14,0,jacket);
    add(-2,14,1,jacketSh); add(-1,14,1,jacket); add(0,14,1,jacket); add(1,14,1,jacket); add(2,14,1,jacketSh);
    // Upper jacket with t-shirt showing
    add(-2,13,0,jacket); add(-1,13,0,tee); add(0,13,0,teeGfx); add(1,13,0,tee); add(2,13,0,jacket);
    add(-2,13,1,jacketSh); add(-1,13,1,jacket); add(0,13,1,jacket); add(1,13,1,jacket); add(2,13,1,jacketSh);
    add(-2,12,0,jacket); add(-1,12,0,tee); add(0,12,0,teeGfx); add(1,12,0,tee); add(2,12,0,jacket);
    add(-2,12,1,jacketSh); add(-1,12,1,jacket); add(0,12,1,jacket); add(1,12,1,jacket); add(2,12,1,jacketSh);
    // Mid jacket
    for (let by = 9; by <= 11; by++) {
      add(-2,by,0,jacket); add(-1,by,0,jacketHi); add(0,by,0,jacket); add(1,by,0,jacketHi); add(2,by,0,jacket);
      add(-2,by,1,jacketSh); add(-1,by,1,jacket); add(0,by,1,jacket); add(1,by,1,jacket); add(2,by,1,jacketSh);
    }
    // Belt
    add(-2,8,0,boot); add(-1,8,0,boot); add(0,8,0,bootLace); add(1,8,0,boot); add(2,8,0,boot);
    // Lower jacket
    add(-2,7,0,jacket); add(-1,7,0,jacketHi); add(0,7,0,jacket); add(1,7,0,jacketHi); add(2,7,0,jacket);
    add(-2,7,1,jacketSh); add(-1,7,1,jacket); add(0,7,1,jacket); add(1,7,1,jacket); add(2,7,1,jacketSh);

    // Arms (reaching to keyboard)
    add(-3,13,0,jacket); add(-3,12,0,jacketHi); add(-3,11,0,jacket);
    add(-4,11,0,skin); add(-4,11,-1,skinSh); add(-4,11,-2,skin); add(-4,11,-3,skinSh);
    add(3,13,0,jacket); add(3,12,0,jacketHi); add(3,11,0,jacket);
    add(4,11,0,skin); add(4,12,0,skinSh);

    // ── Jeans (rows 4-6) ──
    for (let by = 4; by <= 6; by++) {
      add(-2,by,0,jean); add(-1,by,0,jean); add(1,by,0,jean); add(2,by,0,jean);
      add(-2,by,1,jeanSh); add(-1,by,1,jean); add(1,by,1,jean); add(2,by,1,jeanSh);
    }

    // ── Work Boots ──
    add(-2,3,0,boot); add(-1,3,0,boot); add(1,3,0,boot); add(2,3,0,boot);
    add(-2,2,0,boot); add(-1,2,0,bootLace); add(1,2,0,bootLace); add(2,2,0,boot);
    add(-2,1,0,bootSole); add(-1,1,0,bootSole); add(-2,1,-1,bootSole);
    add(1,1,0,bootSole); add(2,1,0,bootSole); add(2,1,-1,bootSole);

    // ═══ BLACK SWAN PET (AI Agent companion, sitting beside the guy) ═══
    const swanBlk = new THREE.Color('#0a0a0a');  // black feathers
    const swanBlkHi = new THREE.Color('#1a1a1a');
    const swanBlkSh = new THREE.Color('#050505');
    const swanBeak = new THREE.Color('#ff6600');  // orange beak
    const swanBeakTip = new THREE.Color('#222222');
    const swanEye = new THREE.Color('#ff2222');   // red eye — menacing AI
    const swanEyeGlow = new THREE.Color('#ff4444');
    const swanWhite = new THREE.Color('#dddddd'); // white chest patch
    const swanFoot = new THREE.Color('#333333');
    const swanGlow = new THREE.Color('#00ff4c');  // subtle green AI glow

    // Swan offset: to the left of the character (x-6)
    const sx = -7;
    const sy = 1; // sitting on ground level

    // Feet/legs
    add(sx,sy,0,swanFoot); add(sx+1,sy,0,swanFoot);
    add(sx,sy,-1,swanFoot); add(sx+1,sy,-1,swanFoot);
    // Legs
    add(sx,sy+1,0,swanFoot); add(sx+1,sy+1,0,swanFoot);

    // Body (plump, rows sy+2 to sy+5)
    for (let by = sy+2; by <= sy+5; by++) {
      const isWing = by >= sy+3 && by <= sy+4;
      add(sx-1,by,0,swanBlkSh); add(sx,by,0,isWing?swanBlkHi:swanBlk); add(sx+1,by,0,swanBlk); add(sx+2,by,0,swanBlkSh);
      add(sx-1,by,1,swanBlkSh); add(sx,by,1,swanBlk); add(sx+1,by,1,swanBlk); add(sx+2,by,1,swanBlkSh);
    }
    // White chest patch
    add(sx,sy+2,-1,swanWhite); add(sx+1,sy+2,-1,swanWhite);
    add(sx,sy+3,-1,swanWhite); add(sx+1,sy+3,-1,swanWhite);

    // Wings spread slightly
    add(sx-2,sy+4,0,swanBlkHi); add(sx+3,sy+4,0,swanBlkHi);
    add(sx-2,sy+3,0,swanBlk); add(sx+3,sy+3,0,swanBlk);
    // Wing tips
    add(sx-3,sy+4,0,swanBlkSh); add(sx+4,sy+4,0,swanBlkSh);

    // Tail feathers (up and back)
    add(sx,sy+5,1,swanBlkHi); add(sx+1,sy+5,1,swanBlk);
    add(sx,sy+6,1,swanBlkSh); add(sx+1,sy+6,1,swanBlkSh);
    add(sx,sy+7,2,swanBlkSh);

    // Neck + Head — pushed to swanHeadVoxels (separate group for cursor tracking)
    // Pivot is at base of neck (sx, sy+6, 0) — offsets relative to that
    const neckBaseX = sx * s;
    const neckBaseY = (sy + 6) * s;
    const neckBaseZ = 0;
    const ha = (x: number, y: number, z: number, col: THREE.Color) => {
      swanHeadV.push({ pos: [(x * s) - neckBaseX, (y * s) - neckBaseY, (z * s) - neckBaseZ], color: col });
    };
    // Neck (rows sy+6 to sy+9)
    ha(sx,sy+6,0,swanBlk); ha(sx+1,sy+6,0,swanBlkHi);
    ha(sx,sy+7,0,swanBlk); ha(sx+1,sy+7,0,swanBlkHi);
    ha(sx,sy+8,-1,swanBlk); ha(sx+1,sy+8,-1,swanBlk);
    ha(sx,sy+9,-1,swanBlkHi);
    // Head
    ha(sx-1,sy+10,-1,swanBlk); ha(sx,sy+10,-1,swanBlkHi); ha(sx+1,sy+10,-1,swanBlk);
    ha(sx,sy+10,-2,swanBlk); // back of head
    // Eye — glowing red AI eye
    ha(sx-1,sy+10,-2,swanEye);
    ha(sx+1,sy+10,-2,swanEye);
    // Beak
    ha(sx,sy+10,0,swanBeak);
    ha(sx,sy+9,0,swanBeak);
    ha(sx,sy+9,1,swanBeakTip);
    // AI glow accent on eyes
    ha(sx-1,sy+10,-2,swanEyeGlow); // left eye ring

    // AI glow accent — subtle green glow on chest
    add(sx,sy+3,0,swanGlow); // heart glow

    // ═══ L-SHAPED DESK ═══
    // Main surface
    for (let dx = -5; dx <= 5; dx++) {
      add(dx,5,-3,c.wood); add(dx,5,-4,c.woodHi); add(dx,5,-5,c.wood); add(dx,5,-6,c.woodSh);
    }
    // Side extension
    add(5,5,-2,c.wood); add(5,5,-1,c.woodHi); add(6,5,-3,c.wood); add(6,5,-4,c.woodHi); add(6,5,-5,c.wood);
    // Desk legs (metal)
    for (let ly = 0; ly <= 4; ly++) {
      add(-5,ly,-3,c.metalDk); add(-5,ly,-6,c.metalDk); add(5,ly,-6,c.metalDk); add(6,ly,-3,c.metalDk);
    }

    // ═══ ULTRAWIDE MONITOR ═══
    // Stand
    add(-1,6,-5,c.metalDk); add(0,6,-5,c.metal); add(1,6,-5,c.metalDk);
    add(0,7,-5,c.metal);
    // Frame
    for (let mx = -3; mx <= 3; mx++) { add(mx,12,-5,c.monFrame); add(mx,8,-5,c.monFrame); }
    add(-3,9,-5,c.monFrame); add(-3,10,-5,c.monFrame); add(-3,11,-5,c.monFrame);
    add(3,9,-5,c.monFrame); add(3,10,-5,c.monFrame); add(3,11,-5,c.monFrame);
    // Screen with code lines
    add(-2,11,-5,c.scrBg); add(-1,11,-5,c.scr1); add(0,11,-5,c.scr2); add(1,11,-5,c.scr3); add(2,11,-5,c.scrBg);
    add(-2,10,-5,c.scr2); add(-1,10,-5,c.scrBg); add(0,10,-5,c.scr1); add(1,10,-5,c.scr2); add(2,10,-5,c.scr3);
    add(-2,9,-5,c.scrBg); add(-1,9,-5,c.scr3); add(0,9,-5,c.scr2); add(1,9,-5,c.scrBg); add(2,9,-5,c.scr1);
    add(-2,8,-5,c.scr1); add(-1,8,-5,c.scr2); add(0,8,-5,c.scrBg); add(1,8,-5,c.scr1); add(2,8,-5,c.scrBg);

    // ═══ MECHANICAL KEYBOARD ═══
    for (let kx = -3; kx <= 3; kx++) { add(kx,6,-3,c.kb); add(kx,6,-4,c.kb); }
    // Key highlights
    add(-2,6,-3,c.kbKey); add(0,6,-3,c.kbHi); add(2,6,-3,c.kbKey);
    add(-1,6,-4,c.kbKey); add(1,6,-4,c.kbHi);
    // Spacebar
    add(-1,6,-3,c.kbHi); add(0,6,-3,c.kbHi); add(1,6,-3,c.kbHi);

    // ═══ DESK ITEMS ═══
    // Coffee mug with steam
    add(4,6,-4,c.mug); add(4,7,-4,c.mug); add(4,6,-5,c.mugSh);
    add(5,7,-4,c.mugSh); // handle
    add(4,6,-4,c.mugCoffee); // coffee inside (top)
    // Plant in pot
    add(-4,6,-4,c.pot); add(-4,6,-5,c.pot); add(-4,7,-4,c.plant); add(-4,8,-4,c.plantDk); add(-5,7,-4,c.plantDk); add(-3,7,-5,c.plant);
    // Stack of papers
    add(5,6,-5,c.paper); add(5,6,-6,c.paperLn); add(5,7,-5,c.paper);
    // Headphones on desk
    add(6,6,-4,c.headphone); add(6,6,-5,c.headCush);
    // Mouse
    add(3,6,-3,c.metalLt); add(3,6,-2,c.metal);
    // Mousepad
    add(2,5,-2,c.hoodDk); add(3,5,-2,c.hoodDk); add(4,5,-2,c.hoodDk);

    // Swan neck base position in local voxel-scaled coords (sx=-7, sy=1 already declared above)
    const nBase: [number, number, number] = [sx * s, (sy + 6) * s, 0];

    return { voxels: v, swanHeadVoxels: swanHeadV, swanNeckBase: nBase };
  }, [s, c]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    // Smooth continuous loop: work at desk → spiral into portal → return
    // Uses a single sine curve so all transitions are seamless (no if/else jump)
    const cycleDuration = 16;
    const loopT = ((t % cycleDuration) / cycleDuration) * Math.PI * 2;
    const rise = Math.sin(loopT); // -1 to 1, smooth

    // Map rise from [-1, 1] to progress [0, 1] where 0 = at desk, 1 = deep in portal
    // Use (1 + rise) / 2 so it's 0 at rise=-1, 0.5 at rise=0, 1 at rise=1
    const progress = (1 + rise) / 2;
    // Ease in/out for more time sitting, faster through portal
    const eased = progress * progress * (3 - 2 * progress); // smoothstep

    const spiralAngle = loopT * 3;
    const spiralR = 0.6 * eased * (1 - eased) * 4; // peaks in middle of journey
    const moveAlongCrater = eased * 5;
    const scale = 1 - eased * 0.9; // 1 at desk → 0.1 at portal center

    groupRef.current.position.set(
      basePos.x + craterDir.x * moveAlongCrater + Math.cos(spiralAngle) * spiralR,
      basePos.y + craterDir.y * moveAlongCrater + Math.sin(spiralAngle) * spiralR + Math.sin(t * 2) * 0.02 * (1 - eased),
      basePos.z + craterDir.z * moveAlongCrater,
    );
    groupRef.current.rotation.set(
      -0.35 + eased * 1.5,
      Math.sin(t * 0.5) * 0.06 * (1 - eased) + eased * Math.PI,
      eased * Math.PI * 0.5,
    );
    groupRef.current.scale.setScalar(Math.max(0.05, scale));

    // Flicker monitor screen when near desk
    if (eased < 0.3) {
      groupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.color && (mat.color.r > 0.4 && mat.color.g > 0.8)) {
            mat.emissiveIntensity = 0.3 + Math.sin(t * 8) * 0.15;
          }
        }
      });
    }

    // Swan neck+head follows cursor — VERY dramatic so it's visible at this scale
    // Only when near the desk, not while spiraling through portal
    if (swanHeadRef.current) {
      const nearDesk = Math.max(0, 1 - eased * 3); // 1.0 at desk, fades to 0 as it spirals
      const mx = _globalMouse.x;  // -1 (left) to 1 (right)
      const my = _globalMouse.y;  // -1 (bottom) to 1 (top)

      // Huge rotation — the neck really cranes toward the cursor
      const targetRotX = -my * 1.5 * nearDesk;
      const targetRotY = mx * 1.8 * nearDesk;
      const targetRotZ = -mx * 0.3 * nearDesk;

      // Large positional displacement — head physically reaches toward cursor
      // s * 8 means the head moves ~1 full voxel body-width in each direction
      const targetPosX = mx * s * 8 * nearDesk;
      const targetPosY = my * s * 6 * nearDesk;

      const lr = 0.12; // faster lerp so it's responsive
      swanHeadRef.current.rotation.x += (targetRotX - swanHeadRef.current.rotation.x) * lr;
      swanHeadRef.current.rotation.y += (targetRotY - swanHeadRef.current.rotation.y) * lr;
      swanHeadRef.current.rotation.z += (targetRotZ - swanHeadRef.current.rotation.z) * lr;
      swanHeadRef.current.position.x += ((swanNeckBase[0] + targetPosX) - swanHeadRef.current.position.x) * lr;
      swanHeadRef.current.position.y += ((swanNeckBase[1] + targetPosY) - swanHeadRef.current.position.y) * lr;
    }
  });

  return (
    <group ref={groupRef} position={[basePos.x, basePos.y, basePos.z]} rotation={[-0.35, 0, 0]}>
      {/* Spotlight on agent so it glows in the dark chamber */}
      <pointLight color={0xffffff} intensity={3} distance={5} decay={2} position={[0, s * 12, -s * 3]} />
      <pointLight color={ACCENT_HEX} intensity={2} distance={4} decay={2} position={[0, s * 5, s * 3]} />
      {voxels.map((v, i) => (
        <mesh key={i} position={v.pos}>
          <boxGeometry args={[s * 0.92, s * 0.92, s * 0.92]} />
          <meshStandardMaterial
            color={v.color}
            emissive={v.color}
            emissiveIntensity={0.35}
            roughness={0.3}
            metalness={0.05}
          />
        </mesh>
      ))}
      {/* Swan neck+head — separate group that tracks cursor */}
      <group ref={swanHeadRef} position={swanNeckBase}>
        {swanHeadVoxels.map((v, i) => (
          <mesh key={`sh${i}`} position={v.pos}>
            <boxGeometry args={[s * 0.92, s * 0.92, s * 0.92]} />
            <meshStandardMaterial
              color={v.color}
              emissive={v.color}
              emissiveIntensity={0.35}
              roughness={0.3}
              metalness={0.05}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ─── Glowing Squiggly Vein Around Portal ─────────────────────────────────────

function PortalVein() {
  const tubeRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const VOXEL_STEP = 0.65; // matches VoxelPlanet grid step

  // Build a path that snaps to voxel grid edges around the crater rim
  const { curve, glowCurve, lightPositions } = useMemo(() => {
    const craterDir = new THREE.Vector3(0.0, 0.35, 1.0).normalize();
    const craterCenter = craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0));
    const planetCenter = new THREE.Vector3(0, -2, 0);
    const planetR = 8.0;

    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(craterDir, up).normalize();
    const forward = new THREE.Vector3().crossVectors(right, craterDir).normalize();

    const rawPoints: THREE.Vector3[] = [];
    const segments = 180;

    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;

      // Circle around crater rim
      const rimRadius = 3.6;
      const baseX = Math.cos(t) * rimRadius;
      const baseY = Math.sin(t) * rimRadius;

      const rimPoint = craterCenter.clone()
        .add(right.clone().multiplyScalar(baseX))
        .add(forward.clone().multiplyScalar(baseY));

      // Project to planet surface
      const toSurface = rimPoint.clone().sub(planetCenter).normalize().multiplyScalar(planetR);
      const surfacePoint = planetCenter.clone().add(toSurface);
      const normal = toSurface.clone().normalize();

      // Snap to voxel grid — round to nearest half-step (between blocks)
      const halfStep = VOXEL_STEP / 2;
      const snappedX = Math.round(surfacePoint.x / halfStep) * halfStep;
      const snappedY = Math.round(surfacePoint.y / halfStep) * halfStep;
      const snappedZ = Math.round(surfacePoint.z / halfStep) * halfStep;

      // Re-project snapped point back to planet surface
      const snapped = new THREE.Vector3(snappedX, snappedY, snappedZ);
      const snappedDir = snapped.clone().sub(planetCenter).normalize();
      // Vein sits at a uniform depth inside the blocks on ALL sides
      // No wave variation — constant depth so glow is even around the entire rim
      const depth = -0.55;
      const finalPoint = planetCenter.clone().add(snappedDir.multiplyScalar(planetR + depth));

      rawPoints.push(finalPoint);
    }

    // Smooth the path slightly so it doesn't jitter but keeps the blocky feel
    const smoothed: THREE.Vector3[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const prev = rawPoints[(i - 1 + rawPoints.length) % rawPoints.length];
      const curr = rawPoints[i];
      const next = rawPoints[(i + 1) % rawPoints.length];
      smoothed.push(new THREE.Vector3(
        prev.x * 0.15 + curr.x * 0.7 + next.x * 0.15,
        prev.y * 0.15 + curr.y * 0.7 + next.y * 0.15,
        prev.z * 0.15 + curr.z * 0.7 + next.z * 0.15,
      ));
    }

    // More frequent lights along the vein — positioned at block surface level
    // so the glow illuminates the seams between blocks from inside
    const lights: [number, number, number][] = [];
    for (let i = 0; i < smoothed.length; i += 15) {
      const p = smoothed[i];
      const n = p.clone().sub(planetCenter).normalize();
      // Place light at the surface — glow from the vein below reaches up through cracks
      const lp = p.clone().add(n.multiplyScalar(0.5));
      lights.push([lp.x, lp.y, lp.z]);
    }

    // Glow path: at surface level so bloom catches between blocks
    const glowSmoothed = smoothed.map(p => {
      const n = p.clone().sub(planetCenter).normalize();
      return p.clone().add(n.multiplyScalar(0.3));
    });

    return {
      curve: new THREE.CatmullRomCurve3(smoothed, true, 'centripetal', 0.3),
      glowCurve: new THREE.CatmullRomCurve3(glowSmoothed, true, 'centripetal', 0.3),
      lightPositions: lights,
    };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (tubeRef.current) {
      (tubeRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5 + Math.sin(t * 2.0) * 1.0;
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshStandardMaterial).opacity = 0.2 + Math.sin(t * 1.5) * 0.1;
    }
  });

  return (
    <group>
      {/* Main vein — buried inside blocks, glow reaches through seams */}
      <mesh ref={tubeRef}>
        <tubeGeometry args={[curve, 300, 0.06, 6, true]} />
        <meshStandardMaterial
          color={0x00ff4c}
          emissive={0x00ff4c}
          emissiveIntensity={6.0}
          transparent
          opacity={0.9}
          toneMapped={false}
        />
      </mesh>

      {/* Point lights along the vein — strong glow bleeds between blocks */}
      {lightPositions.map((pos, i) => (
        <pointLight key={i} position={pos} color={0x00ff4c} intensity={1.5} distance={1.8} decay={2} />
      ))}
    </group>
  );
}

// ─── Black Swan with Crown (perched on top of the planet) ──────────────────

function BlackSwanKing() {
  const groupRef = useRef<THREE.Group>(null);
  const headGroupRef = useRef<THREE.Group>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);

  // Position on top of the planet, slightly tilted to look toward the portal
  const planetCenter = useMemo(() => new THREE.Vector3(0, -2, 0), []);
  const topPos = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const tilt = craterDir.clone().multiplyScalar(0.2).add(up).normalize();
    return planetCenter.clone().add(tilt.multiplyScalar(8.3));
  }, [craterDir, planetCenter]);

  const PX = 0.18; // pixel unit size for the swan

  // Animate: gentle bobbing, sway, and head follows cursor
  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    // Gentle bob
    groupRef.current.position.y = topPos.y + Math.sin(t * 0.8) * 0.08;
    // Subtle sway
    groupRef.current.rotation.z = Math.sin(t * 0.5) * 0.03;

    // HEAD FOLLOWS CURSOR
    if (headGroupRef.current) {
      const mx = _globalMouse.x; // -1 to 1
      const my = _globalMouse.y; // -1 to 1
      // Rotation: head turns to face cursor direction
      const targetRotY = mx * 0.6;     // yaw — look left/right
      const targetRotX = -my * 0.35;   // pitch — look up/down
      const targetRotZ = -mx * 0.12;   // tilt — slight head cock
      // Smooth lerp
      const lr = 0.07;
      headGroupRef.current.rotation.x += (targetRotX - headGroupRef.current.rotation.x) * lr;
      headGroupRef.current.rotation.y += (targetRotY - headGroupRef.current.rotation.y) * lr;
      headGroupRef.current.rotation.z += (targetRotZ - headGroupRef.current.rotation.z) * lr;
    }
  });

  // Colors
  const black = '#0a0a0a';
  const darkGrey = '#1a1a1a';
  const bodyBlack = '#111115';
  const bodyDark = '#0d0d10';
  const wingDark = '#161618';
  const wingEdge = '#222225';
  const beak = '#f97316';
  const beakTip = '#ea580c';
  const gogglePurple = '#7722cc';
  const goggleDark = '#4a1188';
  const goggleFrame = '#2a0a55';
  const goggleLens = '#aa44ff';
  const goggleShine = '#cc88ff';
  const veinPurple = '#6622aa';
  const veinBright = '#8833dd';
  const crownGold = '#fbbf24';
  const crownDark = '#d4940a';
  const crownJewel = '#ef4444';
  const crownJewelGreen = '#22c55e';

  // All boxes as [x, y, z, w, h, d, color]
  type VoxelDef = [number, number, number, number, number, number, string];

  // BODY voxels — stays fixed
  const bodyVoxels: VoxelDef[] = [
    // ═══ BODY — oval, chunky, sitting ═══
    [0, 0, 0, PX*5, PX*4, PX*6, bodyBlack],
    [0, PX*0.5, 0, PX*4.5, PX*3.5, PX*5.5, bodyDark],
    [0, PX*0.8, -PX*2.5, PX*4, PX*3, PX*1.5, bodyBlack],
    // Wings
    [-PX*2.8, PX*0.5, PX*0.5, PX*1.2, PX*3, PX*5, wingDark],
    [-PX*3.2, PX*0.8, PX*1, PX*0.5, PX*2, PX*3.5, wingEdge],
    [PX*2.8, PX*0.5, PX*0.5, PX*1.2, PX*3, PX*5, wingDark],
    [PX*3.2, PX*0.8, PX*1, PX*0.5, PX*2, PX*3.5, wingEdge],
    // Tail
    [0, PX*1.5, PX*3.5, PX*3, PX*3.5, PX*1.5, bodyBlack],
    [0, PX*3, PX*4, PX*2.5, PX*2.5, PX*1, wingDark],
    [0, PX*4, PX*4.3, PX*1.5, PX*1.5, PX*0.5, wingEdge],
    // Feet
    [-PX*1.2, -PX*2.2, -PX*0.5, PX*1.5, PX*0.5, PX*2.5, darkGrey],
    [PX*1.2, -PX*2.2, -PX*0.5, PX*1.5, PX*0.5, PX*2.5, darkGrey],
  ];

  // HEAD + NECK voxels — these follow the cursor
  // Positions are relative to neck pivot at (0, PX*3, -PX*2)
  const neckPivotY = PX * 3;
  const neckPivotZ = -PX * 2;
  const headVoxels: VoxelDef[] = [
    // Neck (offset from pivot)
    [0, 0, 0, PX*2, PX*2.5, PX*2, bodyBlack],
    [0, PX*2, -PX*0.5, PX*1.8, PX*2.5, PX*1.8, bodyBlack],
    [0, PX*4, -PX*0.5, PX*1.6, PX*2.5, PX*1.6, bodyDark],
    [0, PX*6, 0, PX*1.5, PX*2, PX*1.5, bodyBlack],
    // Head
    [0, PX*7.5, PX*0.2, PX*2.5, PX*2.5, PX*2.8, bodyBlack],
    [0, PX*7.5, PX*0.2, PX*2.2, PX*2.2, PX*2.5, bodyDark],
    // Goggles
    [0, PX*8, -PX*0.8, PX*3.5, PX*1.4, PX*1.2, goggleFrame],
    [-PX*1, PX*8, -PX*1.2, PX*1.2, PX*1.0, PX*0.4, gogglePurple],
    [-PX*1, PX*8, -PX*1.35, PX*0.9, PX*0.7, PX*0.15, goggleLens],
    [-PX*0.7, PX*8.2, -PX*1.4, PX*0.3, PX*0.3, PX*0.1, goggleShine],
    [PX*1, PX*8, -PX*1.2, PX*1.2, PX*1.0, PX*0.4, gogglePurple],
    [PX*1, PX*8, -PX*1.35, PX*0.9, PX*0.7, PX*0.15, goggleLens],
    [PX*0.7, PX*8.2, -PX*1.4, PX*0.3, PX*0.3, PX*0.1, goggleShine],
    [0, PX*7.8, -PX*1.1, PX*0.6, PX*0.5, PX*0.3, goggleFrame],
    [-PX*1.8, PX*8, -PX*0.2, PX*0.4, PX*0.8, PX*1.5, goggleFrame],
    [PX*1.8, PX*8, -PX*0.2, PX*0.4, PX*0.8, PX*1.5, goggleFrame],
    [-PX*1.6, PX*8, PX*1.2, PX*0.3, PX*0.6, PX*1.5, goggleDark],
    [PX*1.6, PX*8, PX*1.2, PX*0.3, PX*0.6, PX*1.5, goggleDark],
    // Veins on neck/head
    [-PX*1.3, PX*7.2, -PX*0.5, PX*0.15, PX*0.8, PX*0.15, veinPurple],
    [-PX*1.5, PX*6.5, -PX*0.3, PX*0.12, PX*1.0, PX*0.12, veinBright],
    [-PX*1.2, PX*5.5, 0, PX*0.12, PX*1.2, PX*0.12, veinPurple],
    [-PX*0.8, PX*4.5, PX*0.2, PX*0.1, PX*1.0, PX*0.1, veinBright],
    [PX*1.3, PX*7.2, -PX*0.5, PX*0.15, PX*0.8, PX*0.15, veinPurple],
    [PX*1.5, PX*6.5, -PX*0.3, PX*0.12, PX*1.0, PX*0.12, veinBright],
    [PX*1.2, PX*5.5, 0, PX*0.12, PX*1.2, PX*0.12, veinPurple],
    [PX*0.8, PX*4.5, PX*0.2, PX*0.1, PX*1.0, PX*0.1, veinBright],
    [0, PX*8.8, -PX*0.6, PX*0.15, PX*0.6, PX*0.15, veinBright],
    [0, PX*9, -PX*0.2, PX*0.12, PX*0.5, PX*0.12, veinPurple],
    [-PX*0.5, PX*3.5, PX*0.5, PX*0.1, PX*1.5, PX*0.1, veinPurple],
    [PX*0.5, PX*3.5, PX*0.5, PX*0.1, PX*1.5, PX*0.1, veinPurple],
    [-PX*0.3, PX*2, PX*0.8, PX*0.08, PX*1.2, PX*0.08, veinBright],
    [PX*0.3, PX*2, PX*0.8, PX*0.08, PX*1.2, PX*0.08, veinBright],
    // Beak
    [0, PX*7.3, -PX*1.4, PX*1.2, PX*0.6, PX*1.2, beak],
    [0, PX*7.1, -PX*1.8, PX*0.8, PX*0.4, PX*0.8, beakTip],
    // Crown
    [0, PX*9.2, PX*0.2, PX*3.2, PX*1, PX*3, crownGold],
    [0, PX*9.2, PX*0.2, PX*3, PX*0.8, PX*2.8, crownDark],
    [-PX*1, PX*10.5, PX*0.2, PX*0.8, PX*1.5, PX*0.8, crownGold],
    [0, PX*11.2, PX*0.2, PX*0.8, PX*2, PX*0.8, crownGold],
    [PX*1, PX*10.5, PX*0.2, PX*0.8, PX*1.5, PX*0.8, crownGold],
    [-PX*1, PX*10.8, -PX*0.3, PX*0.4, PX*0.4, PX*0.2, crownJewel],
    [0, PX*11.5, -PX*0.3, PX*0.5, PX*0.5, PX*0.2, crownJewelGreen],
    [PX*1, PX*10.8, -PX*0.3, PX*0.4, PX*0.4, PX*0.2, crownJewel],
    [-PX*1.5, PX*9.4, -PX*1.3, PX*0.35, PX*0.35, PX*0.15, crownJewel],
    [0, PX*9.4, -PX*1.3, PX*0.35, PX*0.35, PX*0.15, crownJewelGreen],
    [PX*1.5, PX*9.4, -PX*1.3, PX*0.35, PX*0.35, PX*0.15, crownJewel],
  ];

  // Shared material function for both body and head
  const matProps = (color: string) => ({
    color,
    emissive: (color === crownGold || color === crownDark) ? color
      : (color === crownJewel || color === crownJewelGreen) ? color
      : (color === gogglePurple || color === goggleLens || color === goggleShine) ? color
      : (color === veinPurple || color === veinBright) ? color
      : '#000000',
    emissiveIntensity: (color === crownGold || color === crownDark) ? 1.2
      : (color === crownJewel || color === crownJewelGreen) ? 3.0
      : (color === goggleLens || color === goggleShine) ? 0.3
      : color === gogglePurple ? 0.2
      : color === veinPurple ? 0.15
      : color === veinBright ? 0.25
      : 0,
    roughness: (color === goggleLens || color === goggleShine) ? 0.1 : 0.5,
    metalness: (color === crownGold || color === crownDark) ? 0.7
      : (color === goggleLens || color === goggleShine || color === gogglePurple) ? 0.8
      : 0.1,
    toneMapped: !(color === crownJewel || color === crownJewelGreen),
  });

  return (
    <group ref={groupRef} position={[topPos.x, topPos.y, topPos.z]}
      rotation={[0.15, Math.PI + 0.3, 0]}
    >
      {/* Body — stays still */}
      {bodyVoxels.map((v, idx) => (
        <mesh key={`b${idx}`} position={[v[0], v[1], v[2]]}>
          <boxGeometry args={[v[3], v[4], v[5]]} />
          <meshStandardMaterial {...matProps(v[6])} />
        </mesh>
      ))}

      {/* Head + neck — follows cursor, pivots from base of neck */}
      <group ref={headGroupRef} position={[0, neckPivotY, neckPivotZ]}>
        {headVoxels.map((v, idx) => (
          <mesh key={`h${idx}`} position={[v[0], v[1], v[2]]}>
            <boxGeometry args={[v[3], v[4], v[5]]} />
            <meshStandardMaterial {...matProps(v[6])} />
          </mesh>
        ))}
        {/* Crown glow */}
        <pointLight position={[0, PX * 11, 0]} color={0xfbbf24} intensity={2.5} distance={4} decay={2} />
        <pointLight position={[0, PX * 10, -PX * 1]} color={0xef4444} intensity={0.8} distance={2.5} decay={2} />
        {/* Goggle glow */}
        <pointLight position={[0, PX * 8, -PX * 2]} color={0x7722cc} intensity={0.2} distance={2} decay={2} />
      </group>
    </group>
  );
}

// ─── Green Dripping Lava (fluorescent goo from bottom of planet) ────────────

function DrippingLava({ count = 40 }: { count?: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const planetCenter = useMemo(() => new THREE.Vector3(0, -2, 0), []);

  // Drips of different types: tiny fast droplets, medium drips, long slow oozes
  const drips = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      // Only spawn from the very bottom of the planet
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.PI * 0.82 + Math.random() * Math.PI * 0.18; // bottom 18% of sphere
      const r = 8.0;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = -Math.abs(r * Math.cos(phi)); // force downward
      const z = r * Math.sin(phi) * Math.sin(theta);

      // 3 drip types: tiny (40%), medium (35%), long ooze (25%)
      const roll = Math.random();
      let size: number, fallSpeed: number, fallDist: number, stretchMax: number, wobbleAmt: number;
      if (roll < 0.3) {
        // Quick splashy droplets — fast and small
        size = 0.03 + Math.random() * 0.05;
        fallSpeed = 1.5 + Math.random() * 2.0;
        fallDist = 3 + Math.random() * 5;
        stretchMax = 1.5;
        wobbleAmt = 0.1 + Math.random() * 0.15;
      } else if (roll < 0.55) {
        // Medium drips — moderate speed
        size = 0.08 + Math.random() * 0.1;
        fallSpeed = 0.7 + Math.random() * 0.8;
        fallDist = 4 + Math.random() * 7;
        stretchMax = 3.0;
        wobbleAmt = 0.15 + Math.random() * 0.3;
      } else if (roll < 0.8) {
        // Big fat drips — heavier, faster than oozes
        size = 0.12 + Math.random() * 0.12;
        fallSpeed = 0.5 + Math.random() * 0.6;
        fallDist = 5 + Math.random() * 8;
        stretchMax = 4.0;
        wobbleAmt = 0.2 + Math.random() * 0.4;
      } else {
        // Long slow oozing drips — thick, stretchy, slow
        size = 0.15 + Math.random() * 0.18;
        fallSpeed = 0.2 + Math.random() * 0.3;
        fallDist = 7 + Math.random() * 12;
        stretchMax = 7.0;
        wobbleAmt = 0.3 + Math.random() * 0.5;
      }

      return {
        startX: x, startY: y + planetCenter.y, startZ: z,
        fallSpeed, fallDist, size, stretchMax,
        phase: Math.random(),
        wobble: wobbleAmt,
        wobbleSpeed: 0.5 + Math.random() * 1.5,
      };
    });
  }, [count, planetCenter]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const children = groupRef.current.children;

    for (let i = 0; i < drips.length; i++) {
      const drip = drips[i];
      const mesh = children[i] as THREE.Mesh;
      if (!mesh) continue;

      const cycle = (t * drip.fallSpeed * 0.08 + drip.phase) % 1;

      // Two-speed fall: slow sticky ooze near the planet, then accelerates once it detaches
      // Planet bottom is at roughly y = -10 (center -2, radius 8)
      // First 40% of cycle = slow creep along surface, last 60% = accelerating freefall
      let fallY: number;
      if (cycle < 0.4) {
        // Slow sticky phase — clinging to the planet surface
        const slowPhase = cycle / 0.4; // 0→1
        fallY = -slowPhase * drip.fallDist * 0.15; // barely moves
      } else {
        // Detached — accelerates like it broke free from the goo
        const fastPhase = (cycle - 0.4) / 0.6; // 0→1
        const accel = fastPhase * fastPhase * fastPhase; // cubic acceleration
        fallY = -drip.fallDist * 0.15 - accel * drip.fallDist * 0.85;
      }
      const fallPhase = cycle;

      // Straight down — no wobble
      mesh.position.set(
        drip.startX,
        drip.startY + fallY,
        drip.startZ,
      );

      // Stretch into long gooey shape as it falls — bigger drips stretch more
      const stretchY = 1 + fallPhase * drip.stretchMax;
      const squishXZ = 1 - fallPhase * 0.5;
      mesh.scale.set(drip.size * squishXZ, drip.size * stretchY, drip.size * squishXZ);

      const fadeIn = Math.min(cycle / 0.08, 1.0);
      const fadeOut = Math.min((1 - cycle) / 0.12, 1.0);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = fadeIn * fadeOut * 0.85;
    }
  });

  return (
    <group ref={groupRef}>
      {drips.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial
            color={0x00ff4c}
            emissive={0x00ff4c}
            emissiveIntensity={3.0}
            transparent
            opacity={0.8}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Shooting Stars ─────────────────────────────────────────────────────────

function ShootingStars({ count = 6 }: { count?: number }) {
  const groupRef = useRef<THREE.Group>(null);

  const stars = useMemo(() => {
    return Array.from({ length: count }, () => ({
      // Random start position in the sky
      startX: (Math.random() - 0.5) * 80,
      startY: 15 + Math.random() * 25,
      startZ: -20 - Math.random() * 30,
      // Direction (diagonal streak)
      dirX: -0.5 + Math.random() * -0.5,
      dirY: -0.3 - Math.random() * 0.4,
      dirZ: 0.2 + Math.random() * 0.3,
      speed: 15 + Math.random() * 25,
      length: 1.5 + Math.random() * 3,
      phase: Math.random() * 30, // stagger timing
      interval: 8 + Math.random() * 15, // seconds between appearances
    }));
  }, [count]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const children = groupRef.current.children;

    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const mesh = children[i] as THREE.Mesh;
      if (!mesh) continue;

      // Each star fires periodically
      const cycleTime = (t + star.phase) % star.interval;
      const streakDuration = 0.8; // how long the streak is visible

      if (cycleTime < streakDuration) {
        const progress = cycleTime / streakDuration;
        const pos = progress * star.speed;

        mesh.position.set(
          star.startX + star.dirX * pos,
          star.startY + star.dirY * pos,
          star.startZ + star.dirZ * pos,
        );

        // Fade in then out
        const fade = progress < 0.3 ? progress / 0.3 : (1 - progress) / 0.7;
        (mesh.material as THREE.MeshStandardMaterial).opacity = fade * 0.9;

        // Stretch along direction of travel
        mesh.scale.set(0.03, 0.03, star.length);
        mesh.lookAt(
          mesh.position.x + star.dirX,
          mesh.position.y + star.dirY,
          mesh.position.z + star.dirZ,
        );
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {stars.map((_, i) => (
        <mesh key={i} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={0xffffff}
            emissive={0xffffff}
            emissiveIntensity={5.0}
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Background Planets (small distant worlds) ─────────────────────────────

function BackgroundPlanets() {
  const planets = useMemo(() => [
    // Spread wide across the sky — distant glowing worlds
    { pos: [-80, 30, -120] as [number,number,number], r: 1.0, color: '#3a2a5e', emissive: '#9955ff', ei: 3.0 },
    { pos: [90, 20, -130] as [number,number,number], r: 0.8, color: '#2a3a2e', emissive: '#44ff66', ei: 3.5 },
    { pos: [-50, -30, -110] as [number,number,number], r: 1.2, color: '#3a2525', emissive: '#ff6644', ei: 2.5 },
    { pos: [60, 45, -100] as [number,number,number], r: 0.7, color: '#252a4e', emissive: '#6688ff', ei: 4.0 },
    { pos: [-95, -15, -140] as [number,number,number], r: 0.9, color: '#3e3a2a', emissive: '#ffcc44', ei: 3.0 },
    { pos: [75, -35, -115] as [number,number,number], r: 0.7, color: '#2a3a3a', emissive: '#44dddd', ei: 3.5 },
    { pos: [-30, 50, -130] as [number,number,number], r: 0.5, color: '#2a2a3e', emissive: '#ff88cc', ei: 4.0 },
    { pos: [40, -45, -125] as [number,number,number], r: 0.8, color: '#1a3a2a', emissive: '#88ffaa', ei: 3.0 },
  ], []);

  return (
    <group>
      {planets.map((p, i) => (
        <group key={i} position={p.pos}>
          {/* Planet body */}
          <mesh>
            <icosahedronGeometry args={[p.r, 1]} />
            <meshStandardMaterial
              color={p.color}
              emissive={p.emissive}
              emissiveIntensity={p.ei}
              roughness={0.8}
              flatShading
            />
          </mesh>
          {/* Bright atmosphere glow — large halo so they read at extreme distance */}
          <mesh>
            <sphereGeometry args={[p.r * 2.5, 16, 16]} />
            <meshStandardMaterial
              color={p.emissive}
              emissive={p.emissive}
              emissiveIntensity={2.0}
              transparent
              opacity={0.12}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Spaceship Traveling Between Planets ────────────────────────────────────

function Spaceship() {
  const groupRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Points>(null);

  // Planet waypoints the ship visits (must match BackgroundPlanets positions)
  const waypoints = useMemo(() => [
    new THREE.Vector3(-80, 30, -120),
    new THREE.Vector3(60, 45, -100),
    new THREE.Vector3(90, 20, -130),
    new THREE.Vector3(75, -35, -115),
    new THREE.Vector3(40, -45, -125),
    new THREE.Vector3(-50, -30, -110),
    new THREE.Vector3(-95, -15, -140),
    new THREE.Vector3(-30, 50, -130),
  ], []);

  // Build a smooth looping path through all planets
  const path = useMemo(() => {
    return new THREE.CatmullRomCurve3(waypoints, true, 'centripetal', 0.5);
  }, [waypoints]);

  // Engine trail particles
  const trailCount = 40;
  const trailPositions = useMemo(() => new Float32Array(trailCount * 3), []);
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    return geo;
  }, [trailPositions]);
  const trailHistory = useRef<THREE.Vector3[]>([]);

  const PX = 0.15;

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    // Travel along the path — full loop every ~60 seconds
    const loopTime = 55;
    const progress = (t % loopTime) / loopTime;
    const pos = path.getPointAt(progress);
    const lookAhead = path.getPointAt((progress + 0.005) % 1);

    groupRef.current.position.copy(pos);
    groupRef.current.lookAt(lookAhead);

    // Gentle banking on turns
    const tangent = lookAhead.clone().sub(pos).normalize();
    const nextTangent = path.getPointAt((progress + 0.01) % 1).sub(lookAhead).normalize();
    const cross = new THREE.Vector3().crossVectors(tangent, nextTangent);
    groupRef.current.rotateZ(-cross.y * 8);

    // Engine trail
    trailHistory.current.unshift(pos.clone());
    if (trailHistory.current.length > trailCount) trailHistory.current.length = trailCount;
    const arr = trailPositions;
    for (let i = 0; i < trailCount; i++) {
      const tp = trailHistory.current[i] || pos;
      arr[i * 3] = tp.x;
      arr[i * 3 + 1] = tp.y;
      arr[i * 3 + 2] = tp.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
  });

  return (
    <group>
      <group ref={groupRef}>
        {/* ═══ SHIP BODY — sleek angular fuselage ═══ */}
        {/* Main hull */}
        <mesh>
          <boxGeometry args={[PX * 3, PX * 1.5, PX * 8]} />
          <meshStandardMaterial color={'#2a2a3a'} emissive={'#2a2a3a'} emissiveIntensity={0.3} metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Nose cone */}
        <mesh position={[0, 0, -PX * 5]}>
          <boxGeometry args={[PX * 2, PX * 1, PX * 3]} />
          <meshStandardMaterial color={'#3a3a4e'} emissive={'#3a3a4e'} emissiveIntensity={0.3} metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0, -PX * 7]}>
          <boxGeometry args={[PX * 1, PX * 0.6, PX * 2]} />
          <meshStandardMaterial color={'#4a4a5e'} emissive={'#4a4a5e'} emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Cockpit window */}
        <mesh position={[0, PX * 0.8, -PX * 3]}>
          <boxGeometry args={[PX * 1.5, PX * 0.4, PX * 2]} />
          <meshStandardMaterial color={'#00ccff'} emissive={'#00ccff'} emissiveIntensity={2.0} toneMapped={false} />
        </mesh>
        {/* Wings — swept back */}
        <mesh position={[-PX * 3.5, 0, PX * 1]}>
          <boxGeometry args={[PX * 5, PX * 0.4, PX * 4]} />
          <meshStandardMaterial color={'#222233'} emissive={'#222233'} emissiveIntensity={0.2} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[PX * 3.5, 0, PX * 1]}>
          <boxGeometry args={[PX * 5, PX * 0.4, PX * 4]} />
          <meshStandardMaterial color={'#222233'} emissive={'#222233'} emissiveIntensity={0.2} metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Wing tips — green accent */}
        <mesh position={[-PX * 6, 0, PX * 2]}>
          <boxGeometry args={[PX * 0.6, PX * 0.5, PX * 1]} />
          <meshStandardMaterial color={'#00ff4c'} emissive={'#00ff4c'} emissiveIntensity={3.0} toneMapped={false} />
        </mesh>
        <mesh position={[PX * 6, 0, PX * 2]}>
          <boxGeometry args={[PX * 0.6, PX * 0.5, PX * 1]} />
          <meshStandardMaterial color={'#00ff4c'} emissive={'#00ff4c'} emissiveIntensity={3.0} toneMapped={false} />
        </mesh>
        {/* Tail fin */}
        <mesh position={[0, PX * 2, PX * 3]}>
          <boxGeometry args={[PX * 0.4, PX * 3, PX * 3]} />
          <meshStandardMaterial color={'#222233'} emissive={'#222233'} emissiveIntensity={0.2} metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Engine glow — back of ship */}
        <mesh position={[0, 0, PX * 4.5]}>
          <boxGeometry args={[PX * 2, PX * 1.2, PX * 0.8]} />
          <meshStandardMaterial color={'#ff8800'} emissive={'#ff6600'} emissiveIntensity={5.0} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 0, PX * 5]} color={0xff6600} intensity={3} distance={8} decay={2} />
        {/* Headlight */}
        <pointLight position={[0, 0, -PX * 7]} color={0xccddff} intensity={2} distance={10} decay={2} />
      </group>

      {/* Engine exhaust trail */}
      <points ref={trailRef} geometry={trailGeo}>
        <pointsMaterial
          color={0xff8800}
          size={0.15}
          sizeAttenuation
          transparent
          opacity={0.5}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

// ─── Phoenix flying around the portal/planet ────────────────────────────────
//
// Independent of the agent group so the portal-dive transition doesn't
// pull it in. Voxel-detailed sprite (~70 voxels): full body with chest
// gradient, head with eye + beak, three-feather crest, layered wings
// that flap, and a five-feather flowing tail.
//
// Flight: wide banking arc around the planet — elliptical orbit in
// X/Z plane with gentle Y undulation, plus banking roll on Z based
// on lateral velocity. One lap every ~12s so the eye can track it.

function PortalPhoenix() {
  const groupRef = useRef<THREE.Group>(null);
  const wingRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const emberRef = useRef<THREE.Group>(null);
  const tStart = useRef(performance.now() / 1000);

  // Phoenix flies a varied path AROUND the planet, kept farther
  // out so it's clearly orbiting rather than hugging the surface.
  const orbitCenter = useMemo(() => new THREE.Vector3(0, 6.0, 1.0), []);
  const orbitRadiusX = 14.0;
  const orbitRadiusZ = 12.0;
  const orbitPeriod = 16.0; // seconds — slightly slower for the bigger lap

  // Phoenix scale — bumped so the bird stays readable at the new
  // orbit distance.
  const v = 0.26;
  const v92 = v * 0.92;

  // Color palette — wide gradient so the bird reads as flame, not flat.
  const DEEP_RED   = useMemo(() => new THREE.Color('#7f1d1d'), []);
  const RED        = useMemo(() => new THREE.Color('#dc2626'), []);
  const BRIGHT_RED = useMemo(() => new THREE.Color('#ef4444'), []);
  const ORANGE     = useMemo(() => new THREE.Color('#f97316'), []);
  const BRIGHT_OR  = useMemo(() => new THREE.Color('#fb923c'), []);
  const YELLOW     = useMemo(() => new THREE.Color('#fbbf24'), []);
  const BRIGHT_YEL = useMemo(() => new THREE.Color('#fde047'), []);
  const HOT_CORE   = useMemo(() => new THREE.Color('#fef3c7'), []);
  const EYE_DARK   = useMemo(() => new THREE.Color('#1f1208'), []);

  // Body voxels — coordinate convention: +x is forward (direction
  // of flight), +y is up, ±z is wing-spread (lateral).
  const bodyVoxels = useMemo<Array<{ pos: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], color: c });

    // Core body — 4 long, 2 tall, 2 thick. Gradient bottom→top: deep
    // red belly, bright red flanks, orange/yellow back.
    for (let x = -1; x <= 2; x++) {
      add(x, 0, -0.5, RED);
      add(x, 0,  0.5, RED);
      add(x, 1, -0.5, ORANGE);
      add(x, 1,  0.5, ORANGE);
    }
    // Hot core in chest — single bright voxel that pulses.
    add(0, 0,  0, BRIGHT_YEL);
    add(1, 0,  0, HOT_CORE);
    // Lower belly (drops one voxel below body).
    for (let x = -1; x <= 1; x++) {
      add(x, -1, -0.5, BRIGHT_RED);
      add(x, -1,  0.5, BRIGHT_RED);
    }
    add(0, -1, 0, RED);

    // Neck — bridges body to head, slight forward tilt.
    add(2, 1,  0, BRIGHT_RED);
    add(2, 2,  0, RED);

    // Head — 2x2x2 cube up and forward of the neck.
    add(2.5, 2, -0.5, BRIGHT_RED);
    add(2.5, 2,  0.5, BRIGHT_RED);
    add(2.5, 3, -0.5, ORANGE);
    add(2.5, 3,  0.5, ORANGE);
    add(3.5, 2, -0.5, BRIGHT_RED);
    add(3.5, 2,  0.5, BRIGHT_RED);
    add(3.5, 3, -0.5, ORANGE);
    add(3.5, 3,  0.5, ORANGE);
    // Eye — bright yellow with dark pupil on each side of the head.
    add(3.0, 2.5, -1.0, BRIGHT_YEL);
    add(3.0, 2.5,  1.0, BRIGHT_YEL);
    add(3.2, 2.5, -1.0, EYE_DARK);
    add(3.2, 2.5,  1.0, EYE_DARK);

    // Beak — yellow tip pointing forward, with a darker shadow line.
    add(4.5, 2.3, 0, YELLOW);
    add(4.0, 2.0, 0, BRIGHT_YEL);
    add(4.5, 2.0, 0, ORANGE);
    add(5.0, 2.3, 0, HOT_CORE);

    // Crest feathers — five flames jutting up from the back of the
    // head, full plume.
    add(2.0, 4, 0, ORANGE);
    add(2.5, 4.5, 0, BRIGHT_YEL);
    add(2.0, 5, 0, YELLOW);
    add(2.0, 5.5, 0.3, BRIGHT_YEL);
    add(3.0, 4.5, 0, ORANGE);
    add(3.0, 5, 0, BRIGHT_YEL);
    add(3.5, 5.0, 0, ORANGE);
    add(3.0, 5.5, -0.3, YELLOW);
    add(2.5, 5.5, 0, HOT_CORE);
    add(2.5, 6, 0, YELLOW);
    add(2.0, 6, 0.5, ORANGE);
    add(3.0, 6, -0.5, ORANGE);

    // Cheek flame ruff — soft glow around the lower head/jaw.
    add(2.5, 1.5, -1.0, BRIGHT_RED);
    add(2.5, 1.5,  1.0, BRIGHT_RED);
    add(2.0, 1.5, -1.2, ORANGE);
    add(2.0, 1.5,  1.2, ORANGE);

    // Body shoulder highlights for depth.
    add(0, 1.5, -0.8, BRIGHT_RED);
    add(0, 1.5,  0.8, BRIGHT_RED);
    add(1, 1.5, -0.8, ORANGE);
    add(1, 1.5,  0.8, ORANGE);

    return list;
  }, [v, RED, BRIGHT_RED, ORANGE, BRIGHT_OR, YELLOW, BRIGHT_YEL, HOT_CORE, DEEP_RED, EYE_DARK]);

  // Wing voxels — drawn in a separate group that rotates around the
  // wing-root axis to flap. Two wings (mirrored on z).
  const wingVoxels = useMemo<Array<{ pos: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], color: c });

    // Each wing fan: 5-row layered fan from shoulder to tip. Inner is
    // dark red, mid bright red, leading-edge orange, tips yellow/hot.
    for (const sign of [1, -1]) {
      // Shoulder row (inner)
      add(-1, 2, sign * 1.0, DEEP_RED);
      add( 0, 2, sign * 1.0, RED);
      add( 1, 2, sign * 1.0, RED);
      add( 2, 2, sign * 1.0, BRIGHT_RED);
      // Upper-shoulder darker row for depth
      add(-1, 2.5, sign * 1.0, DEEP_RED);
      add( 0, 2.5, sign * 1.0, RED);
      add( 1, 2.5, sign * 1.2, BRIGHT_RED);
      // Mid wing (second row out)
      add(-2, 2.3, sign * 2.0, RED);
      add(-1, 2.5, sign * 2.0, BRIGHT_RED);
      add( 0, 2.7, sign * 2.0, BRIGHT_RED);
      add( 1, 2.8, sign * 2.0, ORANGE);
      add( 2, 2.5, sign * 2.0, ORANGE);
      // Outer wing (leading edge of feathers)
      add(-2, 2.8, sign * 3.0, BRIGHT_RED);
      add(-1, 3.0, sign * 3.0, ORANGE);
      add( 0, 3.2, sign * 3.0, BRIGHT_OR);
      add( 1, 3.3, sign * 3.0, YELLOW);
      add( 2, 3.0, sign * 3.0, BRIGHT_YEL);
      // Wing tips — long flame feathers
      add(-3, 3.2, sign * 4.0, ORANGE);
      add(-2, 3.5, sign * 4.0, BRIGHT_OR);
      add(-1, 3.7, sign * 4.0, YELLOW);
      add( 0, 3.9, sign * 4.0, BRIGHT_YEL);
      add( 1, 3.7, sign * 4.0, HOT_CORE);
      add( 2, 3.5, sign * 4.0, BRIGHT_YEL);
      // Far tip flames extending further out and back
      add(-3, 3.7, sign * 5.0, BRIGHT_YEL);
      add(-2, 4.0, sign * 5.0, HOT_CORE);
      add(-1, 4.2, sign * 5.0, BRIGHT_YEL);
      add( 0, 4.0, sign * 5.0, YELLOW);
      // Trailing back-edge feathers (smaller, behind the wing)
      add(-3, 2, sign * 2.0, BRIGHT_RED);
      add(-3, 2.5, sign * 3.0, ORANGE);
      add(-4, 2.5, sign * 2.5, RED);
      add(-4, 2.8, sign * 3.5, ORANGE);
    }
    return list;
  }, [v, DEEP_RED, RED, BRIGHT_RED, ORANGE, BRIGHT_OR, YELLOW, BRIGHT_YEL, HOT_CORE]);

  // Tail voxels — much longer + more flames. Five distinct streams of
  // feathers (center + two upper + two lower) plus ember particles
  // trailing behind the bird.
  const tailVoxels = useMemo<Array<{ pos: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], color: c });

    // Center spine — 14 voxels long, gradient red → hot core.
    add(-2,  0.0, 0, BRIGHT_RED);
    add(-3,  0.2, 0, RED);
    add(-4,  0.4, 0, BRIGHT_RED);
    add(-5,  0.5, 0, ORANGE);
    add(-6,  0.7, 0, BRIGHT_OR);
    add(-7,  0.9, 0, ORANGE);
    add(-8,  1.0, 0, YELLOW);
    add(-9,  1.2, 0, BRIGHT_YEL);
    add(-10, 1.3, 0, YELLOW);
    add(-11, 1.4, 0, BRIGHT_YEL);
    add(-12, 1.5, 0, HOT_CORE);
    add(-13, 1.6, 0, YELLOW);
    add(-14, 1.5, 0, BRIGHT_YEL);
    add(-15, 1.4, 0, ORANGE);

    // Inner side feathers (close to spine)
    for (const sign of [1, -1]) {
      add(-2,  0.1, sign * 0.5, RED);
      add(-3,  0.3, sign * 0.6, BRIGHT_RED);
      add(-4,  0.4, sign * 0.7, ORANGE);
      add(-5,  0.6, sign * 0.8, BRIGHT_OR);
      add(-6,  0.8, sign * 0.9, ORANGE);
      add(-7,  0.9, sign * 1.0, YELLOW);
      add(-8,  1.0, sign * 1.0, BRIGHT_YEL);
      add(-9,  1.1, sign * 1.0, YELLOW);
      add(-10, 1.2, sign * 0.9, BRIGHT_YEL);
      add(-11, 1.3, sign * 0.8, HOT_CORE);
    }

    // Mid side feathers (more spread)
    for (const sign of [1, -1]) {
      add(-3,  0.0, sign * 1.2, RED);
      add(-4,  0.2, sign * 1.4, BRIGHT_RED);
      add(-5,  0.4, sign * 1.6, ORANGE);
      add(-6,  0.5, sign * 1.7, BRIGHT_OR);
      add(-7,  0.7, sign * 1.7, YELLOW);
      add(-8,  0.8, sign * 1.6, BRIGHT_YEL);
      add(-9,  0.9, sign * 1.4, YELLOW);
      add(-10, 1.0, sign * 1.2, ORANGE);
    }

    // Outer side feathers (big spread, far back)
    for (const sign of [1, -1]) {
      add(-4, -0.1, sign * 2.0, RED);
      add(-5,  0.1, sign * 2.2, ORANGE);
      add(-6,  0.3, sign * 2.4, BRIGHT_OR);
      add(-7,  0.5, sign * 2.4, YELLOW);
      add(-8,  0.7, sign * 2.3, BRIGHT_YEL);
      add(-9,  0.8, sign * 2.0, YELLOW);
    }

    // Lower drooping feathers (dive below the spine line)
    for (const sign of [1, -1]) {
      add(-3, -0.4, sign * 0.7, RED);
      add(-4, -0.4, sign * 1.0, BRIGHT_RED);
      add(-5, -0.3, sign * 1.2, ORANGE);
      add(-6, -0.1, sign * 1.3, BRIGHT_OR);
      add(-7,  0.1, sign * 1.3, YELLOW);
      add(-8,  0.3, sign * 1.2, BRIGHT_YEL);
    }

    // Long trailing flame tips extending way back (beyond main tail)
    for (const sign of [1, -1]) {
      add(-10, 0.5, sign * 1.6, ORANGE);
      add(-11, 0.7, sign * 1.4, BRIGHT_OR);
      add(-12, 0.9, sign * 1.2, YELLOW);
      add(-13, 1.0, sign * 1.0, BRIGHT_YEL);
      add(-14, 1.1, sign * 0.7, HOT_CORE);
    }

    // Spiraling ember tail-streamers — voxels offset from the main
    // path to suggest curling flames trailing behind.
    add(-13, 1.8, 0.5, ORANGE);
    add(-14, 1.9, -0.5, BRIGHT_YEL);
    add(-15, 1.7, 0.3, YELLOW);
    add(-12, 2.0, 0, BRIGHT_OR);
    add(-13, 0.5, 0.8, RED);
    add(-13, 0.4, -0.8, RED);
    add(-14, 0.6, 0.4, ORANGE);
    add(-14, 0.7, -0.4, ORANGE);

    return list;
  }, [v, BRIGHT_RED, RED, ORANGE, BRIGHT_OR, YELLOW, BRIGHT_YEL, HOT_CORE]);

  // Detached ember particles — flicker behind the bird at random
  // positions. Animated separately so they pulse and drift.
  const emberSeeds = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => ({
      basePos: [
        (-13 - Math.random() * 6),
        (Math.random() * 2 - 0.3),
        (Math.random() - 0.5) * 3,
      ] as [number, number, number],
      seed: Math.random() * Math.PI * 2,
      speed: 6 + Math.random() * 6,
      hue: i % 3,
    }));
  }, []);

  // Slow distance cycle so the bird flies far away from the planet,
  // comes back close, flies far again. Period is much longer than
  // the orbit period so the user sees several close-passes per
  // fly-out cycle.
  const distPeriod = 22.0;

  // Compute position from absolute time t — same formula used for
  // current and next-tick to derive velocity for facing direction.
  const pathAt = useMemo(() => (t: number): [number, number, number] => {
    const theta = (t / orbitPeriod) * Math.PI * 2;
    // Distance multiplier pulses 1.0 (close — flying around the
    // portal) to ~3.0 (far — swooping out toward the camera/edge).
    // Squared sin so the bird spends more time NEAR the portal
    // and only briefly swoops far away, like a comet on a long
    // elliptical orbit.
    const distT = (t / distPeriod) * Math.PI * 2;
    const distRaw = 0.5 + 0.5 * Math.sin(distT); // 0..1
    const distMul = 1.0 + Math.pow(distRaw, 1.6) * 2.4; // ~1.0 to ~3.4
    // Combined harmonics — primary ellipse + secondary wobble at 2x
    // frequency on different axes. Orbit varies each lap so the bird
    // visits different airspace around the portal instead of tracing
    // the same loop.
    const x = orbitCenter.x
            + Math.cos(theta) * orbitRadiusX * distMul
            + Math.cos(theta * 2 + 1.7) * 1.6;
    const z = orbitCenter.z
            + Math.sin(theta * 1.15) * orbitRadiusZ * distMul
            + Math.sin(theta * 2 + 0.5) * 1.6;
    // Rise as it flies away — gives the path more visual depth so
    // it doesn't just shrink straight back, but climbs and dives.
    const y = orbitCenter.y
            + Math.sin(theta * 1.5) * 1.4
            + Math.cos(theta * 0.7) * 0.9
            + (distMul - 1) * 1.4;
    return [x, y, z];
  }, [orbitCenter, orbitRadiusX, orbitRadiusZ, orbitPeriod, distPeriod]);

  useFrame(() => {
    const t = performance.now() / 1000 - tStart.current;
    if (groupRef.current) {
      const [x, y, z] = pathAt(t);
      groupRef.current.position.set(x, y, z);

      // Velocity from finite differences a small dt ahead. Both
      // theta and the distance cycle advance together so this
      // captures the true tangent of the curve.
      const dt = 0.05;
      const [x2, y2, z2] = pathAt(t + dt);
      const vx = x2 - x;
      const vy = y2 - y;
      const vz = z2 - z;

      // Yaw — bird's local +X is forward (head). For three.js Y
      // rotation, world forward after yaw=θ_y is (cos, 0, -sin), so
      // to face (vx, vz) we need atan2(-vz, vx).
      groupRef.current.rotation.y = Math.atan2(-vz, vx);

      // Pitch — climb/dive based on vertical velocity vs horizontal
      // speed. Negative pitch when climbing (nose up).
      const horiz = Math.sqrt(vx * vx + vz * vz);
      groupRef.current.rotation.x = -Math.atan2(vy, Math.max(horiz, 0.0001)) * 0.7;

      // Bank — roll into turns. Use change in yaw direction as a
      // rough proxy for curvature; sign of cross product of velocity
      // and acceleration tells us which way the path curves.
      const [x3, , z3] = pathAt(t + 2 * dt);
      const ax = (x3 - x) - 2 * vx;
      const az = (z3 - z) - 2 * vz;
      const curvSign = vx * az - vz * ax;
      groupRef.current.rotation.z = Math.tanh(curvSign * 4) * 0.32;
    }
    if (wingRef.current) {
      // Flap: scale Y plus a slight rotation x dip for a more
      // bird-like wing cycle.
      const flap = 0.85 + Math.sin(t * 8) * 0.4;
      wingRef.current.scale.y = flap;
      wingRef.current.rotation.x = Math.sin(t * 8) * 0.22;
    }
    if (tailRef.current) {
      // Tail trails behind with a slight wave — feathers shimmer.
      tailRef.current.rotation.z = Math.sin(t * 5) * 0.10;
      tailRef.current.rotation.y = Math.sin(t * 2.6) * 0.07;
      // Subtle pulse so the long flames feel alive.
      const pulse = 0.95 + Math.sin(t * 7) * 0.05;
      tailRef.current.scale.x = pulse;
    }
    // Embers — flicker via opacity-style scale. Each ember has its
    // own seed so they don't pulse in lock-step.
    if (emberRef.current) {
      const children = emberRef.current.children;
      for (let i = 0; i < children.length && i < emberSeeds.length; i++) {
        const seed = emberSeeds[i];
        const s = 0.7 + 0.5 * Math.sin(t * seed.speed + seed.seed);
        children[i].scale.set(s, s, s);
      }
    }
  });

  const renderMesh = (
    bv: { pos: [number, number, number]; color: THREE.Color },
    keyPrefix: string,
    i: number,
    intensity = 2.6,
  ) => (
    <mesh key={`${keyPrefix}${i}`} position={bv.pos}>
      <boxGeometry args={[v92, v92, v92]} />
      <meshStandardMaterial
        color={bv.color}
        emissive={bv.color}
        emissiveIntensity={intensity}
        roughness={0.25}
        metalness={0.0}
      />
    </mesh>
  );

  // Pick ember color from index.
  const emberColorFor = (hue: number): THREE.Color =>
    hue === 0 ? RED : hue === 1 ? ORANGE : YELLOW;

  return (
    <group ref={groupRef} position={[orbitCenter.x, orbitCenter.y, orbitCenter.z]}>
      {/* Bright corona light tracking with the bird so it casts a
          visible red wash on whatever it passes. */}
      <pointLight color={'#ff5533'} intensity={5.0} distance={7} decay={1.4} />
      <pointLight color={'#ffaa44'} intensity={2.4} distance={3.5} decay={1.8} position={[v, v, 0]} />
      {/* Trailing tail glow — picks up the long flames behind. */}
      <pointLight color={'#ff7733'} intensity={2.8} distance={5} decay={1.6} position={[-v * 10, v * 1.5, 0]} />
      {bodyVoxels.map((bv, i) => renderMesh(bv, 'pb', i, 2.8))}
      <group ref={wingRef}>
        {wingVoxels.map((wv, i) => renderMesh(wv, 'pw', i, 2.5))}
      </group>
      <group ref={tailRef}>
        {tailVoxels.map((tv, i) => renderMesh(tv, 'pt', i, 2.6))}
      </group>
      {/* Detached ember particles — float behind the bird, flickering
          on their own clocks for a more chaotic flame trail. */}
      <group ref={emberRef}>
        {emberSeeds.map((e, i) => (
          <mesh key={`pe${i}`} position={[e.basePos[0] * v, e.basePos[1] * v, e.basePos[2] * v]}>
            <boxGeometry args={[v92 * 0.7, v92 * 0.7, v92 * 0.7]} />
            <meshStandardMaterial
              color={emberColorFor(e.hue)}
              emissive={emberColorFor(e.hue)}
              emissiveIntensity={3.2}
              roughness={0.2}
              metalness={0.0}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ─── Alien Flying Saucer orbiting the portal ─────────────────────────────────
//
// A detailed voxel UFO with a classic gray alien visible inside the
// glass dome. Orbits the portal at ~1.5x the phoenix's distance with
// a different period and inclination so the two paths cross
// occasionally. Slow Y rotation gives a hovering-disc feel; window
// rim has a chase light that moves around it.

function AlienSaucer() {
  const groupRef = useRef<THREE.Group>(null);
  const discRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const tStart = useRef(performance.now() / 1000);

  // Orbit center is the planet (slightly above so the saucer doesn't
  // dive into it). Larger radii than the phoenix so it visibly stays
  // farther out — viewer sees both at once with the saucer further.
  const orbitCenter = useMemo(() => new THREE.Vector3(0, 4.5, 1.0), []);
  const orbitRadiusX = 19.0;
  const orbitRadiusZ = 16.0;
  const orbitPeriod = 22.0;

  const v = 0.28;
  const v92 = v * 0.92;

  // Color palette — metallic silver hull, glowing windows, alien
  // green/cyan dome, classic gray alien.
  const HULL       = useMemo(() => new THREE.Color('#b6bec8'), []);
  const HULL_HI    = useMemo(() => new THREE.Color('#dfe6ed'), []);
  const HULL_DK    = useMemo(() => new THREE.Color('#6c757e'), []);
  const HULL_SHA   = useMemo(() => new THREE.Color('#3e464e'), []);
  const RIM_GOLD   = useMemo(() => new THREE.Color('#fde047'), []);
  const PANEL      = useMemo(() => new THREE.Color('#0f1418'), []);
  const RIVET      = useMemo(() => new THREE.Color('#94a3b0'), []);
  const DOME_GLASS = useMemo(() => new THREE.Color('#7dd3fc'), []);
  const DOME_HI    = useMemo(() => new THREE.Color('#bae6fd'), []);
  const DOME_DK    = useMemo(() => new THREE.Color('#22d3ee'), []);
  const ALIEN_SKIN = useMemo(() => new THREE.Color('#9ad9a3'), []);
  const ALIEN_DK   = useMemo(() => new THREE.Color('#5e8a66'), []);
  const ALIEN_HI   = useMemo(() => new THREE.Color('#cdf0d2'), []);
  const EYE_BLACK  = useMemo(() => new THREE.Color('#040508'), []);
  const EYE_SHEEN  = useMemo(() => new THREE.Color('#3a4458'), []);
  const ANTENNA    = useMemo(() => new THREE.Color('#2e7d4f'), []);
  const BEAM_GREEN = useMemo(() => new THREE.Color('#22ff77'), []);

  // Saucer hull voxels — rings + dome. Coordinate convention:
  // +x is starboard (right), +y up, +z forward. Disc lies in x/z
  // plane.
  const hullVoxels = useMemo<Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], size: [w * v92, h * v92, d * v92], color: c });

    // Bottom keel — narrow column under the disc.
    add(0, -1.5, 0, 1.6, 0.8, 1.6, HULL_DK);
    add(0, -2.0, 0, 1.0, 0.5, 1.0, HULL_SHA);

    // Lower disc taper — small underside that flares out.
    add(0, -1.0, 0, 4.5, 0.7, 4.5, HULL_DK);
    add(0, -0.7, 0, 6.0, 0.6, 6.0, HULL);

    // Main disc ring (widest part).
    add(0, -0.2, 0, 8.0, 0.8, 8.0, HULL);
    add(0, -0.2, 0, 8.5, 0.5, 8.5, HULL_HI);
    // Edge bevel
    for (const sx of [-3.6, 3.6]) {
      add(sx, -0.2, 0, 0.7, 0.7, 7.5, HULL_DK);
    }
    for (const sz of [-3.6, 3.6]) {
      add(0, -0.2, sz, 7.5, 0.7, 0.7, HULL_DK);
    }

    // Window ring — 12 yellow lights around the rim.
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const wr = 3.8;
      add(Math.cos(ang) * wr, 0.2, Math.sin(ang) * wr, 0.6, 0.6, 0.6, RIM_GOLD);
    }

    // Upper rim taper — narrows back in toward the dome base.
    add(0, 0.6, 0, 6.5, 0.5, 6.5, HULL);
    add(0, 0.9, 0, 5.0, 0.5, 5.0, HULL_HI);
    add(0, 1.2, 0, 3.8, 0.5, 3.8, HULL_DK);

    // Panel seams — dark stripes radiating out for sci-fi detail.
    for (const ang of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      add(Math.cos(ang) * 2.0, 0.6, Math.sin(ang) * 2.0, 0.3, 0.4, 0.3, PANEL);
      add(Math.cos(ang) * 3.2, 0.6, Math.sin(ang) * 3.2, 0.3, 0.4, 0.3, PANEL);
    }
    // Rivets around the upper rim
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      add(Math.cos(ang) * 2.8, 1.05, Math.sin(ang) * 2.8, 0.18, 0.18, 0.18, RIVET);
    }

    return list;
  }, [v, v92, HULL, HULL_HI, HULL_DK, HULL_SHA, RIM_GOLD, PANEL, RIVET]);

  // Dome voxels — stepped hemisphere of cyan glass.
  const domeVoxels = useMemo<Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], size: [w * v92, h * v92, d * v92], color: c });
    // Base ring of dome — wide, slightly transparent feel via slight
    // size shrink (we don't actually use opacity to keep emissive
    // glow visible).
    add(0, 1.5, 0, 3.6, 0.5, 3.6, DOME_DK);
    add(0, 1.8, 0, 3.4, 0.5, 3.4, DOME_GLASS);
    // Mid dome
    add(0, 2.2, 0, 3.0, 0.5, 3.0, DOME_GLASS);
    add(0, 2.6, 0, 2.6, 0.5, 2.6, DOME_HI);
    // Upper dome
    add(0, 3.0, 0, 2.0, 0.5, 2.0, DOME_GLASS);
    add(0, 3.4, 0, 1.4, 0.5, 1.4, DOME_HI);
    // Apex
    add(0, 3.7, 0, 0.7, 0.4, 0.7, DOME_HI);
    return list;
  }, [v, v92, DOME_GLASS, DOME_HI, DOME_DK]);

  // Alien voxels — sits inside the dome, classic gray alien with
  // bulbous head, big almond eyes, slim body.
  const alienVoxels = useMemo<Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }>>(() => {
    const list: Array<{ pos: [number, number, number]; size: [number, number, number]; color: THREE.Color }> = [];
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, c: THREE.Color) =>
      list.push({ pos: [x * v, y * v, z * v], size: [w * v92, h * v92, d * v92], color: c });
    // Body — small torso seated at saucer floor level.
    add(0, 1.7, 0, 0.9, 0.6, 0.7, ALIEN_SKIN);
    add(0, 1.5, 0, 1.0, 0.4, 0.8, ALIEN_DK);
    // Shoulder ridges
    add(-0.5, 1.9, 0, 0.3, 0.3, 0.3, ALIEN_SKIN);
    add( 0.5, 1.9, 0, 0.3, 0.3, 0.3, ALIEN_SKIN);
    // Slim arms reaching forward to the controls.
    add(-0.55, 1.7, 0.4, 0.18, 0.5, 0.18, ALIEN_SKIN);
    add( 0.55, 1.7, 0.4, 0.18, 0.5, 0.18, ALIEN_SKIN);
    add(-0.55, 1.4, 0.55, 0.20, 0.18, 0.18, ALIEN_HI);
    add( 0.55, 1.4, 0.55, 0.20, 0.18, 0.18, ALIEN_HI);
    // Neck
    add(0, 2.15, 0, 0.30, 0.30, 0.30, ALIEN_DK);
    // Head — bulbous, larger than body.
    add(0, 2.55, 0, 1.1, 0.7, 1.0, ALIEN_SKIN);
    add(0, 2.85, 0, 0.9, 0.4, 0.9, ALIEN_HI);
    // Lower jaw
    add(0, 2.30, 0.05, 0.7, 0.30, 0.50, ALIEN_DK);
    // Eye sockets
    add(-0.30, 2.55, -0.55, 0.30, 0.55, 0.10, EYE_BLACK);
    add( 0.30, 2.55, -0.55, 0.30, 0.55, 0.10, EYE_BLACK);
    // Eye sheen highlights
    add(-0.32, 2.70, -0.62, 0.10, 0.18, 0.04, EYE_SHEEN);
    add( 0.28, 2.70, -0.62, 0.10, 0.18, 0.04, EYE_SHEEN);
    // Tiny mouth slit
    add(0, 2.30, -0.50, 0.25, 0.05, 0.06, EYE_BLACK);
    // Nostril dots
    add(-0.10, 2.45, -0.55, 0.06, 0.06, 0.04, EYE_BLACK);
    add( 0.10, 2.45, -0.55, 0.06, 0.06, 0.04, EYE_BLACK);
    // Antenna stubs (decorative)
    add(-0.25, 3.10, 0, 0.10, 0.30, 0.10, ANTENNA);
    add( 0.25, 3.10, 0, 0.10, 0.30, 0.10, ANTENNA);
    add(-0.25, 3.30, 0, 0.18, 0.10, 0.18, RIM_GOLD);
    add( 0.25, 3.30, 0, 0.18, 0.10, 0.18, RIM_GOLD);
    return list;
  }, [v, v92, ALIEN_SKIN, ALIEN_DK, ALIEN_HI, EYE_BLACK, EYE_SHEEN, ANTENNA, RIM_GOLD]);

  // Compute saucer position from absolute time t.
  const pathAt = useMemo(() => (t: number): [number, number, number] => {
    const theta = (t / orbitPeriod) * Math.PI * 2;
    // Mostly steady orbit (UFOs glide), but gentle altitude
    // undulation so the path has depth.
    const x = orbitCenter.x + Math.cos(theta) * orbitRadiusX;
    const z = orbitCenter.z + Math.sin(theta) * orbitRadiusZ;
    const y = orbitCenter.y + Math.sin(theta * 1.3) * 1.0 + Math.sin(theta * 0.4) * 0.8;
    return [x, y, z];
  }, [orbitCenter, orbitRadiusX, orbitRadiusZ, orbitPeriod]);

  useFrame(() => {
    const t = performance.now() / 1000 - tStart.current;
    if (groupRef.current) {
      const [x, y, z] = pathAt(t);
      groupRef.current.position.set(x, y, z);

      // Velocity → yaw to face direction of travel.
      const dt = 0.05;
      const [x2, y2, z2] = pathAt(t + dt);
      const vx = x2 - x;
      const vy = y2 - y;
      const vz = z2 - z;
      groupRef.current.rotation.y = Math.atan2(-vz, vx);

      // Subtle pitch — UFOs angle slightly up/down with the path.
      const horiz = Math.sqrt(vx * vx + vz * vz);
      groupRef.current.rotation.x = -Math.atan2(vy, Math.max(horiz, 0.0001)) * 0.4;

      // Hover bob independent of orbit.
      groupRef.current.position.y += Math.sin(t * 1.7) * 0.15;
    }
    if (discRef.current) {
      // Slow Y spin of the disc itself for a hovering-saucer feel.
      // The hull voxels rotate; the alien stays still inside the
      // dome (because alien sits in its own group).
      discRef.current.rotation.y = t * 0.6;
    }
    if (beamRef.current) {
      // Tractor beam pulse — scale Y up/down between 0.7 and 1.1
      // and a tiny opacity pulse via emissive intensity.
      const pulse = 0.85 + Math.sin(t * 3) * 0.15;
      beamRef.current.scale.set(1, pulse, 1);
      const mat = beamRef.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.emissiveIntensity = 1.4 + Math.sin(t * 4) * 0.4;
        mat.opacity = 0.35 + Math.sin(t * 4) * 0.08;
      }
    }
  });

  const renderBoxMesh = (
    bv: { pos: [number, number, number]; size: [number, number, number]; color: THREE.Color },
    keyPrefix: string,
    i: number,
    intensity: number,
  ) => (
    <mesh key={`${keyPrefix}${i}`} position={bv.pos}>
      <boxGeometry args={bv.size} />
      <meshStandardMaterial
        color={bv.color}
        emissive={bv.color}
        emissiveIntensity={intensity}
        roughness={0.3}
        metalness={0.55}
      />
    </mesh>
  );

  return (
    <group ref={groupRef} position={[orbitCenter.x, orbitCenter.y, orbitCenter.z]}>
      {/* Light from underneath — saucers always glow under their disc. */}
      <pointLight color={'#22ff77'} intensity={3.0} distance={5} decay={1.6} position={[0, -v * 1.5, 0]} />
      {/* Window rim glow */}
      <pointLight color={'#fde047'} intensity={1.6} distance={3} decay={1.8} position={[0, 0, 0]} />

      {/* Spinning hull (disc + windows + bottom keel) */}
      <group ref={discRef}>
        {hullVoxels.map((bv, i) => renderBoxMesh(
          bv,
          'sh',
          i,
          bv.color === RIM_GOLD ? 2.6 : 0.4,
        ))}
      </group>

      {/* Dome — stays fixed (doesn't spin with the hull so the alien
          inside reads correctly). */}
      {domeVoxels.map((bv, i) => renderBoxMesh(bv, 'sd', i, 1.6))}

      {/* Alien pilot inside the dome */}
      {alienVoxels.map((bv, i) => renderBoxMesh(bv, 'sa', i, bv.color === EYE_BLACK ? 0 : 0.35))}

      {/* Tractor beam — translucent green cone hanging below. */}
      <mesh ref={beamRef} position={[0, -v * 4.5, 0]}>
        <coneGeometry args={[v * 3.2, v * 6, 16, 1, true]} />
        <meshStandardMaterial
          color={BEAM_GREEN}
          emissive={BEAM_GREEN}
          emissiveIntensity={1.4}
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
          roughness={0.0}
          metalness={0.0}
        />
      </mesh>
    </group>
  );
}

// ─── Sand Tiger Guardian (deep inside the portal tunnel) ────────────────────

function SandTigerGuardian() {
  const groupRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const craterDir = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.0).normalize(), []);
  const craterCenter = useMemo(() => craterDir.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, -2, 0)), [craterDir]);

  // Position deep inside the tunnel, facing outward toward the entrance
  const tigerPos = useMemo(() => {
    return new THREE.Vector3(
      craterCenter.x - craterDir.x * 5,
      craterCenter.y - craterDir.y * 5 - 0.3,
      craterCenter.z - craterDir.z * 5,
    );
  }, [craterCenter, craterDir]);

  const PX = 0.12;

  // Animate: slow breathing, eye glow pulses
  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    // Slow breathing
    const breathe = 1 + Math.sin(t * 0.6) * 0.02;
    groupRef.current.scale.set(breathe, breathe, 1);

    // Eyes pulse with forbidden purple glow
    if (leftEyeRef.current) {
      const mat = leftEyeRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 4 + Math.sin(t * 1.5) * 2 + Math.sin(t * 3.7) * 1;
    }
    if (rightEyeRef.current) {
      const mat = rightEyeRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 4 + Math.sin(t * 1.5 + 0.3) * 2 + Math.sin(t * 3.7 + 0.3) * 1;
    }
  });

  const sand = '#c2a14d';
  const sandDark = '#8a7333';
  const sandLight = '#d4b85a';
  const sandPale = '#e8d9a0';
  const stripe = '#6b5220';
  const stripeDark = '#4a3815';
  const nose = '#3a2a1a';
  const mouthDark = '#2a1a0a';
  const whiskerColor = '#e0d0a0';
  const innerEar = '#cc8899';
  const eyePurple = '#7722cc';

  type V = [number, number, number, number, number, number, string];
  const voxels: V[] = [
    // ═══ HEAD — broad, powerful, front-facing ═══
    // Main head block
    [0, 0, 0, PX*10, PX*8, PX*7, sand],
    [0, 0, -PX*0.5, PX*9.5, PX*7.5, PX*6.5, sandDark],
    // Forehead — flat, wide
    [0, PX*3, -PX*0.5, PX*9, PX*2.5, PX*6, sand],
    // Cheeks — wider than head
    [-PX*5, -PX*0.5, PX*0.5, PX*2, PX*4, PX*4, sandLight],
    [PX*5, -PX*0.5, PX*0.5, PX*2, PX*4, PX*4, sandLight],
    // Jaw — powerful, wide
    [0, -PX*4, PX*0.5, PX*8, PX*2.5, PX*5, sandDark],
    [0, -PX*5, PX*1, PX*6, PX*1.5, PX*4, sandDark],

    // ═══ MUZZLE — rounded, prominent ═══
    [0, -PX*1.5, -PX*3.5, PX*5, PX*3.5, PX*3, sandLight],
    [0, -PX*1, -PX*4.5, PX*4, PX*3, PX*1.5, sandPale],
    // Nose — dark, blocky
    [0, PX*0.3, -PX*5, PX*2.5, PX*1.5, PX*1, nose],
    [0, PX*0.8, -PX*5.2, PX*2, PX*0.8, PX*0.5, '#2a1a0a'],
    // Mouth line
    [0, -PX*2.5, -PX*4, PX*3, PX*0.4, PX*1.5, mouthDark],

    // ═══ EYES — deep set, glowing purple/dark ═══
    // Eye sockets (dark recess)
    [-PX*2.8, PX*1.5, -PX*3, PX*2, PX*1.8, PX*0.8, '#1a1020'],
    [PX*2.8, PX*1.5, -PX*3, PX*2, PX*1.8, PX*0.8, '#1a1020'],
    // Brow ridge
    [-PX*3, PX*3, -PX*2.5, PX*2.5, PX*1, PX*1.5, sandDark],
    [PX*3, PX*3, -PX*2.5, PX*2.5, PX*1, PX*1.5, sandDark],

    // ═══ EARS — rounded, tiger-like ═══
    [-PX*3.5, PX*5.5, PX*0.5, PX*2.5, PX*3, PX*2, sand],
    [PX*3.5, PX*5.5, PX*0.5, PX*2.5, PX*3, PX*2, sand],
    [-PX*3.5, PX*6, PX*0.3, PX*1.5, PX*2, PX*1.2, innerEar],
    [PX*3.5, PX*6, PX*0.3, PX*1.5, PX*2, PX*1.2, innerEar],

    // ═══ TIGER STRIPES — dark markings ═══
    // Forehead stripes
    [0, PX*3.5, -PX*3, PX*1, PX*1.5, PX*0.3, stripeDark],
    [-PX*2, PX*3, -PX*2.8, PX*0.8, PX*2, PX*0.3, stripe],
    [PX*2, PX*3, -PX*2.8, PX*0.8, PX*2, PX*0.3, stripe],
    // Cheek stripes
    [-PX*4.5, PX*0.5, -PX*1, PX*0.5, PX*2.5, PX*0.3, stripe],
    [-PX*5, -PX*0.5, -PX*0.5, PX*0.5, PX*2, PX*0.3, stripeDark],
    [PX*4.5, PX*0.5, -PX*1, PX*0.5, PX*2.5, PX*0.3, stripe],
    [PX*5, -PX*0.5, -PX*0.5, PX*0.5, PX*2, PX*0.3, stripeDark],
    // Side head stripes
    [-PX*5.5, PX*1.5, PX*1, PX*0.3, PX*1.5, PX*2, stripe],
    [PX*5.5, PX*1.5, PX*1, PX*0.3, PX*1.5, PX*2, stripe],

    // ═══ WHISKERS — thin horizontal lines ═══
    [-PX*4, -PX*1.5, -PX*4, PX*3, PX*0.2, PX*0.15, whiskerColor],
    [-PX*4, -PX*2, -PX*3.8, PX*3.5, PX*0.2, PX*0.15, whiskerColor],
    [-PX*3.5, -PX*2.5, -PX*3.5, PX*2.5, PX*0.2, PX*0.15, whiskerColor],
    [PX*4, -PX*1.5, -PX*4, PX*3, PX*0.2, PX*0.15, whiskerColor],
    [PX*4, -PX*2, -PX*3.8, PX*3.5, PX*0.2, PX*0.15, whiskerColor],
    [PX*3.5, -PX*2.5, -PX*3.5, PX*2.5, PX*0.2, PX*0.15, whiskerColor],

    // ═══ CHIN / RUFF — white fur under jaw ═══
    [0, -PX*5.5, -PX*1, PX*5, PX*1.5, PX*3, sandPale],
    [0, -PX*6.5, PX*0, PX*4, PX*1.5, PX*3.5, sandPale],
  ];

  return (
    <group ref={groupRef} position={[tigerPos.x, tigerPos.y, tigerPos.z]}
      rotation={[-0.35, 0, 0]} // face outward along tunnel axis
      scale={[1.8, 1.8, 1.8]}
    >
      {/* Body voxels */}
      {voxels.map((v, idx) => (
        <mesh key={idx} position={[v[0], v[1], v[2]]}>
          <boxGeometry args={[v[3], v[4], v[5]]} />
          <meshStandardMaterial color={v[6]} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {/* ═══ GLOWING EYES — purple/dark, forbidden magic ═══ */}
      <mesh ref={leftEyeRef} position={[-PX * 2.8, PX * 1.5, -PX * 3.5]}>
        <boxGeometry args={[PX * 1.6, PX * 1.2, PX * 0.5]} />
        <meshStandardMaterial color={eyePurple} emissive={eyePurple} emissiveIntensity={5.0} toneMapped={false} />
      </mesh>
      <mesh ref={rightEyeRef} position={[PX * 2.8, PX * 1.5, -PX * 3.5]}>
        <boxGeometry args={[PX * 1.6, PX * 1.2, PX * 0.5]} />
        <meshStandardMaterial color={eyePurple} emissive={eyePurple} emissiveIntensity={5.0} toneMapped={false} />
      </mesh>
      {/* Eye pupils — darker slit */}
      <mesh position={[-PX * 2.8, PX * 1.5, -PX * 3.7]}>
        <boxGeometry args={[PX * 0.4, PX * 1, PX * 0.2]} />
        <meshStandardMaterial color={'#110022'} emissive={'#220044'} emissiveIntensity={2.0} toneMapped={false} />
      </mesh>
      <mesh position={[PX * 2.8, PX * 1.5, -PX * 3.7]}>
        <boxGeometry args={[PX * 0.4, PX * 1, PX * 0.2]} />
        <meshStandardMaterial color={'#110022'} emissive={'#220044'} emissiveIntensity={2.0} toneMapped={false} />
      </mesh>

      {/* Eye glow lights — purple aura */}
      <pointLight position={[-PX * 3, PX * 1.5, -PX * 5]} color={0x7722cc} intensity={3} distance={4} decay={2} />
      <pointLight position={[PX * 3, PX * 1.5, -PX * 5]} color={0x7722cc} intensity={3} distance={4} decay={2} />
      {/* Deep purple ambient within the guardian's space */}
      <pointLight position={[0, 0, -PX * 2]} color={0x331155} intensity={2} distance={5} decay={2} />
    </group>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function LoginBackground3D() {
  if (Platform.OS !== 'web') return null;
  // Attach mouse listener lazily — only when login screen renders
  attachMouseListener();

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}>
      <Canvas
        camera={{ position: [0, 2, 14], fov: 55, near: 0.1, far: 250 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent', cursor: 'grab' }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#030508']} />
        <fog attach="fog" args={['#030508', 80, 200]} />

        <InteractiveCamera />

        {/* Bright lighting */}
        <ambientLight intensity={0.2} color={0x1a1a1a} />
        <directionalLight position={[10, 12, 8]} intensity={0.6} color={0xffffff} />
        
        

        <StarDust count={600} />
        <ShootingStars count={8} />
        <BackgroundPlanets />
        <Spaceship />

        {/* Living planet */}
        <VoxelPlanet />
        <PortalVein />
        <EnergyCore />
        <UndergroundCircle />
        {/* CraterBeam removed — portal vortex replaces it */}
        <PortalVortex count={120} />
        <PortalRings />
        <PortalDNA count={300} />
        <PortalSpiral />
        <DetailedFurniture />
        <DrippingLava count={120} />

        {/* Cute agent working at desk inside the planet */}
        <UndergroundAgent />

        {/* Black Swan with crown perched on top of the planet */}
        <BlackSwanKing />
        {/* Phoenix flying around the planet — independent of the agent
            group so it isn't pulled into the portal during dive. */}
        <PortalPhoenix />
        {/* Alien flying saucer orbiting the portal at greater distance
            than the phoenix, on its own slower path. */}
        <AlienSaucer />
        <SandTigerGuardian />
        {/* Spotlight on the Black Swan from above-front */}
        <group>
          <spotLight
            position={[1, 14, 4]}
            color={0xffeedd}
            intensity={12}
            angle={0.3}
            penumbra={0.5}
            distance={20}
            decay={1.5}
          />
          {/* Warm fill from the side */}
          <pointLight position={[3, 8, 1]} color={0xffd700} intensity={3} distance={8} decay={2} />
          {/* Green rim light from behind for dramatic silhouette */}
          <pointLight position={[-1, 8, -2]} color={0x44ff66} intensity={2} distance={6} decay={2} />
        </group>

        {/* Bloom postprocessing — makes emissive materials glow and blend */}
        <EffectComposer>
          <Bloom
            intensity={0.4}
            luminanceThreshold={0.9}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
