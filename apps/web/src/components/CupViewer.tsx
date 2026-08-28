'use client';

/**
 * Interactive 3D cup.
 *
 * The cup mesh is a THREE.CylinderGeometry built from the CupProfile's derived
 * radii and height. This is not an approximation of the fan mapping - it IS
 * the same parameterisation:
 *
 *   Three.js torso:  x = r*sin(theta),  z = r*cos(theta),  r linear in height
 *   designToCup():   x = r*sin(phi),    z = r*cos(phi),    r linear in height
 *
 * and Three.js emits uv = (u, 1-v) with v=0 at the TOP ring, so texture v=1
 * lands on the cup's top rim - matching design space, where v=1 is the rim.
 * texture.flipY defaults to true, so canvas row 0 (top of the artwork) also
 * lands at the rim.
 *
 * The upshot: NO pre-warp is applied here. The design canvas is used directly
 * as the texture, which is why the 3D preview and the production fan cannot
 * drift apart - there is only one warp in the system, in the fan rasteriser.
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { FrustumGeometry, CupProfile } from '@cupco/geometry';
import { pickVideoMime, type RecordTurntable, type VideoResult } from '@/lib/turntable';

interface CupMeshProps {
  groupRef: MutableRefObject<THREE.Group | null>;
  geom: FrustumGeometry;
  profile: CupProfile;
  textureSource: HTMLCanvasElement | null;
  /** Bumped by the parent whenever the design canvas has been repainted. */
  revision: number;
  spin: boolean;
}

/** Paper white, used for every unprinted surface. */
const PAPER = '#ffffff';

function CupMesh({ groupRef, geom, profile, textureSource, revision, spin }: CupMeshProps) {
  const group = groupRef;

  const texture = useMemo(() => {
    if (!textureSource) return null;
    const t = new THREE.CanvasTexture(textureSource);
    t.colorSpace = THREE.SRGBColorSpace;
    // Artwork wraps the circumference, so u must repeat rather than clamp -
    // the same seam-continuity requirement the rasteriser enforces.
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  }, [textureSource]);

  // The canvas is repainted in place, so Three must be told its contents moved.
  useEffect(() => { if (texture) texture.needsUpdate = true; }, [texture, revision]);
  useEffect(() => () => texture?.dispose(), [texture]);

  useFrame((_, delta) => {
    if (spin && group.current) group.current.rotation.y += delta * 0.35;
  });

  const h = geom.heightMm;
  const rTop = geom.topRadiusMm;
  const rBot = geom.bottomRadiusMm;
  const seamAngle = profile.seam.positionRad;

  const seamLine = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const v = i / 24;
      const r = rBot + (rTop - rBot) * v + 0.2;
      pts.push(new THREE.Vector3(r * Math.sin(seamAngle), h * v, r * Math.cos(seamAngle)));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({
      color: '#ef4444', dashSize: 3, gapSize: 3, transparent: true, opacity: 0.7,
    }));
    // Dashes come from vertex distances; without this the line renders solid.
    line.computeLineDistances();
    return line;
  }, [rTop, rBot, h, seamAngle]);

  useEffect(() => () => {
    seamLine.geometry.dispose();
    (seamLine.material as THREE.Material).dispose();
  }, [seamLine]);

  return (
    <group ref={group} position={[0, -h / 2, 0]}>
      {/*
        OUTER wall - the printed surface.

        The Y rotation is REQUIRED for correctness, not styling. Three.js maps
        texture u=0 to local theta=0; design space puts u=0 at the SEAM, which
        the profile places at seam.positionRad. Without this the 3D view would
        disagree with designToCup() and with the production fan.

        Check: u=0 -> local theta 0 -> world seam.positionRad, matching
        designToCup's phi = 2*pi*u + seamPositionRad at u=0.

        FrontSide only. The inner wall is a separate white mesh below: a
        single DoubleSide mesh would show the customer's artwork mirrored on
        the inside of the cup, which is not what gets manufactured - only the
        outside is printed.
      */}
      <mesh position={[0, h / 2, 0]} rotation={[0, seamAngle, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[rTop, rBot, h, 128, 1, true]} />
        {texture ? (
          <meshStandardMaterial
            map={texture} side={THREE.FrontSide}
            roughness={0.58} metalness={0.02}
            envMapIntensity={0.7}
          />
        ) : (
          <meshStandardMaterial color="#e2e8f0" side={THREE.FrontSide} roughness={0.8} />
        )}
      </mesh>

      {/*
        INNER wall - unprinted paper. Very slightly inset so it never
        z-fights with the outer wall at grazing angles.
      */}
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[rTop - 0.35, rBot - 0.35, h - 0.02, 128, 1, true]} />
        <meshStandardMaterial color={PAPER} side={THREE.BackSide} roughness={0.95} metalness={0} />
      </mesh>

      {/* Rolled rim, at the true top radius. */}
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[rTop - 0.15, 1.5, 14, 128]} />
        <meshStandardMaterial color={PAPER} roughness={0.55} />
      </mesh>

      {/* Inside base, seen when looking into the cup. */}
      <mesh position={[0, 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[rBot - 0.35, 96]} />
        <meshStandardMaterial color={PAPER} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      {/* Outside base: a short white skirt plus the closing disc. */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[rBot, rBot * 0.985, 1.2, 96, 1, true]} />
        <meshStandardMaterial color={PAPER} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[rBot * 0.985, 96]} />
        <meshStandardMaterial color={PAPER} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      <primitive object={seamLine} />
    </group>
  );
}

