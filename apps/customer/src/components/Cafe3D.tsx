/**
 * The 3D café (ADR-0003). Everything here is procedural: no model files to download,
 * so the scene is part of the lazily loaded bundle and costs no extra requests.
 * Branding (café name, apron initial, favourites board) comes from tenant data so
 * one scene serves every café. CafeScene decides whether to show this or the 2D scene.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, PerformanceMonitor } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

export interface Cafe3DProps {
  cafeName: string;
  favourites: Array<{ name: string; price: string }>;
  /** Filmed barista on a green screen; replaces the drawn one when set. */
  baristaVideo?: { idle: string; wave?: string; keyColor?: string } | null;
  /** Reduced motion: no intro dolly, no idle animation. */
  still: boolean;
  onReady: () => void;
  /** Called when the device can't keep a usable frame rate; the 2D scene takes over. */
  onTooSlow: () => void;
}

const C = {
  wall: "#2c1d14",
  panel: "#24170f",
  wood: "#6b4329",
  woodLight: "#8a5a3a",
  brass: "#d9ad70",
  cream: "#f1e4cc",
  shirt: "#ede0c8",
  apron: "#57331f",
  skin: "#c98e62",
  hair: "#2a1c14",
  leaf: "#6f8f5a",
  chrome: "#c9c2b8",
  ink: "#120d0a",
};

/* ---------- textures drawn once on a canvas ---------- */

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function useTextures(initial: string) {
  return useMemo(() => {
    // Seeded so the grain is the same on every load.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const wood = canvasTexture(512, 512, (g) => {
      g.fillStyle = "#7a4e30";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 140; i++) {
        const y = rnd() * 512;
        g.strokeStyle = `rgba(${rnd() > 0.5 ? "40,22,12" : "150,100,64"},${0.08 + rnd() * 0.12})`;
        g.lineWidth = 1 + rnd() * 3;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 3 * rnd());
        g.stroke();
      }
    });
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    const glow = canvasTexture(128, 128, (g) => {
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, "rgba(255,217,160,0.9)");
      r.addColorStop(0.35, "rgba(255,200,130,0.35)");
      r.addColorStop(1, "rgba(255,200,130,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
    });
    const steam = canvasTexture(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "rgba(255,255,255,0.55)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const apron = canvasTexture(256, 320, (g) => {
      g.fillStyle = C.apron;
      g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "rgba(217,173,112,0.5)";
      g.lineWidth = 4;
      g.strokeRect(70, 190, 116, 70); // pocket
      g.fillStyle = C.brass;
      g.font = '700 120px "Cormorant Garamond", Georgia, serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(initial, 128, 110);
    });
    // Limewashed plaster: soft blotches and a few hairline cracks, tinted by the material colour.
    const plaster = canvasTexture(512, 256, (g) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 90; i++) {
        const x = rnd() * 512;
        const y = rnd() * 256;
        const r = 20 + rnd() * 70;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const shade = rnd() > 0.5 ? "255,240,220" : "150,130,115";
        grad.addColorStop(0, `rgba(${shade},${0.05 + rnd() * 0.08})`);
        grad.addColorStop(1, `rgba(${shade},0)`);
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = "rgba(90,70,60,0.18)";
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        let x = rnd() * 512;
        let y = rnd() * 256;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += rnd() * 12));
        g.stroke();
      }
    });
    plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;
    plaster.repeat.set(2, 1);
    // Glazed subway tiles for the wainscot: offset rows with darker grout and a soft highlight.
    const tiles = canvasTexture(256, 128, (g) => {
      g.fillStyle = "#6e6258";
      g.fillRect(0, 0, 256, 128);
      const tw = 64;
      const th = 32;
      for (let row = 0; row < 4; row++)
        for (let col = -1; col < 5; col++) {
          const x = col * tw + (row % 2 ? tw / 2 : 0) + 2;
          const y = row * th + 2;
          const v = 225 + Math.floor(rnd() * 20);
          g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
          g.fillRect(x, y, tw - 4, th - 4);
          const hl = g.createLinearGradient(x, y, x, y + th);
          hl.addColorStop(0, "rgba(255,255,255,0.35)");
          hl.addColorStop(0.5, "rgba(255,255,255,0)");
          g.fillStyle = hl;
          g.fillRect(x, y, tw - 4, th - 4);
        }
    });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(9, 2.2);
    return { wood, glow, steam, apron, plaster, tiles };
  }, [initial]);
}

