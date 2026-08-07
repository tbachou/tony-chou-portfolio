'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';

type ScenePhase = 'idle' | 'entering' | 'exiting';

const DESK_TOP_Y = 0.59;

const ESTABLISHING_POSITION = new THREE.Vector3(0, 2.3, 7.5);
const ESTABLISHING_TARGET = new THREE.Vector3(0, 1.1, 0);
const ZOOMED_POSITION = new THREE.Vector3(0, 1.55, 0.95);
const ZOOMED_TARGET = new THREE.Vector3(0, 1.5, -0.4);

interface SiteIntroSceneProps {
  initialPhase: 'idle' | 'exiting';
  onZoomInComplete: () => void;
}

export default function SiteIntroScene({ initialPhase, onZoomInComplete }: SiteIntroSceneProps) {
  const [phase, setPhase] = useState<ScenePhase>(initialPhase);
  const [screenHovered, setScreenHovered] = useState(false);

  return (
    <div className="fixed inset-0 bg-term-canvas">
      <Canvas shadows camera={{ position: ESTABLISHING_POSITION.toArray(), fov: 42 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={2.4} />
          <directionalLight position={[3, 6, 4]} intensity={2.6} castShadow />
          <directionalLight position={[-4, 3, -1]} intensity={1.4} />
          <pointLight position={[0, 2.4, 3]} intensity={1.2} />
          {/* Restrained cyberpunk rim accents — visible on the desk and monitor edges, never competing with the green screen. */}
          <pointLight position={[-1.4, 0.9, 0.4]} intensity={2.6} color="#ff2ec4" distance={3} />
          <pointLight position={[1.4, 0.9, 0.4]} intensity={2.6} color="#22d3ee" distance={3} />

          <Desk />
          <FlatMonitor
            hovered={screenHovered}
            onHoverChange={setScreenHovered}
            onClick={() => {
              if (phase === 'idle') setPhase('entering');
            }}
          />
          <Keyboard />
          <Mouse />
          <Cable />
          <Plant position={[-1.4, DESK_TOP_Y, -0.2]} scale={1} />
          <Plant position={[1.4, DESK_TOP_Y, -0.15]} scale={0.7} />
          <ContactShadows position={[0, DESK_TOP_Y + 0.001, 0]} opacity={0.5} scale={4} blur={2} far={0.8} />

          {phase === 'idle' ? (
            <OrbitControls
              target={ESTABLISHING_TARGET.toArray()}
              enableDamping
              dampingFactor={0.08}
              minDistance={6}
              maxDistance={9}
              minAzimuthAngle={-0.45}
              maxAzimuthAngle={0.45}
              minPolarAngle={Math.PI / 3}
              maxPolarAngle={Math.PI / 2.4}
            />
          ) : null}

          <CameraRig
            phase={phase}
            onEnterComplete={onZoomInComplete}
            onExitComplete={() => setPhase('idle')}
          />
        </Suspense>
      </Canvas>

      {phase === 'idle' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
          <p className="text-term-sm text-term-muted">
            <span className={screenHovered ? 'text-term-ink' : undefined}>[ click the screen to boot</span>
            <span className="terminal-cursor ml-1" aria-hidden="true" />
            <span className={screenHovered ? 'text-term-ink' : undefined}> ]</span>
          </p>
          <p className="text-term-xs text-term-muted">drag to look around</p>
        </div>
      ) : null}
    </div>
  );
}

function CameraRig({
  phase,
  onEnterComplete,
  onExitComplete
}: {
  phase: ScenePhase;
  onEnterComplete: () => void;
  onExitComplete: () => void;
}) {
  const { camera } = useThree();
  const progress = useRef(phase === 'exiting' ? 1 : 0);
  const settledRef = useRef(false);
  const startPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    if (phase === 'entering') {
      // Starts from wherever OrbitControls left the camera, not a fixed
      // constant — avoids a jarring snap if the visitor had dragged around.
      startPos.current.copy(camera.position);
      startTarget.current.copy(ESTABLISHING_TARGET);
      progress.current = 0;
      settledRef.current = false;
    } else if (phase === 'exiting') {
      startPos.current.copy(ZOOMED_POSITION);
      startTarget.current.copy(ZOOMED_TARGET);
      progress.current = 1;
      settledRef.current = false;
    }
  }, [phase, camera]);

  useFrame((_, delta) => {
    if (phase === 'idle') return;
    const direction = phase === 'entering' ? 1 : -1;
    progress.current = THREE.MathUtils.clamp(progress.current + direction * delta * 0.8, 0, 1);
    const eased = THREE.MathUtils.smoothstep(progress.current, 0, 1);

    if (phase === 'entering') {
      camera.position.lerpVectors(startPos.current, ZOOMED_POSITION, eased);
      lookTarget.current.lerpVectors(startTarget.current, ZOOMED_TARGET, eased);
    } else {
      camera.position.lerpVectors(ZOOMED_POSITION, ESTABLISHING_POSITION, 1 - eased);
      lookTarget.current.lerpVectors(ZOOMED_TARGET, ESTABLISHING_TARGET, 1 - eased);
    }
    camera.lookAt(lookTarget.current);

    if (!settledRef.current) {
      if (phase === 'entering' && progress.current >= 1) {
        settledRef.current = true;
        onEnterComplete();
      } else if (phase === 'exiting' && progress.current <= 0) {
        settledRef.current = true;
        onExitComplete();
      }
    }
  });

  return null;
}

