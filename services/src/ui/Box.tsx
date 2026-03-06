import React, { memo, useMemo } from "react";
import { View, type ViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme, type AppTheme } from "@/src/theme/ThemeProvider";

/* --------------------------------- tokens -------------------------------- */

// Option B (recommandé): bg peut être n’importe quelle clé du theme.colors
type BgToken = keyof AppTheme["colors"];

// Option A (si tu veux limiter):
// type BgToken = "bg" | "card" | "surface" | "surface2";

type SpaceToken = keyof AppTheme["spacing"];
type RadiusToken = keyof AppTheme["radius"];

/* --------------------------------- props --------------------------------- */

type Props = Omit<ViewProps, "style"> & {
  /** background token */
  bg?: BgToken;

  /** padding tokens */
  p?: SpaceToken;
  px?: SpaceToken;
  py?: SpaceToken;
  pt?: SpaceToken;
  pr?: SpaceToken;
  pb?: SpaceToken;
  pl?: SpaceToken;

  /** margin tokens */
  m?: SpaceToken;
  mx?: SpaceToken;
  my?: SpaceToken;
  mt?: SpaceToken;
  mr?: SpaceToken;
  mb?: SpaceToken;
  ml?: SpaceToken;

  /** radius token */
  r?: RadiusToken;

  /** border helpers */
  border?: boolean;
  borderColor?: keyof AppTheme["colors"];

  /** style override */
  style?: StyleProp<ViewStyle>;

  /** optionnel debug (safe à supprimer) */
  debugName?: string;
};

function isColorKey(t: AppTheme, k: unknown): k is keyof AppTheme["colors"] {
  return typeof k === "string" && k in t.colors;
}

/* -------------------------------- component -------------------------------- */

export const Box = memo(function Box({
  bg,

  p,
  px,
  py,
  pt,
  pr,
  pb,
  pl,

  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,

  r,

  border,
  borderColor,

  style,
  debugName,
  ...rest
}: Props) {
  const t = useTheme();

  const themedStyle = useMemo((): ViewStyle => {
    const s: ViewStyle = {};

    // background
    if (bg && isColorKey(t, bg)) {
      s.backgroundColor = t.colors[bg] as unknown as string;
    }

    // padding
    if (p) s.padding = t.spacing[p] as unknown as number;
    if (px) s.paddingHorizontal = t.spacing[px] as unknown as number;
    if (py) s.paddingVertical = t.spacing[py] as unknown as number;
    if (pt) s.paddingTop = t.spacing[pt] as unknown as number;
    if (pr) s.paddingRight = t.spacing[pr] as unknown as number;
    if (pb) s.paddingBottom = t.spacing[pb] as unknown as number;
    if (pl) s.paddingLeft = t.spacing[pl] as unknown as number;

    // margin
    if (m) s.margin = t.spacing[m] as unknown as number;
    if (mx) s.marginHorizontal = t.spacing[mx] as unknown as number;
    if (my) s.marginVertical = t.spacing[my] as unknown as number;
    if (mt) s.marginTop = t.spacing[mt] as unknown as number;
    if (mr) s.marginRight = t.spacing[mr] as unknown as number;
    if (mb) s.marginBottom = t.spacing[mb] as unknown as number;
    if (ml) s.marginLeft = t.spacing[ml] as unknown as number;

    // radius
    if (r) s.borderRadius = t.radius[r] as unknown as number;

    // border
    if (border) {
      s.borderWidth = 1;

      const bc =
        borderColor && isColorKey(t, borderColor)
          ? (t.colors[borderColor] as unknown as string)
          : (t.colors.border as unknown as string);

      s.borderColor = bc;
    }

    // debug (optionnel)
    if (__DEV__ && debugName) {
      // rien visuel par défaut, mais tu peux mettre un outline si tu veux:
      // s.outlineColor = "rgba(255,0,0,0.35)" as any;
      // s.outlineWidth = 1 as any;
    }

    return s;
  }, [
    t,
    bg,
    p,
    px,
    py,
    pt,
    pr,
    pb,
    pl,
    m,
    mx,
    my,
    mt,
    mr,
    mb,
    ml,
    r,
    border,
    borderColor,
    debugName,
  ]);

  return <View {...rest} style={[themedStyle, style]} />;
});
