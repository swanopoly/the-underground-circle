import React, { useMemo, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function SwanModel() {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.35;
      groupRef.current.position.y = Math.sin(t * 1.15) * 0.06;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.45;
      ringRef.current.rotation.x = Math.sin(t * 0.4) * 0.2;
    }
  });

  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#f8fafc',
    roughness: 0.42,
    metalness: 0.02,
    emissive: new THREE.Color('#0f172a'),
    emissiveIntensity: 0.04,
  }), []);

  const beakMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    roughness: 0.48,
    metalness: 0.08,
  }), []);

  const pedestalMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.9,
    metalness: 0.03,
  }), []);

  return (
    <group ref={groupRef} position={[0, -0.05, 0]}>
      <mesh position={[0, -0.72, 0]} rotation={[-0.08, 0.28, 0]} material={pedestalMaterial}>
        <cylinderGeometry args={[0.8, 1.05, 0.2, 24]} />
      </mesh>

      <mesh ref={ringRef} position={[0, -0.34, 0]} rotation={[Math.PI / 2.8, 0, 0]}>
        <torusGeometry args={[1.02, 0.035, 16, 64]} />
        <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={0.55} transparent opacity={0.75} />
      </mesh>

      <mesh position={[0, 0.05, 0]} material={bodyMaterial}>
        <sphereGeometry args={[0.64, 36, 36]} />
      </mesh>
      <mesh position={[0.52, 0.12, 0.02]} rotation={[0.18, 0, -0.55]} material={bodyMaterial}>
        <sphereGeometry args={[0.35, 28, 28]} />
      </mesh>
      <mesh position={[-0.5, 0.16, 0]} rotation={[0.08, 0, 0.58]} material={bodyMaterial}>
        <sphereGeometry args={[0.31, 28, 28]} />
      </mesh>

      <mesh position={[0.22, 0.62, 0]} rotation={[0, 0, -0.22]} material={bodyMaterial}>
        <cylinderGeometry args={[0.09, 0.12, 0.84, 24]} />
      </mesh>
      <mesh position={[0.34, 0.98, 0]} rotation={[0, 0, -0.48]} material={bodyMaterial}>
        <sphereGeometry args={[0.18, 26, 26]} />
      </mesh>

      <mesh position={[0.52, 1.01, 0]} rotation={[0, 0, -0.15]} material={beakMaterial}>
        <coneGeometry args={[0.08, 0.22, 18]} />
      </mesh>

      <mesh position={[0.39, 1.06, 0.1]}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshStandardMaterial color="#0f172a" emissive="#0f172a" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

export default function MiniSwanStage() {
  if (Platform.OS !== 'web') return <View />;

  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 24,
        overflow: 'hidden',
      }}
    >
      <Canvas
        camera={{ position: [0, 0.65, 3.8], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
        style={{
          width: '100%',
          height: '100%',
          background: 'radial-gradient(circle at 30% 20%, rgba(99,102,241,0.18), transparent 38%), linear-gradient(180deg, rgba(15,23,42,0.88), rgba(2,6,23,0.96))',
        } as any}
      >
        <ambientLight intensity={0.85} color={0xe2e8f0} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} color={0xffffff} />
        <pointLight position={[-3, 2, 3]} intensity={1.2} color={0x6366f1} />
        <pointLight position={[2, 1, -2]} intensity={0.75} color={0x6366f1} />
        <SwanModel />
      </Canvas>
    </View>
  );
}