function Desk() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#2a2a35" roughness={0.9} />
      </mesh>
      {/* Back wall, catches the rim lights */}
      <mesh position={[0, 3, -3.2]}>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color="#1c1c24" roughness={1} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.08, 1.6]} />
        <meshStandardMaterial color="#5a5a5a" roughness={0.6} metalness={0.15} />
      </mesh>
      <mesh position={[-1.5, 0.27, 0.6]}>
        <boxGeometry args={[0.08, 0.55, 0.08]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
      <mesh position={[1.5, 0.27, 0.6]}>
        <boxGeometry args={[0.08, 0.55, 0.08]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
    </group>
  );
}

interface FlatMonitorProps {
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onClick: () => void;
}

// A slim modern monitor: foot, neck, panel, all sharing one depth
// centerline so the neck visibly plugs into the panel's back rather than
// floating in front of or behind it. Built upward from local y=0; the
// group itself sits exactly at desk height.
function FlatMonitor({ hovered, onHoverChange, onClick }: FlatMonitorProps) {
  const baseHeight = 0.035;
  const neckHeight = 0.36;
  const panelHeight = 1.2;
  const panelDepth = 0.05;
  const panelZ = -0.05;
  const neckZ = panelZ - panelDepth / 2; // aligns the neck top with the panel's back face
  const panelCenterY = baseHeight + neckHeight + panelHeight / 2;

  return (
    <group position={[0, DESK_TOP_Y, -0.35]}>
      {/* Foot */}
      <RoundedBox args={[0.6, baseHeight, 0.36]} radius={0.012} smoothness={4} position={[0, baseHeight / 2, -0.02]} castShadow receiveShadow>
        <meshStandardMaterial color="#4d4d4d" roughness={0.5} metalness={0.15} />
      </RoundedBox>
      {/* Neck */}
      <mesh position={[0, baseHeight + neckHeight / 2, neckZ]} castShadow>
        <boxGeometry args={[0.09, neckHeight, 0.08]} />
        <meshStandardMaterial color="#4d4d4d" roughness={0.5} metalness={0.15} />
      </mesh>
      {/* Hinge block — reads as the mechanical joint between neck and panel */}
      <mesh position={[0, baseHeight + neckHeight, neckZ]} castShadow>
        <boxGeometry args={[0.18, 0.09, 0.1]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Panel */}
      <RoundedBox
        args={[1.95, panelHeight, panelDepth]}
        radius={0.02}
        smoothness={4}
        position={[0, panelCenterY, panelZ]}
        castShadow
      >
        <meshStandardMaterial color="#2c2c2c" roughness={0.4} metalness={0.1} />
      </RoundedBox>
      {/* Screen */}
      <mesh
        position={[0, panelCenterY, panelZ + panelDepth / 2 + 0.002]}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHoverChange(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHoverChange(false);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <planeGeometry args={[1.78, 1.06]} />
        <meshStandardMaterial
          color="#010805"
          emissive="#39ff14"
          emissiveIntensity={hovered ? 0.16 : 0.09}
          roughness={0.4}
        />
      </mesh>
      <Text
        position={[-0.75, panelCenterY + 0.3, panelZ + panelDepth / 2 + 0.02]}
        fontSize={0.09}
        color="#39ff14"
        anchorX="left"
        anchorY="middle"
      >
        tonychou@portfolio:~$
      </Text>
      <Text
        position={[-0.75, panelCenterY, panelZ + panelDepth / 2 + 0.02]}
        fontSize={0.11}
        color="#39ff14"
        anchorX="left"
        anchorY="middle"
      >
        {'>'} _
      </Text>
    </group>
  );
}

const KEY_UNIT = 0.08;
const KEY_GAP = 0.014;
const KEY_HEIGHT = 0.022;
const KEY_RADIUS = 0.006;
const KEY_DEFAULT_COLOR = '#eeeeee';

// This module only ever runs client-side (SiteIntroScene is dynamically
// imported with ssr: false), so canvas APIs are always available here.
const labelTextureCache = new Map<string, THREE.CanvasTexture>();

function getLabelTexture(label: string): THREE.CanvasTexture {
  const cached = labelTextureCache.get(label);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#333333';
  ctx.font = label.length > 2 ? 'bold 15px monospace' : 'bold 30px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  labelTextureCache.set(label, texture);
  return texture;
}

interface KeyDef {
  w: number;
  label: string;
  color?: string;
}

// Widths in key-units — 1 = a standard key, wider values simulate tab,
// caps, shift, enter. Each row staggers right slightly, like a real board.
// Esc and Enter/Space get accent colors, echoing the reference keyboard.
const KEYBOARD_ROWS: { z: number; stagger: number; keys: KeyDef[] }[] = [
  {
    z: -0.135,
    stagger: 0,
    keys: [
      { w: 1, label: 'esc', color: '#b5423a' },
      { w: 1, label: '1' },
      { w: 1, label: '2' },
      { w: 1, label: '3' },
      { w: 1, label: '4' },
      { w: 1, label: '5' },
      { w: 1, label: '6' },
      { w: 1, label: '7' },
      { w: 1, label: '8' },
      { w: 1, label: '9' },
      { w: 1, label: '0' },
      { w: 1, label: '-' },
      { w: 1, label: '=' }
    ]
  },
  {
    z: -0.06,
    stagger: 0.5,
    keys: [
      { w: 1.4, label: 'tab' },
      { w: 1, label: 'q' },
      { w: 1, label: 'w' },
      { w: 1, label: 'e' },
      { w: 1, label: 'r' },
      { w: 1, label: 't' },
      { w: 1, label: 'y' },
      { w: 1, label: 'u' },
      { w: 1, label: 'i' },
      { w: 1, label: 'o' },
      { w: 1.4, label: 'p' }
    ]
  },
  {
    z: 0.015,
    stagger: 0.7,
    keys: [
      { w: 1.6, label: 'caps' },
      { w: 1, label: 'a' },
      { w: 1, label: 's' },
      { w: 1, label: 'd' },
      { w: 1, label: 'f' },
      { w: 1, label: 'g' },
      { w: 1, label: 'h' },
      { w: 1, label: 'j' },
      { w: 1, label: 'k' },
      { w: 1, label: 'l' },
      { w: 2, label: 'enter', color: '#6fae9c' }
    ]
  },
  {
    z: 0.09,
    stagger: 0.3,
    keys: [
      { w: 2, label: 'shift' },
      { w: 1, label: 'z' },
      { w: 1, label: 'x' },
      { w: 1, label: 'c' },
      { w: 1, label: 'v' },
      { w: 1, label: 'b' },
      { w: 1, label: 'n' },
      { w: 1, label: 'm' },
      { w: 2.4, label: 'shift' }
    ]
  }
];

function Key({ x, z, baseY, keyDef }: { x: number; z: number; baseY: number; keyDef: KeyDef }) {
  const width = keyDef.w * KEY_UNIT;
  return (
    <group position={[x, baseY, z]}>
      <RoundedBox args={[width, KEY_HEIGHT, 0.06]} radius={KEY_RADIUS} smoothness={2} castShadow>
        <meshStandardMaterial color={keyDef.color ?? KEY_DEFAULT_COLOR} roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, KEY_HEIGHT / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.min(width * 0.75, 0.05), 0.045]} />
        <meshBasicMaterial map={getLabelTexture(keyDef.label)} transparent />
      </mesh>
    </group>
  );
}

