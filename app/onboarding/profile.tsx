// app/onboarding/profile.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { theme } from "@/constants/theme";
import { Card, Screen, SectionTitle, ButtonPrimary } from "@/components/ui";
import * as onboarding from "@/storage/onboarding";

/* -------------------------------- helpers -------------------------------- */

function toDigits(v: string) {
  return (v ?? "").replace(/[^\d]/g, "");
}

function toInt(v: string) {
  const n = parseInt(toDigits(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloatFR(v: string) {
  const clean = String(v ?? "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function safeTrim(s: string) {
  return String(s ?? "").trim();
}

type FieldError = Partial<Record<"name" | "age" | "height" | "weight", string>>;

type DraftProfile = {
  name?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
};

/* -------------------------------- component -------------------------------- */

export default memo(function Profile() {
  const router = useRouter();

  const aliveRef = useRef(true);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldError>({});

  /**
   * 🔧 Mode:
   * - false: profil recommandé (vide autorisé, mais si rempli doit être cohérent)
   * - true : profil obligatoire (tous champs requis + cohérents)
   */
  const REQUIRE_FULL_PROFILE = false;

  /* ------------------------------ load draft ------------------------------ */

  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      try {
        const d = await onboarding.loadOnboarding().catch(() => null);
        if (!aliveRef.current) return;

        const p: any = d?.profile ?? {};

        if (typeof p?.name === "string") setName(p.name);
        if (typeof p?.age === "number") setAge(String(p.age));
        if (typeof p?.heightCm === "number") setHeightCm(String(p.heightCm));
        if (typeof p?.weightKg === "number") setWeightKg(String(p.weightKg));
      } finally {
        if (!aliveRef.current) return;
        setLoading(false);
      }
    })();

    return () => {
      aliveRef.current = false;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    };
  }, []);

  /* ------------------------------ parsing -------------------------------- */

  const parsed = useMemo(() => {
    const nameTrim = safeTrim(name);

    const ageN = toInt(age);
    const heightN = toInt(heightCm);
    const weightN = Math.round(toFloatFR(weightKg));

    // validations "hard"
    const nameOk = nameTrim.length >= 2;
    const ageOk = ageN >= 10 && ageN <= 99;
    const heightOk = heightN >= 120 && heightN <= 230;
    const weightOk = weightN >= 30 && weightN <= 250;

    // soft mode: empty ok; if filled, must be valid
    const softNameOk = nameTrim.length === 0 || nameOk;
    const softAgeOk = age.trim().length === 0 || ageOk;
    const softHeightOk = heightCm.trim().length === 0 || heightOk;
    const softWeightOk = weightKg.trim().length === 0 || weightOk;

    const strictValid = nameOk && ageOk && heightOk && weightOk;
    const softValid = softNameOk && softAgeOk && softHeightOk && softWeightOk;

    const anyFilled = !!nameTrim || !!age.trim() || !!heightCm.trim() || !!weightKg.trim();
    const recommendedFilled = nameOk && ageOk && heightOk && weightOk;

    return {
      nameTrim,
      ageN,
      heightN,
      weightN,
      nameOk,
      ageOk,
      heightOk,
      weightOk,
      anyFilled,
      recommendedFilled,
      strictValid,
      softValid,
    };
  }, [name, age, heightCm, weightKg]);

  const canContinue = REQUIRE_FULL_PROFILE ? parsed.strictValid : parsed.softValid;

  /* --------------------------- draft autosave ---------------------------- */

  const buildDraftPayload = useCallback((): DraftProfile => {
    const p: DraftProfile = {};
    if (parsed.nameTrim) p.name = parsed.nameTrim;
    if (parsed.ageN) p.age = parsed.ageN;
    if (parsed.heightN) p.heightCm = parsed.heightN;
    if (parsed.weightN) p.weightKg = parsed.weightN;
    return p;
  }, [parsed]);

  const scheduleDraftSave = useCallback(() => {
    if (loading) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);

    // debounce léger pour éviter d’écrire à chaque frappe
    draftTimerRef.current = setTimeout(() => {
      const profile = buildDraftPayload();
      onboarding.saveOnboarding({ profile }).catch(() => {});
    }, 350);
  }, [loading, buildDraftPayload]);

  /* ---------------------------- error builder ---------------------------- */

  const buildFieldErrors = useCallback((): FieldError => {
    const fe: FieldError = {};

    if (REQUIRE_FULL_PROFILE) {
      if (!parsed.nameOk) fe.name = "Entre au moins 2 caractères.";
      if (!parsed.ageOk) fe.age = "Âge invalide (10–99).";
      if (!parsed.heightOk) fe.height = "Taille invalide (120–230 cm).";
      if (!parsed.weightOk) fe.weight = "Poids invalide (30–250 kg).";
      return fe;
    }

    // soft: only show error when the field is not empty and invalid
    if (name.trim().length > 0 && !parsed.nameOk) fe.name = "Entre au moins 2 caractères.";
    if (age.trim().length > 0 && !parsed.ageOk) fe.age = "Âge invalide (10–99).";
    if (heightCm.trim().length > 0 && !parsed.heightOk) fe.height = "Taille invalide (120–230 cm).";
    if (weightKg.trim().length > 0 && !parsed.weightOk) fe.weight = "Poids invalide (30–250 kg).";

    return fe;
  }, [REQUIRE_FULL_PROFILE, parsed, name, age, heightCm, weightKg]);

  /* ------------------------------- actions ------------------------------- */

  const saveAndContinue = useCallback(async () => {
    if (loading || saving) return;

    setFormError(null);

    const fe = buildFieldErrors();
    setFieldError(fe);

    if (!canContinue) {
      setFormError(REQUIRE_FULL_PROFILE ? "Complète le profil pour continuer." : "Vérifie les champs en rouge.");
      return;
    }

    // Patch: soft mode + rien rempli => profil optionnel, on peut laisser vide
    const profile = buildDraftPayload();

    setSaving(true);
    try {
      // flush timer + save final
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;

      await onboarding.saveOnboarding({ profile });

      router.replace("/onboarding/program");
    } catch (e: any) {
      setFormError(e?.message ?? "Erreur lors de l’enregistrement.");
    } finally {
      if (!aliveRef.current) return;
      setSaving(false);
    }
  }, [loading, saving, buildFieldErrors, canContinue, REQUIRE_FULL_PROFILE, buildDraftPayload, router]);

  const onSkip = useCallback(() => {
    if (REQUIRE_FULL_PROFILE) return;
    router.replace("/onboarding/program");
  }, [REQUIRE_FULL_PROFILE, router]);

  const headerHint = useMemo(() => {
    if (loading) return "Chargement…";
    if (REQUIRE_FULL_PROFILE) return "Nécessaire pour personnaliser ton plan.";
    return parsed.recommendedFilled ? "Profil complet ✅" : "Recommandé (tu peux compléter plus tard).";
  }, [loading, REQUIRE_FULL_PROFILE, parsed.recommendedFilled]);

  /* -------------------------------- render -------------------------------- */

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={s.wrap}>
          <Text style={s.brand}>pacepilot</Text>
          <Text style={s.h1}>Complète ton profil</Text>
          <Text style={s.hint}>{headerHint}</Text>

          <Card style={{ marginTop: 14 }}>
            <View style={s.headerRow}>
              <SectionTitle>Infos</SectionTitle>
              {loading ? <ActivityIndicator /> : null}
            </View>

            {/* Nom */}
            <Text style={s.label}>Nom</Text>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setFieldError((p) => ({ ...p, name: undefined }));
                scheduleDraftSave();
              }}
              style={[s.input, fieldError.name && s.inputErr]}
              autoCapitalize="words"
              placeholder="Ex: Wistan"
              placeholderTextColor={theme.colors.text2}
              returnKeyType="next"
            />
            {!!fieldError.name && <Text style={s.errField}>{fieldError.name}</Text>}

            {/* Âge + Taille */}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Âge</Text>
                <TextInput
                  value={age}
                  onChangeText={(v) => {
                    setAge(toDigits(v));
                    setFieldError((p) => ({ ...p, age: undefined }));
                    scheduleDraftSave();
                  }}
                  keyboardType="number-pad"
                  style={[s.input, fieldError.age && s.inputErr]}
                  placeholder="Ex: 33"
                  placeholderTextColor={theme.colors.text2}
                />
                {!!fieldError.age && <Text style={s.errField}>{fieldError.age}</Text>}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.label}>Taille (cm)</Text>
                <TextInput
                  value={heightCm}
                  onChangeText={(v) => {
                    setHeightCm(toDigits(v));
                    setFieldError((p) => ({ ...p, height: undefined }));
                    scheduleDraftSave();
                  }}
                  keyboardType="number-pad"
                  style={[s.input, fieldError.height && s.inputErr]}
                  placeholder="Ex: 178"
                  placeholderTextColor={theme.colors.text2}
                />
                {!!fieldError.height && <Text style={s.errField}>{fieldError.height}</Text>}
              </View>
            </View>

            {/* Poids */}
            <Text style={s.label}>Poids (kg)</Text>
            <TextInput
              value={weightKg}
              onChangeText={(v) => {
                // accepte "70,5" ou "70.5"
                const clean = String(v ?? "").replace(".", ",");
                setWeightKg(clean);
                setFieldError((p) => ({ ...p, weight: undefined }));
                scheduleDraftSave();
              }}
              keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "decimal-pad"}
              style={[s.input, fieldError.weight && s.inputErr]}
              placeholder="Ex: 70,5"
              placeholderTextColor={theme.colors.text2}
            />
            {!!fieldError.weight && <Text style={s.errField}>{fieldError.weight}</Text>}

            {/* CTA */}
            <View style={{ marginTop: 14, opacity: saving || loading ? 0.6 : 1 }}>
              <ButtonPrimary label={saving ? "Enregistrement…" : "Continuer"} onPress={saveAndContinue} />
            </View>

            {/* Secondary actions */}
            {formError ? <Text style={s.err}>{formError}</Text> : null}

            <View style={s.bottomRow}>
              {!REQUIRE_FULL_PROFILE ? (
                <Pressable onPress={onSkip} hitSlop={10}>
                  <Text style={s.link}>Passer</Text>
                </Pressable>
              ) : (
                <View />
              )}

              <Pressable onPress={() => router.replace("/(auth)/login")} hitSlop={10}>
                <Text style={s.link}>Retour</Text>
              </Pressable>
            </View>

            {/* Mini “qualité” */}
            {!REQUIRE_FULL_PROFILE && parsed.anyFilled && !parsed.recommendedFilled ? (
              <Text style={s.micro}>Astuce : avec âge + taille + poids, le coach peut mieux doser la charge.</Text>
            ) : null}
          </Card>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
});

/* -------------------------------- styles -------------------------------- */

const s = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 24 },
  brand: { color: theme.colors.text2, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  h1: { marginTop: 8, fontSize: 26, fontWeight: "900", color: theme.colors.text },
  hint: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  label: { marginTop: 12, marginBottom: 6, color: theme.colors.text, fontWeight: "800" },
  input: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontWeight: "800",
  },
  inputErr: {
    borderColor: (theme.colors as any).danger ?? theme.colors.primary,
  },

  row: { flexDirection: "row", gap: 10 },

  bottomRow: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: theme.colors.primary, fontWeight: "900" },

  err: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },
  errField: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  micro: { marginTop: 10, color: theme.colors.text2, fontWeight: "700", fontSize: 12, lineHeight: 16 },
});
