// app/(tabs)/plan.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { theme } from "@/constants/theme";
import { Screen, Card } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */

type PhaseKey = "foundation" | "base" | "stabilisation" | "specifique" | "affutage";
type DOWKey = "Lun" | "Mar" | "Mer" | "Jeu" | "Ven" | "Sam" | "Dim";

type Tone = "green" | "slate" | "purple" | "orange" | "brown";

type SessionDetail = {
  warmup?: string;
  main?: string;
  cooldown?: string;
  tips?: string[];
};

type DaySession = {
  id: string;
  dow: DOWKey;
  badge: string;
  title: string;
  duration?: string;
  tone: Tone;
  detail?: SessionDetail;
};

type ModuleWeek = {
  weekIndex: number;
  label: string;
  totalKm: number;
  days: Record<DOWKey, DaySession | null>;
};

type PlanModule = {
  key: PhaseKey;
  title: string;
  totalKm: number;
  weeksCount: number;
  weekLabels: string[];
  weeks: ModuleWeek[];
  status?: "En cours" | "À venir" | "Terminé";
};

/* -------------------------------------------------------------------------- */
/*                                   CONSTS                                   */
/* -------------------------------------------------------------------------- */

const DOW: DOWKey[] = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const ORANGE = "#FF5A2A";

const PHASE_ORDER: PhaseKey[] = ["foundation", "base", "stabilisation", "specifique", "affutage"];

const PHASE_TITLES: Record<PhaseKey, string> = {
  foundation: "Fondation",
  base: "Base",
  stabilisation: "Stabilisation",
  specifique: "Spécifique",
  affutage: "Affûtage",
};

const PLAN_CHOICES = [
  { id: "marathon_debutant_12", label: "Marathon • Débutant • 12 sem" },
  { id: "semi_marathon_12", label: "Semi-marathon • 12 sem" },
  { id: "10k_8", label: "10 km • 8 sem" },
  { id: "5km_10", label: "5 km • 10 sem" },
] as const;

type PlanChoiceId = (typeof PLAN_CHOICES)[number]["id"];

/* -------------------------------------------------------------------------- */
/*                            THEME FALLBACKS (SAFE)                           */
/* -------------------------------------------------------------------------- */

const TEXT = (theme as any)?.colors?.text ?? "#fff";

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function todayIndexMon0() {
  const js = new Date().getDay();
  return js === 0 ? 6 : js - 1;
}

function parseDayIndex(raw?: string | string[]) {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(6, Math.floor(n)));
}

function toneStyles(tone: Tone) {
  switch (tone) {
    case "green":
      return {
        bg: "rgba(52,199,89,0.12)",
        stroke: "rgba(52,199,89,0.45)",
        badgeBg: "rgba(52,199,89,0.18)",
        badgeText: "rgba(230,255,238,0.95)",
      };
    case "purple":
      return {
        bg: "rgba(175,82,222,0.12)",
        stroke: "rgba(175,82,222,0.45)",
        badgeBg: "rgba(175,82,222,0.18)",
        badgeText: "rgba(248,234,255,0.95)",
      };
    case "orange":
      return {
        bg: "rgba(255,149,0,0.12)",
        stroke: "rgba(255,149,0,0.45)",
        badgeBg: "rgba(255,149,0,0.18)",
        badgeText: "rgba(255,246,232,0.95)",
      };
    case "brown":
      return {
        bg: "rgba(162,132,94,0.14)",
        stroke: "rgba(162,132,94,0.45)",
        badgeBg: "rgba(162,132,94,0.2)",
        badgeText: "rgba(255,247,238,0.95)",
      };
    case "slate":
    default:
      return {
        bg: "rgba(255,255,255,0.06)",
        stroke: "rgba(255,255,255,0.10)",
        badgeBg: "rgba(255,255,255,0.08)",
        badgeText: "rgba(235,235,235,0.95)",
      };
  }
}

function isRestSession(s: DaySession | null) {
  return !!s && s.title.trim().toLowerCase() === "repos";
}

function isRealSession(s: DaySession | null) {
  return !!s && s.title.trim().toLowerCase() !== "repos";
}

function computeWeekSessions(week: ModuleWeek) {
  return DOW.reduce((acc, d) => acc + (isRealSession(week.days[d]) ? 1 : 0), 0);
}