function KeyRow({ z, stagger, keys, baseY }: { z: number; stagger: number; keys: KeyDef[]; baseY: number }) {
  const totalWidth = keys.reduce((sum, k) => sum + k.w * KEY_UNIT + KEY_GAP, -KEY_GAP);
  let cursor = -totalWidth / 2 + stagger * KEY_UNIT;

  return (
    <>
      {keys.map((keyDef, index) => {
        const width = keyDef.w * KEY_UNIT;
        const x = cursor + width / 2;
        cursor += width + KEY_GAP;
        return <Key key={index} x={x} z={z} baseY={baseY} keyDef={keyDef} />;
      })}
    </>
  );
}

function Keyboard() {
  const baseHeight = 0.045;
  const keyY = baseHeight + KEY_HEIGHT / 2;

  return (
    <group position={[0, DESK_TOP_Y, 0.55]}>
      <RoundedBox
        args={[1.45, baseHeight, 0.52]}
        radius={0.02}
        smoothness={4}
        position={[0, baseHeight / 2, 0.02]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#5a5a5a" roughness={0.6} />
      </RoundedBox>
      {KEYBOARD_ROWS.map((row, index) => (
        <KeyRow key={index} {...row} baseY={keyY} />
      ))}
      {/* Spacebar */}
      <Key x={0.05} z={0.165} baseY={keyY} keyDef={{ w: 5.25, label: 'space', color: '#6fae9c' }} />
    </group>
  );
}

function Mouse() {
  const bodyHeight = 0.07;
  return (
    <group position={[0.85, DESK_TOP_Y, 0.5]} rotation={[0, 0.3, 0]}>
      <RoundedBox
        args={[0.15, bodyHeight, 0.24]}
        radius={0.025}
        smoothness={4}
        position={[0, bodyHeight / 2, 0]}
        castShadow
      >
        <meshStandardMaterial color="#eeeeee" roughness={0.45} />
      </RoundedBox>
      {/* Left/right button split */}
      <mesh position={[0, bodyHeight + 0.001, 0.03]}>
        <boxGeometry args={[0.004, 0.002, 0.09]} />
        <meshStandardMaterial color="#999999" />
      </mesh>
      {/* Scroll wheel */}
      <mesh position={[0, bodyHeight - 0.005, 0.07]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.02, 10]} />
        <meshStandardMaterial color="#444444" roughness={0.6} />
      </mesh>
    </group>
  );
}

