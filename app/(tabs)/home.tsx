// app/(tabs)/home.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { theme } from "@/constants/theme";
import { Screen, Card } from "@/components/ui";
import ActivityRow from "@/components/ActivityRow";
import WorkoutTodayCard from "@/components/WorkoutTodayCard";

import * as onboarding from "@/storage/onboarding";
import { ensureWeeklyPlan } from "@/coaching/planService";
import { fetchWeeklyWeather, type WeatherIcon } from "@/services/weather";
import { listActivities, type Activity } from "@/storage/activities";
import { toActivityItem } from "@/storage/activityItemMapper";
import type { WeeklyPlan, WeeklyPlanDay } from "@/storage/weeklyPlan";

import { isPostSessionPending, shouldShowDailyCheckin } from "@/storage/checkins";

/* ---------------------------------- utils --------------------------------- */

const DOW = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"] as const;
const DOW_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

const weatherIconMap: Record<WeatherIcon, keyof typeof Ionicons.glyphMap> = {
  sunny: "sunny-outline",
  partly: "partly-sunny-outline",
  rain: "rainy-outline",
  cloud: "cloud-outline",
  storm: "thunderstorm-outline",
};

function todayIndexMon0() {
  const js = new Date().getDay(); // 0=dim..6=sam
  return js === 0 ? 6 : js - 1;
}

function extractFirstName(ob: any): string {
  const raw =
    ob?.profile?.firstName ??
    ob?.profile?.name ??
    ob?.user?.firstName ??
    ob?.user?.name ??
    ob?.name ??
    "Athlète";

  const s = String(raw).trim();
  if (!s) return "Athlète";
  return s.split(" ")[0] ?? s;
}

function firstLine(s?: string) {
  const t = (s ?? "").trim();
  if (!t) return "";
  return t.split("\n")[0] ?? "";
}

function workoutLabel(w?: string) {
  const t = (w ?? "").toLowerCase();
  if (!t) return "—";
  if (t.includes("repos")) return "Repos";
  if (t.includes("renfo")) return "Renfo";
  if (t.includes("vélo") || t.includes("velo")) return "Vélo";
  if (t.includes("fraction")) return "Fractionné";
  if (t.includes("seuil")) return "Seuil";
  if (t.includes("long")) return "Sortie longue";
  if (t.includes("ef") || t.includes("footing") || t.includes("endurance")) return "Footing";
  return w ?? "Séance";
}

function workoutCode(workout?: string) {
  const t = (workout ?? "").toLowerCase();
  if (!t) return "--";
  if (t.includes("repos")) return "RE";
  if (t.includes("renfo")) return "RF";
  if (t.includes("vélo") || t.includes("velo")) return "VE";
  if (t.includes("fraction")) return "FR";
  if (t.includes("seuil")) return "SE";
  if (t.includes("long") || t.includes("sortie longue")) return "SL";
  if (t.includes("footing") || t.includes("ef") || t.includes("endurance")) return "EF";
  return "TR";
}