/** One draw call for many copies of the same shape (ADR-0003: ≤100 draw calls). */
function Many({ at, children }: { at: Array<{ p: readonly [number, number, number]; r?: readonly [number, number, number]; s?: readonly [number, number, number] }>; children: ReactNode }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    at.forEach((a, i) => {
      o.position.set(...a.p);
      o.rotation.set(...(a.r ?? [0, 0, 0]));
      o.scale.set(...(a.s ?? [1, 1, 1]));
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [at]);
  return <instancedMesh ref={ref} args={[undefined, undefined, at.length]}>{children}</instancedMesh>;
}

/* ---------- pieces of the café ---------- */

function Room({ plaster, tiles }: { plaster: THREE.Texture; tiles: THREE.Texture }) {
  return (
    <group>
      <mesh position={[0, 2, -1.6]}>
        <planeGeometry args={[9, 4.4]} />
        <meshStandardMaterial map={plaster} color={C.wall} roughness={0.95} />
      </mesh>
      {/* tiled wainscot */}
      <mesh position={[0, 0.55, -1.58]}>
        <boxGeometry args={[9, 1.1, 0.04]} />
        <meshStandardMaterial map={tiles} color="#7a5a44" roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.12, -1.55]}>
        <boxGeometry args={[9, 0.04, 0.08]} />
        <meshStandardMaterial color={C.woodLight} roughness={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0.5]}>
        <planeGeometry args={[9, 5]} />
        <meshStandardMaterial color="#1c130d" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Counter({ wood }: { wood: THREE.Texture }) {
  const slats = useRef<THREE.InstancedMesh>(null);
  const count = 30;
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation(-2.1 + (i + 0.5) * (4.2 / count), 0.5, 0.56);
      slats.current!.setMatrixAt(i, m);
    }
    slats.current!.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <mesh position={[0, 0.5, 0.2]}>
        <boxGeometry args={[4.2, 1, 0.7]} />
        <meshStandardMaterial map={wood} color="#ffffff" roughness={0.7} />
      </mesh>
      <instancedMesh ref={slats} args={[undefined, undefined, count]}>
        <cylinderGeometry args={[0.05, 0.05, 0.86, 10, 1, false, 0, Math.PI]} />
        <meshStandardMaterial map={wood} color="#fff2e6" roughness={0.6} />
      </instancedMesh>
      {/* top slab and brass kick rail */}
      <mesh position={[0, 1.02, 0.22]}>
        <boxGeometry args={[4.36, 0.06, 0.82]} />
        <meshStandardMaterial map={wood} color="#f0d8c4" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.08, 0.62]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.02, 0.02, 4.2, 12]} />
        <meshStandardMaterial color={C.brass} metalness={0.9} roughness={0.3} />
      </mesh>
    </group>
  );
}

const CUPS = [-0.22, -0.08, 0.06, 0.2].map((x) => ({ p: [x, 0.51, 0.02] as const }));

function EspressoMachine() {
  const chrome = <meshStandardMaterial color={C.chrome} metalness={0.85} roughness={0.25} />;
  return (
    <group position={[1.3, 1.05, -0.05]}>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.78, 0.44, 0.46]} />
        <meshStandardMaterial color={C.cream} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.8, 0.03, 0.48]} />
        {chrome}
      </mesh>
      {/* cups warming on top */}
      <Many at={CUPS}>
        <cylinderGeometry args={[0.045, 0.035, 0.08, 14]} />
        <meshStandardMaterial color="#fbf6ec" roughness={0.3} />
      </Many>
      {/* group heads and portafilters */}
      {[-0.18, 0.18].map((x) => (
        <group key={x} position={[x, 0.2, 0.26]}>
          <mesh>
            <cylinderGeometry args={[0.06, 0.06, 0.08, 18]} />
            {chrome}
          </mesh>
          <mesh position={[0, -0.04, 0.12]} rotation-x={Math.PI / 2.3}>
            <cylinderGeometry args={[0.018, 0.022, 0.2, 10]} />
            <meshStandardMaterial color={C.ink} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* gauges */}
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.36, 0.235]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.035, 0.035, 0.01, 20]} />
          <meshStandardMaterial color="#fffaf0" emissive="#ffd9a0" emissiveIntensity={0.25} />
        </mesh>
      ))}
      <mesh position={[0, 0.015, 0.2]}>
        <boxGeometry args={[0.72, 0.03, 0.18]} />
        {chrome}
      </mesh>
      {/* steam wand */}
      <mesh position={[0.36, 0.12, 0.25]} rotation-z={0.25}>
        <cylinderGeometry args={[0.008, 0.008, 0.22, 8]} />
        {chrome}
      </mesh>
      {/* grinder */}
      <group position={[-0.62, 0, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <boxGeometry args={[0.16, 0.32, 0.2]} />
          <meshStandardMaterial color={C.ink} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.1, 0.05, 0.2, 18]} />
          <meshStandardMaterial color="#8a5a1a" transparent opacity={0.55} roughness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

