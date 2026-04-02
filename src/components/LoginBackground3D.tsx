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
    const onDive = () => { diving.current = true; diveStart.current = 0; };
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
      // Camera rushes into the portal tunnel
      diveStart.current += delta;
      const diveDuration = 2.2;
      const progress = Math.min(diveStart.current / diveDuration, 1);
      // Ease in — starts slow, accelerates hard
      const eased = progress * progress * progress;

      // Start position (wherever camera currently is)
      // Target: deep inside the portal tunnel
      const startDist = 14;
      const endDist = -4; // past the portal, into the tunnel
      const dist = startDist + (endDist - startDist) * eased;

      // Lerp camera toward portal center
      const lerpAmt = eased;
      const targetX = portalCenter.x * lerpAmt;
      const targetY = (portalCenter.y + 1) * lerpAmt + (1 - lerpAmt) * (camera.position.y);
      const targetZ = dist * (1 - lerpAmt * 0.7);

      camera.position.x += (targetX - camera.position.x) * 0.06;
      camera.position.y += (targetY - camera.position.y) * 0.06;
      camera.position.z += (targetZ - camera.position.z) * 0.08;

      // Look deeper into the tunnel as we dive
      const lookTarget = new THREE.Vector3(
        portalCenter.x,
        portalCenter.y,
        portalCenter.z - eased * 8,
      );
      camera.lookAt(lookTarget);

      // Increase FOV for speed effect (tunnel vision)
      (camera as THREE.PerspectiveCamera).fov = 55 + eased * 60;
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

    const d = 14;
    camera.position.x = Math.sin(rot.current.y) * Math.cos(rot.current.x) * d;
    camera.position.y = Math.sin(rot.current.x) * d * 0.5 + 1;
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
    const craterAngle = 0.58;

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
          if (dist > radius || dist < radius - step * 2.5) continue;
          const norm = new THREE.Vector3(x, y, z).normalize();
          const dotCrater = norm.dot(craterDir);
          if (dotCrater > Math.cos(craterAngle)) continue;

          const isEdge = dotCrater > Math.cos(craterAngle + 0.12);
          const isNearEdge = dotCrater > Math.cos(craterAngle + 0.25);
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

    // Animate complex core shape
    if (coreRef.current) {
      coreRef.current.rotation.x = t * 0.4;
      coreRef.current.rotation.y = t * 0.6;
      coreRef.current.rotation.z = t * 0.3;
      const pulse = 0.7 + Math.sin(t * 1.8) * 0.3;
      coreRef.current.scale.setScalar(pulse);
      (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 + Math.sin(t * 2.5) * 1.5;
    }
    if (core2Ref.current) {
      core2Ref.current.rotation.x = -t * 0.7;
      core2Ref.current.rotation.y = t * 0.5;
      core2Ref.current.rotation.z = -t * 0.8;
      const pulse2 = 0.6 + Math.sin(t * 1.2 + 1) * 0.25;
      core2Ref.current.scale.setScalar(pulse2);
    }
    if (core3Ref.current) {
      core3Ref.current.rotation.x = t * 0.9;
      core3Ref.current.rotation.z = -t * 0.4;
      const pulse3 = 0.5 + Math.sin(t * 2.2 + 2) * 0.2;
      core3Ref.current.scale.setScalar(pulse3);
      (core3Ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 + Math.sin(t * 3) * 1;
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

      {/* ═══ COMPLEX CORE SHAPE — nested geometries ═══ */}
      {/* Outer: icosahedron (20-sided, faceted, alien-looking) */}
      <mesh ref={coreRef} position={[0, 0, -5]}>
        <icosahedronGeometry args={[0.6, 1]} />
        <meshStandardMaterial color={0x00ff4c} emissive={0x00ff4c} emissiveIntensity={5.0} transparent opacity={0.7} wireframe toneMapped={false} />
      </mesh>
      {/* Middle: octahedron (diamond shape) inside the icosahedron */}
      <mesh ref={core2Ref} position={[0, 0, -5]}>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={0x00ff4c} emissive={0x00ff4c} emissiveIntensity={6.0} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {/* Inner: dodecahedron (12-faced, complex) spinning opposite */}
      <mesh ref={core3Ref} position={[0, 0, -5]}>
        <dodecahedronGeometry args={[0.25, 0]} />
        <meshStandardMaterial color={0xaaffcc} emissive={0xaaffcc} emissiveIntensity={7.0} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {/* Core point light — deep inside tunnel */}
      <pointLight position={[0, 0, -5]} color={0x55ff77} intensity={10} distance={12} decay={2} />
      <pointLight position={[0, 0, -5]} color={0xffffff} intensity={4} distance={8} decay={2} />

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

      const phase = (t * piece.spiralSpeed + piece.orbitPhase) % 1;
      const angle = piece.orbitPhase + t * piece.orbitSpeed;
      // Depth into the tunnel (0 at entrance, increasing inward)
      const tunnelDepth = phase * 5.0;
      // Tunnel radius tapers from ~3.8 at entrance to ~1.3 deep inside
      const maxR = 3.8 - tunnelDepth * 0.5;
      // Orbit within the tunnel, shrinking as it spirals deeper
      const r = maxR * (0.3 + (1 - phase) * 0.6);
      const localX = Math.cos(angle) * r;
      const localY = Math.sin(angle) * r;
      const depth = -tunnelDepth; // negative = into the tunnel

      grp.position.set(
        craterCenter.x + craterUp.x * localX + craterRight.x * localY + craterDir.x * depth,
        craterCenter.y + craterUp.y * localX + craterRight.y * localY + craterDir.y * depth,
        craterCenter.z + craterUp.z * localX + craterRight.z * localY + craterDir.z * depth,
      );
      grp.rotation.x = t * piece.tumbleSpeed.x;
      grp.rotation.y = t * piece.tumbleSpeed.y;
      grp.rotation.z = t * piece.tumbleSpeed.z;
      const scale = piece.scale * (0.3 + (1 - phase) * 0.7);
      grp.scale.setScalar(scale);
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

  const voxels = useMemo(() => {
    const v: { pos: [number, number, number]; color: THREE.Color }[] = [];
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

    // Neck (long, curved upward, rows sy+6 to sy+9)
    add(sx,sy+6,0,swanBlk); add(sx+1,sy+6,0,swanBlkHi);
    add(sx,sy+7,0,swanBlk); add(sx+1,sy+7,0,swanBlkHi);
    add(sx,sy+8,-1,swanBlk); add(sx+1,sy+8,-1,swanBlk);
    add(sx,sy+9,-1,swanBlkHi);

    // Head
    add(sx-1,sy+10,-1,swanBlk); add(sx,sy+10,-1,swanBlkHi); add(sx+1,sy+10,-1,swanBlk);
    add(sx,sy+10,-2,swanBlk); // back of head
    // Eye — glowing red AI eye
    add(sx-1,sy+10,-2,swanEye);
    add(sx+1,sy+10,-2,swanEye);
    // Beak
    add(sx,sy+10,0,swanBeak);
    add(sx,sy+9,0,swanBeak);
    add(sx,sy+9,1,swanBeakTip);

    // AI glow accent — subtle green glow on chest and eyes
    add(sx,sy+3,0,swanGlow); // heart glow
    add(sx-1,sy+10,-2,swanEyeGlow); // left eye ring

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

    return v;
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
      // Snake through blocks: oscillate depth so it weaves in and out
      // Deep = hidden inside blocks, shallow = peeking out between them
      // Snake weaves uniformly deep through blocks on all sides
      // Stays well below surface — only glow visible between cracks
      const snakeDepth = Math.sin(t * 7.0) * 0.08 + Math.sin(t * 11.0) * 0.04;
      const depth = -0.42 + snakeDepth;
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

    // Pick light positions every ~30 points along the path
    const lights: [number, number, number][] = [];
    for (let i = 0; i < smoothed.length; i += 30) {
      const p = smoothed[i];
      const n = p.clone().sub(planetCenter).normalize();
      // Lift light slightly above surface so it illuminates nearby blocks
      const lp = p.clone().add(n.multiplyScalar(0.15));
      lights.push([lp.x, lp.y, lp.z]);
    }

    // Glow path: same but slightly above surface
    const glowSmoothed = smoothed.map(p => {
      const n = p.clone().sub(planetCenter).normalize();
      return p.clone().add(n.multiplyScalar(0.08));
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
      {/* Main vein — thin bright line sitting in block seams */}
      <mesh ref={tubeRef}>
        <tubeGeometry args={[curve, 300, 0.03, 5, true]} />
        <meshStandardMaterial
          color={0x00ff4c}
          emissive={0x00ff4c}
          emissiveIntensity={4.0}
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      </mesh>

      {/* Point lights along the vein to illuminate nearby blocks */}
      {lightPositions.map((pos, i) => (
        <pointLight key={i} position={pos} color={0x00ff4c} intensity={0.6} distance={1.2} decay={2} />
      ))}
    </group>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function LoginBackground3D() {
  if (Platform.OS !== 'web') return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}>
      <Canvas
        camera={{ position: [0, 2, 14], fov: 55, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent', cursor: 'grab' }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#030508']} />
        <fog attach="fog" args={['#030508', 25, 60]} />

        <InteractiveCamera />

        {/* Bright lighting */}
        <ambientLight intensity={0.2} color={0x1a1a1a} />
        <directionalLight position={[10, 12, 8]} intensity={0.6} color={0xffffff} />
        
        

        <StarDust count={300} />

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

        {/* Cute agent working at desk inside the planet */}
        <UndergroundAgent />

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