function computeModuleSessions(module: PlanModule) {
  return module.weeks.reduce((sum, w) => sum + computeWeekSessions(w), 0);
}

function estimateKmFromDuration(duration?: string) {
  if (!duration) return 0;
  const s = duration.toLowerCase().replace(/\s/g, "");
  if (s.includes("×")) return 9;
  if (s.includes("8×400m")) return 8;
  if (s.includes("10×45s")) return 7;
  if (s.includes("1h20")) return 13;
  if (s.includes("1h15")) return 12;
  if (s.includes("1h10")) return 11;
  if (s.includes("1h05")) return 10;
  if (s.includes("1h")) return 10;

  const m = s.match(/(\d+)min/);
  if (m) {
    const minutes = parseInt(m[1], 10);
    return Math.max(4, Math.round(minutes / 6));
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/*                          MOCK PLAN GENERATOR (STABLE)                       */
/* -------------------------------------------------------------------------- */

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: T[]) {
  return arr[Math.floor(rnd() * arr.length)];
}

function buildSessionId(moduleKey: PhaseKey, weekLabel: string, dow: DOWKey) {
  return `${moduleKey}-${weekLabel}-${dow}`.toLowerCase();
}

function makeDaySession(opts: {
  moduleKey: PhaseKey;
  weekLabel: string;
  dow: DOWKey;
  title: string;
  duration?: string;
  tone: Tone;
  tips?: string[];
  warmup?: string;
  main?: string;
  cooldown?: string;
}): DaySession {
  return {
    id: buildSessionId(opts.moduleKey, opts.weekLabel, opts.dow),
    dow: opts.dow,
    badge: opts.dow,
    title: opts.title,
    duration: opts.duration,
    tone: opts.tone,
    detail: {
      warmup: opts.warmup,
      main: opts.main,
      cooldown: opts.cooldown,
      tips: opts.tips,
    },
  };
}

function generateWeekDays(rnd: () => number, moduleKey: PhaseKey, weekLabel: string): Record<DOWKey, DaySession | null> {
  const longDuration = pick(rnd, ["1h05", "1h10", "1h15", "1h20"]);
  const efDuration = pick(rnd, ["40 min", "45 min", "50 min"]);
  const easyDuration = pick(rnd, ["35 min", "40 min"]);

  const quality = pick(rnd, [
    { title: "Seuil", duration: "3 × 8 min", tone: "purple" as const },
    { title: "Intervalles", duration: "8 × 400 m", tone: "purple" as const },
    { title: "Côtes", duration: "10 × 45 s", tone: "purple" as const },
  ]);

  const qualityTips =
    moduleKey === "foundation"
      ? ["Reste facile : la technique d’abord.", "Stop si douleur nette."]
      : moduleKey === "specifique"
      ? ["Reste précis, pas héroïque.", "Si l’allure dégrade, baisse le volume."]
      : ["Qualité > épuisement.", "Contrôle la récup."];

  return {
    Lun: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Lun",
      title: "Repos",
      tone: "green",
      tips: ["Récup active : marche 20–30 min si besoin.", "Hydratation + sommeil."],
    }),
    Mar: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Mar",
      title: "Endurance fondamentale",
      duration: efDuration,
      tone: "slate",
      warmup: "10 min facile + mobilité",
      main: `${efDuration} en aisance respiratoire`,
      cooldown: "5 min facile",
      tips: ["Tu dois pouvoir parler.", "Relâche les épaules."],
    }),
    Mer: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Mer",
      title: "Repos",
      tone: "slate",
      tips: ["Si raideur : 10 min mobilité + auto-massage mollets."],
    }),
    Jeu: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Jeu",
      title: quality.title,
      duration: quality.duration,
      tone: quality.tone,
      warmup: "15 min facile + 4 lignes droites",
      main: quality.duration,
      cooldown: "10 min facile",
      tips: qualityTips,
    }),
    Ven: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Ven",
      title: "Repos",
      tone: "orange",
      tips: ["Prépare le week-end : sommeil + hydratation."],
    }),
    Sam: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Sam",
      title: "Footing",
      duration: easyDuration,
      tone: "brown",
      warmup: "8 min facile",
      main: easyDuration,
      cooldown: "5 min facile",
      tips: ["Facile, relâché, régulier."],
    }),
    Dim: makeDaySession({
      moduleKey,
      weekLabel,
      dow: "Dim",
      title: "Sortie longue",
      duration: longDuration,
      tone: "slate",
      warmup: "10 min facile",
      main: `${longDuration} progressif très léger`,
      cooldown: "5 min facile",
      tips: ["Allure confortable.", "Eau si > 1h."],
    }),
  };
}