const PASTRY_SPOTS = [-0.24, -0.08, 0.08, 0.24].flatMap((x, i) => [
  { x, y: 0.07, z: 0.06, croissant: i % 2 === 0 },
  { x, y: 0.25, z: -0.02, croissant: i % 2 === 1 },
]);
const CROISSANTS = PASTRY_SPOTS.filter((s) => s.croissant).map((s) => ({ p: [s.x, s.y, s.z] as const, r: [Math.PI / 2, 0, 0.4] as const, s: [1, 1, 0.7] as const }));
const MUFFINS = PASTRY_SPOTS.filter((s) => !s.croissant);
const MUFFIN_CASES = MUFFINS.map((s) => ({ p: [s.x, s.y - 0.015, s.z] as const }));
const MUFFIN_TOPS = MUFFINS.map((s) => ({ p: [s.x, s.y + 0.02, s.z] as const, s: [1, 0.75, 1] as const }));

function PastryCase() {
  return (
    <group position={[-1.32, 1.05, 0.12]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.72, 0.4, 0.42]} />
        <meshStandardMaterial color="#fff6e6" transparent opacity={0.12} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.7, 0.012, 0.4]} />
        <meshStandardMaterial color="#e8dcc6" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <boxGeometry args={[0.74, 0.02, 0.44]} />
        <meshStandardMaterial color={C.brass} metalness={0.8} roughness={0.35} />
      </mesh>
      <Many at={CROISSANTS}>
        <torusGeometry args={[0.045, 0.025, 10, 18, Math.PI * 1.25]} />
        <meshStandardMaterial color="#c98a3e" roughness={0.6} />
      </Many>
      <Many at={MUFFIN_CASES}>
        <cylinderGeometry args={[0.04, 0.03, 0.05, 14]} />
        <meshStandardMaterial color="#d9c3a0" roughness={0.8} />
      </Many>
      <Many at={MUFFIN_TOPS}>
        <sphereGeometry args={[0.048, 14, 10]} />
        <meshStandardMaterial color="#5a3420" roughness={0.75} />
      </Many>
    </group>
  );
}

function Shelves({ wood }: { wood: THREE.Texture }) {
  const jars = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: Array<{ x: number; y: number; h: number; c: string }> = [];
    const colors = ["#b8a48b", "#6f8f5a", "#d9ad70", "#8a5a3a", "#e8dcc6"];
    [1.62, 2.08].forEach((y, row) => {
      for (let i = 0; i < 6; i++) out.push({ x: 0.95 + i * 0.22 + (row ? 0.08 : 0), y, h: 0.14 + ((i + row) % 3) * 0.04, c: colors[(i + row * 2) % colors.length]! });
    });
    return out;
  }, []);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, s.y + s.h / 2 + 0.02, -1.45), new THREE.Quaternion(), new THREE.Vector3(1, s.h / 0.16, 1));
      jars.current!.setMatrixAt(i, m);
      jars.current!.setColorAt(i, col.set(s.c));
    });
    jars.current!.instanceMatrix.needsUpdate = true;
    if (jars.current!.instanceColor) jars.current!.instanceColor.needsUpdate = true;
  }, [spots]);
  return (
    <group>
      {[1.62, 2.08].map((y) => (
        <mesh key={y} position={[1.55, y, -1.45]}>
          <boxGeometry args={[1.5, 0.04, 0.24]} />
          <meshStandardMaterial map={wood} color="#a0704e" roughness={0.6} />
        </mesh>
      ))}
      <instancedMesh ref={jars} args={[undefined, undefined, spots.length]}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 14]} />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <Plant position={[2.25, 2.1, -1.45]} />
      <Plant position={[-2.3, 1.15, -1.3]} big />
    </group>
  );
}

function Plant({ position, big = false }: { position: [number, number, number]; big?: boolean }) {
  const s = big ? 1.8 : 1;
  return (
    <group position={position} scale={s}>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.07, 0.05, 0.12, 14]} />
        <meshStandardMaterial color="#b56a45" roughness={0.8} />
      </mesh>
      {[
        [0, 0.18, 0, 0.09],
        [-0.06, 0.15, 0.02, 0.07],
        [0.06, 0.16, -0.01, 0.07],
        [0.01, 0.25, 0.01, 0.06],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x!, y!, z!]}>
          <icosahedronGeometry args={[r!, 0]} />
          <meshStandardMaterial color={i % 2 ? "#5d7a4a" : C.leaf} roughness={0.8} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Lamp({ x, glow }: { x: number; glow: THREE.Texture }) {
  return (
    <group position={[x, 0, 0.15]}>
      <mesh position={[0, 3.05, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.8, 6]} />
        <meshStandardMaterial color="#3a2a20" />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <coneGeometry args={[0.2, 0.18, 28, 1, true]} />
        <meshStandardMaterial color={C.brass} metalness={0.75} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 2.53, 0]}>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshStandardMaterial color="#fff2d6" emissive="#ffd9a0" emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <Billboard position={[0, 2.5, 0.02]}>
        <mesh>
          <planeGeometry args={[0.9, 0.9]} />
          <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </Billboard>
      <pointLight position={[0, 2.45, 0]} color="#ffcf8a" intensity={4.5} distance={4.5} decay={1.6} />
    </group>
  );
}

