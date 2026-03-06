// app/(tabs)/progress.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { theme } from "@/constants/theme";
import { Screen, Card } from "@/components/ui";
import {
  computeStats,
  type RangeKey,
  type Gauge as GaugeT,
  fmtDistanceKm,
  fmtElevation,
  fmtHoursMinutes,
} from "@/storage/stats";

/* --------------------------------- tokens -------------------------------- */

const TEXT_3 = "rgba(242,242,242,0.52)";
const BORDER_2 = "rgba(255,255,255,0.14)";
const DIVIDER = "rgba(255,255,255,0.18)";
const PRIMARY_A14 = "rgba(239,59,0,0.14)";
const PRIMARY_A24 = "rgba(239,59,0,0.24)";

/* --------------------------------- types --------------------------------- */

type Kpi = {
  label: string;
  value: string;
  sub?: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type Trophy = {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  isUnlocked: boolean;
  progressPct?: number; // 0..100 for locked
  icon: keyof typeof Ionicons.glyphMap;
  category?: "distance" | "dplus" | "streak" | "consistency" | "plans" | "health" | "special";
};

type RecentUnlock = {
  id: string;
  name: string;
  dateLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  rarity: Trophy["rarity"];
};

/* -------------------------------- helpers -------------------------------- */

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function rarityBadge(r: Trophy["rarity"]) {
  switch (r) {
    case "legendary":
      return "Légendaire";
    case "epic":
      return "Épique";
    case "rare":
      return "Rare";
    default:
      return "Commun";
  }
}

/** DA-safe rarity styling: no custom palette, only border weight / subtle accents */
function rarityStyle(r: Trophy["rarity"]) {
  switch (r) {
    case "legendary":
      return { borderWidth: 1.5, borderColor: BORDER_2 };
    case "epic":
      return { borderWidth: 1.25, borderColor: BORDER_2 };
    case "rare":
      return { borderWidth: 1.1, borderColor: BORDER_2 };
    default:
      return { borderWidth: 1, borderColor: theme.colors.border };
  }
}

function toastRarityStyle(r: Trophy["rarity"]) {
  // DA-safe : fond subtil + bordures
  if (r === "legendary") return { bg: "rgba(255,215,0,0.14)", bd: "rgba(255,215,0,0.28)" };
  if (r === "epic") return { bg: "rgba(160, 90, 255, 0.12)", bd: "rgba(160, 90, 255, 0.26)" };
  if (r === "rare") return { bg: "rgba(80, 200, 255, 0.10)", bd: "rgba(80, 200, 255, 0.22)" };
  return { bg: "rgba(255,255,255,0.06)", bd: BORDER_2 };
}

/* ----------------------------- small ui parts ----------------------------- */

function SectionHeader({
  title,
  rightLabel,
  onPressRight,
}: {
  title: string;
  rightLabel?: string;
  onPressRight?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!rightLabel && !!onPressRight && (
        <Pressable onPress={onPressRight} style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
          <Text style={styles.sectionActionText}>{rightLabel}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

function Segmented({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  const items: { key: RangeKey; label: string }[] = [
    { key: "7d", label: "7j" },
    { key: "28d", label: "28j" },
    { key: "12w", label: "12 sem" },
    { key: "all", label: "Tout" },
  ];

  return (
    <View style={styles.segmentWrap}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={({ pressed }) => [styles.segmentItem, active && styles.segmentItemActive, pressed && styles.pressed]}
            hitSlop={8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{it.label}</Text>
            {active ? <View style={styles.segmentUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: GaugeT["tone"] }) {
  const clamped = clamp(pct, 0, 100);
  const barColor =
    tone === "green"
      ? theme.colors.success
      : tone === "orange"
      ? theme.colors.primary
      : tone === "red"
      ? theme.colors.danger
      : theme.colors.text2;

  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${clamped}%`, backgroundColor: barColor }]} />
    </View>
  );
}

function GaugeCard({ g }: { g: GaugeT }) {
  return (
    <Card style={styles.gaugeCard}>
      <View style={styles.gaugeTop}>
        <Text style={styles.gaugeLabel}>{g.label}</Text>

        <View style={styles.gaugeValueRow}>
          <Text style={styles.gaugeValue}>{Math.round(g.value)}</Text>
          {g.tone === "orange" ? <View style={styles.orangeDot} /> : null}
        </View>
      </View>

      <ProgressBar pct={g.value} tone={g.tone} />

      {!!g.hint && <Text style={styles.gaugeHint}>{g.hint}</Text>}
    </Card>
  );
}

function KpiCard({ k }: { k: Kpi }) {
  return (
    <Card style={styles.kpiCard}>
      <View style={styles.kpiTop}>
        <Ionicons name={k.icon} size={18} color={theme.colors.primary} />
        <Text style={styles.kpiLabel}>{k.label}</Text>
      </View>
      <Text style={styles.kpiValue}>{k.value}</Text>
      {!!k.sub && <Text style={styles.kpiSub}>{k.sub}</Text>}
    </Card>
  );
}

function ChartPlaceholder({
  title,
  subtitle,
  rightLabel,
  onPressRight,
}: {
  title: string;
  subtitle: string;
  rightLabel?: string;
  onPressRight?: () => void;
}) {
  return (
    <Card style={styles.chartCard}>
      <View style={styles.chartHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.chartTitle}>{title}</Text>
          <Text style={styles.chartSub}>{subtitle}</Text>
        </View>

        {!!rightLabel && !!onPressRight && (
          <Pressable onPress={onPressRight} style={({ pressed }) => [styles.chartAction, pressed && styles.pressed]}>
            <Text style={styles.chartActionText}>{rightLabel}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
          </Pressable>
        )}
      </View>

      <View style={styles.chartBox}>
        <View style={styles.chartBadge}>
          <Ionicons name="flash-outline" size={14} color={theme.colors.primary} />
          <Text style={styles.chartBadgeText}>Tendance</Text>
        </View>
        <Text style={styles.chartHint}>Graphique (à brancher) — charge / semaines</Text>
      </View>
    </Card>
  );
}

/* --------------------------- Xbox-style unlock toast ----------------------- */

type UnlockToast = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  rarity: Trophy["rarity"];
};

function useUnlockToast() {
  const [toast, setToast] = useState<UnlockToast | null>(null);

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const animateIn = useCallback(() => {
    opacity.stopAnimation();
    scale.stopAnimation();
    opacity.setValue(0);
    scale.setValue(0.92);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 18, bounciness: 8, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale]);

  const animateOut = useCallback(
    (onDone?: () => void) => {
      opacity.stopAnimation();
      scale.stopAnimation();

      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.98, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onDone?.();
      });
    },
    [opacity, scale]
  );

  const show = useCallback(
    (t: UnlockToast) => {
      clearTimer();
      setToast(t);
      animateIn();

      timer.current = setTimeout(() => {
        animateOut(() => setToast(null));
      }, 1600);
    },
    [animateIn, animateOut, clearTimer]
  );

  const dismiss = useCallback(() => {
    clearTimer();
    animateOut(() => setToast(null));
  }, [animateOut, clearTimer]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return useMemo(() => ({ toast, opacity, scale, show, dismiss }), [toast, opacity, scale, show, dismiss]);
}

/* -------------------------------- trophies ui ----------------------------- */

function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]}>
      <Text style={[styles.filterChipTxt, active && styles.filterChipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function TrophyMini({ t, onPress }: { t: Trophy; onPress: () => void }) {
  const locked = !t.isUnlocked;

  const nameColor = locked ? TEXT_3 : theme.colors.text;
  const iconColor = locked ? TEXT_3 : theme.colors.text;
  const pctColor = locked ? theme.colors.primary : theme.colors.text2;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.trophyMini, rarityStyle(t.rarity), pressed && styles.pressed]}>
      <View style={styles.trophyIconWrap}>
        <Ionicons name={t.icon} size={18} color={iconColor} />
      </View>

      <Text style={[styles.trophyMiniName, { color: nameColor }]} numberOfLines={1}>
        {t.isUnlocked ? t.name : "???"}
      </Text>

      {locked ? (
        <Text style={[styles.trophyMiniProgress, { color: pctColor }]}>{Math.round(t.progressPct ?? 0)}%</Text>
      ) : (
        <View style={styles.trophyUnlockedRow}>
          {t.rarity === "legendary" ? <Ionicons name="sparkles-outline" size={14} color={theme.colors.primary} /> : null}
          <Text style={styles.trophyMiniUnlocked}>{rarityBadge(t.rarity)}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* --------------------------------- screen -------------------------------- */

function ProgressScreen() {
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>("28d");

  const { toast, opacity, scale, show, dismiss } = useUnlockToast();

  // ---- data loading (from storage/stats.ts) ----
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [gauges, setGauges] = useState<GaugeT[]>([
    { label: "Forme", value: 0, tone: "slate" },
    { label: "Fatigue", value: 0, tone: "slate" },
    { label: "Charge", value: 0, tone: "slate" },
  ]);

  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [coachInsights, setCoachInsights] = useState<string[]>([]);
  const [periodLabel, setPeriodLabel] = useState<string>("");

  const refresh = useCallback(
    async (why: "init" | "range") => {
      setLoading(true);
      setErr(null);

      try {
        const res = await computeStats(range);

        setGauges(res.gauges);

        const s = res.summary;
        setPeriodLabel(`${s.fromISO} → ${s.toISO}`);

        setKpis([
          { label: "Distance", value: fmtDistanceKm(s.distanceKm), sub: "sur la période", icon: "map-outline" },
          { label: "Temps", value: fmtHoursMinutes(s.durationMin), sub: "temps de course", icon: "time-outline" },
          { label: "D+", value: fmtElevation(s.elevationGainM), sub: "cumul", icon: "trending-up-outline" },
          { label: "Séances", value: `${s.sessions}`, sub: "complétées", icon: "checkmark-done-outline" },
        ]);

        const ratio = s.load.ratio;
        const acute = Math.round(s.load.acute7d);
        const chronic = Math.round(s.load.chronicWeekly);

        const base = [
          `Décision simple : vise la régularité (2 EF + 1 séance clé).`,
          `Règle de sécurité : évite un pic de charge > +20% semaine.`,
          `Charge 7j ≈ ${acute} • chronique hebdo ≈ ${chronic} • ratio ≈ ${ratio.toFixed(2)}`,
        ];

        const adapt =
          ratio >= 1.2
            ? ["Aujourd’hui : alléger (EF / repos) pour revenir sous contrôle."]
            : ratio <= 0.85
            ? ["Tu récupères bien : tu peux remonter doucement si tout va bien."]
            : ["C’est propre : continue sans forcer, garde de la marge."];

        setCoachInsights([...base, ...adapt]);

        if (why === "range") show({ name: "Analyse mise à jour", icon: "flash-outline", rarity: "common" });
      } catch (e: any) {
        setErr(e?.message ? String(e.message) : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    },
    [range, show]
  );

  useEffect(() => {
    refresh("init");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh("range");
  }, [range, refresh]);

  // ---- trophies (mock for now) ----
  const trophySummary = useMemo(() => ({ unlocked: 37, total: 100 }), []);
  const [trophyFilter, setTrophyFilter] = useState<"all" | "locked" | "unlocked">("all");

  const trophiesMini = useMemo<Trophy[]>(() => {
    return [
      { id: "t1", name: "Première séance", rarity: "common", isUnlocked: true, icon: "ribbon-outline", category: "special" },
      { id: "t2", name: "100 km cumulés", rarity: "rare", isUnlocked: false, progressPct: 62, icon: "navigate-outline", category: "distance" },
      { id: "t3", name: "5 000 m D+", rarity: "rare", isUnlocked: false, progressPct: 91, icon: "trail-sign-outline", category: "dplus" },
      { id: "t4", name: "Métronome", rarity: "epic", isUnlocked: false, progressPct: 24, icon: "pulse-outline", category: "consistency" },
      { id: "t5", name: "Sortie longue 1h30", rarity: "common", isUnlocked: true, icon: "hourglass-outline", category: "plans" },
      { id: "t6", name: "Semaine parfaite", rarity: "rare", isUnlocked: false, progressPct: 71, icon: "calendar-outline", category: "streak" },
      { id: "t7", name: "Charge maîtrisée", rarity: "epic", isUnlocked: false, progressPct: 36, icon: "options-outline", category: "health" },
      { id: "t8", name: "1 000 km", rarity: "legendary", isUnlocked: false, progressPct: 13, icon: "trophy-outline", category: "distance" },
      { id: "t9", name: "Affûtage réussi", rarity: "epic", isUnlocked: false, progressPct: 0, icon: "sparkles-outline", category: "plans" },
      { id: "t10", name: "Saison saine", rarity: "rare", isUnlocked: false, progressPct: 58, icon: "heart-outline", category: "health" },
      { id: "t11", name: "20 km / semaine", rarity: "common", isUnlocked: true, icon: "speedometer-outline", category: "consistency" },
      { id: "t12", name: "Confiance", rarity: "rare", isUnlocked: false, progressPct: 44, icon: "hand-left-outline", category: "special" },
    ];
  }, []);

  const trophiesFiltered = useMemo(() => {
    let arr = trophiesMini;
    if (trophyFilter === "locked") arr = arr.filter((t) => !t.isUnlocked);
    if (trophyFilter === "unlocked") arr = arr.filter((t) => t.isUnlocked);

    const locked = arr.filter((t) => !t.isUnlocked).sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0));
    const unlocked = arr.filter((t) => t.isUnlocked);
    return [...unlocked, ...locked].slice(0, 12);
  }, [trophiesMini, trophyFilter]);

  const recentUnlocks = useMemo<RecentUnlock[]>(() => {
    return [
      { id: "r1", name: "Sortie longue 1h30", dateLabel: "20 janv. 2026", icon: "hourglass-outline", rarity: "common" },
      { id: "r2", name: "20 km / semaine", dateLabel: "18 janv. 2026", icon: "speedometer-outline", rarity: "common" },
      { id: "r3", name: "Première séance", dateLabel: "02 janv. 2026", icon: "ribbon-outline", rarity: "common" },
    ];
  }, []);

  const onOpenTrophies = useCallback(() => {
    show({ name: "Écran trophées à brancher", icon: "trophy-outline", rarity: "rare" });
  }, [show]);

  const onOpenTrophyDetail = useCallback(
    (t: Trophy) => {
      if (!t.isUnlocked) show({ name: `Progression : ${Math.round(t.progressPct ?? 0)}%`, icon: t.icon, rarity: t.rarity });
      else show({ name: `Débloqué : ${t.name}`, icon: t.icon, rarity: t.rarity });
    },
    [show]
  );

  return (
    <Screen>
      {/* Toast centre écran “Succès débloqué” */}
      {toast ? (
        <Pressable onPress={dismiss} style={toastStyles.overlay}>
          <Animated.View style={[toastStyles.toast, { opacity, transform: [{ scale }] }]}>
            <View style={toastStyles.toastIconWrap}>
              <Ionicons name={toast.icon} size={22} color={theme.colors.text} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={toastStyles.toastTitle}>Succès</Text>
              <Text style={toastStyles.toastName} numberOfLines={1}>
                {toast.name}
              </Text>
            </View>

            {(() => {
              const rs = toastRarityStyle(toast.rarity);
              return (
                <View style={[toastStyles.rarityPill, { backgroundColor: rs.bg, borderColor: rs.bd }]}>
                  <Text style={toastStyles.rarityTxt}>{toast.rarity.toUpperCase()}</Text>
                </View>
              );
            })()}
          </Animated.View>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.title}>Progrès</Text>
            <Text style={styles.subtitle}>Tendances utiles • pas de bruit • décisions plus sûres</Text>
            {!!periodLabel && <Text style={styles.period}>{periodLabel}</Text>}
          </View>

          <Pressable onPress={() => router.push("/chat")} style={({ pressed }) => [styles.headerCoachBtn, pressed && styles.pressed]} hitSlop={10}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.primary} />
          </Pressable>
        </View>

        {/* Range */}
        <Segmented value={range} onChange={setRange} />

        {/* Error / Loading */}
        {err ? (
          <Card style={styles.stateCard}>
            <View style={styles.stateRow}>
              <Ionicons name="warning-outline" size={18} color={theme.colors.primary} />
              <Text style={styles.stateTitle}>Impossible de calculer les stats</Text>
            </View>
            <Text style={styles.stateText}>{err}</Text>

            <Pressable onPress={() => refresh("init")} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
              <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
              <Text style={styles.retryTxt}>Réessayer</Text>
            </Pressable>
          </Card>
        ) : null}

        {loading ? (
          <Card style={styles.stateCard}>
            <View style={styles.stateRow}>
              <ActivityIndicator />
              <Text style={styles.stateTitle}>Analyse…</Text>
            </View>
            <Text style={styles.stateText}>On consolide ta période et ta charge récente.</Text>
          </Card>
        ) : null}

        {/* Gauges */}
        <View style={styles.grid3}>
          {gauges.map((g) => (
            <GaugeCard key={g.label} g={g} />
          ))}
        </View>

        {/* Chart */}
        <SectionHeader title="Charge & tendances" />
        <ChartPlaceholder
          title="Charge d’entraînement"
          subtitle="Vue période sélectionnée"
          rightLabel="Détails"
          onPressRight={() => show({ name: "Graphique hebdo à brancher (weeks)", icon: "stats-chart-outline", rarity: "common" })}
        />

        {/* KPIs */}
        <SectionHeader title="Stats clés" />
        <View style={styles.kpiGrid}>
          {kpis.map((k) => (
            <KpiCard key={k.label} k={k} />
          ))}
        </View>

        {/* Trophies */}
        <SectionHeader title="Trophées" rightLabel={`${trophySummary.unlocked} / ${trophySummary.total} • Voir tous`} onPressRight={onOpenTrophies} />

        <Card style={styles.trophyCard}>
          <View style={styles.trophyTopRow}>
            <Text style={styles.trophyHeadline}>Collection</Text>

            <View style={styles.trophyProgressWrap}>
              <Text style={styles.trophyProgressText}>
                {trophySummary.unlocked} / {trophySummary.total}
              </Text>
              <Ionicons name="trophy-outline" size={16} color={theme.colors.primary} />
            </View>
          </View>

          <View style={styles.trophyFilters}>
            <FilterChip label="Tous" active={trophyFilter === "all"} onPress={() => setTrophyFilter("all")} />
            <FilterChip label="À débloquer" active={trophyFilter === "locked"} onPress={() => setTrophyFilter("locked")} />
            <FilterChip label="Débloqués" active={trophyFilter === "unlocked"} onPress={() => setTrophyFilter("unlocked")} />
          </View>

          <View style={styles.trophyMiniGrid}>
            {trophiesFiltered.map((t) => (
              <TrophyMini key={t.id} t={t} onPress={() => onOpenTrophyDetail(t)} />
            ))}
          </View>

          <Pressable onPress={onOpenTrophies} style={({ pressed }) => [styles.trophyCta, pressed && styles.pressed]}>
            <Text style={styles.trophyCtaText}>Voir la liste complète</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
          </Pressable>
        </Card>

        {/* Recent unlocks */}
        <SectionHeader title="Succès récents" />
        <Card style={styles.recentCard}>
          {recentUnlocks.map((r, idx) => (
            <View key={r.id} style={[styles.recentRow, idx > 0 && styles.recentRowBorder]}>
              <View style={styles.recentLeft}>
                <View style={styles.recentIcon}>
                  <Ionicons name={r.icon} size={18} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentTitle}>{r.name}</Text>
                  <Text style={styles.recentSub}>{r.dateLabel}</Text>
                </View>
              </View>
              <Text style={styles.recentTag}>{rarityBadge(r.rarity)}</Text>
            </View>
          ))}
        </Card>

        {/* Coach */}
        <SectionHeader title="Coach" rightLabel="Détails" onPressRight={() => router.push("/chat")} />
        <Card style={styles.insightCard}>
          {coachInsights.map((s, i) => (
            <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: 10 }]}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{s}</Text>
            </View>
          ))}

          <View style={styles.coachCtas}>
            <Pressable onPress={() => router.push("/chat")} style={({ pressed }) => [styles.coachBtn, pressed && styles.pressed]} hitSlop={8}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.colors.text} />
              <Text style={styles.coachBtnTxt}>Demander au coach</Text>
            </Pressable>

            <Pressable
              onPress={() => show({ name: "Règles de sécurité (bientôt)", icon: "shield-checkmark-outline", rarity: "common" })}
              style={({ pressed }) => [styles.coachBtnGhost, pressed && styles.pressed]}
              hitSlop={8}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.primary} />
              <Text style={styles.coachBtnGhostTxt}>Règles</Text>
            </Pressable>
          </View>
        </Card>

        <View style={{ height: 20 }} />
      </ScrollView>
    </Screen>
  );
}

export default memo(ProgressScreen);

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 28, gap: 12 },
  pressed: { opacity: 0.85 },

  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.2 },
  subtitle: { marginTop: 4, fontSize: 13, color: theme.colors.text2, maxWidth: 340, lineHeight: 18 },
  period: { marginTop: 6, fontSize: 12, color: TEXT_3, fontWeight: "700" },

  headerCoachBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: BORDER_2,
  },

  sectionHeader: { marginTop: 6, marginBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  sectionAction: { flexDirection: "row", gap: 6, alignItems: "center" },
  sectionActionText: { fontSize: 13, color: theme.colors.primary, fontWeight: "800" },

  segmentWrap: {
    flexDirection: "row",
    backgroundColor: theme.colors.card,
    borderColor: BORDER_2,
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
    gap: 6,
  },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative" },
  segmentItemActive: { backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  segmentText: { fontSize: 13, color: theme.colors.text2, fontWeight: "800" },
  segmentTextActive: { color: theme.colors.text },
  segmentUnderline: { position: "absolute", bottom: 4, height: 2, width: 22, borderRadius: 2, backgroundColor: theme.colors.primary },

  stateCard: { padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2, gap: 10 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stateTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 13 },
  stateText: { color: theme.colors.text2, fontWeight: "700", fontSize: 12, lineHeight: 16 },

  retryBtn: {
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  retryTxt: { color: theme.colors.text, fontWeight: "900" },

  grid3: { flexDirection: "row", gap: 10 },
  gaugeCard: { flex: 1, padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  gaugeTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
  gaugeLabel: { fontSize: 12, color: theme.colors.text2, fontWeight: "800" },
  gaugeValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  gaugeValue: { fontSize: 18, color: theme.colors.text, fontWeight: "900" },
  orangeDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: theme.colors.primary },
  gaugeHint: { marginTop: 8, fontSize: 12, color: TEXT_3, lineHeight: 16, fontWeight: "700" },

  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER_2,
  },
  barFill: { height: 8, borderRadius: 999 },

  chartCard: { padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  chartTitle: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  chartSub: { marginTop: 2, fontSize: 12, color: theme.colors.text2 },
  chartAction: { flexDirection: "row", gap: 6, alignItems: "center" },
  chartActionText: { fontSize: 13, color: theme.colors.primary, fontWeight: "800" },
  chartBox: {
    marginTop: 10,
    height: 140,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_2,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  chartBadge: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: PRIMARY_A14,
    borderWidth: 1,
    borderColor: PRIMARY_A24,
  },
  chartBadgeText: { color: theme.colors.primary, fontWeight: "900", fontSize: 12 },
  chartHint: { fontSize: 12, color: theme.colors.text2, fontWeight: "700" },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpiCard: { width: "48.5%", padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  kpiTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  kpiLabel: { fontSize: 12, color: theme.colors.text2, fontWeight: "800" },
  kpiValue: { marginTop: 8, fontSize: 22, color: theme.colors.text, fontWeight: "900", letterSpacing: -0.2 },
  kpiSub: { marginTop: 2, fontSize: 12, color: TEXT_3, fontWeight: "700" },

  trophyCard: { padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  trophyTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  trophyHeadline: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  trophyProgressWrap: { flexDirection: "row", gap: 6, alignItems: "center" },
  trophyProgressText: { fontSize: 12, color: theme.colors.text2, fontWeight: "800" },

  trophyFilters: { flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  filterChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER_2,
  },
  filterChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterChipTxt: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },
  filterChipTxtActive: { color: "#000" },

  trophyMiniGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  trophyMini: { width: "31.5%", padding: 10, borderRadius: 14, backgroundColor: theme.colors.background, gap: 6 },

  trophyIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  trophyMiniName: { fontSize: 12, fontWeight: "900" },
  trophyMiniProgress: { fontSize: 12, fontWeight: "900" },
  trophyUnlockedRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  trophyMiniUnlocked: { fontSize: 12, color: theme.colors.text2, fontWeight: "800" },

  trophyCta: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trophyCtaText: { fontSize: 13, color: theme.colors.primary, fontWeight: "900" },

  recentCard: { padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2, gap: 10 },
  recentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  recentRowBorder: { borderTopWidth: 1, borderTopColor: DIVIDER, paddingTop: 12 },
  recentLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  recentIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: PRIMARY_A14,
    borderWidth: 1,
    borderColor: PRIMARY_A24,
    alignItems: "center",
    justifyContent: "center",
  },
  recentTitle: { fontSize: 13, fontWeight: "900", color: theme.colors.text },
  recentSub: { marginTop: 2, fontSize: 12, color: TEXT_3, fontWeight: "700" },
  recentTag: { fontSize: 12, color: theme.colors.primary, fontWeight: "900" },

  insightCard: { padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: BORDER_2 },
  bulletRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bulletDot: { marginTop: 7, width: 6, height: 6, borderRadius: 999, backgroundColor: theme.colors.primary },
  bulletText: { flex: 1, fontSize: 13, color: theme.colors.text, lineHeight: 18, fontWeight: "700" },

  coachCtas: { marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  coachBtn: {
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachBtnTxt: { color: theme.colors.text, fontWeight: "900" },

  coachBtnGhost: {
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_2,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachBtnGhostTxt: { color: theme.colors.primary, fontWeight: "900" },
});

const toastStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    zIndex: 999,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  toast: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  toastIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toastTitle: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },
  toastName: { color: theme.colors.text, fontWeight: "900", fontSize: 16, marginTop: 1 },
  rarityPill: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rarityTxt: { color: theme.colors.text, fontWeight: "900", fontSize: 11 },
});
