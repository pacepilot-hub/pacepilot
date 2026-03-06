// components/CoachButton.tsx
import React, { memo, useCallback, useMemo } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/constants/theme";

/**
 * Patch set (idées vues avant) :
 * ✅ hitSlop + feedback pressed
 * ✅ badge “DA-safe” (border bg) + clamp 99+
 * ✅ props optionnels (unread / onPress / route) -> réutilisable header/tab/cards
 * ✅ memo + callbacks stables
 */

type Props = {
  unread?: number;
  route?: string; // default "/coach"
  onPress?: () => void; // override
  size?: number; // icon size
};

function formatUnread(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 99) return "99+";
  return String(Math.floor(n));
}

function CoachButtonImpl({ unread = 0, route = "/coach", onPress, size = 22 }: Props) {
  const router = useRouter();

  const badge = useMemo(() => formatUnread(unread), [unread]);

  const handlePress = useCallback(() => {
    if (onPress) return onPress();
    router.push(route as any);
  }, [onPress, router, route]);

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      style={({ pressed }) => [s.btn, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir le coach"
    >
      <Ionicons name="chatbubble-ellipses-outline" size={size} color={theme.colors.text} />

      {badge ? (
        <View style={s.badge} pointerEvents="none">
          <Text style={s.badgeText} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default memo(CoachButtonImpl);

const s = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.86 },

  badge: {
    position: "absolute",
    right: 6,
    top: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  badgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "900",
  },
});
