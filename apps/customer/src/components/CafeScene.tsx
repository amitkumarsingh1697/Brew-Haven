import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

const Cafe3D = lazy(() => import("./Cafe3D"));
import type { Cafe3DProps } from "./Cafe3D";

/**
 * Should this device get the 3D café? ADR-0003: the 2D scene is first-class, 3D is an
 * enhancement. `?scene=2d` or `?scene=3d` in the URL forces either (useful for demos).
 */
function want3D(): boolean {
  try {
    const forced = new URLSearchParams(location.search).get("scene");
    if (forced === "2d") return false;
    if (forced === "3d") return true;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (nav.connection?.saveData) return false;
    if (nav.deviceMemory !== undefined && nav.deviceMemory < 3) return false;
    const gl = document.createElement("canvas").getContext("webgl2");
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** Any error inside the 3D scene leaves the 2D café showing. */
class Quiet extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The café scene. The 2D illustration paints first (it is the poster and the LCP element),
 * then the 3D café loads in the background and fades in over it when its first frame is ready.
 */
export function CafeScene({ cafeName, managerName, favourites = [], baristaVideo = null }: { cafeName: string; managerName: string; favourites?: Array<{ name: string; price: string }>; baristaVideo?: Cafe3DProps["baristaVideo"] }) {
  const [use3D, setUse3D] = useState(false);
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    // Let the page settle before pulling in the 3D bundle.
    const id = window.setTimeout(() => setUse3D(want3D()), 150);
    return () => window.clearTimeout(id);
  }, []);
  const giveUp = () => {
    setUse3D(false);
    setReady(false);
  };
  return (
    <div className={ready ? "scene-stack is-3d" : "scene-stack"}>
      <CafeScene2D cafeName={cafeName} managerName={managerName} />
      {use3D && (
        <Quiet onError={giveUp}>
          <Suspense fallback={null}>
            <Cafe3D cafeName={cafeName} favourites={favourites} baristaVideo={baristaVideo} still={still} onReady={() => setReady(true)} onTooSlow={giveUp} />
          </Suspense>
        </Quiet>
      )}
    </div>
  );
}

/**
 * The 2D café (ADR-CX-05: the 2D path is first-class). It is the poster while 3D loads
 * and the whole scene on devices that don't get 3D.
 * Branding (name, apron initial) comes from tenant config so other cafés can reuse it.
 */
function CafeScene2D({ cafeName, managerName }: { cafeName: string; managerName: string }) {
  const initial = cafeName.trim().charAt(0).toUpperCase();
  return (
    <svg className="cafe-scene" viewBox="0 0 360 240" role="img" aria-label={`Inside ${cafeName}. ${managerName}, the café manager, waves hello from behind the counter.`}>
      <defs>
        <radialGradient id="lamp-glow" cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor="#FFD9A0" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFD9A0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2E1F15" />
          <stop offset="100%" stopColor="#1A120C" />
        </linearGradient>
        <linearGradient id="counter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B4329" />
          <stop offset="100%" stopColor="#3D2616" />
        </linearGradient>
      </defs>
      <rect width="360" height="240" fill="url(#wall)" />
      {/* shelves and jars */}
      <g opacity="0.9">
        <rect x="24" y="62" width="120" height="5" rx="2" fill="#57331F" />
        <rect x="216" y="62" width="120" height="5" rx="2" fill="#57331F" />
        {[34, 54, 74, 94, 114].map((x, i) => (
          <rect key={`a${x}`} x={x} y={44 - (i % 2) * 4} width="14" height={18 + (i % 2) * 4} rx="3" fill={i % 3 === 0 ? "#6F8F5A" : "#B8A48B"} opacity="0.75" />
        ))}
        {[226, 246, 266, 286, 306].map((x, i) => (
          <rect key={`b${x}`} x={x} y={46 - (i % 2) * 5} width="13" height={16 + (i % 2) * 5} rx="3" fill={i % 2 === 0 ? "#D9AD70" : "#B8A48B"} opacity="0.7" />
        ))}
        <rect x="24" y="100" width="90" height="5" rx="2" fill="#57331F" />
        <rect x="246" y="100" width="90" height="5" rx="2" fill="#57331F" />
        <path d="M36 98c4-14 12-14 16 0M62 98c3-10 10-10 13 0M266 98c4-12 12-12 16 0M296 98c3-9 9-9 12 0" stroke="#6F8F5A" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      {/* chalkboard sign */}
      <rect x="128" y="18" width="104" height="40" rx="6" fill="#120D0A" stroke="#D9AD70" strokeWidth="2" />
      <text x="180" y="44" textAnchor="middle" fill="#F1E4CC" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="15" fontWeight="600" style={{ fontVariantNumeric: "lining-nums" }}>
        {cafeName.length > 18 ? cafeName.slice(0, 17) + "…" : cafeName}
      </text>
      {/* pendant lamps */}
      {[70, 180, 290].map((x) => (
        <g key={x} className="lamp">
          <line x1={x} y1="0" x2={x} y2="14" stroke="#B8A48B" strokeWidth="1.5" />
          <path d={`M${x - 11} 24 q11 -14 22 0 z`} fill="#D9AD70" />
          <ellipse cx={x} cy="26" rx="60" ry="80" fill="url(#lamp-glow)" />
        </g>
      ))}
      {/* manager */}
      <g className="manager" transform="translate(180 120)">
        <circle cx="0" cy="-8" r="17" fill="#C98E62" />
        <path d="M-17 -12c2-14 30-16 34 0-6-6-26-8-34 0z" fill="#2A1C14" />
        <circle cx="-6" cy="-8" r="1.8" fill="#2A1C14" />
        <circle cx="6" cy="-8" r="1.8" fill="#2A1C14" />
        <path d="M-6 0q6 5 12 0" stroke="#2A1C14" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M-26 50v-30q0-14 26-14t26 14v30z" fill="#F1E4CC" />
        <path d="M-15 50v-26h30v26z" fill="#57331F" />
        <text x="0" y="42" textAnchor="middle" fill="#D9AD70" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="14" fontWeight="700">
          {initial}
        </text>
        <g className="wave-arm">
          <path d="M24 22q16-8 18-30" stroke="#F1E4CC" strokeWidth="9" fill="none" strokeLinecap="round" />
          <circle cx="42" cy="-10" r="6" fill="#C98E62" />
        </g>
      </g>
      {/* counter and machine */}
      <rect x="0" y="168" width="360" height="72" fill="url(#counter)" />
      <rect x="0" y="164" width="360" height="8" fill="#8A5A3A" />
      <g transform="translate(262 128)">
        <rect x="0" y="0" width="60" height="38" rx="5" fill="#B8A48B" />
        <rect x="6" y="6" width="48" height="10" rx="3" fill="#2A1C14" />
        <rect x="14" y="22" width="8" height="10" fill="#57331F" />
        <rect x="38" y="22" width="8" height="10" fill="#57331F" />
      </g>
      <g transform="translate(70 138)">
        <path d="M0 10h26v12a13 13 0 0 1-26 0z" fill="#F1E4CC" />
        <path d="M26 13h4a5 5 0 0 1 0 10h-4" stroke="#F1E4CC" strokeWidth="3" fill="none" />
        <path className="steam" d="M8 4c-3 -4 3 -6 0 -10M16 4c-3 -4 3 -6 0 -10" stroke="#F1E4CC" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      </g>
    </svg>
  );
}