function pillAccent(workout?: string) {
  const t = (workout ?? "").toLowerCase();
  if (t.includes("repos") || t.includes("renfo") || t.includes("vélo") || t.includes("velo")) {
    return { bg: "rgba(149,165,166,0.14)", bd: "rgba(149,165,166,0.28)" };
  }
  if (t.includes("seuil")) return { bg: "rgba(70,120,255,0.16)", bd: "rgba(70,120,255,0.30)" };
  if (t.includes("fraction")) return { bg: "rgba(160,90,255,0.16)", bd: "rgba(160,90,255,0.30)" };
  if (t.includes("long")) return { bg: "rgba(239,59,0,0.16)", bd: "rgba(239,59,0,0.30)" };
  return { bg: "rgba(70,200,120,0.14)", bd: "rgba(70,200,120,0.28)" };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function sortActivitiesMostRecentFirst(a: Activity, b: Activity) {
  // ✅ patch: Activity V2 n'a pas startTime -> on utilise updatedAt/createdAt
  const at = Number.isFinite(a.updatedAt) ? a.updatedAt : a.createdAt;
  const bt = Number.isFinite(b.updatedAt) ? b.updatedAt : b.createdAt;
  return bt - at;
}

/* ------------------------ measure / anchor helpers ------------------------ */

type Rect = { x: number; y: number; width: number; height: number };

function measureInWindow(ref: React.RefObject<View>, cb: (r: Rect) => void) {
  const node = ref.current as any;
  if (!node?.measureInWindow) return;
  node.measureInWindow((x: number, y: number, width: number, height: number) => cb({ x, y, width, height }));
}

/* ---------------------- single tap vs double tap hook ---------------------- */
/**
 * - single tap déclenche après delayMs (si pas de 2e tap)
 * - double tap déclenche immédiatement et annule le single
 */
function useTapHandlers(delayMs = 240) {
  const lastTapRef = useRef(0);
  const singleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTap = useCallback(
    (single: () => void, dbl: () => void) => {
      const now = Date.now();
      const last = lastTapRef.current;

      if (now - last < delayMs) {
        lastTapRef.current = 0;
        if (singleTimerRef.current) {
          clearTimeout(singleTimerRef.current);
          singleTimerRef.current = null;
        }
        dbl();
        return;
      }

      lastTapRef.current = now;
      if (singleTimerRef.current) clearTimeout(singleTimerRef.current);

      singleTimerRef.current = setTimeout(() => {
        singleTimerRef.current = null;
        single();
      }, delayMs + 10);
    },
    [delayMs]
  );

  useEffect(() => {
    return () => {
      if (singleTimerRef.current) clearTimeout(singleTimerRef.current);
    };
  }, []);

  return { onTap };
}

/* ------------------------------ toast success ------------------------------ */

type AchievementToast = {
  title: string;
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rarity?: "common" | "rare" | "epic" | "legendary";
};

function rarityStyle(r?: AchievementToast["rarity"]) {
  const rr = r ?? "common";
  switch (rr) {
    case "legendary":
      return { bg: "rgba(255,215,0,0.16)", border: "rgba(255,215,0,0.35)" };
    case "epic":
      return { bg: "rgba(160, 90, 255, 0.14)", border: "rgba(160, 90, 255, 0.35)" };
    case "rare":
      return { bg: "rgba(80, 200, 255, 0.12)", border: "rgba(80, 200, 255, 0.30)" };
    case "common":
    default:
      return { bg: "rgba(255,255,255,0.06)", border: theme.colors.border };
  }
}

function useCenterToast() {
  const [toast, setToast] = useState<AchievementToast | null>(null);

  // ✅ Animated values stables
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
    (t: AchievementToast) => {
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
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  // ✅ PATCH CRITIQUE: retourne un objet memoïsé (évite deps qui changent à chaque render)
  return useMemo(() => ({ toast, opacity, scale, show, dismiss }), [toast, opacity, scale, show, dismiss]);
}

/* ------------------------------ Peek overlay ------------------------------ */

type PeekState =
  | null
  | {
      kind: "workout" | "day" | "activity";
      anchor: Rect;
      dayIndex?: number;
    };

function peekTitle(kind: NonNullable<PeekState>["kind"], dayIndex?: number) {
  if (kind === "workout") return "Aperçu — Séance du jour";
  if (kind === "activity") return "Aperçu — Dernière sortie";
  return `Aperçu — ${dayIndex !== undefined ? DOW_FULL[dayIndex] : "Jour"}`;
}

function coachWhyText(day?: WeeklyPlanDay | null) {
  const w = (day?.workout ?? "").toLowerCase();
  if (!w) return "→ On garde la continuité, sans forcer.";
  if (w.includes("repos")) return "→ Ton corps assimile. Repos = progression.";
  if (w.includes("long")) return "→ Construire l’endurance et la confiance.";
  if (w.includes("fraction")) return "→ Stimuler la vitesse sans te cramer.";
  if (w.includes("seuil")) return "→ Améliorer l’allure tenable, proprement.";
  return "→ Séance alignée sur la phase et ta forme.";
}

/* -------------------------------- component -------------------------------- */

export default memo(function Home() {
  const router = useRouter();
  const { onTap } = useTapHandlers(240);

  // ✅ PATCH: on destructure pour deps stables
  const { toast, opacity, scale, show, dismiss } = useCenterToast();

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [weather, setWeather] = useState<any>(null);
  const [onb, setOnb] = useState<any>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [peek, setPeek] = useState<PeekState>(null);

  // anchors (peek)
  const workoutAnchorRef = useRef<View>(null);
  const activityAnchorRef = useRef<View>(null);
  const dayRefs = useRef<Array<View | null>>([]);

  // tes sorties : déplier / replier
  const [showMoreRuns, setShowMoreRuns] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, w, o, a] = await Promise.all([
        ensureWeeklyPlan().catch(() => null),
        fetchWeeklyWeather({ timezone: "Europe/Paris" }).catch(() => null),
        onboarding.loadOnboarding().catch(() => null),
        listActivities().catch(() => [] as Activity[]),
      ]);

      setPlan(p);
      setWeather(w);
      setOnb(o);
      setActivities(a);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ Un seul useFocusEffect : checkins -> sinon load()
  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      (async () => {
        if (await isPostSessionPending()) {
          if (!mounted) return;
          router.push("/checkins/postSession");
          return;
        }

        if (await shouldShowDailyCheckin()) {
          if (!mounted) return;
          router.push("/checkins/daily");
          return;
        }

        if (!mounted) return;
        await load();
      })().catch(() => {});

      return () => {
        mounted = false;
      };
    }, [router, load])
  );

  const firstName = useMemo(() => extractFirstName(onb), [onb]);
  const todayIdx = useMemo(() => todayIndexMon0(), []);
  const days = plan?.days ?? [];
  const todayDay = days[todayIdx] ?? null;
  const wxDays = weather?.days ?? [];

  // ✅ PATCH: activité la plus récente (pas startTime)
  const sortedActivities = useMemo(() => activities.slice().sort(sortActivitiesMostRecentFirst), [activities]);
  const lastActivity = sortedActivities[0] ?? null;

  const expandedCount = 3;
  const expandedRuns = useMemo(() => sortedActivities.slice(0, expandedCount), [sortedActivities]);

  // ✅ éviter de recalculer 5 fois dans le peek
  const lastActivityItem = useMemo(() => (lastActivity ? toActivityItem(lastActivity) : null), [lastActivity]);

  // navigation
  const goPlanDay = useCallback(
    (idx: number) => router.push({ pathname: "/(tabs)/plan", params: { dayIndex: String(idx) } }),
    [router]
  );
  const goPlanToday = useCallback(() => router.push({ pathname: "/(tabs)/plan", params: { focus: "today" } }), [router]);
  const goMapToday = useCallback(() => router.push({ pathname: "/(tabs)/map", params: { mode: "today" } }), [router]);
  const goActivities = useCallback(() => router.push("/(tabs)/activities"), [router]);

  // Moment fierté
  const pride = useMemo(
    () => ({
      title: "Moment fierté",
      line1: "Régularité validée",
      line2: "Tu as respecté ton rythme — c’est ça qui fait progresser.",
    }),
    []
  );

  const onSharePride = useCallback(() => {
    show({ title: "Partage (bientôt)", name: "Export carte fierté", icon: "share-social-outline", rarity: "common" });
  }, [show]);

  /* ----------------------------- Peek renderer ------------------------------ */

  const renderPeek = () => {
    if (!peek) return null;

    const width = clamp(peek.anchor.width, 220, 380);

    // ✅ PATCH: position stable (évite “jump”)
    const left = clamp(peek.anchor.x, 12, Math.max(12, peek.anchor.x + peek.anchor.width - width));
    const top = Math.max(12, peek.anchor.y - 156);

    const w =
      peek.kind === "workout"
        ? todayDay
        : peek.kind === "day"
        ? peek.dayIndex !== undefined
          ? days[peek.dayIndex]
          : null
        : null;

    const title = peekTitle(peek.kind, peek.dayIndex);

    const main =
      peek.kind === "activity"
        ? lastActivityItem?.title?.trim()
          ? lastActivityItem.title
          : lastActivity
          ? "Sortie"
          : "Aucune activité"
        : `${workoutLabel(w?.workout)}`;

    const sub =
      peek.kind === "activity"
        ? lastActivityItem
          ? `${lastActivityItem.subtitle ?? ""}${lastActivityItem.meta ? " • " + lastActivityItem.meta : ""}`.trim()
          : ""
        : firstLine(w?.details) || coachWhyText(w);

    return (
      <View pointerEvents="none" style={[p.peek, { top, left, width }]}>
        <View style={p.peekCard}>
          <Text style={p.peekTitle}>{title}</Text>
          <Text style={p.peekStrong} numberOfLines={1}>
            {main}
          </Text>
          <Text style={p.peekText} numberOfLines={2}>
            {sub}
          </Text>

          <View style={p.peekTip}>
            <Ionicons name="information-circle-outline" size={16} color={theme.colors.text2} />
            <Text style={p.peekTipTxt} numberOfLines={1}>
              Maintiens = aperçu • Double tap = ouvrir
            </Text>
          </View>
        </View>
      </View>
    );
  };

  /* --------------------------- LONG PRESS PATCHES --------------------------- */

  const LONG_PRESS_MS = 240;

  const openPeekWorkout = useCallback(() => {
    measureInWindow(workoutAnchorRef, (r) => setPeek({ kind: "workout", anchor: r }));
  }, []);

  const openPeekActivity = useCallback(() => {
    measureInWindow(activityAnchorRef, (r) => setPeek({ kind: "activity", anchor: r }));
  }, []);

  const openPeekDay = useCallback((idx: number) => {
    const ref = { current: dayRefs.current[idx] as any } as React.RefObject<View>;
    measureInWindow(ref, (r) => setPeek({ kind: "day", anchor: r, dayIndex: idx }));
  }, []);

  const closePeek = useCallback(() => setPeek(null), []);

  /* --------------------------- quick coach actions -------------------------- */

  const onOpenCoach = useCallback(() => {
    router.push("/chat");
  }, [router]);

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        {/* Toast centre écran */}
        {toast ? (
          <Pressable onPress={dismiss} style={t.overlay}>
            <Animated.View style={[t.toast, { opacity, transform: [{ scale }] }]}>
              <View style={t.toastIconWrap}>
                <Ionicons name={toast.icon ?? "trophy-outline"} size={22} color={theme.colors.text} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={t.toastTitle}>{toast.title}</Text>
                <Text style={t.toastName} numberOfLines={1}>
                  {toast.name}
                </Text>
              </View>

              <View
                style={[
                  t.rarityPill,
                  {
                    backgroundColor: rarityStyle(toast.rarity).bg,
                    borderColor: rarityStyle(toast.rarity).border,
                  },
                ]}
              >
                <Text style={t.rarityTxt}>{(toast.rarity ?? "common").toUpperCase()}</Text>
              </View>
            </Animated.View>
          </Pressable>
        ) : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* ---- Module 0 : micro header coach ---- */}
          <Card style={{ marginTop: 10 }}>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>Bonjour {firstName}</Text>
                <Text style={s.h1}>On garde ça simple.</Text>
                <Text style={s.p}>Je te donne une décision claire, tu gardes le contrôle.</Text>
              </View>

              <Pressable onPress={onOpenCoach} hitSlop={10} style={({ pressed }) => [s.coachBtn, pressed && s.pressed]}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.colors.text} />
              </Pressable>
            </View>
          </Card>

          {/* ---- Module 1 : Moment fierté ---- */}
          <Card style={{ marginTop: 12 }}>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>{pride.title}</Text>
                <Text style={s.h1}>{pride.line1}</Text>
                <Text style={s.p}>{pride.line2}</Text>
              </View>

              <View style={s.iconBubble}>
                <Ionicons name="trophy-outline" size={20} color={theme.colors.primary} />
              </View>
            </View>

            <Pressable onPress={onSharePride} style={({ pressed }) => [s.shareBtn, pressed && s.pressed]}>
              <Ionicons name="share-social-outline" size={16} color={theme.colors.text} />
              <Text style={s.shareTxt}>Partager</Text>
            </Pressable>
          </Card>

          {/* ---- Module 2 : Séance du jour ---- */}
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>Séance du jour</Text>

            <Pressable onPress={goPlanToday} hitSlop={10} style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}>
              <Text style={s.ghostTxt}>Plan</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.text2} />
            </Pressable>
          </View>

          <View ref={workoutAnchorRef} style={{ marginTop: 10 }}>
            <Pressable
              delayLongPress={LONG_PRESS_MS}
              pressRetentionOffset={{ top: 30, left: 30, bottom: 30, right: 30 }}
              hitSlop={12}
              onLongPress={openPeekWorkout}
              onPressOut={closePeek}
              onPressCancel={closePeek}
              onPress={() => onTap(() => {}, goPlanToday)}
              style={({ pressed }) => [pressed && { opacity: 0.985 }]}
            >
              <WorkoutTodayCard
                contextLine={`Bonjour ${firstName}`}
                badgeLine={"Décision coach • adaptable"}
                title={workoutLabel(todayDay?.workout) === "—" ? "Aucune séance" : workoutLabel(todayDay?.workout)}
                pace={"—"}
                loadValue={100}
                trendPct={"+0%"}
                distanceLabel={"—"}
                timeLabel={"—"}
                elevLabel={"—"}
                onGo={goMapToday}
                onLongPressPreview={undefined}
                onDoubleTapOpenPlan={goPlanToday}
              />
            </Pressable>

            <Card style={{ marginTop: 10 }}>
              <Text style={s.whyTitle}>Pourquoi ?</Text>
              <Text style={s.whyTxt}>{coachWhyText(todayDay)}</Text>

              <View style={s.whyChips}>
                <View style={s.chip}>
                  <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.text2} />
                  <Text style={s.chipTxt}>Charge maîtrisée</Text>
                </View>
                <View style={s.chip}>
                  <Ionicons name="trending-up-outline" size={14} color={theme.colors.text2} />
                  <Text style={s.chipTxt}>Progression continue</Text>
                </View>
              </View>
            </Card>

            <Text style={s.tapHint}>Maintiens pour aperçu • Double tap pour ouvrir le plan</Text>
          </View>

          {/* ---- Module 3 : Tes sorties ---- */}
          <View style={[s.sectionHeaderRow, { marginTop: 18 }]}>
            <Text style={s.sectionTitle}>Tes sorties</Text>

            <Pressable onPress={goActivities} hitSlop={10} style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}>
              <Text style={s.ghostTxt}>Tout</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.text2} />
            </Pressable>
          </View>

          <View ref={activityAnchorRef} style={{ marginTop: 10 }}>
            <Pressable
              delayLongPress={LONG_PRESS_MS}
              pressRetentionOffset={{ top: 30, left: 30, bottom: 30, right: 30 }}
              hitSlop={12}
              onLongPress={openPeekActivity}
              onPressOut={closePeek}
              onPressCancel={closePeek}
              onPress={() =>
                onTap(
                  () => setShowMoreRuns((v) => !v),
                  goActivities
                )
              }
              style={({ pressed }) => [pressed && { opacity: 0.985 }]}
            >
              <Card>
                {!lastActivity ? (
                  <Text style={s.muted}>{loading ? "Chargement…" : "Aucune activité enregistrée."}</Text>
                ) : (
                  <>
                    <ActivityRow item={toActivityItem(lastActivity)} />

                    {showMoreRuns ? (
                      <View style={{ marginTop: 10, gap: 10 }}>
                        {expandedRuns.slice(1).map((a) => (
                          <ActivityRow key={a.id} item={toActivityItem(a)} />
                        ))}
                      </View>
                    ) : null}

                    <View style={s.runsActions}>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setShowMoreRuns((v) => !v);
                        }}
                        style={({ pressed }) => [s.runsBtn, pressed && s.pressed]}
                      >
                        <Ionicons name={showMoreRuns ? "chevron-up-outline" : "chevron-down-outline"} size={16} color={theme.colors.text} />
                        <Text style={s.runsBtnTxt}>{showMoreRuns ? "Réduire" : `Voir ${expandedCount}`}</Text>
                      </Pressable>

                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          show({ title: "Partage (bientôt)", name: "Dernière sortie", icon: "share-social-outline", rarity: "common" });
                        }}
                        style={({ pressed }) => [s.runsBtn, pressed && s.pressed]}
                      >
                        <Ionicons name="share-social-outline" size={16} color={theme.colors.text} />
                        <Text style={s.runsBtnTxt}>Partager</Text>
                      </Pressable>
                    </View>

                    <Text style={s.tapHint}>Tap = déplier • Double tap = Activités</Text>
                  </>
                )}
              </Card>
            </Pressable>
          </View>

          {/* ---- Module 4 : Semaine + météo ---- */}
          <View style={[s.sectionHeaderRow, { marginTop: 18 }]}>
            <Text style={s.sectionTitle}>Semaine</Text>

            <Pressable onPress={goPlanToday} hitSlop={10} style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}>
              <Text style={s.ghostTxt}>Ouvrir</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.text2} />
            </Pressable>
          </View>

          <Card style={{ marginTop: 10 }}>
            <View style={s.weekRow}>
              {Array.from({ length: 7 }).map((_, idx) => (
                <View
                  key={idx}
                  ref={(r) => {
                    dayRefs.current[idx] = r;
                  }}
                  style={{ flexGrow: 1, flexBasis: 0 }}
                >
                  <Pressable
                    delayLongPress={LONG_PRESS_MS}
                    pressRetentionOffset={{ top: 25, left: 25, bottom: 25, right: 25 }}
                    hitSlop={10}
                    onLongPress={() => openPeekDay(idx)}
                    onPressOut={closePeek}
                    onPressCancel={closePeek}
                    onPress={() => onTap(() => {}, () => goPlanDay(idx))}
                    style={({ pressed }) => [
                      s.dayPillBtn,
                      { borderColor: idx === todayIdx ? theme.colors.primary : theme.colors.border },
                      pressed && s.pressed,
                    ]}
                  >
                    <Text style={[s.dow, idx === todayIdx && { color: theme.colors.primary }]}>{DOW[idx]}</Text>

                    <Ionicons
                      name={weatherIconMap[(wxDays[idx]?.icon ?? "cloud") as WeatherIcon]}
                      size={14}
                      color={theme.colors.text2}
                    />

                    <View
                      style={[
                        s.codePill,
                        {
                          backgroundColor: pillAccent(days[idx]?.workout).bg,
                          borderColor: pillAccent(days[idx]?.workout).bd,
                        },
                      ]}
                    >
                      <Text style={s.codeTxt}>{workoutCode(days[idx]?.workout)}</Text>
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>

            <Text style={s.tapHint}>Maintiens un jour pour aperçu • Double tap pour ouvrir le plan</Text>
          </Card>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* Peek overlay au-dessus de tout */}
        {renderPeek()}
      </View>
    </Screen>
  );
});

