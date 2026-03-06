// app/(tabs)/activities.tsx
import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { Screen, Card, SectionTitle } from "@/components/ui";
import { theme } from "@/constants/theme";
import { listActivities } from "@/storage/activities";

/* --------------------------------- types --------------------------------- */

type RangeKey = "7d" | "28d" | "12w" | "all";
type TagKey = "all" | "EF" | "Tempo" | "SL" | "Frac" | "Autre";

type EffortKey = "facile" | "modere" | "dur";

type ActivityView = {
  id: string;

  // ✅ robust: tri/filtre sur dateMs
  dateMs: number; // epoch ms, 0 si inconnue
  dateISO: string; // YYYY-MM-DD ou "—"

  title: string;
  tag: Exclude<TagKey, "all">;

  km: number;
  durationMin: number;
  paceTxt: string;

  effort?: EffortKey;
};

/* -------------------------------- utils -------------------------------- */

function safeStr(x: any) {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/* -------------------------------- helpers -------------------------------- */

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m} min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function paceFrom(km: number, durationMin: number): string {
  if (!km || km <= 0 || !durationMin || durationMin <= 0) return "—";
  const pace = durationMin / km; // min/km
  const pMin = Math.floor(pace);
  const pSec = Math.round((pace - pMin) * 60);
  return `${pMin}:${String(pSec).padStart(2, "0")}/km`;
}

function toneFromTag(tag: ActivityView["tag"]) {
  if (tag === "EF") return "green";
  if (tag === "Tempo") return "orange";
  if (tag === "SL") return "purple";
  if (tag === "Frac") return "slate";
  return "slate";
}

function toneColor(tone: ReturnType<typeof toneFromTag>) {
  switch (tone) {
    case "green":
      return theme.colors.success ?? theme.colors.primary;
    case "orange":
      return theme.colors.warning ?? theme.colors.primary;
    case "purple":
      return theme.colors.purple ?? theme.colors.primary;
    case "slate":
    default:
      return theme.colors.text2;
  }
}

/**
 * Parse tolérant d'une date venant de storage.
 * - supporte YYYY-MM-DD
 * - supporte ISO string
 * - supporte timestamp number (ms ou s)
 */
function parseDate(raw: any): { dateMs: number; dateISO: string } {
  if (raw == null) return { dateMs: 0, dateISO: "—" };

  // timestamp number
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 10_000_000_000 ? raw : raw * 1000; // si c'est en secondes
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return { dateMs: d.getTime(), dateISO: toISODate(d) };
    return { dateMs: 0, dateISO: "—" };
  }

  const s = safeStr(raw);
  if (!s) return { dateMs: 0, dateISO: "—" };

  // déjà YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return { dateMs: Number.isNaN(d.getTime()) ? 0 : d.getTime(), dateISO: s };
  }

  // ISO string / autre format parseable
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { dateMs: d.getTime(), dateISO: toISODate(d) };

  return { dateMs: 0, dateISO: "—" };
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Range: filtrage simple par dateMs.
 * On garde les dates inconnues (dateMs=0) en mode tolérant.
 */
function filterByRange(items: ActivityView[], range: RangeKey) {
  if (range === "all") return items;

  const days = range === "7d" ? 7 : range === "28d" ? 28 : range === "12w" ? 84 : 9999;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  return items.filter((a) => a.dateMs === 0 || a.dateMs >= cutoffMs);
}

/**
 * Normalisation depuis storage.
 * (Tu peux raffiner les tags plus tard via ton IA / workoutType).
 */