function computeWeekKmFromDays(days: Record<DOWKey, DaySession | null>) {
  return DOW.reduce((sum, d) => sum + estimateKmFromDuration(days[d]?.duration), 0);
}

function buildModule(opts: {
  key: PhaseKey;
  startWeekIndex: number;
  weeksCount: number;
  status?: "En cours" | "À venir" | "Terminé";
  seed: number;
}): PlanModule {
  const rnd = mulberry32(opts.seed);

  const weekLabels = Array.from({ length: opts.weeksCount }).map((_, i) => `S${opts.startWeekIndex + i}`);

  const weeks: ModuleWeek[] = weekLabels.map((lab, i) => {
    const days = generateWeekDays(rnd, opts.key, lab);
    const totalKm = computeWeekKmFromDays(days);
    return {
      weekIndex: opts.startWeekIndex + i,
      label: lab,
      totalKm,
      days,
    };
  });

  const totalKm = weeks.reduce((acc, w) => acc + w.totalKm, 0);

  return {
    key: opts.key,
    title: PHASE_TITLES[opts.key],
    totalKm,
    weeksCount: opts.weeksCount,
    weekLabels,
    weeks,
    status: opts.status,
  };
}

function generateMockModules(): PlanModule[] {
  return [
    buildModule({ key: "foundation", startWeekIndex: 1, weeksCount: 4, status: "En cours", seed: 11 }),
    buildModule({ key: "base", startWeekIndex: 5, weeksCount: 4, status: "À venir", seed: 22 }),
    buildModule({ key: "stabilisation", startWeekIndex: 9, weeksCount: 4, status: "À venir", seed: 33 }),
    buildModule({ key: "specifique", startWeekIndex: 13, weeksCount: 6, status: "À venir", seed: 44 }),
    buildModule({ key: "affutage", startWeekIndex: 19, weeksCount: 2, status: "À venir", seed: 55 }),
  ];
}

const MODULES: PlanModule[] = generateMockModules();

/* -------------------------------------------------------------------------- */
/*                                 UI ATOMS                                   */
/* -------------------------------------------------------------------------- */