/* -------------------------------- styles -------------------------------- */

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 24 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },

  kicker: { color: theme.colors.text2, fontWeight: "900", fontSize: 12, textTransform: "uppercase" },
  h1: { marginTop: 6, color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  p: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },

  coachBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,59,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,59,0,0.22)",
  },

  shareBtn: {
    marginTop: 10,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  shareTxt: { color: theme.colors.text, fontWeight: "900" },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text },

  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  ghostTxt: { color: theme.colors.text2, fontWeight: "900" },

  tapHint: { marginTop: 8, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },
  muted: { color: theme.colors.text2, fontWeight: "800" },

  whyTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  whyTxt: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },
  whyChips: { marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipTxt: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },

  weekRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  dayPillBtn: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  dow: { fontSize: 12, fontWeight: "900", color: theme.colors.text2 },

  codePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 44,
    alignItems: "center",
  },
  codeTxt: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 0.6 },

  runsActions: { marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  runsBtn: {
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
  runsBtnTxt: { color: theme.colors.text, fontWeight: "900" },

  pressed: { opacity: 0.85 },
});

const p = StyleSheet.create({
  peek: { position: "absolute", zIndex: 9999, elevation: 20 },
  peekCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  peekTitle: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },
  peekStrong: { marginTop: 6, color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  peekText: { marginTop: 4, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },
  peekTip: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  peekTipTxt: { flex: 1, color: theme.colors.text2, fontWeight: "800" },
});

const t = StyleSheet.create({
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
  rarityPill: { height: 26, paddingHorizontal: 10, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rarityTxt: { color: theme.colors.text, fontWeight: "900", fontSize: 11 },
});
