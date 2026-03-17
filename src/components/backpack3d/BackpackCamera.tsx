/**
 * BackpackCamera — PerspectiveCamera + OrbitControls with constraints.
 * Uses three.js directly (no drei dependency).
 */
import React, { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function BackpackCamera() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    // Set initial camera position
    camera.position.set(0, 0.8, 4.2);
    (camera as any).fov = 45;
    (camera as any).updateProjectionMatrix();

    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minDistance = 3;
    controls.maxDistance = 6;

    controlsRef.current = controls;

    return () => {
      controls.dispose();
    };
  }, [camera, gl]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}