function toView(a: any): ActivityView {
  const id = safeStr(a?.id) ?? safeStr(a?.uuid) ?? `act_${Math.random().toString(16).slice(2)}`;

  // date : dateISO / startedAt / startTime / createdAt / updatedAt
  const rawDate =
    a?.dateISO ?? a?.startedAt ?? a?.startTime ?? a?.createdAt ?? a?.updatedAt ?? null;

  const { dateMs, dateISO } = parseDate(rawDate);

  // distance
  const km =
    toNum(a?.km) ??
    toNum(a?.distanceKm) ??
    (((toNum(a?.distance_m) ?? toNum(a?.distanceM)) != null
      ? (toNum(a?.distance_m) ?? toNum(a?.distanceM)!) / 1000
      : null) as number | null) ??
    0;

  // durée
  const durationMin =
    toNum(a?.durationMin) ??
    (((toNum(a?.duration_s) ?? toNum(a?.durationS)) != null
      ? (toNum(a?.duration_s) ?? toNum(a?.durationS)!) / 60
      : null) as number | null) ??
    0;

  // title
  const title =
    safeStr(a?.title) ??
    safeStr(a?.name) ??
    safeStr(a?.typeLabel) ??
    safeStr(a?.workoutType) ??
    safeStr(a?.sport) ??
    "Séance";

  // tag
  const tagRaw = safeStr(a?.tag) ?? safeStr(a?.sessionTag) ?? safeStr(a?.workoutTag) ?? null;
  const tag = ((): ActivityView["tag"] => {
    const t = (tagRaw ?? "").toUpperCase();
    if (t === "EF") return "EF";
    if (t === "TEMPO") return "Tempo";
    if (t === "SL") return "SL";
    if (t === "FRAC" || t === "INTERVAL" || t === "INTERVALS") return "Frac";

    const t2 = title.toLowerCase();
    if (t2.includes("facile") || t2.includes("footing") || t2.includes("endurance") || t2.includes("ef")) return "EF";
    if (t2.includes("tempo")) return "Tempo";
    if (t2.includes("long") || t2.includes("sortie longue") || t2.includes("sl")) return "SL";
    if (t2.includes("fraction") || t2.includes("interval") || t2.includes("frac")) return "Frac";

    return "Autre";
  })();

  // effort (optionnel)
  const effortRaw = safeStr(a?.effort) ?? safeStr(a?.feeling) ?? null;
  const effort = ((): ActivityView["effort"] | undefined => {
    const e = (effortRaw ?? "").toLowerCase();
    if (e.includes("fac")) return "facile";
    if (e.includes("mod")) return "modere";
    if (e.includes("dur") || e.includes("hard")) return "dur";
    return undefined;
  })();

  const kmSafe = Math.max(0, Number(km) || 0);
  const minSafe = Math.max(0, Number(durationMin) || 0);

  return {
    id,
    dateMs,
    dateISO,
    title,
    tag,
    km: kmSafe,
    durationMin: minSafe,
    paceTxt: paceFrom(kmSafe, minSafe),
    effort,
  };
}

/* --------------------------------- small UI -------------------------------- */

