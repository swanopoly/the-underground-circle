/**
 * CompartmentMesh — SolarPunk interactive pocket on the 3D backpack.
 * Each pocket has:
 *   - Deep extrusion with thick bevel (visibly protrudes from bag)
 *   - Tinted base color (25% blend of accent into dark base)
 *   - Colored accent bar across the top
 *   - Colored edge outline (EdgesGeometry)
 *   - BIG text labels (512px canvas, 40px font)
 *   - Bio-luminescent activity pulse
 * No drei — pure three.js + R3F.
 */
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CompartmentLayout } from './compartmentLayout';
import { SOLAR, POCKET_BASE } from './backpackMaterials';

interface Props {
  layout: CompartmentLayout;
  miniStat: string;
  hasActivity: boolean;
  onOpen: (key: string) => void;
}

/** Canvas-based text sprite — BIG, readable, with glow */
function createLabelTexture(text: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 128;
  ctx.clearRect(0, 0, 512, 128);

  // Glow pass
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.font = 'bold 42px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);

  // Sharp pass
  ctx.shadowBlur = 0;
  ctx.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Icon sprite — large glowing symbol */
function createIconTexture(text: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 256;
  canvas.height = 128;
  ctx.clearRect(0, 0, 256, 128);

  // Strong glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.font = 'bold 72px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);

  // Sharp pass
  ctx.shadowBlur = 0;
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Pocket geometry with THICK bevel for visible depth */
function createPocketGeometry(args: [number, number, number]): THREE.ExtrudeGeometry {
  const [w, h] = args;
  const r = Math.min(w, h) * 0.1;
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

  return new THREE.ExtrudeGeometry(shape, {
    depth: args[2],
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.025,
    bevelSegments: 3,
  });
}

export default function CompartmentMesh({ layout, miniStat, hasActivity, onOpen }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const accentRef = useRef<THREE.MeshStandardMaterial>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const [hovered, setHovered] = useState(false);

  const pocketGeo = useMemo(() => createPocketGeometry(layout.geometryArgs), [layout.geometryArgs]);

  // Colored edge outline
  const edgeLines = useMemo(() => {
    const edges = new THREE.EdgesGeometry(pocketGeo, 15);
    const mat = new THREE.LineBasicMaterial({
      color: layout.color,
      transparent: true,
      opacity: 0.6,
    });
    return new THREE.LineSegments(edges, mat);
  }, [pocketGeo, layout.color]);

  // Tinted pocket color — 25% blend for strong color identity
  const tintedColor = useMemo(() => {
    const accent = new THREE.Color(layout.color);
    const base = new THREE.Color(POCKET_BASE.color);
    return base.clone().lerp(accent, 0.25);
  }, [layout.color]);

  // BIG text textures
  const labelTexture = useMemo(() => createLabelTexture(layout.label, layout.color), [layout.label, layout.color]);
  const iconTexture = useMemo(() => createIconTexture(layout.iconLabel, layout.color), [layout.iconLabel, layout.color]);

  useEffect(() => {
    return () => {
      labelTexture?.dispose();
      iconTexture?.dispose();
    };
  }, [labelTexture, iconTexture]);

  useFrame((state, delta) => {
    const t = delta * 10;

    // Scale
    if (meshRef.current) {
      const target = hovered ? layout.hoverScale : 1.0;
      meshRef.current.scale.lerp(new THREE.Vector3(target, target, target), t);
    }

    // Emissive — strong idle, blazing hover
    if (materialRef.current) {
      materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        materialRef.current.emissiveIntensity,
        hovered ? 1.5 : 0.5,
        t,
      );
    }

    // Accent bar glow
    if (accentRef.current) {
      accentRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        accentRef.current.emissiveIntensity,
        hovered ? 2.5 : 1.0,
        t,
      );
    }

    // Glow shell
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = THREE.MathUtils.lerp(glowMat.opacity, hovered ? 0.5 : 0.1, t);
    }

    // Edge outline
    const edgeMat = edgeLines.material as THREE.LineBasicMaterial;
    edgeMat.opacity = THREE.MathUtils.lerp(edgeMat.opacity, hovered ? 1.0 : 0.6, t);

    // Label
    if (labelRef.current) {
      const mat = labelRef.current.material as THREE.SpriteMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, hovered ? 1 : 0.75, t);
    }

    // Activity pulse
    if (pulseRef.current && hasActivity) {
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.5 + 0.5;
      pulseRef.current.scale.setScalar(0.8 + pulse * 0.6);
      const pMat = pulseRef.current.material as THREE.MeshStandardMaterial;
      pMat.emissiveIntensity = 1.0 + pulse * 2.0;
    }
  });

  const [w, h, d] = layout.geometryArgs;

  return (
    <group position={layout.position} rotation={layout.rotation}>
      {/* Pocket body */}
      <mesh
        ref={meshRef}
        geometry={pocketGeo}
        onClick={(e) => { e.stopPropagation(); onOpen(layout.key); }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          if (typeof document !== 'undefined') document.body.style.cursor = 'default';
        }}
      >
        <meshStandardMaterial
          ref={materialRef}
          color={tintedColor}
          emissive={layout.color}
          emissiveIntensity={0.5}
          roughness={0.45}
          metalness={0.18}
        />
      </mesh>

      {/* Colored accent bar across top of pocket */}
      <mesh position={[0, h / 2 - 0.012, d / 2 + 0.025]}>
        <boxGeometry args={[w * 0.88, 0.025, 0.015]} />
        <meshStandardMaterial
          ref={accentRef}
          color={layout.color}
          emissive={layout.color}
          emissiveIntensity={1.0}
          metalness={0.4}
          roughness={0.2}
        />
      </mesh>

      {/* Colored edge outline */}
      <primitive object={edgeLines} />

      {/* Outer glow shell — always visible */}
      <mesh geometry={pocketGeo} ref={glowRef} scale={1.12}>
        <meshBasicMaterial
          color={layout.color}
          transparent
          opacity={0.1}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Label above pocket — BIG */}
      {labelTexture && (
        <sprite
          ref={labelRef}
          position={[0, h / 2 + 0.14, d / 2 + 0.02]}
          scale={[1.0, 0.25, 1]}
        >
          <spriteMaterial map={labelTexture} transparent opacity={0.75} depthTest={false} />
        </sprite>
      )}

      {/* Icon in center — LARGE glowing */}
      {iconTexture && (
        <sprite
          position={[0, -0.02, d / 2 + 0.04]}
          scale={[0.5, 0.22, 1]}
        >
          <spriteMaterial map={iconTexture} transparent opacity={1.0} depthTest={false} />
        </sprite>
      )}

      {/* Bio-luminescent activity indicator */}
      {hasActivity && (
        <mesh
          ref={pulseRef}
          position={[w / 2 + 0.03, h / 2 + 0.03, d / 2]}
        >
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial
            color={SOLAR.bioGlow}
            emissive={SOLAR.bioGlow}
            emissiveIntensity={1}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}
    </group>
  );
}