// Runs from the back of the monitor's neck down and off the back edge of
// the desk, implying a wall outlet — not toward the keyboard, which reads
// as an unrelated peripheral with its own (unseen, likely wireless) link.
function Cable() {
  const points = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.1, DESK_TOP_Y + 0.3, -0.42),
      new THREE.Vector3(0.16, DESK_TOP_Y + 0.1, -0.58),
      new THREE.Vector3(0.1, DESK_TOP_Y + 0.02, -0.72),
      new THREE.Vector3(0.05, DESK_TOP_Y - 0.05, -0.8)
    ]);
    return curve.getPoints(20);
  }, []);

  return <Line points={points} color="#0a0a0a" lineWidth={3} />;
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.11, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.22, 8]} />
        <meshStandardMaterial color="#6b6b6b" roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <mesh
          key={index}
          position={[0, 0.33, 0]}
          rotation={[0.35 + (index % 2) * 0.1, (index / 6) * Math.PI * 2, 0]}
          castShadow
        >
          <coneGeometry args={[0.05, 0.42 + (index % 3) * 0.06, 4]} />
          <meshStandardMaterial color="#4caf50" roughness={0.6} />
        </mesh>
      ))}
      {/* A couple of small flower accents, echoing the reference's plant */}
      <mesh position={[0.08, 0.66, 0.05]} castShadow>
        <sphereGeometry args={[0.03, 6, 6]} />
        <meshStandardMaterial color="#f2d94e" roughness={0.5} />
      </mesh>
      <mesh position={[-0.1, 0.61, -0.05]} castShadow>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshStandardMaterial color="#f2d94e" roughness={0.5} />
      </mesh>
    </group>
  );
}