type ChipProps = { label: string; active?: boolean; onPress: () => void };
const Chip = memo(function Chip({ label, active, onPress }: ChipProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [c.chip, active && c.chipActive, pressed && s.pressed]}>
      <Text style={[c.chipTxt, active && c.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
});

type KpiProps = { label: string; value: string; icon: keyof typeof Ionicons.glyphMap };
const Kpi = memo(function Kpi({ label, value, icon }: KpiProps) {
  return (
    <View style={k.kpi}>
      <View style={k.kpiIcon}>
        <Ionicons name={icon} size={16} color={theme.colors.text2} />
      </View>
      <Text style={k.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={k.kpiValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
});

/* --------------------------------- screen --------------------------------- */

function ActivitiesTab() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [all, setAll] = useState<ActivityView[]>([]);

  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeKey>("28d");
  const [tag, setTag] = useState<TagKey>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await listActivities().catch(() => [] as any[]);
      const arr = Array.isArray(raw) ? raw : [];
      const views = arr.map(toView);

      // ✅ tri desc : dateMs puis fallback id
      views.sort((a, b) => {
        if (a.dateMs !== b.dateMs) return (b.dateMs || 0) - (a.dateMs || 0);
        return a.id < b.id ? 1 : -1;
      });

      setAll(views);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const ranged = useMemo(() => filterByRange(all, range), [all, range]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = ranged;

    if (tag !== "all") base = base.filter((a) => a.tag === tag);

    if (q) {
      base = base.filter((a) => {
        const blob = `${a.title} ${a.tag} ${a.km} ${a.paceTxt} ${a.dateISO}`.toLowerCase();
        return blob.includes(q);
      });
    }

    return base;
  }, [query, ranged, tag]);

  const kpis = useMemo(() => {
    const totalKm = filtered.reduce((s, a) => s + a.km, 0);
    const totalMin = filtered.reduce((s, a) => s + a.durationMin, 0);
    const count = filtered.length;

    const avg = count > 0 && totalKm > 0 ? totalMin / totalKm : 0;
    const avgMin = Math.floor(avg);
    const avgSec = Math.round((avg - avgMin) * 60);

    return {
      count,
      totalKm,
      totalMin,
      avgPaceTxt: count > 0 && totalKm > 0 ? `${avgMin}:${String(avgSec).padStart(2, "0")}/km` : "—",
    };
  }, [filtered]);

  const clearQuery = useCallback(() => setQuery(""), []);

  const openActivity = useCallback(
    (id: string) => {
      // ✅ pas de boucle vers soi-même
      // TODO: quand tu crées l'écran détail:
      // router.push({ pathname: "/activity/[id]", params: { id } });
      // Pour l'instant: noop ou toast plus tard
      return;
    },
    []
  );

  const onExport = useCallback(async () => {
    try {
      // ✅ évite d’envoyer 500KB+ en Share si historique énorme
      const max = 200;
      const exported = all.slice(0, max);

      const payload = {
        exportedAt: new Date().toISOString(),
        count: all.length,
        sampleCount: exported.length,
        activities: exported,
        note: all.length > max ? `Export tronqué à ${max} activités (évite un partage trop lourd).` : undefined,
      };

      await Share.share({
        message: JSON.stringify(payload, null, 2),
      });
    } catch {
      // silencieux
    }
  }, [all]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.wrap} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.headerRow}>
          <SectionTitle>Activités</SectionTitle>

          <Pressable onPress={onExport} hitSlop={10} style={({ pressed }) => [s.exportBtn, pressed && s.pressed]}>
            <Ionicons name="download-outline" size={18} color={theme.colors.text} />
            <Text style={s.exportBtnTxt}>Exporter</Text>
          </Pressable>
        </View>

        {/* Loading / Empty */}
        {loading ? (
          <Card>
            <View style={s.empty}>
              <Ionicons name="time-outline" size={20} color={theme.colors.text2} />
              <Text style={s.emptyTxt}>Chargement…</Text>
            </View>
          </Card>
        ) : null}

        {!loading && all.length === 0 ? (
          <Card>
            <View style={s.empty}>
              <Ionicons name="walk-outline" size={22} color={theme.colors.text2} />
              <Text style={s.emptyTxt}>Aucune activité pour l’instant.</Text>
            </View>
          </Card>
        ) : null}

        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons name="search-outline" size={18} color={theme.colors.text2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher (ex : longue, tempo, 10 km…)"
            placeholderTextColor={theme.colors.text2}
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={clearQuery} hitSlop={10} style={({ pressed }) => [s.clearBtn, pressed && s.pressed]}>
              <Ionicons name="close" size={18} color={theme.colors.text} />
            </Pressable>
          ) : null}
        </View>

        {/* Range chips */}
        <View style={s.chipsRow}>
          <Chip label="7 j" active={range === "7d"} onPress={() => setRange("7d")} />
          <Chip label="28 j" active={range === "28d"} onPress={() => setRange("28d")} />
          <Chip label="12 sem" active={range === "12w"} onPress={() => setRange("12w")} />
          <Chip label="Tout" active={range === "all"} onPress={() => setRange("all")} />
        </View>

        {/* Tag chips */}
        <View style={s.chipsRow}>
          <Chip label="Tous" active={tag === "all"} onPress={() => setTag("all")} />
          <Chip label="EF" active={tag === "EF"} onPress={() => setTag("EF")} />
          <Chip label="Tempo" active={tag === "Tempo"} onPress={() => setTag("Tempo")} />
          <Chip label="SL" active={tag === "SL"} onPress={() => setTag("SL")} />
          <Chip label="Frac" active={tag === "Frac"} onPress={() => setTag("Frac")} />
          <Chip label="Autre" active={tag === "Autre"} onPress={() => setTag("Autre")} />
        </View>

        {/* KPI période */}
        <View style={{ marginTop: 12 }}>
          <Card>
            <View style={s.periodRow}>
              <Kpi label="Séances" value={`${kpis.count}`} icon="stats-chart-outline" />
              <Kpi label="Distance" value={`${kpis.totalKm.toFixed(1)} km`} icon="walk-outline" />
              <Kpi label="Temps" value={fmtMin(kpis.totalMin)} icon="time-outline" />
              <Kpi label="Allure moy." value={kpis.avgPaceTxt} icon="speedometer-outline" />
            </View>
          </Card>
        </View>

        {/* List */}
        <View style={{ marginTop: 12 }}>
          {filtered.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => openActivity(a.id)}
              style={({ pressed }) => [s.rowPress, pressed && s.pressed]}
            >
              <Card>
                <View style={s.itemRow}>
                  <View style={[s.dot, { backgroundColor: toneColor(toneFromTag(a.tag)) }]} />

                  <View style={{ flex: 1 }}>
                    <View style={s.itemTopRow}>
                      <Text style={s.itemTitle} numberOfLines={1}>
                        {a.title}
                      </Text>

                      <View style={s.tagPill}>
                        <Text style={s.tagTxt}>{a.tag}</Text>
                      </View>
                    </View>

                    <Text style={s.itemMeta} numberOfLines={1}>
                      {a.km.toFixed(1)} km • {fmtMin(a.durationMin)} • {a.paceTxt}
                      {a.effort ? ` • ${a.effort}` : ""}
                    </Text>

                    <Text style={s.itemDate} numberOfLines={1}>
                      {a.dateISO}
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={theme.colors.text2} />
                </View>
              </Card>
            </Pressable>
          ))}

          {!loading && filtered.length === 0 && all.length > 0 ? (
            <Card>
              <View style={s.empty}>
                <Ionicons name="filter-outline" size={22} color={theme.colors.text2} />
                <Text style={s.emptyTxt}>Aucune activité ne correspond.</Text>
              </View>
            </Card>
          ) : null}
        </View>

        <Text style={s.hint}>Export : JSON (tronqué si énorme). Prochaine étape : CSV + écran détail activité.</Text>
      </ScrollView>
    </Screen>
  );
}

