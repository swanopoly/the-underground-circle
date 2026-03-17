/**
 * BackpackLighting — SolarPunk-themed lighting setup.
 * BRIGHT — cranked up ambient + multiple fills so bag is fully illuminated from all angles.
 */
import React from 'react';

export default function BackpackLighting() {
  return (
    <>
      {/* VERY strong warm ambient — base brightness for everything */}
      <ambientLight intensity={1.2} color="#f5edd8" />

      {/* Hemisphere light — sky/ground even fill */}
      <hemisphereLight
        color="#fffff0"
        groundColor="#2a5520"
        intensity={0.8}
      />

      {/* Key light — blazing sun from upper right */}
      <directionalLight
        position={[5, 8, 5]}
        intensity={2.2}
        color="#fff8ee"
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />

      {/* Secondary directional — from upper left */}
      <directionalLight
        position={[-4, 6, 4]}
        intensity={1.0}
        color="#e0ffe8"
      />

      {/* Third directional — from front-above for face brightness */}
      <directionalLight
        position={[0, 4, 6]}
        intensity={1.2}
        color="#fff0e0"
      />

      {/* Fill — neon cyan from left */}
      <pointLight position={[-3, 2, 4]} intensity={1.2} color="#00ffb0" />

      {/* Fill — electric blue from right */}
      <pointLight position={[3, 1, 3]} intensity={0.9} color="#00e5ff" />

      {/* Rim — bright gold from behind */}
      <pointLight position={[0, 3, -3]} intensity={0.9} color="#ffc93c" />

      {/* Under-glow — bio-green */}
      <pointLight position={[0, -2, 2]} intensity={0.6} color="#39ff14" />

      {/* STRONG front face fill — pockets must be visible */}
      <pointLight position={[0, 0.2, 5]} intensity={1.0} color="#f0fff0" />

      {/* Lower front fill — bottom pockets */}
      <pointLight position={[0, -0.8, 4]} intensity={0.6} color="#e0ffe0" />

      {/* Upper front fill — top compartments */}
      <pointLight position={[0, 1.5, 4]} intensity={0.5} color="#fffff0" />

      {/* Side fills — left and right edges */}
      <pointLight position={[-2, 0, 2]} intensity={0.4} color="#e0ffe8" />
      <pointLight position={[2, 0, 2]} intensity={0.4} color="#e8f0ff" />
    </>
  );
}
