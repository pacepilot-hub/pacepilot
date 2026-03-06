// components/ActivityRow.tsx
import React, { memo, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/constants/theme";
import type { WeatherIcon } from "@/storage/types";

import MiniRoute from "./MiniRoute";

/* ---------------------------------- types --------------------------------- */

export type Sport = "Course" | "Vélo" | "Renfo";

export type ActivityItem = {
  id: string;
  sport: Sport;
  title: string;

  dateLabel: string;
  location: string;

  distance: string;
  duration: string;
  pace?: string;
  calories?: string;

  weather: { temp: number; icon: WeatherIcon; wind?: string };

  route?: { points: [number, number][] };
};

type Props = { item: ActivityItem };

/* --------------------------------- mappings -------------------------------- */

const WEATHER_ICON: Partial<Record<WeatherIcon, keyof typeof Ionicons.glyphMap>> = {
  sunny: "sunny-outline",
  partly: "partly-sunny-outline",
  rain: "rainy-outline",
  cloud: "cloud-outline",
  storm: "thunderstorm-outline",
};

const SPORT_ICON: Partial<Record<Sport, keyof typeof Ionicons.glyphMap>> = {
  Course: "walk-outline",
  Vélo: "bicycle-outline",
  Renfo: "barbell-outline",
};

function safeWeatherGlyph(icon: WeatherIcon): keyof typeof Ionicons.glyphMap {
  return WEATHER_ICON[icon] ?? "cloud-outline";
}

function safeSportGlyph(sport: Sport): keyof typeof Ionicons.glyphMap {
  return SPORT_ICON[sport] ?? "walk-outline";
}

/* --------------------------------- helpers -------------------------------- */

function cleanText(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

function buildMeta(item: ActivityItem) {
  const date = cleanText(item.dateLabel);
  const loc = cleanText(item.location);

  const wind = cleanText(item.weather?.wind);
  const windPart = wind ? ` · Vent ${wind}` : "";

  // si location vide, on ne met pas "·"
  if (date && loc) return `${date} · ${loc}${windPart}`;
  if (date) return `${date}${windPart}`;
  if (loc) return `${loc}${windPart}`;
  return wind ? `Vent ${wind}` : "—";
}

function buildStats(item: ActivityItem) {
  const parts = [
    cleanText(item.distance),
    cleanText(item.duration),
    cleanText(item.pace),
    cleanText(item.calories),
  ].filter(Boolean);

  return parts.length ? parts : ["—"];
}

function getRoutePoints(item: ActivityItem) {
  const pts = item.route?.points;
  if (!pts || !Array.isArray(pts) || pts.length < 2) return undefined;
  return pts;
}

/** clé stable pour memo, sans dépendre d'une ref d'array */
function routeKey(points?: [number, number][]) {
  if (!points || points.length < 2) return "noroute";
  const a = points[0];
  const b = points[points.length - 1];
  // arrondi léger => évite variations microscopiques
  const f = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "0");
  return `${points.length}:${f(a[0])},${f(a[1])}:${f(b[0])},${f(b[1])}`;
}

/* -------------------------------- component -------------------------------- */

function ActivityRow({ item }: Props) {
  const meta = useMemo(
    () => buildMeta(item),
    [item.dateLabel, item.location, item.weather?.wind, item.weather?.temp]
  );

  const stats = useMemo(
    () => buildStats(item),
    [item.distance, item.duration, item.pace, item.calories]
  );

  const routePoints = useMemo(() => getRoutePoints(item), [routeKey(item.route?.points)]);

  const hasRoute = !!routePoints;

  const sportIcon = safeSportGlyph(item.sport);
  const weatherIcon = safeWeatherGlyph(item.weather.icon);

  const title = cleanText(item.title) || "Activité";

  const weatherLabel =
    Number.isFinite(item.weather?.temp) ? `Météo : ${item.weather.temp}°` : "Météo";

  return (
    <View
      style={s.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${meta}`}
    >
      {/* Left: sport pill */}
      <View style={s.leftPill} accessibilityLabel={`Sport : ${item.sport}`}>
        <Ionicons name={sportIcon} size={18} color="#fff" />
      </View>

      {/* Middle: content */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.topLine}>
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>

          <View style={s.weather} accessibilityLabel={weatherLabel}>
            <Ionicons name={weatherIcon} size={14} color={theme.colors.neutral} />
            <Text style={s.weatherTxt} numberOfLines={1}>
              {Number.isFinite(item.weather?.temp) ? `${item.weather.temp}°` : "—"}
            </Text>
          </View>
        </View>

        <Text style={s.meta} numberOfLines={1}>
          {meta}
        </Text>

        <View style={s.stats} accessibilityLabel="Statistiques">
          {stats.map((t, idx) => (
            <View key={`${item.id}-stat-${idx}`} style={s.statWrap}>
              {idx !== 0 ? <Text style={s.dot}>•</Text> : null}
              <Text style={s.stat} numberOfLines={1}>
                {t}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Right: mini map */}
      <View
        style={s.mapBox}
        accessibilityLabel={hasRoute ? "Aperçu du parcours" : "Aucun parcours"}
      >
        <MiniRoute points={routePoints} />
        <View pointerEvents="none" style={s.mapOverlay} />
      </View>
    </View>
  );
}

export default memo(ActivityRow);

/* --------------------------------- styles -------------------------------- */

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,

    padding: 12,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  leftPill: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  topLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.text,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  weather: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 6,
  },
  weatherTxt: {
    color: theme.colors.neutral,
    fontWeight: "900",
    fontSize: 12,
  },

  meta: {
    marginTop: 4,
    color: theme.colors.text2,
    fontSize: 12,
    fontWeight: "700",
  },

  stats: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 4,
  },
  statWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  stat: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 12,
  },
  dot: {
    marginHorizontal: 6,
    color: theme.colors.text2,
    fontWeight: "900",
  },

  mapBox: {
    width: 86,
    height: 56,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    opacity: 0.35,
  },
});
