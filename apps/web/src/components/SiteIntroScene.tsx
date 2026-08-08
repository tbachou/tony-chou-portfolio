'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type ScenePhase = 'idle' | 'entering' | 'exiting';

const DESK_TOP_Y = 0.59;

const ESTABLISHING_POSITION = new THREE.Vector3(0, 2.6, 7.5);
const ESTABLISHING_TARGET = new THREE.Vector3(0, 1.7, 0);
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
          <fog attach="fog" args={['#0c0c12', 7, 18]} />
          <ambientLight intensity={2.4} />
          <directionalLight position={[3, 6, 4]} intensity={2.6} castShadow />
          <directionalLight position={[-4, 3, -1]} intensity={1.4} />
          <pointLight position={[0, 2.4, 3]} intensity={1.2} />
          {/* Restrained cyberpunk rim accents — visible on the desk and monitor edges, never competing with the green screen. */}
          <pointLight position={[-1.4, 0.9, 0.4]} intensity={2.6} color="#ff2ec4" distance={3} />
          <pointLight position={[1.4, 0.9, 0.4]} intensity={2.6} color="#22d3ee" distance={3} />

          <Room />
          <ImportedDesk
            hovered={screenHovered}
            onHoverChange={setScreenHovered}
            onClick={() => {
              if (phase === 'idle') setPhase('entering');
            }}
          />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={6} blur={2} far={1.5} />

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
              maxPolarAngle={Math.PI / 2}
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

// Subtle vertical gradient + soft central glow, echoing the pink/cyan rim
// lights - replaces the previous flat single-color wall.
function createWallGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, '#22222e');
  vertical.addColorStop(0.55, '#1c1c24');
  vertical.addColorStop(1, '#111116');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height * 0.5,
    0,
    canvas.width / 2,
    canvas.height * 0.5,
    canvas.width * 0.65
  );
  glow.addColorStop(0, 'rgba(140,110,190,0.14)');
  glow.addColorStop(1, 'rgba(140,110,190,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return new THREE.CanvasTexture(canvas);
}

// Floor and back wall only - the desk/monitor/keyboard geometry itself now
// comes from the imported model (see ImportedDesk below).
function Room() {
  const wallTexture = useMemo(() => createWallGradientTexture(), []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#2a2a35" roughness={0.9} />
      </mesh>
      {/* Back wall, catches the rim lights */}
      <mesh position={[0, 3, -3.2]}>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial map={wallTexture} roughness={1} />
      </mesh>
    </group>
  );
}

// Auto-derives UVs for a flat quad from its actual world-space vertex
// positions AND its real face normal, so "right"/"up" are defined relative
// to a viewer facing the front of the mesh - not guessed from raw world
// axis ranges (which can come out mirrored depending on the mesh's
// orientation in Blender).
function applyAutoUV(mesh: THREE.Mesh) {
  const posAttr = mesh.geometry.attributes.position;
  const normalAttr = mesh.geometry.attributes.normal;
  mesh.updateWorldMatrix(true, false);

  const world: THREE.Vector3[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    mesh.localToWorld(v);
    world.push(v);
  }

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const normal = normalAttr
    ? new THREE.Vector3().fromBufferAttribute(normalAttr, 0).applyMatrix3(normalMatrix).normalize()
    : new THREE.Vector3(0, 0, 1);

  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, normal);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();

  const centroid = world.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(world.length);
  const projected = world.map((v) => {
    const rel = v.clone().sub(centroid);
    return { u: rel.dot(right), v: rel.dot(up) };
  });

  const us = projected.map((p) => p.u);
  const vs = projected.map((p) => p.v);
  const minU = Math.min(...us);
  const maxU = Math.max(...us);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);

  const uv: number[] = [];
  projected.forEach((p) => {
    const u = maxU === minU ? 0.5 : (p.u - minU) / (maxU - minU);
    const v = maxV === minV ? 0.5 : (p.v - minV) / (maxV - minV);
    uv.push(u, v);
  });

  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function drawScreenContent(canvas: HTMLCanvasElement, hovered: boolean) {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#010805';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = hovered ? '#5cff45' : '#39ff14';
  ctx.textBaseline = 'top';
  // Coordinates/sizes match the 2048x1280 canvas (2x the original
  // 1024x640) - keep this scale relationship in mind if the canvas
  // resolution changes again.
  ctx.font = 'bold 128px monospace';
  ctx.fillText('tonychou@portfolio:~$', 100, 120);
  ctx.font = 'bold 160px monospace';
  ctx.fillText('> _', 100, 320);
}

// Loads the desk/monitor/keyboard model exported from Blender, scales +
// positions it so the desk surface sits at DESK_TOP_Y and the legs touch
// the floor (derived from the model's own bounding box, not hardcoded
// numbers - the export's scale/units aren't something we control). The
// Screen mesh gets its UVs re-derived (see applyAutoUV) and a canvas
// texture standing in for the old drei <Text> readout.
interface ScreenInteractionProps {
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onClick: () => void;
}

