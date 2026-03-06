// components/WeekPlanCard.tsx
import React, { memo, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Platform, AccessibilityInfo } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/constants/theme";

/**
 * Patch set (idées vues avant) :
 * ✅ DA PacePilot (theme.colors) — pas de palette “TYPE_COLORS” custom
 * ✅ single tap = sélection + callback (navigation possible)
 * ✅ long press = preview (bottom sheet) + announce accessibilité
 * ✅ day chips : code + icône météo/session (style proche Home)
 * ✅ safe defaults : jour sans séance => Repos
 * ✅ sheet: actions claires + meta pills + texte lisible
 * ✅ performances : memo, maps, callbacks stables
 */

export type DayKey = "Lun" | "Mar" | "Mer" | "Jeu" | "Ven" | "Sam" | "Dim";
export type SessionType = "easy" | "threshold" | "intervals" | "rest" | "long" | "race";

export type Session = {
  id: string;
  day: DayKey;
  type: SessionType;
  titleShort: string;
  subtitleShort?: string;
  details: string;
  durationMin?: number;
  targetPace?: string;
  notes?: string;
};

const DAYS: DayKey[] = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function typeLabelFR(t: SessionType) {
  switch (t) {
    case "easy":
      return "EF";
    case "threshold":
      return "Seuil";
    case "intervals":
      return "Frac";
    case "long":
      return "SL";
    case "race":
      return "Race";
    default:
      return "Repos";
  }
}

function typeIcon(t: SessionType): keyof typeof Ionicons.glyphMap {
  switch (t) {
    case "easy":
      return "leaf-outline";
    case "threshold":
      return "speedometer-outline";
    case "intervals":
      return "flash-outline";
    case "long":
      return "hourglass-outline";
    case "race":
      return "trophy-outline";
    default:
      return "moon-outline";
  }
}

/** Accents “DA-safe” (une seule identité orange + neutres) */
function typeAccent(t: SessionType) {
  // on garde la DA: primary pour “séance clé”, neutre pour repos / easy
  const key = typeLabelFR(t);
  const hard = t === "threshold" || t === "intervals" || t === "race";
  const long = t === "long";
  const rest = t === "rest";

  if (rest) return { bg: "rgba(149,165,166,0.14)", bd: "rgba(149,165,166,0.28)", code: key, dot: false };
  if (hard) return { bg: "rgba(239,59,0,0.16)", bd: "rgba(239,59,0,0.30)", code: key, dot: true };
  if (long) return { bg: "rgba(239,59,0,0.12)", bd: "rgba(239,59,0,0.24)", code: key, dot: true };

  // easy
  return { bg: "rgba(70,200,120,0.12)", bd: "rgba(70,200,120,0.22)", code: key, dot: false };
}

type Props = {
  title?: string;
  sessions: Session[];
  initialDay?: DayKey;
  onDayPress?: (session: Session) => void; // navigation plan / détail séance
  onDaySelect?: (day: DayKey) => void; // optionnel
  longPressMs?: number;
};

