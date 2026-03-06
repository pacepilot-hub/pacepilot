// components/ui/Screen.tsx
import React, { memo, PropsWithChildren, useMemo } from "react";
import {
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  Platform,
} from "react-native";
import {
  SafeAreaView,
  type Edge,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { theme } from "@/constants/theme";

export type ScreenProps = PropsWithChildren<{
  /** Style appliqué au conteneur interne (root). */
  style?: StyleProp<ViewStyle>;

  /** Style appliqué au SafeAreaView. */
  safeStyle?: StyleProp<ViewStyle>;

  /** Couleur de fond (par défaut: theme.colors.background) */
  backgroundColor?: string;

  /** Edges SafeArea (par défaut: top/left/right). */
  edges?: Edge[];

  /**
   * Ajoute automatiquement un padding correspondant aux insets
   * (utile si tu n’utilises pas ScrollView avec contentInset/padding).
   */
  withInsetsPadding?: boolean;

  /**
   * Ajoute un padding horizontal standard (optionnel),
   * pratique pour éviter de le répéter partout.
   */
  padded?: boolean;
}>;

export const Screen = memo(function Screen({
  children,
  style,
  safeStyle,
  backgroundColor = theme.colors.background,
  edges = ["top", "left", "right"],
  withInsetsPadding = false,
  padded = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const insetPaddingStyle = useMemo<StyleProp<ViewStyle>>(() => {
    if (!withInsetsPadding) return null;
    return {
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    };
  }, [withInsetsPadding, insets]);

  return (
    <SafeAreaView
      edges={edges}
      style={[s.safe, { backgroundColor }, safeStyle]}
    >
      <View
        style={[
          s.root,
          { backgroundColor },
          padded && s.padded,
          insetPaddingStyle,
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
});

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  root: {
    flex: 1,
    // petit détail: évite certains "flash" de fond sur Android
    ...(Platform.OS === "android" ? { minHeight: "100%" as any } : null),
  },
  padded: {
    paddingHorizontal: 16,
  },
});

export default Screen;
