import { StyleSheet } from "react-native";
import type { AppTheme } from "./ThemeProvider";

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/**
 * Factory de styles typée.
 * - Conserve l’inférence des clés (ex: { container, title })
 * - Garantit que chaque valeur est un style RN valide
 * - Compatible avec un thème AppTheme
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (t: AppTheme) => T) {
  return (t: AppTheme): T => StyleSheet.create(factory(t)) as T;
}
