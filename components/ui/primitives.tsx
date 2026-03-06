// components/ui/primitives.tsx
import React, { memo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  StyleProp,
  ViewStyle,
  TextStyle,
  PressableProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/constants/theme";

/* --------------------------------- Screen -------------------------------- */

type ScreenProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  pad?: number; // default 16
};

export const Screen = memo(function Screen({ children, style, pad = 16 }: ScreenProps) {
  return <View style={[styles.screen, { padding: pad }, style]}>{children}</View>;
});

/* ---------------------------------- Card ---------------------------------- */

type CardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  pad?: number; // default 14
  tone?: "default" | "soft" | "flat";
};

export const Card = memo(function Card({ children, style, pad = 14, tone = "default" }: CardProps) {
  const base = [
    styles.card,
    { padding: pad },
    tone === "soft" && styles.cardSoft,
    tone === "flat" && styles.cardFlat,
    style,
  ];
  return <View style={base}>{children}</View>;
});

/* ------------------------------ SectionTitle ------------------------------ */

type SectionTitleProps = {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  right?: React.ReactNode;
  hint?: string;
};

export const SectionTitle = memo(function SectionTitle({ children, style, right, hint }: SectionTitleProps) {
  return (
    <View style={styles.sectionRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sectionTitle, style]}>{children}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {right ? <View style={{ marginLeft: 10 }}>{right}</View> : null}
    </View>
  );
});

/* ------------------------------- ButtonPrimary ---------------------------- */

type ButtonPrimaryProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  tone?: "primary" | "surface";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
} & Omit<PressableProps, "onPress" | "disabled" | "style">;

export const ButtonPrimary = memo(function ButtonPrimary({
  label,
  onPress,
  disabled,
  leftIcon,
  rightIcon,
  tone = "primary",
  style,
  textStyle,
  testID,
  ...rest
}: ButtonPrimaryProps) {
  const isDisabled = Boolean(disabled || !onPress);

  const bg = tone === "primary" ? theme.colors.primary : theme.colors.surface2;
  const border = tone === "primary" ? theme.colors.primary : theme.colors.border;
  const txt = tone === "primary" ? "#fff" : theme.colors.text;

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      android_ripple={
        Platform.OS === "android" && !isDisabled ? { color: theme.colors.border, borderless: false } : undefined
      }
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {leftIcon ? (
        <Ionicons name={leftIcon} size={18} color={txt} style={{ marginRight: 8 }} />
      ) : null}

      <Text style={[styles.btnText, { color: txt }, textStyle]} numberOfLines={1}>
        {label}
      </Text>

      {rightIcon ? (
        <Ionicons name={rightIcon} size={18} color={txt} style={{ marginLeft: 8 }} />
      ) : null}
    </Pressable>
  );
});

/* -------------------------------- IconButton ------------------------------ */

type IconButtonProps = {
  name?: keyof typeof Ionicons.glyphMap;
  label?: string; // fallback if no icon
  onPress?: () => void;
  disabled?: boolean;
  tone?: "default" | "ghost" | "primary";
  size?: number; // default 40
  iconSize?: number; // default 20
  style?: StyleProp<ViewStyle>;
  testID?: string;
} & Omit<PressableProps, "onPress" | "disabled" | "style">;

export const IconButton = memo(function IconButton({
  name,
  label = "•",
  onPress,
  disabled,
  tone = "default",
  size = 40,
  iconSize = 20,
  style,
  testID,
  ...rest
}: IconButtonProps) {
  const isDisabled = Boolean(disabled || !onPress);

  const bg =
    tone === "primary" ? theme.colors.primary : tone === "ghost" ? "transparent" : theme.colors.surface2;
  const border = tone === "primary" ? theme.colors.primary : theme.colors.border;
  const fg = tone === "primary" ? "#fff" : theme.colors.text;

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={name ? String(name) : label}
      accessibilityState={{ disabled: isDisabled }}
      android_ripple={
        Platform.OS === "android" && !isDisabled ? { color: theme.colors.border, borderless: false } : undefined
      }
      style={({ pressed }) => [
        styles.iconBtn,
        {
          width: size,
          height: size,
          borderRadius: Math.max(12, Math.floor(size * 0.32)),
          backgroundColor: bg,
          borderColor: border,
          opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {name ? (
        <Ionicons name={name} size={iconSize} color={fg} />
      ) : (
        <Text style={[styles.iconFallback, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
});

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cardSoft: {
    backgroundColor: theme.colors.surface2,
  },
  cardFlat: {
    borderWidth: 0,
    backgroundColor: theme.colors.surface2,
  },

  sectionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: theme.colors.text,
    letterSpacing: 0.2,
  },
  sectionHint: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.muted,
  },

  btn: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  btnText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  iconBtn: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconFallback: {
    fontSize: 18,
    fontWeight: "900",
  },
});
