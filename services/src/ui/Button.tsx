import React, { memo, useMemo } from "react";
import {
  Pressable,
  ActivityIndicator,
  Platform,
  View,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { useTheme, type AppTheme } from "@/src/theme/ThemeProvider";
import { Text } from "./Text";

type Variant = "primary" | "ghost" | "surface" | "danger";

type Props = Omit<PressableProps, "style"> & {
  title: string;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  loading?: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
};

type Cfg = {
  container: ViewStyle;
  text: TextStyle;
  spinnerColor: string;
  rippleColor: string;
};

function pickDangerColor(t: AppTheme): string {
  // si ton thème a danger, utilise-le
  const anyT = t as any;
  const c = anyT?.colors?.danger;
  if (typeof c === "string" && c.trim()) return c;
  // fallback raisonnable (rouge/orange)
  return "rgba(255,80,80,1)";
}

function variantStyles(t: ReturnType<typeof useTheme>, variant: Variant): Cfg {
  const common: ViewStyle = {
    minHeight: 46,
    paddingVertical: t.spacing.m,
    paddingHorizontal: t.spacing.xl,
    borderRadius: t.radius.btn,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  };

  if (variant === "ghost") {
    return {
      container: {
        ...common,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: t.colors.border as any,
      },
      text: { color: t.colors.text as any, fontWeight: "900", letterSpacing: 0.2 },
      spinnerColor: String(t.colors.text),
      rippleColor: String(t.colors.border),
    };
  }

  if (variant === "surface") {
    return {
      container: {
        ...common,
        backgroundColor: t.colors.surface2 as any,
        borderWidth: 1,
        borderColor: t.colors.border as any,
      },
      text: { color: t.colors.text as any, fontWeight: "900", letterSpacing: 0.2 },
      spinnerColor: String(t.colors.text),
      rippleColor: String(t.colors.border),
    };
  }

  if (variant === "danger") {
    const danger = pickDangerColor(t as any);
    return {
      container: {
        ...common,
        backgroundColor: danger as any,
        borderWidth: 0,
      },
      text: { color: t.colors.bg as any, fontWeight: "900", letterSpacing: 0.2 },
      spinnerColor: String(t.colors.bg),
      rippleColor: "rgba(0,0,0,0.12)",
    };
  }

  // primary
  return {
    container: {
      ...common,
      backgroundColor: t.colors.primary as any,
      borderWidth: 0,
    },
    text: { color: t.colors.bg as any, fontWeight: "900", letterSpacing: 0.2 },
    spinnerColor: String(t.colors.bg),
    rippleColor: "rgba(0,0,0,0.12)",
  };
}

export const Button = memo(function Button({
  title,
  variant = "primary",
  disabled,
  loading = false,
  style,
  textStyle,
  left,
  right,
  accessibilityLabel,
  hitSlop,
  ...rest
}: Props) {
  const t = useTheme();
  const isOff = Boolean(disabled || loading);

  const cfg = useMemo(() => variantStyles(t, variant), [t, variant]);

  return (
    <Pressable
      {...rest}
      disabled={isOff}
      hitSlop={hitSlop ?? 8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isOff, busy: Boolean(loading) }}
      android_ripple={
        Platform.OS === "android" && !isOff
          ? { color: cfg.rippleColor, borderless: false }
          : undefined
      }
      style={({ pressed }) => [
        cfg.container,
        isOff && s.off,
        pressed && !isOff && s.pressed,
        style,
      ]}
    >
      {/* Left */}
      {left ? <View style={s.side}>{left}</View> : null}

      {/* Center: text OR spinner */}
      {loading ? (
        <ActivityIndicator size="small" color={cfg.spinnerColor} />
      ) : (
        <Text
          style={[cfg.text, textStyle]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
      )}

      {/* Right */}
      {right ? <View style={s.side}>{right}</View> : null}
    </Pressable>
  );
});

const s = StyleSheet.create({
  off: { opacity: 0.55 },
  pressed: { opacity: 0.92 },
  side: {
    // remplace "gap" pour compat : espace stable autour des icônes
    marginHorizontal: 6,
  },
});