/** Warm pools of lamplight on the counter top: one instanced draw for both lamps. */
const POOLS = [-1.05, 1.05].map((x) => ({ p: [x, 1.054, 0.2] as const, r: [-Math.PI / 2, 0, 0] as const, s: [1.9, 0.95, 1] as const }));
function LightPools({ glow }: { glow: THREE.Texture }) {
  return (
    <Many at={POOLS}>
      <planeGeometry args={[0.9, 0.9]} />
      <meshBasicMaterial map={glow} color="#ffcf8a" transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </Many>
  );
}

/** Dust drifting through the lamplight. One draw call; frozen with reduced motion. */
function Dust({ tex, still }: { tex: THREE.Texture; still: boolean }) {
  const count = 70;
  const ref = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: count }, (_, i) => ({ x: (i % 2 ? 1.05 : -1.05) + (rnd() - 0.5) * 0.9, y: 1.2 + rnd() * 1.3, z: 0.15 + (rnd() - 0.5) * 0.7, phase: rnd() * Math.PI * 2, speed: 0.04 + rnd() * 0.06 }));
  }, []);
  const positions = useMemo(() => new Float32Array(seeds.flatMap((s) => [s.x, s.y, s.z])), [seeds]);
  useFrame(({ clock }) => {
    if (still || !ref.current) return;
    const t = clock.elapsedTime;
    const a = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    seeds.forEach((s, i) => {
      const y = 1.2 + ((s.y - 1.2 + t * s.speed) % 1.3);
      a.setXYZ(i, s.x + Math.sin(t * 0.3 + s.phase) * 0.06, y, s.z + Math.cos(t * 0.25 + s.phase) * 0.04);
    });
    a.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial map={tex} color="#ffe2b0" size={0.045} sizeAttenuation transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  );
}

function Steam({ tex, still }: { tex: THREE.Texture; still: boolean }) {
  const puffs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    if (still) return;
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const t = (clock.elapsedTime * 0.45 + i / 3) % 1;
      m.position.y = t * 0.32;
      m.position.x = Math.sin(t * 6 + i) * 0.02;
      m.scale.setScalar(0.06 + t * 0.12);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.5;
    });
  });
  return (
    <group position={[-0.62, 1.05, 0.36]}>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.06, 0.045, 0.12, 20]} />
        <meshStandardMaterial color="#fbf6ec" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.112, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.052, 20]} />
        <meshStandardMaterial color="#6b3d1e" roughness={0.3} />
      </mesh>
      <mesh position={[0.07, 0.06, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.03, 0.009, 8, 16]} />
        <meshStandardMaterial color="#fbf6ec" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.01, 24]} />
        <meshStandardMaterial color="#fbf6ec" roughness={0.3} />
      </mesh>
      <group position={[0, 0.16, 0]}>
        {[0, 1, 2].map((i) => (
          <Billboard key={i}>
            <mesh ref={(m) => void (puffs.current[i] = m)} scale={0.1}>
              <planeGeometry args={[1, 1.4]} />
              <meshBasicMaterial map={tex} transparent opacity={still ? 0.25 : 0} depthWrite={false} />
            </mesh>
          </Billboard>
        ))}
      </group>
    </group>
  );
}

