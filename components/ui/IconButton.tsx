import React, { memo, useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
  ViewStyle,
  StyleProp,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/constants/theme";

/* --------------------------------- helpers -------------------------------- */

function normalizeBadge(badge?: string | number | null) {
  if (badge === null || badge === undefined) return undefined;

  // Accept: "3", 3, "99+", "NEW"
  const raw = String(badge).trim();
  if (!raw) return undefined;

  // If it's numeric: clamp to 99+
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n <= 0) return undefined;
    if (n > 99) return "99+";
    return String(Math.floor(n));
  }

  // Non-numeric labels (e.g. "NEW", "!")
  return raw.length > 4 ? raw.slice(0, 4) : raw;
}

type Tone = "default" | "primary" | "danger" | "success" | "ghost";

function toneStyles(tone: Tone) {
  switch (tone) {
    case "ghost":
      return {
        bg: "transparent",
        border: theme.colors.border,
        icon: theme.colors.text,
      };
    case "primary":
      return {
        bg: theme.colors.primary,
        border: theme.colors.primary,
        icon: "#fff",
      };
    case "danger":
      return {
        // si ton thème a colors.danger, remplace ici
        bg: theme.colors.primary,
        border: theme.colors.primary,
        icon: "#fff",
      };
    case "success":
      // si ton thème a colors.success, remplace ici
      return {
        bg: theme.colors.surface2,
        border: theme.colors.border,
        icon: theme.colors.text,
      };
    case "default":
    default:
      return {
        bg: theme.colors.surface2,
        border: theme.colors.border,
        icon: theme.colors.text,
      };
  }
}

/* --------------------------------- component -------------------------------- */

export type IconButtonProps = {
  name: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;

  label?: string;
  disabled?: boolean;

  badge?: string | number | null;
  size?: number; // button square size (default 44)
  iconSize?: number; // default 22
  tone?: Tone;

  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const IconButton = memo(function IconButton({
  name,
  onPress,
  badge,
  label,
  disabled,
  size = 44,
  iconSize = 22,
  tone = "default",
  style,
  testID,
}: IconButtonProps) {
  const isDisabled = Boolean(disabled || !onPress);
  const safeBadge = useMemo(() => normalizeBadge(badge), [badge]);
  const t = toneStyles(tone);

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label ?? String(name)}
      accessibilityState={{ disabled: isDisabled }}
      android_ripple={
        Platform.OS === "android" && !isDisabled
          ? { color: theme.colors.border, borderless: false }
          : undefined
      }
      style={({ pressed }) => [
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: Math.max(12, Math.floor(size * 0.32)),
          backgroundColor: t.bg,
          borderColor: t.border,
          opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={name} size={iconSize} color={t.icon} />

      {safeBadge ? (
        <View
          style={[
            styles.badge,
            {
              borderColor: theme.colors.bg,
              backgroundColor: theme.colors.primary,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.badgeText} numberOfLines={1}>
            {safeBadge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",

    borderWidth: 1,
  },

  badge: {
    position: "absolute",
    top: -6,
    right: -6,

    minWidth: 18,
    height: 18,
    borderRadius: 10,

    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",

    borderWidth: 2,
  },

  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    includeFontPadding: false,
  },
});
