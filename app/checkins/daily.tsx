// app/checkins/daily.tsx
import React, { memo, useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { theme } from "@/constants/theme";
import { Screen, Card } from "@/components/ui";
import { saveDailyCheckinAnswer } from "@/storage/checkins";

type Option = {
  id: "top" | "good" | "ok" | "low" | "bad";
  title: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function DailyCheckinScreen() {
  const router = useRouter();

  const options = useMemo<Option[]>(
    () => [
      { id: "top", title: "Très bien", hint: "Énergie haute • motivation OK", icon: "sunny-outline" },
      { id: "good", title: "Bien", hint: "Rien à signaler", icon: "happy-outline" },
      { id: "ok", title: "Moyen", hint: "Fatigue légère • journée chargée", icon: "remove-circle-outline" },
      { id: "low", title: "Fatigué", hint: "Besoin de récupérer", icon: "moon-outline" },
      { id: "bad", title: "Pas bien", hint: "Douleurs • stress • manque de sommeil", icon: "warning-outline" },
    ],
    []
  );

  const [selected, setSelected] = useState<Option["id"] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const canContinue = !!selected && !saving;

  const onSelect = useCallback((id: Option["id"]) => {
    setSelected(id);
  }, []);

  const onContinue = useCallback(async () => {
    if (!selected || saving) return;

    try {
      setSaving(true);
      const trimmed = note.trim();

      await saveDailyCheckinAnswer({
        choice: selected,
        note: trimmed ? trimmed : undefined,
      });

      router.replace("/(tabs)/home");
    } finally {
      setSaving(false);
    }
  }, [selected, saving, note, router]);

  const subtitle = useMemo(() => "Une seule question, une seule fois par jour.", []);

  return (
    <Screen title="Comment vas-tu ?" subtitle={subtitle}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Card style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.question}>Ton état général aujourd’hui ?</Text>
              <Text style={styles.microHint}>Choisis le plus proche, sans te justifier.</Text>
            </View>

            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={14} color={theme.colors.text2} />
              <Text style={styles.badgeTxt}>Quotidien</Text>
            </View>
          </View>

          <View style={styles.optionsWrap}>
            {options.map((o) => {
              const active = selected === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onSelect(o.id)}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.pressed,
                  ]}
                  hitSlop={6}
                >
                  <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                    <Ionicons
                      name={o.icon}
                      size={18}
                      color={active ? theme.colors.primary : theme.colors.text2}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{o.title}</Text>
                    <Text style={[styles.optionHint, active && styles.optionHintActive]}>{o.hint}</Text>
                  </View>

                  <Ionicons
                    name={active ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={active ? theme.colors.primary : theme.colors.textMuted}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.noteBlock}>
            <View style={styles.noteHeader}>
              <Text style={styles.label}>Note (optionnel)</Text>
              <Text style={styles.counter}>{note.trim().length}/160</Text>
            </View>

            <TextInput
              value={note}
              onChangeText={(t) => (t.length <= 160 ? setNote(t) : setNote(t.slice(0, 160)))}
              placeholder="Sommeil, stress, douleurs…"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              multiline
              textAlignVertical="top"
              returnKeyType="done"
            />
          </View>

          <View style={styles.footerRow}>
            <Pressable
              onPress={() => router.back()}
              disabled={saving}
              style={({ pressed }) => [
                styles.ghostBtn,
                pressed && styles.pressed,
                saving && { opacity: 0.55 },
              ]}
              hitSlop={6}
            >
              <Ionicons name="chevron-back" size={16} color={theme.colors.text2} />
              <Text style={styles.ghostTxt}>Plus tard</Text>
            </Pressable>

            <Pressable
              onPress={onContinue}
              disabled={!canContinue}
              style={({ pressed }) => [
                styles.cta,
                !canContinue && { opacity: 0.5 },
                pressed && styles.pressed,
              ]}
              hitSlop={6}
            >
              {saving ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.ctaText}>Enregistrement…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="checkmark-outline" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Continuer</Text>
                </>
              )}
            </Pressable>
          </View>
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default memo(DailyCheckinScreen);

const styles = StyleSheet.create({
  card: { padding: 14, gap: 12 },
  pressed: { opacity: 0.86 },

  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  question: { color: theme.colors.text, fontSize: 18, fontWeight: "900" as any },
  microHint: { marginTop: 4, color: theme.colors.text2, fontSize: 12, lineHeight: 16, fontWeight: "700" },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  badgeTxt: { color: theme.colors.text2, fontSize: 12, fontWeight: "800" },

  optionsWrap: { gap: 10 },

  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    padding: 12,
  },
  optionActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface2,
  },

  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  optionIconActive: {
    borderColor: theme.colors.primary,
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  optionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" as any },
  optionTitleActive: { color: theme.colors.primary },
  optionHint: { color: theme.colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  optionHintActive: { color: theme.colors.text },

  noteBlock: { gap: 6 },
  noteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800" },
  counter: { color: theme.colors.text2, fontSize: 12, fontWeight: "800" },

  input: {
    minHeight: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
  },

  footerRow: { marginTop: 2, flexDirection: "row", gap: 10, alignItems: "center" },

  ghostBtn: {
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  ghostTxt: { color: theme.colors.text2, fontSize: 13, fontWeight: "900" as any },

  cta: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  ctaText: { color: "#fff", fontSize: 13, fontWeight: "900" as any },
});
