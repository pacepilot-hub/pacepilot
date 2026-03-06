// constants/theme.ts

/* --------------------------------- helpers -------------------------------- */

// rgba("#RRGGBB", 0.5) -> "rgba(r,g,b,0.5)"
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return `rgba(255,255,255,${clamp01(a)})`;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  return `rgba(${r},${g},${b},${clamp01(a)})`;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// mix 2 couleurs hex (#RRGGBB) à t (0..1)
function mixHex(aHex: string, bHex: string, t: number) {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  const tt = clamp01(t);
  const r = Math.round(a.r + (b.r - a.r) * tt);
  const g = Math.round(a.g + (b.g - a.g) * tt);
  const b2 = Math.round(a.b + (b.b - a.b) * tt);
  return `#${toHex(r)}${toHex(g)}${toHex(b2)}`;
}

function parseHex(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(n: number) {
  return n.toString(16).padStart(2, "0");
}

/* --------------------------------- theme --------------------------------- */

const base = {
  // base palette (ta DA)
  primary: "#EF3B00",
  neutral: "#B6B7B7",

  bg: "#0B0B0C",
  surface: "#141417",
  surface2: "#1B1B20",

  text: "#F2F2F2",
} as const;

export const theme = {
  colors: {
    /* brand */
    primary: base.primary,
    neutral: base.neutral,

    /* surfaces */
    bg: base.bg,
    card: base.surface, // alias “card”
    surface: base.surface,
    surface2: base.surface2,

    /* text */
    text: base.text,
    text2: rgba(base.text, 0.72),

    /* borders */
    border: "rgba(255,255,255,0.08)",

    /* states (optionnels mais utiles) */
    overlay: "rgba(0,0,0,0.35)",
    divider: "rgba(255,255,255,0.06)",

    /* ✅ alias standard attendu par certains écrans/layouts */
    get background() {
      return this.bg;
    },

    /* ✅ aliases legacy */
    get orange() {
      return this.primary;
    },
    get gray() {
      return this.neutral;
    },

    /* helpers accessibles via theme.colors */
    alpha(hex: string, a: number) {
      return rgba(hex, a);
    },
    mix(aHex: string, bHex: string, t: number) {
      return mixHex(aHex, bHex, t);
    },
  },

  radius: {
    card: 16,
    btn: 12,
    pill: 999,
    sheet: 20,
  },

  spacing: {
    xs: 4,
    s: 8,
    m: 12,
    l: 16,
    xl: 24,
    xxl: 32,
  },

  typography: {
    // simple, mais suffisant pour unifier
    size: {
      xs: 12,
      s: 13,
      m: 15,
      l: 17,
      xl: 20,
      xxl: 26,
    },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    },
    lineHeight: {
      s: 18,
      m: 22,
      l: 26,
      xl: 30,
    },
  },

  shadow: {
    card: {
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    floating: {
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  },
} as const;

export type Theme = typeof theme;
