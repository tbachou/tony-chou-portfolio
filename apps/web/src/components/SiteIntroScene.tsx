'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from '@react-three/fiber';
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import { EffectComposer, SelectiveBloom } from '@react-three/postprocessing';
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

export default function SiteIntroScene({
  initialPhase,
  onZoomInComplete,
}: SiteIntroSceneProps) {
  const [phase, setPhase] = useState<ScenePhase>(initialPhase);
  const [screenHovered, setScreenHovered] = useState(false);
  const [bloomTargets, setBloomTargets] = useState<THREE.Object3D[]>([]);
  const handleBloomTargetsReady = useCallback((targets: THREE.Object3D[]) => {
    setBloomTargets(targets);
  }, []);

  return (
    <div className='fixed inset-0 bg-term-canvas'>
      {/* Same header markup/styling as SiteNav, present from the first
          frame - the intro previously had no chrome at all, so booting into
          the real page made the header snap into existence instead of
          already being there. The nav links themselves come alive once the
          real SiteNav takes over post-boot (their target sections aren't
          mounted yet during the intro). */}
      {phase === 'idle' ? (
        <header className='absolute inset-x-0 top-0 z-20 border-b border-term-border bg-term-canvas/90 backdrop-blur'>
          <div className='mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-0'>
            <span className='text-term-sm text-term-muted'>
              <span aria-hidden='true'>$ </span>
              tonychou@portfolio:~
            </span>
          </div>
        </header>
      ) : null}

      <Canvas
        shadows
        camera={{ position: ESTABLISHING_POSITION.toArray(), fov: 42 }}
      >
        <Suspense fallback={null}>
          <fog attach='fog' args={['#0c0c12', 7, 18]} />
          <ambientLight intensity={2.4} />
          <directionalLight position={[3, 6, 4]} intensity={2.6} castShadow />
          <directionalLight position={[-4, 3, -1]} intensity={1.4} />
          <pointLight position={[0, 2.4, 3]} intensity={1.2} />
          {/* Cyberpunk rim accents - tint the desk/leg edges with real color
              so the reflective floor below has actual lit geometry to pick
              up (a mirror reflection can't show a bare light source, only
              what it illuminates). */}
          <pointLight
            position={[-1.4, 0.9, 0.4]}
            intensity={4}
            color='#ff2ec4'
            distance={9}
            decay={1.1}
          />
          <pointLight
            position={[1.4, 0.9, 0.4]}
            intensity={4}
            color='#22d3ee'
            distance={9}
            decay={1.1}
          />

          <Room />
          <ImportedDesk
            hovered={screenHovered}
            onHoverChange={setScreenHovered}
            onClick={() => {
              if (phase === 'idle') setPhase('entering');
            }}
            onBloomTargetsReady={handleBloomTargetsReady}
          />
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.5}
            scale={6}
            blur={2}
            far={1.5}
          />

          {phase === 'idle' ? (
            <OrbitControls
              target={ESTABLISHING_TARGET.toArray()}
              enableDamping
              dampingFactor={0.08}
              minDistance={5}
              maxDistance={10}
              minAzimuthAngle={-0.9}
              maxAzimuthAngle={0.9}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={Math.PI / 2}
            />
          ) : null}

          <CameraRig
            phase={phase}
            onEnterComplete={onZoomInComplete}
            onExitComplete={() => setPhase('idle')}
          />

          {bloomTargets.length > 0 ? (
            <EffectComposer>
              <SelectiveBloom
                selection={bloomTargets}
                intensity={0.9}
                luminanceThreshold={0.15}
                luminanceSmoothing={0.15}
                mipmapBlur
                radius={0.4}
              />
            </EffectComposer>
          ) : null}
        </Suspense>
      </Canvas>

      {phase === 'idle' ? (
        <div className='pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center gap-2'>
          <p className='text-term-sm text-term-muted'>
            <span className={screenHovered ? 'text-term-ink' : undefined}>
              [ click the screen to boot
            </span>
            <span className='terminal-cursor ml-1' aria-hidden='true' />
            <span className={screenHovered ? 'text-term-ink' : undefined}>
              {' '}
              ]
            </span>
          </p>
          <p className='text-term-xs text-term-muted'>drag to look around</p>
        </div>
      ) : null}
    </div>
  );
}