/** The manager: a friendly, stylised barista who follows your finger and waves. */
function Barista({ apron, still, waveSignal }: { apron: THREE.Texture; still: boolean; waveSignal: number }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const waveUntil = useRef(still ? 0 : 3.6);
  const waveAmt = useRef(still ? 0 : 0);
  const { clock } = useThree();

  useEffect(() => {
    if (waveSignal) waveUntil.current = clock.elapsedTime + 2.8;
  }, [waveSignal, clock]);

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.elapsedTime;
    const d = Math.min(dt, 0.05);
    if (still) {
      shoulder.current!.rotation.z = 2.5;
      elbow.current!.rotation.z = 0.35;
      return;
    }
    // Wave on arrival, then now and then, and whenever tapped.
    if (t > 12 && Math.floor(t) % 14 === 0 && t > waveUntil.current + 4) waveUntil.current = t + 2.4;
    const target = t < waveUntil.current && t > 0.5 ? 1 : 0;
    waveAmt.current += (target - waveAmt.current) * Math.min(1, d * 5);
    const w = waveAmt.current;
    shoulder.current!.rotation.z = THREE.MathUtils.lerp(0.18, 2.55, w);
    shoulder.current!.rotation.x = THREE.MathUtils.lerp(-0.45, 0, w);
    elbow.current!.rotation.z = THREE.MathUtils.lerp(-0.1, 0.35 + Math.sin(t * 9) * 0.38, w);
    // Breathing and a gentle sway.
    body.current!.position.y = Math.sin(t * 1.6) * 0.006;
    body.current!.rotation.z = Math.sin(t * 0.7) * 0.015;
    // Look towards the visitor's finger or cursor.
    head.current!.rotation.y += (pointer.x * 0.45 - head.current!.rotation.y) * d * 4;
    head.current!.rotation.x += (-pointer.y * 0.18 - head.current!.rotation.x) * d * 4;
    head.current!.rotation.z = Math.sin(t * 0.9) * 0.03 + w * 0.08;
    // Blink every few seconds.
    const blink = t % 4.2 < 0.12 ? 0.1 : 1;
    eyes.current!.scale.y = blink;
  });

  const skin = <meshStandardMaterial color={C.skin} roughness={0.65} />;
  const shirt = <meshStandardMaterial color={C.shirt} roughness={0.85} />;
  const dark = <meshStandardMaterial color={C.hair} roughness={0.6} />;
  return (
    <group position={[0.05, 0, -0.42]}>
      <group ref={body}>
        <mesh position={[0, 1.22, 0]}>
          <capsuleGeometry args={[0.21, 0.42, 6, 18]} />
          {shirt}
        </mesh>
        {/* apron with the café initial */}
        <mesh position={[0, 1.16, 0]}>
          <cylinderGeometry args={[0.218, 0.226, 0.46, 24, 1, true, -0.85, 1.7]} />
          <meshStandardMaterial map={apron} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x * 0.9, 1.49, 0.2]} rotation={[-0.35, 0, x > 0 ? 0.3 : -0.3]}>
            <boxGeometry args={[0.025, 0.16, 0.01]} />
            <meshStandardMaterial color={C.apron} />
          </mesh>
        ))}
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[0.055, 0.06, 0.08, 14]} />
          {skin}
        </mesh>
        <group ref={head} position={[0, 1.64, 0]}>
          <mesh position={[0, 0.15, 0]}>
            <sphereGeometry args={[0.16, 28, 22]} />
            {skin}
          </mesh>
          {/* hair */}
          <mesh position={[0, 0.17, -0.012]} rotation-x={-0.25}>
            <sphereGeometry args={[0.168, 28, 14, 0, Math.PI * 2, 0, 1.45]} />
            {dark}
          </mesh>
          {/* ears */}
          {[-0.16, 0.16].map((x) => (
            <mesh key={x} position={[x, 0.14, 0]} scale={[0.5, 1, 0.8]}>
              <sphereGeometry args={[0.035, 12, 10]} />
              {skin}
            </mesh>
          ))}
          <group ref={eyes} position={[0, 0.165, 0.145]}>
            {[-0.055, 0.055].map((x) => (
              <mesh key={x} position={[x, 0, 0]}>
                <sphereGeometry args={[0.018, 12, 10]} />
                <meshStandardMaterial color={C.ink} roughness={0.2} />
              </mesh>
            ))}
          </group>
          {[-0.055, 0.055].map((x) => (
            <mesh key={x} position={[x, 0.215, 0.14]} rotation-z={x > 0 ? -0.15 : 0.15}>
              <boxGeometry args={[0.05, 0.01, 0.01]} />
              {dark}
            </mesh>
          ))}
          {[-0.09, 0.09].map((x) => (
            <mesh key={x} position={[x, 0.11, 0.125]}>
              <sphereGeometry args={[0.025, 10, 8]} />
              <meshStandardMaterial color="#e07a6a" transparent opacity={0.35} />
            </mesh>
          ))}
          {/* smile */}
          <mesh position={[0, 0.1, 0.152]} rotation-z={Math.PI}>
            <torusGeometry args={[0.04, 0.007, 8, 18, Math.PI]} />
            <meshStandardMaterial color="#5a2a1a" />
          </mesh>
        </group>
        {/* resting arm on the viewer's left */}
        <group position={[-0.27, 1.43, 0]} rotation={[-0.55, 0, -0.16]}>
          <mesh position={[0, -0.17, 0]}>
            <capsuleGeometry args={[0.058, 0.24, 4, 12]} />
            {shirt}
          </mesh>
          <group position={[0, -0.34, 0]} rotation-x={-0.5}>
            <mesh position={[0, -0.12, 0]}>
              <capsuleGeometry args={[0.048, 0.18, 4, 12]} />
              {skin}
            </mesh>
          </group>
        </group>
        {/* waving arm */}
        <group ref={shoulder} position={[0.27, 1.43, 0]}>
          <mesh position={[0, -0.17, 0]}>
            <capsuleGeometry args={[0.058, 0.24, 4, 12]} />
            {shirt}
          </mesh>
          <group ref={elbow} position={[0, -0.34, 0]}>
            <mesh position={[0, -0.12, 0]}>
              <capsuleGeometry args={[0.048, 0.18, 4, 12]} />
              {skin}
            </mesh>
            <mesh position={[0, -0.27, 0]} scale={[0.85, 1.1, 0.6]}>
              <sphereGeometry args={[0.055, 14, 12]} />
              {skin}
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * Sign and chalkboard text, drawn on canvases. Inter is used where digits appear because the
 * display serif's default figures are old-style ("4oo"), and canvas text can't switch them.
 */
