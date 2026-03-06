// components/ui/Card.tsx
import React, { memo, PropsWithChildren, useMemo } from "react";
import { type ViewProps, type StyleProp, type ViewStyle } from "react-native";
import { Box } from "./Box";
import { useTheme, type AppTheme } from "@/src/theme/ThemeProvider";

type CardVariant = "default" | "flat" | "outlined";

type SpaceToken = keyof AppTheme["spacing"];

export type CardProps = PropsWithChildren<
  Omit<ViewProps, "style"> & {
    style?: StyleProp<ViewStyle>;
    variant?: CardVariant;
    withShadow?: boolean;

    /** Optionnel : padding token (sinon pas de padding imposé) */
    p?: SpaceToken;

    /** Optionnel : override background token (rare, mais pratique) */
    bg?: "bg" | "card" | "surface" | "surface2";
  }
>;

function getCardBg(variant: CardVariant): "card" | "surface" | "surface2" {
  // logique simple : default = card, outlined = surface, flat = surface2 (ou transparent via style)
  if (variant === "outlined") return "surface";
  if (variant === "flat") return "surface2";
  return "card";
}

export const Card = memo(function Card({
  style,
  variant = "default",
  withShadow = true,
  p,
  bg,
  children,
  ...rest
}: CardProps) {
  const t = useTheme();

  const cfg = useMemo(() => {
    const baseBg = bg ?? getCardBg(variant);

    const border: ViewStyle =
      variant === "flat"
        ? {}
        : {
            borderWidth: 1,
            borderColor: t.colors.border as any,
          };

    // shadow seulement si demandé ET variant pas flat
    const shadow: StyleProp<ViewStyle> =
      withShadow && variant !== "flat" ? (t.shadow.card as any) : undefined;

    return { baseBg, border, shadow };
  }, [t, variant, withShadow, bg]);

  return (
    <Box
      {...rest}
      bg={cfg.baseBg}
      r="card"
      p={p}
      style={[cfg.shadow, cfg.border, style]}
    >
      {children}
    </Box>
  );
});

export default Card;
