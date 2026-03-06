// components/MiniRoute.tsx
import React, { memo, useMemo } from "react";
import { StyleSheet, View, type ViewStyle, type StyleProp } from "react-native";
import Svg, { Polyline, Rect, Path } from "react-native-svg";
import { theme } from "@/constants/theme";

type Pt = [number, number];

export type MiniRouteProps = {
  /**
   * Points :
   * - soit normalisés en 0..1 (x,y)
   * - soit lat/lng (dans ce cas on normalise automatiquement)
   */
  points?: Pt[];

  /**
   * Optionnel : clé stable pour la mémo.
   * Exemple parent: `${len}:${first}:${last}`
   */
  pointsKey?: string;

  stroke?: string;

  width?: number;
  height?: number;

  padding?: number;
  radius?: number;

  strokeWidth?: number;

  backgroundOpacity?: number;

  /** Opacité de la grille (0..1) */
  gridOpacity?: number;

  /** Opacité du “glow” sous-trait (0..1) */
  glowOpacity?: number;

  style?: StyleProp<ViewStyle>;
};

/* -------------------------------- helpers -------------------------------- */

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function clamp01(n: number) {
  return clamp(n, 0, 1);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function sanitizePairs(src?: Pt[]): Pt[] | null {
  if (!src || src.length < 2) return null;

  const safe = src.filter(([x, y]) => isFiniteNumber(x) && isFiniteNumber(y));
  if (safe.length < 2) return null;

  // remove exact consecutive duplicates
  const out: Pt[] = [];
  for (const [x, y] of safe) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== x || prev[1] !== y) out.push([x, y]);
  }
  return out.length >= 2 ? out : null;
}

/**
 * Heuristique :
 * - si la majorité des points est déjà dans [0..1], on considère "normalisé"
 * - sinon, on considère "lat/lng" (ou coordinates brutes) et on normalise via bbox
 */
function looksNormalized01(pts: Pt[]): boolean {
  let ok = 0;
  for (const [x, y] of pts) {
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) ok++;
  }
  return ok >= Math.ceil(pts.length * 0.7);
}

function normalizeTo01(pts: Pt[]): Pt[] {
  // bbox
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;

  // évite division par 0
  const sx = dx > 0 ? dx : 1;
  const sy = dy > 0 ? dy : 1;

  // on garde le ratio : on “fit” dans 0..1 en centrant
  const scale = 1 / Math.max(sx, sy);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const out: Pt[] = pts.map(([x, y]) => {
    const nx = 0.5 + (x - cx) * scale;
    const ny = 0.5 + (y - cy) * scale;
    return [clamp01(nx), clamp01(ny)];
  });

  // si tout est collé (track quasi point), on fallback
  const spread =
    Math.max(...out.map((p) => p[0])) - Math.min(...out.map((p) => p[0])) +
    (Math.max(...out.map((p) => p[1])) - Math.min(...out.map((p) => p[1])));
  if (!Number.isFinite(spread) || spread < 0.03) return defaultFallback();

  return out;
}

function sanitizePoints(src?: Pt[]): Pt[] | null {
  const cleaned = sanitizePairs(src);
  if (!cleaned) return null;

  if (looksNormalized01(cleaned)) {
    // clamp + dedupe
    const out: Pt[] = [];
    for (const [x0, y0] of cleaned) {
      const x = clamp01(x0);
      const y = clamp01(y0);
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== x || prev[1] !== y) out.push([x, y]);
    }
    return out.length >= 2 ? out : null;
  }

  // lat/lng ou brut -> normalisation bbox
  return normalizeTo01(cleaned);
}

function defaultFallback(): Pt[] {
  return [
    [0.08, 0.78],
    [0.20, 0.62],
    [0.35, 0.68],
    [0.50, 0.50],
    [0.62, 0.56],
    [0.80, 0.30],
    [0.92, 0.36],
  ];
}

function toSvgPoints(pts: Pt[], w: number, h: number, pad: number) {
  const innerW = Math.max(1, w - pad * 2);
  const innerH = Math.max(1, h - pad * 2);

  return pts
    .map(([x, y]) => {
      const xx = pad + clamp01(x) * innerW;
      const yy = pad + clamp01(y) * innerH;
      return `${xx.toFixed(1)},${yy.toFixed(1)}`;
    })
    .join(" ");
}

function gridPath(w: number, h: number, r: number) {
  const x1 = (w * 1) / 3;
  const x2 = (w * 2) / 3;
  const y1 = (h * 1) / 3;
  const y2 = (h * 2) / 3;

  const inset = Math.max(2, r * 0.35);

  const L = (x: number, y: number, x2: number, y2: number) =>
    `M ${x.toFixed(1)} ${y.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;

  return [
    L(x1, inset, x1, h - inset),
    L(x2, inset, x2, h - inset),
    L(inset, y1, w - inset, y1),
    L(inset, y2, w - inset, y2),
  ].join(" ");
}

/* -------------------------------- component ------------------------------- */

export default memo(function MiniRoute({
  points,
  pointsKey,

  stroke,
  width = 86,
  height = 56,
  padding = 6,
  radius = 14,
  strokeWidth = 3,

  backgroundOpacity = 0.04,
  gridOpacity = 0.06,
  glowOpacity = 0.18,

  style,
}: MiniRouteProps) {
  const polyPoints = useMemo(() => {
    const cleaned = sanitizePoints(points) ?? defaultFallback();
    return toSvgPoints(cleaned, width, height, padding);
  }, [pointsKey ?? points, width, height, padding]);

  const bg = `rgba(255,255,255,${clamp01(backgroundOpacity)})`;
  const gridStroke = `rgba(255,255,255,${clamp01(gridOpacity)})`;
  const glowStroke = `rgba(0,0,0,${clamp01(glowOpacity)})`;

  return (
    <View style={[s.root, { borderRadius: radius }, style]}>
      <Svg width={width} height={height}>
        {/* fond */}
        <Rect x={0} y={0} width={width} height={height} rx={radius} ry={radius} fill={bg} />

        {/* grille */}
        <Path d={gridPath(width, height, radius)} stroke={gridStroke} strokeWidth={1} />

        {/* glow */}
        <Polyline
          points={polyPoints}
          fill="none"
          stroke={glowStroke}
          strokeWidth={strokeWidth + 2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* route */}
        <Polyline
          points={polyPoints}
          fill="none"
          stroke={stroke ?? theme.colors.primary}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>

      {/* bordure discrète (mieux en dark theme) */}
      <View pointerEvents="none" style={[s.border, { borderRadius: radius }]} />
    </View>
  );
});

const s = StyleSheet.create({
  root: { overflow: "hidden" },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: theme.colors.border,
    opacity: 0.25,
  },
});