/* ---------- filmed barista ---------- */

/**
 * Removes the green screen: pixels close to the key colour (in chroma, so shadows on the screen go
 * too) become transparent, with a soft edge, and green spill on hair and shoulders is pulled back.
 */
const KEY_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const KEY_FRAG = `
uniform sampler2D map; uniform sampler2D waveMap; uniform float useWave; uniform vec3 keyColor; uniform vec3 tint; uniform float similarity; uniform float smoothness; uniform float spill;
varying vec2 vUv;
vec2 rgb2uv(vec3 c) { return vec2(c.r * -0.169 + c.g * -0.331 + c.b * 0.5 + 0.5, c.r * 0.5 + c.g * -0.419 + c.b * -0.081 + 0.5); }
void main() {
  vec4 c = mix(texture2D(map, vUv), texture2D(waveMap, vUv), useWave);
  float d = distance(rgb2uv(c.rgb), rgb2uv(keyColor));
  float a = smoothstep(similarity, similarity + smoothness, d);
  float s = pow(clamp((d - similarity) / spill, 0.0, 1.0), 1.5);
  float grey = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 rgb = (mix(vec3(grey), c.rgb, s) * 0.94 + 0.03) * tint; // lift the blacks a touch so dark hair reads against the wall
  if (a < 0.05) discard;
  // The clip is sampled as raw sRGB so the key matches what was filmed; convert for the renderer.
  gl_FragColor = vec4(pow(rgb, vec3(2.2)), a);
  #include <colorspace_fragment>
}`;

function makeVideo(src: string, loop: boolean) {
  const v = document.createElement("video");
  v.src = src;
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.loop = loop;
  v.playsInline = true;
  v.preload = "auto";
  return v;
}

/**
 * The filmed barista: an idle loop, and a wave when tapped that plays once and returns to idle.
 * Calls onFail if the clip can't play, so the drawn barista takes over.
 */
function VideoBarista({ video, still, waveSignal, onFail }: { video: NonNullable<Cafe3DProps["baristaVideo"]>; still: boolean; waveSignal: number; onFail: () => void }) {
  const idle = useMemo(() => makeVideo(video.idle, true), [video.idle]);
  const wave = useMemo(() => (video.wave ? makeVideo(video.wave, false) : null), [video.wave]);
  const idleTex = useMemo(() => Object.assign(new THREE.VideoTexture(idle), { colorSpace: THREE.NoColorSpace }), [idle]);
  const waveTex = useMemo(() => (wave ? Object.assign(new THREE.VideoTexture(wave), { colorSpace: THREE.NoColorSpace }) : null), [wave]);
  const [aspect, setAspect] = useState(9 / 16);
  const [waving, setWaving] = useState(false);
  const uniforms = useMemo(
    () => ({ map: { value: idleTex as THREE.Texture }, waveMap: { value: (waveTex ?? idleTex) as THREE.Texture }, useWave: { value: 0 }, keyColor: { value: new THREE.Color().setStyle(video.keyColor ?? "#00b140", THREE.NoColorSpace) }, tint: { value: new THREE.Color(0.96, 0.9, 0.82) }, similarity: { value: 0.11 }, smoothness: { value: 0.07 }, spill: { value: 0.14 } }),
    [idleTex, waveTex, video.keyColor],
  );
  // The material keeps its own copy of the uniforms, so changes go to the material, not to `uniforms`.
  const material = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    const ready = () => {
      if (idle.videoWidth) setAspect(idle.videoWidth / idle.videoHeight);
      if (still) idle.currentTime = 0;
      else void idle.play().catch(onFail);
    };
    idle.addEventListener("loadeddata", ready);
    idle.addEventListener("error", onFail);
    idle.load();
    return () => {
      idle.removeEventListener("loadeddata", ready);
      idle.removeEventListener("error", onFail);
      idle.pause();
      idleTex.dispose();
    };
  }, [idle, idleTex, still, onFail]);

  useEffect(() => {
    if (!waveSignal || !wave || still) return;
    wave.currentTime = 0;
    void wave.play().then(() => setWaving(true), () => undefined);
    const done = () => setWaving(false);
    wave.addEventListener("ended", done);
    return () => wave.removeEventListener("ended", done);
  }, [waveSignal, wave, still]);

  useEffect(() => () => waveTex?.dispose(), [waveTex]);
  // Both clips stay bound to the shader and the wave is blended in when tapped.
  useFrame(() => {
    const u = material.current?.uniforms;
    if (u) u.useWave!.value = waving && waveTex ? 1 : 0;
  });

  // Framed waist up behind the counter, about the drawn barista's height.
  const h = 1.45;
  return (
    <mesh position={[0.05, 0.98 + h / 2 - 0.3, -0.42]}>
      <planeGeometry args={[h * aspect, h]} />
      <shaderMaterial ref={material} vertexShader={KEY_VERT} fragmentShader={KEY_FRAG} uniforms={uniforms} transparent />
    </mesh>
  );
}