// Derives the Y rotation needed to turn the model's screen to face the
// establishing camera (which sits at +Z looking toward the origin), from
// the Screen mesh's actual exported normal - not a guessed constant, since
// the model's own "front" direction isn't something we control.
function getFrontFacingYRotation(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const normalAttr = mesh.geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const normal = normalAttr
    ? new THREE.Vector3().fromBufferAttribute(normalAttr, 0).applyMatrix3(normalMatrix).normalize()
    : new THREE.Vector3(0, 0, 1);
  return -Math.atan2(normal.x, normal.z);
}

// Named material -> color, matching the terminal/cyberpunk palette used
// elsewhere in the scene. Falls back to leaving a material untouched if its
// name isn't in this map (e.g. the Screen mesh's material, which gets
// replaced separately with the canvas texture).
const MATERIAL_COLORS: Record<string, string> = {
  Desktop: '#23232b',
  Legs: '#4a4a52',
  'Leg stand': '#4a4a52',
  'Monitor Stand': '#3a3a42',
  Monitor: '#2c2c2c',
  'Keyboard base': '#4a4a52',
  'Key section 1': '#eeeeee',
  'Key section 2': '#eeeeee',
  'Key section 2.001': '#eeeeee',
  'Key section 3': '#eeeeee',
  'Key section 3.001': '#eeeeee',
  'Key section 3.003': '#eeeeee',
  'Key section 4': '#eeeeee',
  'accent key': '#b5423a',
  'accent key.001': '#6fae9c',
  'accent key.002': '#39ff14',
  'accent key.003': '#22d3ee',
  'accent key.004': '#ff2ec4',
  'accent key.005': '#f2d94e',
  'Pencil holder': '#3a3a42',
  Pencil: '#f2d94e',
  'Pencil.001': '#39ff14',
  'Pencil.002': '#22d3ee',
  Mug: '#eeeeee'
};

function applyMaterialColors(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((mat) => {
      if (mat instanceof THREE.MeshStandardMaterial && mat.name in MATERIAL_COLORS) {
        mat.color.set(MATERIAL_COLORS[mat.name]);
      }
    });
  });
}

function ImportedDesk({ hovered, onHoverChange, onClick }: ScreenInteractionProps) {
  const { scene } = useGLTF('/Untitled.glb');
  const { gl } = useThree();
  const [transform, setTransform] = useState<{
    scale: number;
    position: [number, number, number];
    rotationY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const desktop = scene.getObjectByName('Desktop');
    const screen = scene.getObjectByName('Screen');
    if (!desktop) return;

    applyMaterialColors(scene);

    const overallBox = new THREE.Box3().setFromObject(scene);
    const desktopBox = new THREE.Box3().setFromObject(desktop);
    const rawMinY = overallBox.min.y;
    const rawDeskTopY = desktopBox.max.y;
    // DESK_TOP_Y alone made the desk read as tiny in the wide establishing
    // shot (the old procedural desk was cartoonishly wide relative to its
    // height to fill that frame; this model has normal real-world
    // proportions), so scale further beyond just matching desk height.
    const SIZE_BOOST = 3.5;
    const scale = (DESK_TOP_Y / (rawDeskTopY - rawMinY)) * SIZE_BOOST;

    const rotationY = screen instanceof THREE.Mesh ? getFrontFacingYRotation(screen) : 0;

    const center = new THREE.Vector3();
    desktopBox.getCenter(center);
    // Rotation happens before translation in the group's local matrix, so
    // the centering offset has to counter-rotate the (scaled) center to
    // still land on world origin.
    const rotatedCenter = center
      .clone()
      .multiplyScalar(scale)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);

    setTransform({
      scale,
      rotationY,
      position: [-rotatedCenter.x, -rawMinY * scale, -rotatedCenter.z]
    });

    if (screen instanceof THREE.Mesh) {
      applyAutoUV(screen);
      const canvas = document.createElement('canvas');
      // 2x the original resolution, plus anisotropic filtering below - the
      // text was reading soft/blurry at the previous 1024x640.
      canvas.width = 2048;
      canvas.height = 1280;
      drawScreenContent(canvas, false);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = gl.capabilities.getMaxAnisotropy();
      screen.material = new THREE.MeshBasicMaterial({ map: texture });
      canvasRef.current = canvas;
      textureRef.current = texture;
    }
  }, [scene, gl]);

  useEffect(() => {
    if (canvasRef.current && textureRef.current) {
      drawScreenContent(canvasRef.current, hovered);
      textureRef.current.needsUpdate = true;
    }
  }, [hovered]);

  if (!transform) return null;

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== 'Screen') return;
    event.stopPropagation();
    onHoverChange(true);
  };
  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== 'Screen') return;
    event.stopPropagation();
    onHoverChange(false);
  };
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.object.name !== 'Screen') return;
    event.stopPropagation();
    onClick();
  };

  return (
    <group
      position={transform.position}
      scale={transform.scale}
      rotation={[0, transform.rotationY, 0]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload('/Untitled.glb');
