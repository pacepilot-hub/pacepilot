import React, { memo } from "react";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import { theme } from "@/constants/theme";

/* --------------------------------- types --------------------------------- */

type Props = TextProps & {
  children: React.ReactNode;
  style?: TextStyle | TextStyle[];
};

/* -------------------------------- component -------------------------------- */

export const SectionTitle = memo(function SectionTitle({
  children,
  style,
  ...props
}: Props) {
  return (
    <Text
      {...props}
      style={[s.sectionTitle, style]}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
});

/* --------------------------------- styles --------------------------------- */

const s = StyleSheet.create({
  sectionTitle: {
    marginTop: 14,
    marginBottom: 10,
    fontSize: 16,
    fontWeight: "900",
    color: theme.colors.text,
    letterSpacing: 0.2,
  },
});