function WeekPlanCardImpl({
  title = "Plan de la semaine",
  sessions,
  initialDay = "Lun",
  onDayPress,
  onDaySelect,
  longPressMs = 240,
}: Props) {
  const [selectedDay, setSelectedDay] = useState<DayKey>(initialDay);
  const [sheetSession, setSheetSession] = useState<Session | null>(null);

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["42%", "78%"], []);

  const byDay = useMemo(() => {
    const m = new Map<DayKey, Session>();
    for (const s of sessions) m.set(s.day, s);
    return m;
  }, [sessions]);

  const getSessionForDay = useCallback(
    (day: DayKey): Session => {
      return (
        byDay.get(day) ?? {
          id: `rest-${day}`,
          day,
          type: "rest",
          titleShort: "Repos",
          subtitleShort: "",
          details: "Récupération. Marche douce / mobilité si besoin.",
        }
      );
    },
    [byDay]
  );

  const openSheet = useCallback((s: Session) => {
    setSheetSession(s);

    if (Platform.OS !== "web") {
      const msg = `Séance ${s.day} : ${s.titleShort}`;
      AccessibilityInfo.announceForAccessibility?.(msg);
    }

    requestAnimationFrame(() => sheetRef.current?.snapToIndex(0));
  }, []);

  const closeSheet = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  const handlePressDay = useCallback(
    (day: DayKey) => {
      setSelectedDay(day);
      onDaySelect?.(day);

      const s = getSessionForDay(day);
      onDayPress?.(s);
    },
    [getSessionForDay, onDayPress, onDaySelect]
  );

  const handleLongPressDay = useCallback(
    (day: DayKey) => {
      const s = getSessionForDay(day);
      openSheet(s);
    },
    [getSessionForDay, openSheet]
  );

  const selected = useMemo(() => getSessionForDay(selectedDay), [getSessionForDay, selectedDay]);

  return (
    <>
      <View style={s.card}>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{title}</Text>
            <Text style={s.cardSub} numberOfLines={1}>
              {selected.day} • {typeLabelFR(selected.type)} • {selected.titleShort}
            </Text>
          </View>

          <Pressable
            onPress={() => openSheet(selected)}
            style={({ pressed }) => [s.previewBtn, pressed && { opacity: 0.85 }]}
            hitSlop={10}
          >
            <Ionicons name="information-circle-outline" size={18} color={theme.colors.text2} />
          </Pressable>
        </View>

        <View style={s.accentBar} />

        <View style={s.daysRow}>
          {DAYS.map((day) => {
            const sess = getSessionForDay(day);
            const isSelected = selectedDay === day;
            const a = typeAccent(sess.type);

            return (
              <Pressable
                key={day}
                onPress={() => handlePressDay(day)}
                onLongPress={() => handleLongPressDay(day)}
                delayLongPress={longPressMs}
                hitSlop={8}
                style={({ pressed }) => [
                  s.dayChip,
                  {
                    borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: "rgba(255,255,255,0.02)",
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Jour ${day}. ${sess.titleShort}. Maintiens pour aperçu.`}
              >
                <View style={s.dayTopRow}>
                  <Text style={[s.dayLabel, isSelected && { color: theme.colors.primary }]}>{day}</Text>
                  <Ionicons name={typeIcon(sess.type)} size={14} color={theme.colors.text2} />
                </View>

                <Text numberOfLines={1} style={s.sessionLabel}>
                  {sess.titleShort || "Repos"}
                </Text>

                {!!sess.subtitleShort && (
                  <Text numberOfLines={1} style={s.sessionSub}>
                    {sess.subtitleShort}
                  </Text>
                )}

                <View style={[s.codePill, { backgroundColor: a.bg, borderColor: a.bd }]}>
                  <Text style={s.codeTxt}>{a.code}</Text>
                  {a.dot ? <View style={s.dot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.hint}>Tap : sélectionner / ouvrir • Maintien : aperçu complet</Text>
      </View>

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={() => setSheetSession(null)}
        backgroundStyle={s.sheetBg}
        handleIndicatorStyle={s.sheetHandle}
      >
        <BottomSheetView style={s.sheetContent}>
          {sheetSession ? (
            <>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={s.sheetKicker}>{sheetSession.day} • {typeLabelFR(sheetSession.type)}</Text>
                  <Text style={s.sheetTitle}>{sheetSession.titleShort}</Text>
                </View>

                <Pressable onPress={closeSheet} style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.85 }]}>
                  <Text style={s.closeText}>Fermer</Text>
                </Pressable>
              </View>

              <View style={s.sheetMetaRow}>
                {typeof sheetSession.durationMin === "number" && sheetSession.durationMin > 0 ? (
                  <View style={s.metaPill}>
                    <Ionicons name="time-outline" size={14} color={theme.colors.text2} />
                    <Text style={s.metaText}>{Math.round(sheetSession.durationMin)} min</Text>
                  </View>
                ) : null}

                {!!sheetSession.targetPace ? (
                  <View style={s.metaPill}>
                    <Ionicons name="speedometer-outline" size={14} color={theme.colors.text2} />
                    <Text style={s.metaText}>{sheetSession.targetPace}</Text>
                  </View>
                ) : null}

                <View style={s.metaPill}>
                  <Ionicons name="sparkles-outline" size={14} color={theme.colors.primary} />
                  <Text style={[s.metaText, { color: theme.colors.text }]}>{typeLabelFR(sheetSession.type)}</Text>
                </View>
              </View>

              <Text style={s.sheetSectionTitle}>Détails</Text>
              <Text style={s.sheetBody}>{sheetSession.details}</Text>

              {!!sheetSession.notes ? (
                <>
                  <Text style={s.sheetSectionTitle}>Notes</Text>
                  <Text style={s.sheetBodyMuted}>{sheetSession.notes}</Text>
                </>
              ) : null}
            </>
          ) : (
            <Text style={s.sheetBodyMuted}>Aucune séance sélectionnée.</Text>
          )}
        </BottomSheetView>
      </BottomSheet>
    </>
  );
}

export const WeekPlanCard = memo(WeekPlanCardImpl);

/* -------------------------------- styles -------------------------------- */

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cardTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  cardSub: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  previewBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  accentBar: {
    height: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
    marginTop: 12,
    marginBottom: 12,
    opacity: 0.85,
  },

  daysRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },

  dayChip: {
    width: 108,
    minHeight: 92,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    justifyContent: "space-between",
  },

  dayTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayLabel: { color: theme.colors.text2, fontSize: 12, fontWeight: "900" },

  sessionLabel: { marginTop: 8, fontSize: 13, fontWeight: "900", color: theme.colors.text },
  sessionSub: { marginTop: 3, fontSize: 12, color: theme.colors.text2, fontWeight: "800" },

  codePill: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  codeTxt: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 0.6 },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: theme.colors.primary },

  hint: { marginTop: 10, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  /* Bottom Sheet */
  sheetBg: { backgroundColor: theme.colors.bg },
  sheetHandle: { backgroundColor: "rgba(255,255,255,0.25)", width: 48 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 18 },

  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 10,
  },
  sheetKicker: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },
  sheetTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 18, marginTop: 6 },

  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  closeText: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },

  sheetMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },

  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: { color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  sheetSectionTitle: {
    marginTop: 10,
    marginBottom: 6,
    color: theme.colors.text2,
    fontWeight: "900",
    fontSize: 13,
  },
  sheetBody: { color: theme.colors.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  sheetBodyMuted: { color: theme.colors.text2, fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