function CameraRig({
  phase,
  onEnterComplete,
  onExitComplete,
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
    progress.current = THREE.MathUtils.clamp(
      progress.current + direction * delta * 0.8,
      0,
      1,
    );
    const eased = THREE.MathUtils.smoothstep(progress.current, 0, 1);

    if (phase === 'entering') {
      camera.position.lerpVectors(startPos.current, ZOOMED_POSITION, eased);
      lookTarget.current.lerpVectors(startTarget.current, ZOOMED_TARGET, eased);
    } else {
      camera.position.lerpVectors(
        ZOOMED_POSITION,
        ESTABLISHING_POSITION,
        1 - eased,
      );
      lookTarget.current.lerpVectors(
        ZOOMED_TARGET,
        ESTABLISHING_TARGET,
        1 - eased,
      );
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

// Fades from near-black at the top down to pure black at the bottom edge,
// so the wall reads as void rather than a distinct colored surface - it
// should blend into the floor, not compete with it.
function createWallGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, '#131318');
  vertical.addColorStop(0.6, '#0a0a0e');
  vertical.addColorStop(1, '#000000');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return new THREE.CanvasTexture(canvas);
}

// A filled rectangle, blurred only at its own edges - used as the
// monitor's backlight halo. A radial gradient (uniform falloff in every
// direction) stretched onto a wide rectangular plane reads as an oval; this
// instead traces the panel's actual rectangular silhouette, feathered
// rather than hard-edged.
function createGlowDiscTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = color;
  const pad = 30;
  ctx.fillRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  return new THREE.CanvasTexture(canvas);
}

// Floor and back wall only - the desk/monitor/keyboard geometry itself now
// comes from the imported model (see ImportedDesk below). A simple flat
// pair, not a curved cove - that added more visible artifacts (a lighter
// material band, then a specular streak once the floor got glossy) than it
// fixed. Fog and matching floor/wall tone do the corner-softening instead.
function Room() {
  const wallTexture = useMemo(() => createWallGradientTexture(), []);
  const WALL_Z = -3.2;
  // Wide enough that its finite edges stay outside the camera's reachable
  // view (OrbitControls' azimuth range) - otherwise rotating reveals where
  // the room just stops, which reads as another hard edge.
  const ROOM_WIDTH = 40;

  return (
    <group>
      {/* Glossy (not mirror) floor - picks up real colored specular
          highlights from the pink/cyan rim lights and monitor backlight
          above, same "real light, not painted" principle as the reference
          site's actual reflector (src/Experience/World/Reflections.js in
          the Ramen-Shop repo), without drei's MeshReflectorMaterial, which
          crashes in this project's fiber/drei version combo (its internal
          camera.matrixWorld read comes back undefined - reproduced with
          postprocessing removed too, so it's isolated to the reflector
          itself, not an interaction bug worth chasing further here). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_WIDTH]} />
        <meshStandardMaterial
          color='#0a0a0d'
          roughness={0.7}
          metalness={0.35}
        />
      </mesh>
      {/* Back wall, fades to black - reads as void, not a distinct surface. */}
      <mesh position={[0, 3, WALL_Z]}>
        <planeGeometry args={[ROOM_WIDTH, 8]} />
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
    ? new THREE.Vector3()
        .fromBufferAttribute(normalAttr, 0)
        .applyMatrix3(normalMatrix)
        .normalize()
    : new THREE.Vector3(0, 0, 1);

  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, normal);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();

  const centroid = world
    .reduce((a, v) => a.add(v), new THREE.Vector3())
    .divideScalar(world.length);
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

  const inkColor = hovered ? '#5cff45' : '#39ff14';
  ctx.fillStyle = inkColor;
  ctx.textBaseline = 'top';
  // A canvas shadow renders as a blurred copy underneath the shape, while
  // the fillText glyphs themselves stay pixel-sharp on top - gives the CRT
  // phosphor glow without the softness postprocess bloom was adding
  // directly to the text (see the bloomTargets effect above).
  ctx.shadowColor = inkColor;
  ctx.shadowBlur = 28;
  // Coordinates/sizes match the 3072x1920 canvas (1.5x the previous
  // 2048x1280) - keep this scale relationship in mind if the canvas
  // resolution changes again.
  ctx.font = 'bold 192px monospace';
  ctx.fillText('tonychou@portfolio:~$', 150, 180);
  ctx.font = 'bold 240px monospace';
  ctx.fillText('> _', 150, 480);
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
  onBloomTargetsReady?: (targets: THREE.Object3D[]) => void;
}