function ProgressBar({ value }: { value: number }) {
  const v = clamp01(value);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${v * 100}%` }]} />
    </View>
  );
}

function Pill({
  label,
  selected,
  onPress,
  leftIcon,
  rightIcon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, selected && styles.pillActive]} hitSlop={8}>
      {leftIcon ? <Ionicons name={leftIcon} size={14} color={selected ? ORANGE : "rgba(255,255,255,0.55)"} /> : null}
      <Text style={[styles.pillText, selected && styles.pillTextActive]}>{label}</Text>
      {rightIcon ? <Ionicons name={rightIcon} size={14} color={selected ? ORANGE : "rgba(255,255,255,0.55)"} /> : null}
    </Pressable>
  );
}

function SessionRow({ item, onPress, highlighted }: { item: DaySession; onPress?: () => void; highlighted?: boolean }) {
  const t = toneStyles(item.tone);
  const isRest = isRestSession(item);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sessionRow,
        { backgroundColor: t.bg, borderColor: t.stroke },
        highlighted && { borderColor: ORANGE, borderWidth: 2 },
        isRest && { opacity: 0.9 },
      ]}
      hitSlop={6}
    >
      <View style={[styles.sessionStroke, { backgroundColor: t.stroke }]} />
      <View style={[styles.sessionBadge, { backgroundColor: t.badgeBg }]}>
        <Text style={[styles.sessionBadgeText, { color: t.badgeText }]}>{item.badge}</Text>
      </View>

      <View style={styles.sessionContent}>
        <Text style={styles.sessionTitle}>{item.title}</Text>
        {!!item.duration && <Text style={styles.sessionMeta}>{` • ${item.duration}`}</Text>}
      </View>

      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.45)" />
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*                                PLAN PICKER                                 */
/* -------------------------------------------------------------------------- */

function PlanPickerModal({
  visible,
  selectedId,
  onClose,
  onPick,
}: {
  visible: boolean;
  selectedId: PlanChoiceId;
  onClose: () => void;
  onPick: (id: PlanChoiceId) => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.planPickerWrap}>
        <Card style={styles.planPickerCard}>
          <View style={styles.planPickerHeader}>
            <Text style={styles.planPickerTitle}>Choisir un plan</Text>
            <Pressable onPress={onClose} style={styles.sheetCloseBtn} hitSlop={10}>
              <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>

          <View style={{ gap: 10 }}>
            {PLAN_CHOICES.map((p) => {
              const active = p.id === selectedId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onPick(p.id)}
                  style={[styles.planChoiceRow, active && styles.planChoiceRowActive]}
                  hitSlop={10}
                >
                  <Text style={[styles.planChoiceText, active && styles.planChoiceTextActive]}>{p.label}</Text>
                  <Ionicons
                    name={active ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={active ? ORANGE : "rgba(255,255,255,0.35)"}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: Platform.OS === "ios" ? 14 : 8 }} />
        </Card>
      </View>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                               SESSION SHEET                                */
/* -------------------------------------------------------------------------- */

function SessionBottomSheet({
  visible,
  onClose,
  session,
  moduleTitle,
  weekLabel,
  quickActions,
}: {
  visible: boolean;
  onClose: () => void;
  session: DaySession | null;
  moduleTitle: string;
  weekLabel: string;
  quickActions?: React.ReactNode;
}) {
  const isRest = !!session && session.title.trim().toLowerCase() === "repos";

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>{session ? `${session.dow} • ${moduleTitle}` : moduleTitle}</Text>
            <Text style={styles.sheetSub}>{weekLabel}</Text>
          </View>

          <Pressable onPress={onClose} style={styles.sheetCloseBtn} hitSlop={10}>
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>

        {quickActions ? <View style={styles.sheetActionsRow}>{quickActions}</View> : null}

        {!session ? (
          <Card style={styles.sheetCard}>
            <Text style={styles.sheetBodyText}>Aucune séance renseignée pour ce jour.</Text>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            <Card style={styles.sheetCard}>
              <Text style={styles.sheetH1}>
                {session.title}
                {session.duration ? <Text style={styles.sheetMuted}>{` • ${session.duration}`}</Text> : null}
              </Text>

              {isRest ? (
                <Text style={styles.sheetBodyText}>
                  Le repos ne compte pas comme une séance. Objectif : récupérer (et garder de la marge pour la suite).
                </Text>
              ) : (
                <>
                  {!!session.detail?.warmup && (
                    <Text style={styles.sheetBodyText}>
                      <Text style={styles.sheetLabel}>Échauffement</Text>
                      {"\n"}
                      {session.detail.warmup}
                    </Text>
                  )}
                  {!!session.detail?.main && (
                    <Text style={styles.sheetBodyText}>
                      <Text style={styles.sheetLabel}>Bloc principal</Text>
                      {"\n"}
                      {session.detail.main}
                    </Text>
                  )}
                  {!!session.detail?.cooldown && (
                    <Text style={styles.sheetBodyText}>
                      <Text style={styles.sheetLabel}>Retour au calme</Text>
                      {"\n"}
                      {session.detail.cooldown}
                    </Text>
                  )}
                </>
              )}
            </Card>

            <Card style={styles.sheetCard}>
              <Text style={styles.sheetLabel}>Conseils du coach</Text>
              <View style={{ marginTop: 8, gap: 6 }}>
                {(session.detail?.tips?.length ? session.detail.tips : ["Reste régulier, écoute tes sensations."]).map((t, i) => (
                  <Text key={i} style={styles.sheetBodyText}>{`• ${t}`}</Text>
                ))}
              </View>
            </Card>
          </View>
        )}

        <View style={{ height: Platform.OS === "ios" ? 24 : 14 }} />
      </View>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                                MODULE CARD                                 */
/* -------------------------------------------------------------------------- */

function ModuleCard({
  module,
  selectedWeekLabel,
  onSelectWeekLabel,
  onPressDay,
  highlightId,
}: {
  module: PlanModule;
  selectedWeekLabel: string;
  onSelectWeekLabel: (label: string) => void;
  onPressDay: (module: PlanModule, week: ModuleWeek, dow: DOWKey) => void;
  highlightId?: string | null;
}) {
  const week = useMemo(() => {
    const w = module.weeks.find((x) => x.label === selectedWeekLabel);
    return w ?? module.weeks[0];
  }, [module, selectedWeekLabel]);

  const computedWeekSessions = useMemo(() => computeWeekSessions(week), [week]);
  const computedModuleSessions = useMemo(() => computeModuleSessions(module), [module]);

  return (
    <Card style={styles.moduleCard}>
      <View style={styles.moduleHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.moduleTitle}>{module.title}</Text>
          <Text style={styles.moduleSub}>
            {module.totalKm} km • {computedModuleSessions} séances • {module.weeksCount} semaines
          </Text>
        </View>

        {module.status ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{module.status}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekPillsRow}>
        {module.weekLabels.map((lab) => (
          <Pill key={lab} label={lab} selected={lab === selectedWeekLabel} onPress={() => onSelectWeekLabel(lab)} />
        ))}
      </ScrollView>

      <View style={styles.dowRow}>
        {DOW.map((d) => (
          <Text key={d} style={styles.dowText}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.sessions}>
        {DOW.map((dow) => {
          const s = week.days[dow];
          if (!s) {
            return (
              <Pressable
                key={dow}
                onPress={() => onPressDay(module, week, dow)}
                style={[styles.sessionRow, styles.sessionRowEmpty]}
                hitSlop={8}
              >
                <Text style={styles.emptyRowText}>{dow} • —</Text>
              </Pressable>
            );
          }
          return (
            <SessionRow
              key={s.id}
              item={s}
              onPress={() => onPressDay(module, week, dow)}
              highlighted={!!highlightId && s.id === highlightId}
            />
          );
        })}
      </View>

      <View style={styles.weekFooter}>
        <Text style={styles.weekFooterText}>
          Semaine {week.weekIndex} • {week.totalKm} km • {computedWeekSessions} séances
        </Text>
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   SCREEN                                   */
/* -------------------------------------------------------------------------- */

function PlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dayIndex?: string; focus?: string; moduleKey?: string; weekLabel?: string }>();

  /* ----------------------- BACK GUARD (Android + Web) ---------------------- */
  const webPushedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/(tabs)/home");
        return true;
      });

      let popHandler: ((e: PopStateEvent) => void) | null = null;

      if (Platform.OS === "web" && typeof window !== "undefined") {
        // évite d’empiler l’historique si l’écran refocus souvent
        if (!webPushedRef.current) {
          window.history.pushState({ noBack: true }, "", window.location.href);
          webPushedRef.current = true;
        }

        popHandler = () => {
          router.replace("/(tabs)/home");
          window.history.pushState({ noBack: true }, "", window.location.href);
        };

        window.addEventListener("popstate", popHandler);
      }

      return () => {
        sub.remove();
        if (Platform.OS === "web" && typeof window !== "undefined" && popHandler) {
          window.removeEventListener("popstate", popHandler);
        }
      };
    }, [router])
  );

  /* ------------------------------ SCROLL / MAP ----------------------------- */
  const modulesScrollRef = useRef<ScrollView | null>(null);
  const moduleYRef = useRef<Record<PhaseKey, number>>({
    foundation: 0,
    base: 0,
    stabilisation: 0,
    specifique: 0,
    affutage: 0,
  });

  const [activeModuleKey, setActiveModuleKey] = useState<PhaseKey>("foundation");

  /* --------------------------- WEEK SELECTION STATE ------------------------ */
  const [weekSelected, setWeekSelected] = useState<Record<PhaseKey, string>>({
    foundation: MODULES.find((m) => m.key === "foundation")!.weekLabels[0],
    base: MODULES.find((m) => m.key === "base")!.weekLabels[0],
    stabilisation: MODULES.find((m) => m.key === "stabilisation")!.weekLabels[0],
    specifique: MODULES.find((m) => m.key === "specifique")!.weekLabels[0],
    affutage: MODULES.find((m) => m.key === "affutage")!.weekLabels[0],
  });

  const weekSelectedRef = useRef(weekSelected);
  useEffect(() => {
    weekSelectedRef.current = weekSelected;
  }, [weekSelected]);

  /* ----------------------------- HIGHLIGHT FX ------------------------------ */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const flashHighlight = useCallback((id: string | null, ms: number) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightId(id);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), ms);
  }, []);

  /* --------------------------- SESSION SHEET STATE ------------------------- */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSession, setSheetSession] = useState<DaySession | null>(null);
  const [sheetMeta, setSheetMeta] = useState<{ moduleTitle: string; weekLabel: string } | null>(null);

  /* ----------------------------- PLAN SELECTOR ----------------------------- */
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<PlanChoiceId>("marathon_debutant_12");

  const selectedPlanLabel = useMemo(() => {
    return PLAN_CHOICES.find((p) => p.id === selectedPlanId)?.label ?? "Choisir un plan";
  }, [selectedPlanId]);

  /* ----------------------- “TOP SUMMARY” (DA style) ------------------------ */
  const planTitle = useMemo(() => "Plan personnalisé", []);
  const objectiveLine = useMemo(() => "Objectif : 10 km  •  Niveau : Débutant", []);
  const progressionLine = useMemo(() => "Progression : 1 / 12 semaines", []);

  /* --------------------------- OPEN DAY / TARGET --------------------------- */
  const openDay = useCallback(
    (module: PlanModule, week: ModuleWeek, dow: DOWKey) => {
      const session = week.days[dow] ?? null;

      setSheetSession(session);
      setSheetMeta({ moduleTitle: module.title, weekLabel: week.label });
      setSheetOpen(true);

      flashHighlight(session?.id ?? null, 1400);
    },
    [flashHighlight]
  );

  const jumpToModule = useCallback(
    (key: PhaseKey) => {
      const y = moduleYRef.current[key] ?? 0;
      setActiveModuleKey(key);
      modulesScrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    },
    []
  );

  const openTarget = useCallback(
    (opts: { moduleKey?: PhaseKey; weekLabel?: string; dow: DOWKey }) => {
      const fallbackModule = MODULES.find((m) => m.status === "En cours") ?? MODULES[0];
      const moduleKey = (opts.moduleKey ?? fallbackModule.key) as PhaseKey;

      const module = MODULES.find((m) => m.key === moduleKey) ?? fallbackModule;

      const currentSelected = weekSelectedRef.current[module.key];
      const weekLabel = opts.weekLabel ?? currentSelected ?? module.weekLabels[0];

      const week = module.weeks.find((w) => w.label === weekLabel) ?? module.weeks[0];

      jumpToModule(module.key);

      setWeekSelected((prev) => (prev[module.key] === week.label ? prev : { ...prev, [module.key]: week.label }));

      requestAnimationFrame(() => {
        const session = week.days[opts.dow] ?? null;
        setSheetSession(session);
        setSheetMeta({ moduleTitle: module.title, weekLabel: week.label });
        setSheetOpen(true);
        flashHighlight(session?.id ?? null, 1800);
      });
    },
    [jumpToModule, flashHighlight]
  );

  const lastFocusKeyRef = useRef<string>("");

  useFocusEffect(
    useCallback(() => {
      const focus = (params.focus ?? "").toString().toLowerCase();

      let idx: number | null = null;
      if (focus === "today") idx = todayIndexMon0();
      else idx = parseDayIndex(params.dayIndex);

      if (idx === null) return;

      const dow = DOW[idx];
      const moduleKey = (params.moduleKey as PhaseKey | undefined) ?? undefined;
      const weekLabel = (params.weekLabel as string | undefined) ?? undefined;

      const key = `${focus}|${params.dayIndex ?? ""}|${moduleKey ?? ""}|${weekLabel ?? ""}`;
      if (lastFocusKeyRef.current === key) return;
      lastFocusKeyRef.current = key;

      openTarget({ dow, moduleKey, weekLabel });
      return () => {};
    }, [params.dayIndex, params.focus, params.moduleKey, params.weekLabel, openTarget])
  );

  /* ------------------------------ ACTIVE PHASE ----------------------------- */
  const onModulesScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;

      const entries = Object.entries(moduleYRef.current) as Array<[PhaseKey, number]>;
      entries.sort((a, b) => a[1] - b[1]);

      let current: PhaseKey = "foundation";
      for (const [k, ky] of entries) {
        if (y + 40 >= ky) current = k;
        else break;
      }
      if (current !== activeModuleKey) setActiveModuleKey(current);
    },
    [activeModuleKey]
  );

  /* ----------------------------- QUICK ACTIONS ----------------------------- */
  const goToday = useCallback(() => {
    const idx = todayIndexMon0();
    openTarget({ dow: DOW[idx] });
  }, [openTarget]);

  const goHome = useCallback(() => router.replace("/(tabs)/home"), [router]);

  const sheetQuickActions = useMemo(() => {
    if (!sheetSession) return null;

    const rest = isRestSession(sheetSession);

    return (
      <>
        <Pressable
          onPress={() => {
            setSheetOpen(false);
            if (!rest) router.push({ pathname: "/(tabs)/map", params: { mode: "today" } });
          }}
          disabled={rest}
          style={[styles.actionBtn, rest && { opacity: 0.45 }]}
          hitSlop={10}
        >
          <Ionicons name="play-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>{rest ? "Repos" : "Démarrer"}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setSheetOpen(false);
            goHome();
          }}
          style={[styles.actionBtn, styles.actionBtnGhost]}
          hitSlop={10}
        >
          <Ionicons name="home-outline" size={16} color="rgba(255,255,255,0.85)" />
          <Text style={[styles.actionBtnTxt, { color: "rgba(255,255,255,0.85)" }]}>Retour</Text>
        </Pressable>
      </>
    );
  }, [sheetSession, router, goHome]);

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        {/* TOP AREA */}
        <View style={styles.fixedTop}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Plan</Text>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={goToday} style={styles.headerIconBtn} hitSlop={8}>
                <Ionicons name="today-outline" size={18} color={TEXT} />
              </Pressable>

              <Pressable onPress={() => setPlanPickerOpen(true)} style={styles.headerIconBtn} hitSlop={8}>
                <Ionicons name="options-outline" size={18} color={TEXT} />
              </Pressable>
            </View>
          </View>

          <Card style={styles.topCard}>
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.planTitleRow}>
                  <Text style={styles.topTitle}>{planTitle}</Text>

                  <Pressable onPress={() => setPlanPickerOpen(true)} style={styles.planPickerBtn} hitSlop={10}>
                    <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.85)" />
                  </Pressable>
                </View>

                <Pressable onPress={() => setPlanPickerOpen(true)} hitSlop={10}>
                  <Text style={styles.planSelectedLabel}>{selectedPlanLabel}</Text>
                </Pressable>

                <Text style={styles.topSub}>{objectiveLine}</Text>
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              <ProgressBar value={0.62} />
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{progressionLine}</Text>

              <View style={styles.progressDots}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View key={i} style={[styles.dot, i === 0 && styles.dotActive, i > 0 && i < 4 && styles.dotDim]} />
                ))}
              </View>
            </View>

            <View style={styles.quickRow}>
              <Pill label="Aujourd’hui" leftIcon="today-outline" onPress={goToday} />
              <Pill label="Retour Home" leftIcon="home-outline" onPress={goHome} />
            </View>
          </Card>

          <Card style={styles.phaseTabsCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.phaseTabsRow}>
              {PHASE_ORDER.map((k) => {
                const m = MODULES.find((x) => x.key === k)!;
                const active = m.key === activeModuleKey;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => jumpToModule(m.key)}
                    style={[styles.phaseTab, active && styles.phaseTabActive]}
                    hitSlop={10}
                  >
                    <Text style={[styles.phaseTabText, active && styles.phaseTabTextActive]}>{m.title}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.phaseRail}>
              <View style={styles.phaseRailLine} />
            </View>
          </Card>
        </View>

        {/* MODULES SCROLL */}
        <ScrollView
          ref={(r) => (modulesScrollRef.current = r)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.modulesScroll}
          onScroll={onModulesScroll}
          scrollEventThrottle={16}
        >
          {MODULES.map((m) => (
            <View
              key={m.key}
              onLayout={(ev) => {
                moduleYRef.current[m.key] = ev.nativeEvent.layout.y;
              }}
            >
              <ModuleCard
                module={m}
                selectedWeekLabel={weekSelected[m.key]}
                onSelectWeekLabel={(lab) =>
                  setWeekSelected((prev) => {
                    if (prev[m.key] === lab) return prev;
                    return { ...prev, [m.key]: lab };
                  })
                }
                onPressDay={openDay}
                highlightId={highlightId}
              />
            </View>
          ))}

          <View style={{ height: 18 }} />
        </ScrollView>

        {/* MODALS */}
        <PlanPickerModal
          visible={planPickerOpen}
          selectedId={selectedPlanId}
          onClose={() => setPlanPickerOpen(false)}
          onPick={(id) => {
            setSelectedPlanId(id);
            setPlanPickerOpen(false);
          }}
        />

        <SessionBottomSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          session={sheetSession}
          moduleTitle={sheetMeta?.moduleTitle ?? ""}
          weekLabel={sheetMeta?.weekLabel ?? ""}
          quickActions={sheetQuickActions}
        />
      </View>
    </Screen>
  );
}

export default memo(PlanScreen);

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  fixedTop: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
  },
  modulesScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  headerTitle: { color: TEXT, fontSize: 22, fontWeight: "900" },

  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  topCard: { padding: 14, borderRadius: 18 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topTitle: { color: "#FFF", fontSize: 18, fontWeight: "900" },

  planPickerBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  planSelectedLabel: {
    marginTop: 6,
    color: "rgba(255,255,255,0.70)",
    fontSize: 13,
    fontWeight: "800",
  },

  topSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.60)",
    fontSize: 13,
    fontWeight: "700",
  },

  progressTrack: {
    height: 6,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: ORANGE },

  progressRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "800" },
  progressDots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.18)" },
  dotActive: { backgroundColor: ORANGE },
  dotDim: { backgroundColor: "rgba(255,255,255,0.12)" },

  quickRow: { marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" },

  phaseTabsCard: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 18 },
  phaseTabsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 },
  phaseTab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  phaseTabActive: {
    backgroundColor: "rgba(255,90,42,0.14)",
    borderColor: "rgba(255,90,42,0.28)",
  },
  phaseTabText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "900" },
  phaseTabTextActive: { color: "#FFF" },
  phaseRail: { marginTop: 10, height: 10, justifyContent: "center" },
  phaseRailLine: { height: 2, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.10)" },

  moduleCard: { padding: 14, borderRadius: 18 },
  moduleHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  moduleTitle: { color: "#FFF", fontSize: 22, fontWeight: "950" as any },
  moduleSub: { marginTop: 4, color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: "800" },

  statusPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,90,42,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,90,42,0.28)",
  },
  statusPillText: { color: ORANGE, fontSize: 12, fontWeight: "950" as any },

  weekPillsRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 10 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pillActive: {
    backgroundColor: "rgba(255,90,42,0.16)",
    borderColor: "rgba(255,90,42,0.30)",
  },
  pillText: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "950" as any },
  pillTextActive: { color: ORANGE },

  dowRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2 },
  dowText: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "900" },

  sessions: { marginTop: 10, gap: 10 },

  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 10,
    overflow: "hidden",
  },
  sessionRowEmpty: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    paddingVertical: 12,
  },
  emptyRowText: { color: "rgba(255,255,255,0.35)", fontSize: 13, fontWeight: "800" },

  sessionStroke: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  sessionBadge: { width: 40, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sessionBadgeText: { fontSize: 12, fontWeight: "950" as any, letterSpacing: 0.2 },

  sessionContent: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  sessionTitle: { color: "#FFF", fontSize: 15, fontWeight: "950" as any },
  sessionMeta: { color: "rgba(255,255,255,0.78)", fontSize: 14, fontWeight: "900" },

  weekFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  weekFooterText: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "900" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },

  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: "rgba(20,20,20,0.98)",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: "#FFF", fontSize: 18, fontWeight: "950" as any },
  sheetSub: { marginTop: 2, color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: "800" },
  sheetCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  sheetActionsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  actionBtn: {
    height: 42,
    borderRadius: 14,
    backgroundColor: ORANGE,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,90,42,0.35)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionBtnGhost: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  actionBtnTxt: { color: "#fff", fontWeight: "950" as any, fontSize: 13 },

  sheetCard: { padding: 14, borderRadius: 18 },
  sheetH1: { color: "#FFF", fontSize: 16, fontWeight: "950" as any },
  sheetMuted: { color: "rgba(255,255,255,0.65)", fontSize: 14, fontWeight: "900" },
  sheetLabel: { color: "#FFF", fontSize: 13, fontWeight: "950" as any },
  sheetBodyText: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "800", lineHeight: 18 },

  planPickerWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "ios" ? 80 : 70,
  },
  planPickerCard: { padding: 14, borderRadius: 18 },
  planPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  planPickerTitle: { color: "#FFF", fontSize: 16, fontWeight: "950" as any },
  planChoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  planChoiceRowActive: {
    borderColor: "rgba(255,90,42,0.35)",
    backgroundColor: "rgba(255,90,42,0.12)",
  },
  planChoiceText: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "850" as any },
  planChoiceTextActive: { color: "#FFF" },
});
