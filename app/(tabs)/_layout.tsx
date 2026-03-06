// app/(tabs)/_layout.tsx
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { theme } from "@/constants/theme";

// ✅ sources de vérité
import { ensureWeeklyPlan } from "@/coaching/planService";
import * as onboarding from "@/storage/onboarding";
import { listActivities } from "@/storage/activities";

/* -------------------------------- header UI -------------------------------- */

type HeaderTitleProps = { title: string; subtitle?: string | null };

const HeaderTitle = memo(function HeaderTitle({ title, subtitle }: HeaderTitleProps) {
  return (
    <View style={h.titleWrap}>
      <Text style={h.title}>{title}</Text>
      {subtitle ? (
        <Text style={h.sub} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
});

type CoachBtnProps = { unread?: number };

const CoachBtn = memo(function CoachBtn({ unread = 0 }: CoachBtnProps) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/chat")}
      hitSlop={10}
      style={({ pressed }) => [h.coachBtn, pressed && h.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir le coach"
    >
      <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.text} />
      {unread > 0 ? (
        <View style={h.badge} pointerEvents="none">
          <Text style={h.badgeTxt} numberOfLines={1}>
            {unread > 99 ? "99+" : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/* ----------------------------- helpers (robust) ----------------------------- */

function safeStr(x: unknown): string | null {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

function toInt(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

type CalibrationMeta = { subtitle: string | null; isDone: boolean };

function extractCalibrationMeta(onb: any): CalibrationMeta {
  // Supporte plusieurs shapes possibles.
  const c =
    onb?.calibration ??
    onb?.profile?.calibration ??
    onb?.user?.calibration ??
    onb?.meta?.calibration ??
    null;

  const status = safeStr(c?.status);
  const reqSessions = toInt(c?.requiredSessions);
  const doneSessions = toInt(c?.completedSessions);
  const reqDays = toInt(c?.requiredDays);
  const doneDays = toInt(c?.completedDays);

  const isDone =
    status === "done" ||
    c?.isDone === true ||
    c?.completed === true ||
    (reqSessions != null && doneSessions != null && doneSessions >= reqSessions) ||
    (reqDays != null && doneDays != null && doneDays >= reqDays);

  if (isDone) return { subtitle: null, isDone: true };

  // Sous-titre lisible si calibrage en cours / à faire
  const parts: string[] = [];

  if (reqDays != null) {
    const d = Math.max(0, doneDays ?? 0);
    parts.push(`Calibrage J${Math.min(d + 1, reqDays)}/${reqDays}`);
  } else {
    parts.push("Calibrage");
  }

  if (reqSessions != null) {
    const s = Math.max(0, doneSessions ?? 0);
    parts.push(`Séances ${Math.min(s, reqSessions)}/${reqSessions}`);
  }

  return { subtitle: parts.join(" • "), isDone: false };
}

function phaseLabelFR(x: unknown): string {
  const k = String(x ?? "").toLowerCase().trim();
  if (!k) return "Phase —";
  if (k.includes("found")) return "Fondation";
  if (k.includes("base")) return "Base";
  if (k.includes("build") || k.includes("construct")) return "Construction";
  if (k.includes("stabil")) return "Stabilisation";
  if (k.includes("taper") || k.includes("affut")) return "Affûtage";
  if (k.includes("race") || k.includes("objectif")) return "Objectif";
  if (k.includes("recov") || k.includes("repos")) return "Récupération";
  // fallback: garde la string si c'est déjà un label propre
  return safeStr(x) ?? "Phase —";
}

type PlanMeta = { weekLabel: string; phaseLabel: string; goalLabel: string };

function extractPlanMeta(plan: any, onb?: any): PlanMeta {
  const week =
    plan?.weekNumber ??
    plan?.meta?.weekNumber ??
    plan?.weekIndex ??
    plan?.meta?.weekIndex ??
    null;

  const phase =
    plan?.phase ??
    plan?.meta?.phase ??
    plan?.phaseKey ??
    plan?.meta?.phaseKey ??
    null;

  // Objectif: priorité onboarding (souvent UI-ready), sinon plan si string
  const goalFromOnb =
    onb?.goal?.label ??
    onb?.goal?.objectiveLabel ??
    onb?.objectiveLabel ??
    null;

  const goalFromPlan =
    plan?.goal ??
    plan?.meta?.goal ??
    plan?.objective ??
    plan?.meta?.objective ??
    null;

  const weekLabel = week != null ? `Semaine ${week}` : "Semaine —";
  const phaseLabel = phaseLabelFR(phase);

  const goalLabel =
    safeStr(goalFromOnb) ??
    (typeof goalFromPlan === "string" ? safeStr(goalFromPlan) : null) ??
    "Objectif —";

  return { weekLabel, phaseLabel, goalLabel };
}

function computeRunnerAgeLabel(onb: any, activitiesCount: number) {
  const realAge =
    (typeof onb?.profile?.age === "number" ? onb.profile.age : null) ??
    (typeof onb?.user?.age === "number" ? onb.user.age : null) ??
    (typeof onb?.age === "number" ? onb.age : null) ??
    null;

  // Placeholder stable (à remplacer par modèle réel)
  const hist = Math.max(0, Number(activitiesCount ?? 0));
  const discount = hist >= 40 ? 2 : hist >= 15 ? 4 : hist >= 5 ? 6 : 7;

  if (typeof realAge === "number" && Number.isFinite(realAge) && realAge > 0) {
    const runnerAge = Math.max(12, Math.round(realAge - discount));
    return `Âge coureur ${runnerAge} ans`;
  }
  return "Âge coureur —";
}

function computeTrendLabel(activitiesCount: number) {
  const n = Number(activitiesCount ?? 0);
  if (n >= 20) return "Tendance ↑";
  if (n >= 8) return "Tendance →";
  return "Tendance —";
}

/* --------------------------------- layout ---------------------------------- */

function TabLayout() {
  const insets = useSafeAreaInsets();

  // ✅ subtitles dynamiques
  const [subHome, setSubHome] = useState<string>("Semaine — • Phase — • Objectif —");
  const [subPlan, setSubPlan] = useState<string>("Semaine — • Phase — • Objectif —");
  const [subProgress, setSubProgress] = useState<string>("Âge coureur — • Tendance —");
  const [subActivities, setSubActivities] = useState<string>("Historique • export");

  // ✅ unread coach (prêt à brancher)
  const [unreadCoach] = useState<number>(1); // TODO: brancher notif/messages

  // ✅ throttle pour éviter IO au moindre focus
  const lastRefreshRef = useRef<number>(0);
  const MIN_REFRESH_MS = 5000;

  const refreshHeaderMeta = useCallback(async () => {
    try {
      const [onb, acts] = await Promise.all([
        onboarding.loadOnboarding().catch(() => null),
        listActivities().catch(() => [] as any[]),
      ]);

      const aCount = Array.isArray(acts) ? acts.length : 0;

      // Progrès
      const ageLabel = computeRunnerAgeLabel(onb, aCount);
      const trendLabel = computeTrendLabel(aCount);
      setSubProgress(`${ageLabel} • ${trendLabel}`);

      // Activités (fixe pour l’instant)
      setSubActivities("Historique • export");

      // Home + Plan : priorité calibrage
      const cal = extractCalibrationMeta(onb);
      if (!cal.isDone && cal.subtitle) {
        const s = `${cal.subtitle} • Phase — • Objectif —`;
        setSubHome(s);
        setSubPlan(s);
        return;
      }

      // Calibrage ok → plan meta (semaine/phase/objectif)
      const plan = await ensureWeeklyPlan().catch(() => null);

      if (plan) {
        const m = extractPlanMeta(plan, onb);
        const s = `${m.weekLabel} • ${m.phaseLabel} • ${m.goalLabel}`;
        setSubHome(s);
        setSubPlan(s);
      } else {
        // fallback si pas encore de plan malgré calibrage
        setSubHome("Semaine — • Phase — • Objectif —");
        setSubPlan("Semaine — • Phase — • Objectif —");
      }
    } catch {
      // silencieux : on garde les fallbacks
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_MS) return;
      lastRefreshRef.current = now;
      refreshHeaderMeta();
    }, [refreshHeaderMeta])
  );

  const screenOptions = useMemo(
    () => ({
      headerShown: true,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: theme.colors.bg },
      headerTitleAlign: "left" as const,
      headerTitleContainerStyle: { paddingLeft: 16 },
      headerRightContainerStyle: { paddingRight: 16 },
      headerStatusBarHeight: insets.top,

      tabBarActiveTintColor: theme.colors.primary,
      tabBarInactiveTintColor: theme.colors.text2,
      tabBarStyle: {
        backgroundColor: theme.colors.bg,
        borderTopColor: "rgba(255,255,255,0.08)",
        height: 60,
        paddingTop: 6,
        paddingBottom: Platform.OS === "ios" ? 12 : 8,
      },
      tabBarLabelStyle: { fontSize: 11, marginTop: 1 },
    }),
    [insets.top]
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={{ href: null }} />

      <Tabs.Screen
        name="home"
        options={{
          title: "Aujourd’hui",
          headerTitle: () => <HeaderTitle title="Aujourd’hui" subtitle={subHome} />,
          headerRight: () => <CoachBtn unread={unreadCoach} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="sunny-outline" size={size} color={color} />,
        }}
      />

      <Tabs.Screen
        name="plan"
        options={{
          title: "Plan",
          headerTitle: () => <HeaderTitle title="Plan" subtitle={subPlan} />,
          headerRight: () => <CoachBtn unread={unreadCoach} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Carte",
          headerTitle: () => <HeaderTitle title="Carte" subtitle="Parcours coach • boucles" />,
          headerRight: () => <CoachBtn unread={unreadCoach} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
        }}
      />

      <Tabs.Screen
        name="progress"
        options={{
          title: "Progrès",
          headerTitle: () => <HeaderTitle title="Progrès" subtitle={subProgress} />,
          headerRight: () => <CoachBtn unread={unreadCoach} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color} />,
        }}
      />

      <Tabs.Screen
        name="activities"
        options={{
          title: "Activités",
          headerTitle: () => <HeaderTitle title="Activités" subtitle={subActivities} />,
          headerRight: () => <CoachBtn unread={unreadCoach} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default memo(TabLayout);

/* --------------------------------- styles ---------------------------------- */

const h = StyleSheet.create({
  titleWrap: { gap: 2 },
  title: { fontSize: 20, fontWeight: "900", color: theme.colors.text },
  sub: { fontSize: 12, fontWeight: "800", color: theme.colors.text2 },

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
  pressed: { opacity: 0.85 },

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
  badgeTxt: { color: "#000", fontSize: 10, fontWeight: "900" },
});