// Reads the Screen mesh's actual exported face normal in raw (pre-wrapping-
// group) space - used both to derive the camera-facing rotation and to
// place the backlight glow behind the panel, since the model's own "front"
// direction isn't something we control.
function getScreenNormal(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.updateWorldMatrix(true, false);
  const normalAttr = mesh.geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return normalAttr
    ? new THREE.Vector3()
        .fromBufferAttribute(normalAttr, 0)
        .applyMatrix3(normalMatrix)
        .normalize()
    : new THREE.Vector3(0, 0, 1);
}

function getFrontFacingYRotation(normal: THREE.Vector3): number {
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
  'Monitor Stand': '#16232b',
  Monitor: '#182a33',
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
  Mug: '#eeeeee',
  Chest: '#23232b',
  Drawer: '#3a3a42',
  Book: '#f2d94e',
  'Book.001': '#22d3ee',
  Clock: '#d8d2c4',
  'Clock arm': '#d9639f',
  'Clock arm.001': '#d9639f',
};

function applyMaterialColors(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];
    materials.forEach((mat) => {
      if (
        mat instanceof THREE.MeshStandardMaterial &&
        mat.name in MATERIAL_COLORS
      ) {
        mat.color.set(MATERIAL_COLORS[mat.name]);
      }
    });
  });
}