export interface CupViewerProps {
  /** Populated with a capture function so the page can record a turntable. */
  /** Populated with a video recorder for the same turntable. */
  recordRef?: MutableRefObject<RecordTurntable | null>;
  geom: FrustumGeometry;
  profile: CupProfile;
  textureSource: HTMLCanvasElement | null;
  revision: number;
  spin: boolean;
  resetToken: number;
}

function CameraRig({ geom, resetToken }: { geom: FrustumGeometry; resetToken: number }) {
  const controls = useRef<{ reset: () => void } | null>(null);
  useEffect(() => { controls.current?.reset(); }, [resetToken]);
  return (
    <OrbitControls
      ref={controls as never}
      enablePan enableZoom
      minDistance={geom.heightMm * 1.2}
      maxDistance={geom.heightMm * 7}
      target={[0, 0, 0]}
      makeDefault
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Studio backdrop                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The graduated backdrop, built as two canvas textures.
 *
 * A real product shot is almost never lit against a flat wall. Light falls off
 * from wherever the softbox is pointed, which pools brightness behind the
 * subject and lets the corners go down - and that falloff is what separates
 * the product from the ground without an outline. A single flat grey, which is
 * what this was, reads as a render precisely because nothing falls off.
 *
 * It is screen-space, behind everything, and anchored to the FRAME rather than
 * the world - so the vignette stays put while the camera orbits, exactly as a
 * real backdrop gradient would.
 *
 * There was a curved sweep here as well, a physical mesh the shadow fell
 * across. It is gone: however seamless it is meant to look, the arc where it
 * turned up into the back wall was visible as a line across the frame, and a
 * line is worse than the flatness it was there to avoid. The cup is grounded by
 * its contact shadow instead, which needs no geometry behind it.
 *
 * The warm centre against cool corners is deliberate. Equal-temperature greys
 * look flat however you ramp them; a little colour contrast is most of what
 * makes a studio shot feel lit rather than filled.
 */
function makeGradient(
  stops: [number, string][],
  cx: number,
  cy: number,
  size = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size * cx, size * cy, 0,
    size * cx, size * cy, size * 0.78,
  );
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  // Without this the gradient is treated as linear data and comes out muddy.
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Deepest tone in the gradient — fog and the CSS ground are matched to it.
 *
 * Kept a true neutral-cool rather than the warmer taupe a paper cup would
 * flatter: brand colours land on this backdrop unpredictably, and a warm ground
 * fights any teal or green in the artwork.
 */
const EDGE = '#8ca0b8';

function useBackdropTexture() {
  return useMemo(() => makeGradient([
    [0, '#fcfbf9'],   // warm pool of light, just above the cup
    [0.38, '#dde5ee'],
    [1, EDGE],        // cool falloff into the corners
  ], 0.5, 0.38), []);
}

/**
 * Apply a texture as the scene background.
 *
 * Restores whatever was there on unmount: the recorder renders this same scene,
 * and leaving a stale background behind would show up in the video.
 */
function SceneBackground({ texture }: { texture: THREE.Texture }) {
  const { scene } = useThree();
  useEffect(() => {
    const previous = scene.background;
    scene.background = texture;
    return () => { scene.background = previous; };
  }, [scene, texture]);
  return null;
}

/**
 * Product-photography lighting.
 *
 * Modelled on a real tabletop setup rather than "some lights": a large soft
 * key at 45 degrees, a dimmer fill opposite it to open the shadows without
 * flattening the form, and a rim light behind to separate the cup from the
 * ground. With no backdrop mesh, that rim light is doing more work than it
 * looks - it is the only thing giving the cup an edge against the gradient.
 */
function StudioRig({ geom }: { geom: FrustumGeometry }) {
  const h = geom.heightMm;
  return (
    <>

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#c9d3e0', 0.55]} />

      {/* Key: large area light, high and to camera-left. */}
      <rectAreaLight
        position={[-h * 1.1, h * 1.5, h * 1.2]}
        width={h * 2.2} height={h * 2.2} intensity={4.2} color="#ffffff"
        onUpdate={(l) => l.lookAt(0, 0, 0)}
      />
      {/* Fill: softer, opposite side, keeps shadow detail readable. */}
      <rectAreaLight
        position={[h * 1.4, h * 0.5, h * 1.0]}
        width={h * 1.8} height={h * 1.8} intensity={1.6} color="#eef4ff"
        onUpdate={(l) => l.lookAt(0, 0, 0)}
      />
      {/* Rim: behind and above, separates the cup from the backdrop. */}
      <rectAreaLight
        position={[0, h * 1.3, -h * 1.6]}
        width={h * 1.6} height={h} intensity={2.4} color="#ffffff"
        onUpdate={(l) => l.lookAt(0, 0, 0)}
      />
      {/* Shaping shadow from the key, soft enough not to read as CGI. */}
      <directionalLight
        position={[-h * 1.1, h * 1.8, h * 1.1]}
        intensity={0.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.6}
      >
        <orthographicCamera attach="shadow-camera" args={[-h, h, h, -h, 0.5, h * 6]} />
      </directionalLight>
      {/* Bounce off the ground, so the underside is not dead grey. */}
      <directionalLight position={[0, -h * 1.6, h * 0.6]} intensity={0.35} />
    </>
  );
}

/**
 * Records a full rotation, frame by frame.
 *
 * Rendering is driven MANUALLY here rather than by the animation loop: each
 * frame must be fully drawn before its pixels are read, and letting the loop
 * run would capture whatever happened to be on screen at the time — producing
 * uneven angles and torn frames.
 *
 * This relies on the canvas being created with preserveDrawingBuffer, without
 * which reading back after a render returns an empty buffer.
 */
function RecordRig({
  groupRef, recordRef,
}: {
  groupRef: MutableRefObject<THREE.Group | null>;
  recordRef?: MutableRefObject<RecordTurntable | null>;
}) {
  const { gl } = useThree();

  /**
   * Record the turntable as a video.
   *
   * Frames are NOT stepped by hand: MediaRecorder pulls from the canvas stream
   * at a fixed rate while the cup animates normally, so motion is smooth and
   * the browser's encoder does the compression. Full colour too, which the
   * graduated backdrop needs - it was the first thing to band on the
   * 256-colour GIF path this replaced.
   */
  useEffect(() => {
    if (!recordRef) return;

    recordRef.current = async (durationMs, fps, onProgress) => {
      const group = groupRef.current;
      if (!group) throw new Error('cup not ready');

      const chosen = pickVideoMime();
      if (!chosen) throw new Error('this browser cannot record video');

      const canvas = gl.domElement;
      const stream = canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, {
        mimeType: chosen.mimeType,
        // Generous, so the gradient backdrop does not band under compression.
        videoBitsPerSecond: 12_000_000,
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

      const startRotation = group.rotation.y;
      recorder.start();

      try {
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const tick = () => {
            const f = (performance.now() - t0) / durationMs;
            if (f >= 1) { resolve(); return; }
            // Exactly one full turn over the duration, so the loop is seamless.
            group.rotation.y = startRotation + f * Math.PI * 2;
            onProgress?.(f);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        // Let the encoder pick up the closing frames before stopping.
        await new Promise((r) => setTimeout(r, 250));
      } finally {
        group.rotation.y = startRotation;
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      }

      await finished;
      const result: VideoResult = {
        blob: new Blob(chunks, { type: chosen.mimeType }),
        mimeType: chosen.mimeType,
        extension: chosen.extension,
        width: canvas.width,
        height: canvas.height,
        durationMs,
      };
      if (result.blob.size === 0) throw new Error('recording produced no data');
      return result;
    };

    return () => { recordRef.current = null; };
  }, [gl, groupRef, recordRef]);


  return null;
}

export default function CupViewer(props: CupViewerProps) {
  const { geom } = props;
  const backdrop = useBackdropTexture();
  const groupRef = useRef<THREE.Group | null>(null);
  // Pulled back further than a bare product view: a studio shot needs space
  // around the subject, not the subject filling the frame.
  const dist = geom.heightMm * 3.4;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [dist * 0.34, geom.heightMm * 0.35, dist], fov: 28, near: 1, far: 6000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      {/* Percentage-closer soft shadows: contact stays tight, the penumbra
          spreads with distance, as a real softbox behaves. */}
      <SoftShadows size={26} samples={12} focus={0.9} />

      <SceneBackground texture={backdrop} />
      {/* Fog matched to the gradient's deepest tone, so distance falls into the
          backdrop instead of standing off it. */}
      <fog attach="fog" args={[EDGE, geom.heightMm * 4, geom.heightMm * 12]} />

      <StudioRig geom={geom} />
      <CupMesh {...props} groupRef={groupRef} />
      <RecordRig groupRef={groupRef} recordRef={props.recordRef} />

      <ContactShadows
        position={[0, -geom.heightMm / 2 - 0.4, 0]}
        opacity={0.5} scale={geom.heightMm * 3.4} blur={2.2}
        far={geom.heightMm} resolution={1024}
      />
      <CameraRig geom={geom} resetToken={props.resetToken} />
    </Canvas>
  );
}
