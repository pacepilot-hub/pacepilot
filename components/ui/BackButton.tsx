import React, { memo, useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, ViewStyle, TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/constants/theme";

type Props = {
  fallback?: string;          // route utilisée si on ne peut pas revenir
  label?: string;             // texte à afficher
  iconOnly?: boolean;         // si true => pas de texte
  compact?: boolean;          // padding réduit
  hitSlop?: number;           // zone de tap
  onPress?: () => void;       // optionnel: override (si tu veux brancher une logique custom)
  style?: ViewStyle;
  textStyle?: TextStyle;
};

function safeCanGoBack(router: any): boolean {
  try {
    return typeof router?.canGoBack === "function" ? !!router.canGoBack() : false;
  } catch {
    return false;
  }
}

export const BackButton = memo(function BackButton({
  fallback = "/(tabs)/home",
  label = "Retour",
  iconOnly = false,
  compact = false,
  hitSlop = 10,
  onPress,
  style,
  textStyle,
}: Props) {
  const router = useRouter();

  const hs = useMemo(
    () => ({ top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }),
    [hitSlop]
  );

  const handleBack = useCallback(() => {
    if (onPress) {
      onPress();
      return;
    }

    if (safeCanGoBack(router)) {
      router.back();
      return;
    }

    // fallback sûr
    router.replace(fallback);
  }, [onPress, router, fallback]);

  return (
    <Pressable
      onPress={handleBack}
      hitSlop={hs}
      style={({ pressed }) => [
        s.btn,
        compact && s.btnCompact,
        pressed && { opacity: 0.86 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Retour"
    >
      <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
      {!iconOnly ? (
        <Text style={[s.txt, textStyle]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
});

const s = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignSelf: "flex-start",
  },
  btnCompact: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  txt: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
});
