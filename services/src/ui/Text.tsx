// components/ui/Text.tsx
import React, { memo, useMemo } from "react";
import {
  Text as RNText,
  type TextProps,
  type TextStyle,
  type StyleProp,
} from "react-native";
import { useTheme, type AppTheme } from "@/src/theme/ThemeProvider";

type Tone = keyof AppTheme["colors"];

type Weight = TextStyle["fontWeight"];
type Size = "xs" | "s" | "m" | "l" | "xl";

type Props = Omit<TextProps, "style"> & {
  tone?: Tone;
  style?: StyleProp<TextStyle>;

  /** Helpers optionnels */
  weight?: Weight;
  size?: Size;
};

function fontSizeFor(size: Size): number {
  switch (size) {
    case "xs":
      return 11;
    case "s":
      return 12;
    case "m":
      return 14;
    case "l":
      return 16;
    case "xl":
      return 18;
    default:
      return 14;
  }
}

export const Text = memo(function Text({
  tone = "text",
  weight,
  size,
  style,
  ...rest
}: Props) {
  const t = useTheme();

  const baseStyle = useMemo<TextStyle>(() => {
    const s: TextStyle = {
      color: (t.colors[tone] ?? t.colors.text) as any,
    };

    if (weight) s.fontWeight = weight;
    if (size) s.fontSize = fontSizeFor(size);

    return s;
  }, [t, tone, weight, size]);

  return <RNText {...rest} style={[baseStyle, style]} />;
});

export default Text;