function ImportedDesk({
  hovered,
  onHoverChange,
  onClick,
  onBloomTargetsReady,
}: ScreenInteractionProps) {
  const { scene } = useGLTF('/Untitled.glb');
  const { gl } = useThree();
  const [transform, setTransform] = useState<{
    scale: number;
    position: [number, number, number];
    rotationY: number;
    backlightPosition: [number, number, number];
    backlightQuaternion: [number, number, number, number];
    backlightWidth: number;
    backlightHeight: number;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const glowDiscRef = useRef<THREE.Mesh>(null);
  const glowTexture = useMemo(
    () => createGlowDiscTexture('rgba(34,211,238,0.85)'),
    [],
  );

  // Reports the objects that should bloom up to the parent once they exist,
  // so SelectiveBloom can target exactly those instead of a global
  // luminance threshold that also catches ordinary lit props like the
  // mug/keycaps. The screen itself is deliberately excluded - running
  // postprocess bloom directly on the text softened the glyphs themselves,
  // not just the halo around them. The phosphor-glow look now comes from a
  // shadowBlur baked into the canvas texture instead (see
  // drawScreenContent), which glows behind the text without touching its
  // edges.
  useEffect(() => {
    if (!transform) return;
    const targets: THREE.Object3D[] = [];
    if (glowDiscRef.current) targets.push(glowDiscRef.current);
    onBloomTargetsReady?.(targets);
  }, [transform, onBloomTargetsReady]);

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

    const normal =
      screen instanceof THREE.Mesh
        ? getScreenNormal(screen)
        : new THREE.Vector3(0, 0, 1);
    const rotationY = getFrontFacingYRotation(normal);

    const center = new THREE.Vector3();
    desktopBox.getCenter(center);
    // Rotation happens before translation in the group's local matrix, so
    // the centering offset has to counter-rotate the (scaled) center to
    // still land on world origin.
    const rotatedCenter = center
      .clone()
      .multiplyScalar(scale)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);

    // Backlight sits just behind the screen panel, along the opposite of
    // its facing normal, as a glow shaped to the panel's own width/height
    // (not a uniform circle, which reads as a stray blob on a rectangular
    // screen) so it traces the silhouette on all sides. Offset/size are
    // specified in real-world (post-scale) units and converted back to the
    // model's raw units, so they stay physically consistent regardless of
    // the export's own scale.
    let backlightPosition: [number, number, number] = [
      0,
      DESK_TOP_Y * SIZE_BOOST,
      0,
    ];
    let backlightQuaternion: [number, number, number, number] = [0, 0, 0, 1];
    let backlightWidth = 0.1;
    let backlightHeight = 0.1;
    if (screen instanceof THREE.Mesh) {
      const screenBox = new THREE.Box3().setFromObject(screen);
      const screenCenterRaw = screenBox.getCenter(new THREE.Vector3());
      const desiredWorldOffset = 0.08;
      const backlightRaw = screenCenterRaw
        .clone()
        .addScaledVector(normal, -desiredWorldOffset / scale);
      backlightPosition = [backlightRaw.x, backlightRaw.y, backlightRaw.z];

      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal,
      );
      backlightQuaternion = [q.x, q.y, q.z, q.w];

      // Project the panel's own bounding box onto its (right, up) plane to
      // get its real width/height, same basis as applyAutoUV - a uniform
      // circle would either clip the corners or overshoot the edges
      // depending on aspect ratio.
      const worldUp = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(worldUp, normal);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const up = new THREE.Vector3().crossVectors(normal, right).normalize();

      const corners = [
        new THREE.Vector3(screenBox.min.x, screenBox.min.y, screenBox.min.z),
        new THREE.Vector3(screenBox.max.x, screenBox.min.y, screenBox.min.z),
        new THREE.Vector3(screenBox.min.x, screenBox.max.y, screenBox.min.z),
        new THREE.Vector3(screenBox.max.x, screenBox.max.y, screenBox.min.z),
        new THREE.Vector3(screenBox.min.x, screenBox.min.y, screenBox.max.z),
        new THREE.Vector3(screenBox.max.x, screenBox.min.y, screenBox.max.z),
        new THREE.Vector3(screenBox.min.x, screenBox.max.y, screenBox.max.z),
        new THREE.Vector3(screenBox.max.x, screenBox.max.y, screenBox.max.z),
      ];
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      corners.forEach((c) => {
        const u = c.dot(right);
        const v = c.dot(up);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      });

      const MARGIN = 1.3;
      backlightWidth = (maxU - minU) * MARGIN;
      backlightHeight = (maxV - minV) * MARGIN;
    }

    setTransform({
      scale,
      rotationY,
      position: [-rotatedCenter.x, -rawMinY * scale, -rotatedCenter.z],
      backlightPosition,
      backlightQuaternion,
      backlightWidth,
      backlightHeight,
    });

    if (screen instanceof THREE.Mesh) {
      applyAutoUV(screen);
      const canvas = document.createElement('canvas');
      // 1.5x the previous resolution, plus anisotropic filtering below -
      // the text was still reading soft at 2048x1280.
      canvas.width = 3072;
      canvas.height = 1920;
      drawScreenContent(canvas, false);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = gl.capabilities.getMaxAnisotropy();
      screen.material = new THREE.MeshBasicMaterial({
        map: texture,
        toneMapped: false,
      });
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
      {/* Cyan backlight glow behind the monitor panel - the point light
          gives real illumination on the panel/stand and contributes to the
          floor's reflected color; the plane, shaped to the panel's own
          width/height (not a circle) so it traces the silhouette evenly on
          all sides, is what SelectiveBloom actually blooms. Sized/offset in
          raw model units so it stays physically consistent regardless of
          the export's own scale. */}
      <pointLight
        position={transform.backlightPosition}
        color='#22d3ee'
        intensity={1.2}
        distance={1 / transform.scale}
        decay={2}
      />
      <mesh
        ref={glowDiscRef}
        position={transform.backlightPosition}
        quaternion={transform.backlightQuaternion}
      >
        <planeGeometry
          args={[transform.backlightWidth, transform.backlightHeight]}
        />
        <meshBasicMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

useGLTF.preload('/Untitled.glb');
