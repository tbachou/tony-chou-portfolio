'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text, ContactShadows, Environment } from '@react-three/drei';

type FigureProps = {
  position: [number, number, number];
  color: string;
  label: string;
  facing?: number;
};

/**
 * Placeholder "figure" for the interviewer / AI-you until real character
 * models are built — a capsule body + sphere head, just enough to block out
 * blocking, staging, and camera framing for the scene.
 */
function Figure({ position, color, label, facing = 0 }: FigureProps) {
  return (
    <group position={position} rotation={[0, facing, 0]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <capsuleGeometry args={[0.35, 1.0, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 2.0, 0]} castShadow>
        <sphereGeometry args={[0.28, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <Text
        position={[0, 2.6, 0]}
        fontSize={0.22}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

function Room() {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#15151d" roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 3, -4]}>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color="#1c1c26" roughness={1} />
      </mesh>

      {/* Table between interviewer and you */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.06, 0.8]} />
        <meshStandardMaterial color="#3a2f28" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.08]} />
        <meshStandardMaterial color="#2a221c" />
      </mesh>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={12} blur={2} far={4} />
    </group>
  );
}

export default function InterviewRoom() {
  return (
    <Canvas shadows camera={{ position: [0, 2.4, 4.5], fov: 45 }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[3, 5, 2]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <Room />
        <Figure position={[0, 0, -0.9]} color="#5b7fff" label="Interviewer" facing={Math.PI} />
        <Figure position={[0, 0, 0.9]} color="#ff9d5b" label="Tony (AI)" facing={0} />
        <Environment preset="city" />
        <OrbitControls
          minDistance={2.5}
          maxDistance={8}
          maxPolarAngle={Math.PI / 2.1}
          target={[0, 1.3, 0]}
        />
      </Suspense>
    </Canvas>
  );
}
