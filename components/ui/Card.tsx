import React, { PropsWithChildren, memo } from "react";
import {
  View,
  StyleSheet,
  ViewProps,
  StyleProp,
  ViewStyle,
} from "react-native";
import { theme } from "@/constants/theme";

/* --------------------------------- types --------------------------------- */

export type CardProps = PropsWithChildren<
  ViewProps & {
    style?: StyleProp<ViewStyle>;
  }
>;

/* -------------------------------- component ------------------------------- */

export const Card = memo(function Card({
  children,
  style,
  ...rest
}: CardProps) {
  return (
    <View
      {...rest}
      style={[styles.card, style]}
      accessibilityRole="summary"
    >
      {children}
    </View>
  );
});

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    padding: 16,

    borderWidth: 1,
    borderColor: theme.colors.border,

    // léger relief (safe iOS / Android)
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
});

export default Card;