function drawSign(g: CanvasRenderingContext2D, cafeName: string) {
  const W = 1024, H = 290;
  g.fillStyle = C.ink;
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = C.cream;
  let size = 96;
  const name = cafeName.toUpperCase();
  do {
    g.font = `600 ${size}px Inter, system-ui, sans-serif`;
    g.letterSpacing = `${Math.round(size * 0.12)}px`;
    size -= 4;
  } while (g.measureText(name).width > W - 120 && size > 36);
  g.fillText(name, W / 2, H * 0.44);
  g.letterSpacing = "14px";
  g.font = "500 30px Inter, system-ui, sans-serif";
  g.fillStyle = C.brass;
  g.fillText("COFFEE · BAKES · TEA", W / 2, H * 0.8);
}

function drawBoard(g: CanvasRenderingContext2D, favourites: Cafe3DProps["favourites"]) {
  const W = 512, H = 400;
  g.fillStyle = "#1d2420";
  g.fillRect(0, 0, W, H);
  // chalk dust
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 30, 1 + Math.random() * 2);
  }
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = C.brass;
  g.font = 'italic 600 52px "Cormorant Garamond", Georgia, serif';
  g.fillText("Today's favourites", W / 2, 58);
  g.font = "600 31px Inter, system-ui, sans-serif";
  favourites.slice(0, 4).forEach((f, i) => {
    const y = 138 + i * 68;
    g.fillStyle = "#ece6da";
    g.textAlign = "left";
    let name = f.name;
    while (g.measureText(name).width > 330 && name.length > 4) name = name.slice(0, -2) + "…";
    g.fillText(name, 34, y);
    g.textAlign = "right";
    g.fillStyle = C.brass;
    g.fillText(f.price, W - 34, y);
    g.strokeStyle = "rgba(236,230,218,0.22)";
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(34, y + 30);
    g.lineTo(W - 34, y + 30);
    g.stroke();
  });
}

function useDrawnTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const tex = useMemo(() => canvasTexture(w, h, draw), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Draw again once the brand fonts are ready, so the first paint never sticks with a fallback font.
    const fonts = document.fonts;
    if (!fonts) return;
    Promise.all([fonts.load('600 64px Inter'), fonts.load('italic 600 52px "Cormorant Garamond"')]).then(() => {
      draw((tex.image as HTMLCanvasElement).getContext("2d")!);
      tex.needsUpdate = true;
    }, () => undefined);
  }, [tex]); // eslint-disable-line react-hooks/exhaustive-deps
  return tex;
}

function Signage({ cafeName, favourites }: { cafeName: string; favourites: Cafe3DProps["favourites"] }) {
  const sign = useDrawnTexture(1024, 290, (g) => drawSign(g, cafeName), [cafeName]);
  const board = useDrawnTexture(512, 400, (g) => drawBoard(g, favourites), [favourites.map((f) => f.name + f.price).join("|")]);
  return (
    <>
      <group position={[0, 2.3, -1.56]}>
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[1.5, 0.5, 0.03]} />
          <meshStandardMaterial color={C.brass} metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.006]}>
          <planeGeometry args={[1.42, 0.42 * (290 / 290) * 0.95]} />
          <meshStandardMaterial map={sign} emissive="#ffffff" emissiveMap={sign} emissiveIntensity={0.25} roughness={0.9} />
        </mesh>
      </group>
      {favourites.length > 0 && (
        <group position={[-1.5, 1.86, -1.56]}>
          <mesh position={[0, 0, -0.01]}>
            <boxGeometry args={[0.98, 0.8, 0.03]} />
            <meshStandardMaterial color="#5a3a26" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.006]}>
            <planeGeometry args={[0.9, 0.72]} />
            <meshStandardMaterial map={board} emissive="#ffffff" emissiveMap={board} emissiveIntensity={0.18} roughness={0.95} />
          </mesh>
        </group>
      )}
    </>
  );
}

