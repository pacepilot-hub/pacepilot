// components/providers/ThemeProvider.tsx
import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  PropsWithChildren,
} from "react";
import { theme as baseTheme, type Theme as BaseTheme } from "@/constants/theme";

/* --------------------------------- types --------------------------------- */

export type AppTheme = BaseTheme;

export type ThemeMode = "dark" | "light" | "system";

type ThemeContextValue = {
  theme: AppTheme;
  mode: ThemeMode;
  // prêt pour plus tard (prefs user, system, etc.)
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/* -------------------------------- provider -------------------------------- */

export function ThemeProvider({
  children,
  initialMode = "dark",
}: PropsWithChildren<{ initialMode?: ThemeMode }>) {
  // Pour l’instant: thème unique (ta DA)
  // Plus tard: switch selon mode + préférences
  const mode = initialMode;

  const setMode = useCallback((_mode: ThemeMode) => {
    // stub volontaire: tu brancheras AsyncStorage + Appearance plus tard
    // (on garde l’API stable dès maintenant)
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    return {
      theme: baseTheme,
      mode,
      setMode,
    };
  }, [mode, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/* ---------------------------------- hooks --------------------------------- */

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider />");
  }
  return ctx.theme;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used inside <ThemeProvider />");
  }
  return { mode: ctx.mode, setMode: ctx.setMode };
}

/**
 * Helper pratique pour créer des styles dépendants du thème
 * sans recalculer à chaque render.
 *
 * Usage:
 * const styles = useThemedStyles(t => StyleSheet.create({ ... }));
 */
export function useThemedStyles<T>(factory: (t: AppTheme) => T) {
  const t = useTheme();
  return useMemo(() => factory(t), [factory, t]);
}
