import React, { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/constants/theme";
import { Card } from "@/components/ui";
import type { WeeklyPlanDay } from "@/storage/weeklyPlan";

/* --------------------------------- types --------------------------------- */

type Props = {
  day: WeeklyPlanDay | null;
  loading?: boolean;

  /** optionnel : heure conseillée style "11:30" */
  recommendedTime?: string | null;

  /** optionnel : sous-texte type (ex) "Charge maîtrisée • progression continue" */
  statusLine?: string | null;

  /** 2–3 bullets max */
  tips?: string[];

  /** si tu veux permettre un clic */
  onPress?: (() => void) | null;

  /** optionnel : style externe */
  style?: StyleProp<ViewStyle>;
};

/* -------------------------------- helpers -------------------------------- */

function firstLine(text?: string | null): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const line = t.split("\n")[0] ?? "";
  return line.trim();
}

function safeStr(v: unknown): string {
  const s = typeof v === "string" ? v : String(v ?? "");
  return s.trim();
}

function workoutLabel(workout?: string | null): string {
  const raw = safeStr(workout);
  if (!raw) return "—";

  const t = raw.toLowerCase();

  // match “mots” plutôt que "includes" trop large
  if (/\brepos\b/.test(t)) return "Repos";
  if (/\brenfo\b/.test(t)) return "Renfo";
  if (/\b(vélo|velo)\b/.test(t)) return "Vélo";
  if (/\bfraction(né)?\b/.test(t)) return "Fractionné";
  if (/\bseuil\b/.test(t)) return "Seuil";
  if (/\blong(ue)?\b/.test(t) || t.includes("sortie longue")) return "Sortie longue";
  if (/\bef\b/.test(t)) return "Footing";

  return raw || "Séance";
}

function pickAiTips(day: WeeklyPlanDay | null): string[] {
  if (!day) return [];
  const anyDay = day as any;
  const raw = Array.isArray(anyDay.aiReasonsText) ? anyDay.aiReasonsText : [];
  const cleaned = raw
    .map((x: any) => safeStr(x))
    .filter(Boolean);

  return cleaned.slice(0, 3);
}

function defaultTips(day: WeeklyPlanDay | null): string[] {
  if (!day) return [];

  const ai = pickAiTips(day);
  if (ai.length) return ai;

  const w = safeStr(day.workout).toLowerCase();

  if (w.includes("sortie longue") || /\blong(ue)?\b/.test(w)) {
    return ["Hydrate-toi régulièrement", "Reste facile en zone 2", "Garde du jus pour la fin"];
  }
  if (w.includes("fraction") || w.includes("interv") || w.includes("vma")) {
    return ["Échauffe-toi 10–15 min", "Récup complète entre les blocs", "Relâche les épaules"];
  }
  if (w.includes("seuil") || w.includes("tempo")) {
    return ["Démarre progressif", "Reste “confortablement dur”", "Respiration contrôlée"];
  }
  if (w.includes("repos") || w.includes("renfo") || w.includes("vélo") || w.includes("velo")) {
    return ["Objectif : récupérer", "Très facile, pas d’ego", "Mobilité 5–10 min"];
  }

  return ["Reste facile", "Cadence souple", "Finis frais"];
}

function normalizeTips(tips?: string[] | null, day?: WeeklyPlanDay | null): string[] {
  const t = (tips ?? [])
    .map((x) => safeStr(x))
    .filter(Boolean);

  if (t.length) return t.slice(0, 3);
  return defaultTips(day ?? null);
}

/* -------------------------------- component -------------------------------- */

function TodayCard({
  day,
  loading = false,
  recommendedTime = null,
  statusLine = null,
  tips,
  onPress = null,
  style,
}: Props) {
  const isPressable = typeof onPress === "function";

  const label = useMemo(() => workoutLabel(day?.workout), [day?.workout]);
  const detail = useMemo(() => firstLine(day?.details) || "—", [day?.details]);

  const computedTips = useMemo(() => normalizeTips(tips, day), [tips, day]);

  const meta = useMemo(() => {
    const sLine = safeStr(statusLine);
    if (sLine) return sLine;

    if (!day) return "—";

    const anyDay = day as any;
    if (anyDay.aiMode) return "Optimisé (météo + récupération)";
    return "Plan personnalisé";
  }, [statusLine, day]);

  const content = (
    <View style={s.inner}>
      {/* top */}
      <View style={s.topRow}>
        <View style={s.pin} accessibilityLabel="Séance du jour">
          <Ionicons name="navigate-circle-outline" size={22} color={theme.colors.primary} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.headLine}>
            <Text style={s.todayLabel}>Aujourd&apos;hui</Text>

            {safeStr(recommendedTime) ? (
              <View style={s.timePill} accessibilityLabel={`Heure conseillée ${recommendedTime}`}>
                <Ionicons name="time-outline" size={14} color={theme.colors.text2} />
                <Text style={s.timeTxt} numberOfLines={1}>
                  {recommendedTime}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={s.title} numberOfLines={2}>
            {label} • {detail}
          </Text>

          <Text style={s.meta} numberOfLines={2}>
            {meta}
          </Text>
        </View>

        {isPressable ? (
          <Ionicons name="chevron-forward-outline" size={18} color={theme.colors.text2} />
        ) : null}
      </View>

      {/* tips / empty states */}
      <View style={s.tipList}>
        {loading ? (
          <Text style={s.muted}>Chargement…</Text>
        ) : !day ? (
          <Text style={s.muted}>Aucune séance aujourd’hui.</Text>
        ) : (
          computedTips.map((t, i) => (
            <View key={`tip-${i}`} style={s.tipRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.primary} />
              <Text style={s.tipTxt} numberOfLines={2}>
                {t}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );

  return (
    <Card style={style}>
      {isPressable ? (
        <Pressable
          onPress={onPress ?? undefined}
          style={({ pressed }) => (pressed ? s.pressed : undefined)}
          accessibilityRole="button"
          accessibilityLabel="Voir la séance du jour"
          accessibilityHint="Ouvre le détail de la séance et les options"
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </Card>
  );
}

export default memo(TodayCard);

/* --------------------------------- styles -------------------------------- */

const PIN_BG = "rgba(239,59,0,0.10)";
const PIN_BORDER = "rgba(239,59,0,0.22)";
const PILL_BG = "rgba(255,255,255,0.03)";

const s = StyleSheet.create({
  pressed: { opacity: 0.92 },

  inner: {},

  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  pin: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PIN_BG,
    borderWidth: 1,
    borderColor: PIN_BORDER,
    marginTop: 2,
  },

  headLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  todayLabel: {
    fontWeight: "900",
    color: theme.colors.text2,
  },

  timePill: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: PILL_BG,
  },

  timeTxt: {
    fontWeight: "900",
    color: theme.colors.text2,
    fontSize: 12,
    maxWidth: 110,
  },

  title: {
    marginTop: 6,
    fontWeight: "900",
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
  },

  meta: {
    marginTop: 6,
    fontWeight: "800",
    color: theme.colors.text2,
    lineHeight: 18,
  },

  tipList: {
    marginTop: 12,
    gap: 8,
  },

  tipRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },

  tipTxt: {
    color: theme.colors.text,
    fontWeight: "800",
    lineHeight: 18,
    flex: 1,
    minWidth: 0,
  },

  muted: {
    color: theme.colors.text2,
    fontWeight: "800",
  },
});