function CameraRig({ still }: { still: boolean }) {
  const target = useMemo(() => new THREE.Vector3(0, 1.45, 0), []);
  useFrame(({ camera, clock, pointer }, dt) => {
    const d = Math.min(dt, 0.05);
    const intro = still ? 1 : Math.min(1, clock.elapsedTime / 1.8);
    const ease = 1 - Math.pow(1 - intro, 3);
    const z = THREE.MathUtils.lerp(5.6, 4.3, ease);
    const px = still ? 0 : pointer.x * 0.28;
    const py = still ? 0 : pointer.y * 0.08;
    camera.position.x += (px - camera.position.x) * d * 3;
    camera.position.y += (1.7 + py - camera.position.y) * d * 3;
    camera.position.z = z;
    camera.lookAt(target);
  });
  return null;
}

/** Calls onFirstFrame once the scene has drawn twice, so the swap from 2D never shows a blank canvas. */
function FirstFrame({ onFirstFrame }: { onFirstFrame: () => void }) {
  const n = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    n.current += 1;
    if (n.current === 1) invalidate(); // still mode renders on demand, so ask for the second frame

    if (n.current === 2) onFirstFrame();
  });
  return null;
}

export default function Cafe3D({ cafeName, favourites, baristaVideo, still, onReady, onTooSlow }: Cafe3DProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const onVideoFail = useMemo(() => () => setVideoFailed(true), []);
  const initial = cafeName.trim().charAt(0).toUpperCase() || "B";
  const tex = useTextures(initial);
  const [dpr, setDpr] = useState(1.5);
  const [wave, setWave] = useState(0);
  const [visible, setVisible] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  // Stop drawing when the scene is off screen or the tab is hidden: saves battery.
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting) && !document.hidden));
    if (wrap.current) io.observe(wrap.current);
    const vis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  // Redraw the apron once the brand font has loaded.
  useEffect(() => {
    document.fonts?.load('700 120px "Cormorant Garamond"').then(() => {
      const img = tex.apron.image as HTMLCanvasElement;
      const g = img.getContext("2d")!;
      g.fillStyle = C.apron;
      g.fillRect(40, 30, 176, 150);
      g.fillStyle = C.brass;
      g.font = '700 120px "Cormorant Garamond", Georgia, serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(initial, 128, 110);
      tex.apron.needsUpdate = true;
    }, () => undefined);
  }, [tex, initial]);

  return (
    <div ref={wrap} className="cafe3d">
      <Canvas
        dpr={dpr}
        frameloop={visible ? (still ? "demand" : "always") : "never"}
        camera={{ position: [0, 1.7, still ? 4.3 : 5.6], fov: 36, near: 0.1, far: 30 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerDown={() => setWave((w) => w + 1)}
        onCreated={({ gl }) => {
          // `?scene=3d&debug` exposes renderer stats for the performance budget check (ADR-0003).
          if (location.search.includes("debug")) (window as unknown as { __bhGl: unknown }).__bhGl = gl;
        }}
        aria-hidden="true"
      >
        <color attach="background" args={["#1a110b"]} />
        <fog attach="fog" args={["#1a110b", 6, 11]} />
        <PerformanceMonitor
          bounds={() => [24, 50]}
          flipflops={3}
          onIncline={() => setDpr(1.75)}
          onDecline={() => setDpr((d) => Math.max(1, d - 0.25))}
          onFallback={onTooSlow}
        />
        <hemisphereLight args={["#ffe3b8", "#3a2618", 0.8]} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.1} color="#ffe6c4" />
        <directionalLight position={[-2, 1.2, 3]} intensity={0.35} color="#ffd2a0" />
        {/* rim light from behind, so the barista stands out from the wall */}
        <directionalLight position={[0.5, 2.6, -2.5]} intensity={0.9} color="#ffd9a8" />
        <Room plaster={tex.plaster} tiles={tex.tiles} />
        <Shelves wood={tex.wood} />
        <Signage cafeName={cafeName} favourites={favourites} />
        {baristaVideo && !videoFailed ? (
          <VideoBarista video={baristaVideo} still={still} waveSignal={wave} onFail={onVideoFail} />
        ) : (
          <Barista apron={tex.apron} still={still} waveSignal={wave} />
        )}
        <Counter wood={tex.wood} />
        <EspressoMachine />
        <PastryCase />
        <Steam tex={tex.steam} still={still} />
        {[-1.05, 1.05].map((x) => (
          <Lamp key={x} x={x} glow={tex.glow} />
        ))}
        <LightPools glow={tex.glow} />
        <Dust tex={tex.steam} still={still} />
        <CameraRig still={still} />
        <FirstFrame onFirstFrame={onReady} />
      </Canvas>
    </div>
  );
}