export default memo(ActivitiesTab);

/* --------------------------------- styles --------------------------------- */

const s = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 18, paddingBottom: 28 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  exportBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  exportBtnTxt: { color: theme.colors.text, fontWeight: "900" },

  searchRow: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontWeight: "800" },
  clearBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  chipsRow: { marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" },

  periodRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },

  rowPress: { marginBottom: 10 },

  itemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 99, marginTop: 2 },

  itemTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  itemTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16, flex: 1 },

  tagPill: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tagTxt: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },

  itemMeta: { marginTop: 6, color: theme.colors.text2, fontWeight: "800" },
  itemDate: { marginTop: 4, color: theme.colors.text2, fontWeight: "700", opacity: 0.85 },

  empty: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  emptyTxt: { color: theme.colors.text2, fontWeight: "800" },

  pressed: { opacity: 0.85 },

  hint: { marginTop: 10, color: theme.colors.text2, fontWeight: "700", lineHeight: 18 },
});

const c = StyleSheet.create({
  chip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipTxt: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },
  chipTxtActive: { color: "#000" },
});

const k = StyleSheet.create({
  kpi: {
    flexGrow: 1,
    minWidth: 130,
    paddingVertical: 6,
    gap: 4,
  },
  kpiIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 2,
  },
  kpiLabel: { color: theme.colors.text2, fontWeight: "800", fontSize: 12 },
  kpiValue: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
});
