import React, { memo, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { theme } from "@/constants/theme";

type Variant = "primary" | "danger" | "ghost";

type Props = {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;

  /** options UI */
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean; // default true
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

export const ButtonPrimary = memo(function ButtonPrimary({
  label,
  onPress,
  disabled,
  loading,
  variant = "primary",
  leftIcon,
  rightIcon,
  fullWidth = true,
  style,
  textStyle,
  testID,
}: Props) {
  const isOff = Boolean(disabled || loading);

  const spinnerColor = useMemo(() => {
    if (variant === "ghost") return theme.colors.text;
    return "#fff";
  }, [variant]);

  return (
    <Pressable
      testID={testID}
      onPress={isOff ? undefined : onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: !!loading }}
      style={({ pressed }) => [
        s.base,
        fullWidth && s.fullWidth,
        variant === "primary" && s.primary,
        variant === "danger" && s.danger,
        variant === "ghost" && s.ghost,
        isOff && s.off,
        pressed && !isOff && s.pressed,
        style,
      ]}
    >
      <View style={s.row}>
        {/* Left */}
        {loading ? (
          <ActivityIndicator color={spinnerColor} />
        ) : leftIcon ? (
          <View style={s.iconSlot}>{leftIcon}</View>
        ) : null}

        {/* Label */}
        <Text
          numberOfLines={1}
          style={[
            s.label,
            variant === "ghost" && s.labelGhost,
            variant === "danger" && s.labelDanger,
            textStyle,
          ]}
        >
          {label}
        </Text>

        {/* Right */}
        {rightIcon ? <View style={s.iconSlot}>{rightIcon}</View> : null}
      </View>
    </Pressable>
  );
});

const s = StyleSheet.create({
  base: {
    borderRadius: theme.radius.btn,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  fullWidth: { width: "100%" },

  primary: {
    backgroundColor: theme.colors.primary,
  },
  danger: {
    backgroundColor: "rgba(239,59,0,0.92)",
  },
  ghost: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  off: { opacity: 0.55 },
  pressed: { opacity: 0.92 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },

  label: { color: "#fff", fontSize: 14, fontWeight: "900" },
  labelGhost: { color: theme.colors.text },
  labelDanger: { color: "#fff" },
});
