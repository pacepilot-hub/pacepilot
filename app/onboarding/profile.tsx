import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";

import { theme } from "@/constants/theme";
import { Card, Screen, SectionTitle, ButtonPrimary } from "@/components/ui";
import * as onboarding from "@/storage/onboarding";
import type { Injury, Level, Sex, Sport } from "@/storage/onboarding";

const SPORTS: Sport[] = [
  "Course à pied",
  "Trail",
  "Triathlon",
  "Biathlon",
  "Vélo route",
  "VTT",
  "Randonnée",
  "Natation",
  "Fitness",
  "Yoga",
  "Mobilité",
  "CrossFit",
  "HIIT",
  "Calisthenics",
  "Musculation",
];

const SEXES: Sex[] = ["Homme", "Femme", "Autre", "Non précisé"];

const EQUIPMENT = [
  "Home trainer",
  "Piscine",
  "Salle de sport",
  "Tapis de course",
  "Montre GPS",
  "Capteur cardio",
  "Vélo",
  "Haltères",
] as const;

const DOW = [
  { idx: 0, label: "Lun" },
  { idx: 1, label: "Mar" },
  { idx: 2, label: "Mer" },
  { idx: 3, label: "Jeu" },
  { idx: 4, label: "Ven" },
  { idx: 5, label: "Sam" },
  { idx: 6, label: "Dim" },
] as const;

function isSport(x: unknown): x is Sport {
  return typeof x === "string" && (SPORTS as readonly string[]).includes(x);
}

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

function uniqDays(days: number[]) {
  return Array.from(new Set(days))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .slice(0, 6);
}

function deriveLevel(yearsPractice: number): Level {
  if (yearsPractice >= 8) return "Élite";
  if (yearsPractice >= 4) return "Avancé";
  if (yearsPractice >= 1) return "Intermédiaire";
  return "Débutant";
}

function bmiLabel(bmi: number | null) {
  if (bmi == null) return "-";
  if (bmi < 18.5) return `${bmi.toFixed(1)} (insuffisance)`;
  if (bmi < 25) return `${bmi.toFixed(1)} (normal)`;
  if (bmi < 30) return `${bmi.toFixed(1)} (surpoids)`;
  return `${bmi.toFixed(1)} (élevé)`;
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.86 }]}>
      <Text style={[s.chipTxt, active && s.chipTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function DayPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.day, active && s.dayOn, pressed && { opacity: 0.86 }]}>
      <Text style={[s.dayTxt, active && s.dayTxtOn]}>{label}</Text>
    </Pressable>
  );
}

export default memo(function Profile() {
  const router = useRouter();
  const aliveRef = useRef(true);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [name, setName] = useState("");
  const [sex, setSex] = useState<Sex>("Non précisé");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [yearsPractice, setYearsPractice] = useState("");

  const [sports, setSports] = useState<Sport[]>(["Course à pied"]);
  const [trainingDays, setTrainingDays] = useState<number[]>([1, 3, 6]);
  const [sessionDurationMin, setSessionDurationMin] = useState("60");

  const [equipment, setEquipment] = useState<string[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);

  const [city, setCity] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const ageN = toInt(age);
    const h = toInt(heightCm);
    const w = toFloatFR(weightKg);
    const years = toInt(yearsPractice);
    const duration = toInt(sessionDurationMin);

    const bmi = h > 0 && w > 0 ? w / Math.pow(h / 100, 2) : null;

    return {
      ageN,
      h,
      w,
      years,
      duration,
      level: deriveLevel(years),
      bmi,
    };
  }, [age, heightCm, weightKg, yearsPractice, sessionDurationMin]);

  const canContinue = useMemo(() => {
    return (
      name.trim().length >= 2 &&
      parsed.ageN >= 10 &&
      parsed.ageN <= 99 &&
      parsed.h >= 120 &&
      parsed.h <= 230 &&
      parsed.w >= 30 &&
      parsed.w <= 250 &&
      parsed.years >= 0 &&
      parsed.years <= 70 &&
      sports.length >= 1 &&
      trainingDays.length >= 1 &&
      trainingDays.length <= 6 &&
      parsed.duration >= 15 &&
      parsed.duration <= 240
    );
  }, [name, parsed, sports.length, trainingDays.length]);

  const scheduleDraftSave = useCallback(() => {
    if (loading) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);

    draftTimerRef.current = setTimeout(() => {
      onboarding
        .saveOnboarding({
          profile: {
            name: name.trim(),
            sex,
            age: parsed.ageN,
            heightCm: parsed.h,
            weightKg: Math.round(parsed.w * 10) / 10,
            yearsPractice: parsed.years,
            level: parsed.level,
            sports,
            injuries,
            availability: {
              trainingDays,
              sessionDurationMin: parsed.duration,
            },
            equipment,
            location:
              locationLat != null && locationLng != null
                ? {
                    lat: locationLat,
                    lng: locationLng,
                    city: city || undefined,
                  }
                : undefined,
          } as any,
        })
        .catch(() => {});
    }, 350);
  }, [
    loading,
    name,
    sex,
    parsed,
    sports,
    injuries,
    trainingDays,
    equipment,
    locationLat,
    locationLng,
    city,
  ]);

  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      try {
        const data = await onboarding.loadOnboarding().catch(() => null);
        if (!aliveRef.current) return;

        const p: any = data?.profile ?? {};

        if (typeof p?.name === "string") setName(p.name);
        if (typeof p?.sex === "string") setSex(p.sex);
        if (typeof p?.age === "number") setAge(String(p.age));
        if (typeof p?.heightCm === "number") setHeightCm(String(p.heightCm));
        if (typeof p?.weightKg === "number") setWeightKg(String(p.weightKg));
        if (typeof p?.yearsPractice === "number") setYearsPractice(String(p.yearsPractice));

        if (Array.isArray(p?.sports) && p.sports.length) {
          setSports(p.sports.filter((x: unknown) => isSport(x)).slice(0, 6));
        }

        if (Array.isArray(p?.injuries)) setInjuries(p.injuries.slice(0, 6));

        const td = Array.isArray(p?.availability?.trainingDays) ? uniqDays(p.availability.trainingDays) : null;
        if (td && td.length) setTrainingDays(td);

        const d = Number(p?.availability?.sessionDurationMin);
        if (Number.isFinite(d) && d > 0) setSessionDurationMin(String(Math.round(d)));

        if (Array.isArray(p?.equipment)) setEquipment(p.equipment.slice(0, 20));

        if (p?.location?.lat != null && p?.location?.lng != null) {
          setLocationLat(Number(p.location.lat));
          setLocationLng(Number(p.location.lng));
          if (typeof p.location.city === "string") setCity(p.location.city);
        }
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    })();

    return () => {
      aliveRef.current = false;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    };
  }, []);

  const toggleSport = useCallback((x: Sport) => {
    setSports((prev) => {
      const has = prev.includes(x);
      if (has && prev.length <= 1) return prev;
      const next = has ? prev.filter((s) => s !== x) : [...prev, x].slice(0, 6);
      return next;
    });
    setFormError(null);
  }, []);

  const toggleDay = useCallback((idx: number) => {
    setTrainingDays((prev) => {
      const has = prev.includes(idx);
      if (has && prev.length <= 1) return prev;
      if (!has && prev.length >= 6) return prev;
      return uniqDays(has ? prev.filter((d) => d !== idx) : [...prev, idx]);
    });
    setFormError(null);
  }, []);

  const toggleEquipment = useCallback((label: string) => {
    setEquipment((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));
  }, []);

  const addInjury = useCallback(() => {
    setInjuries((prev) => {
      if (prev.length >= 6) return prev;
      return [
        ...prev,
        {
          type: "",
          zone: "",
          date: new Date().toISOString().slice(0, 10),
          severity: 2,
        },
      ];
    });
  }, []);

  const updateInjury = useCallback((index: number, patch: Partial<Injury>) => {
    setInjuries((prev) => prev.map((x, i) => (i === index ? ({ ...x, ...patch } as Injury) : x)));
  }, []);

  const removeInjury = useCallback((index: number) => {
    setInjuries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  useEffect(() => {
    scheduleDraftSave();
  }, [
    name,
    sex,
    age,
    heightCm,
    weightKg,
    yearsPractice,
    sports,
    trainingDays,
    sessionDurationMin,
    equipment,
    injuries,
    city,
    locationLat,
    locationLng,
    scheduleDraftSave,
  ]);

  const detectLocation = useCallback(async () => {
    setLocating(true);
    setFormError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setFormError("Permission de localisation refusée.");
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setLocationLat(lat);
      setLocationLng(lng);

      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(() => []);
      const cityName = places?.[0]?.city || places?.[0]?.subregion || places?.[0]?.region || "";
      setCity(cityName);
    } catch (e: any) {
      setFormError(String(e?.message ?? "Impossible de récupérer la localisation."));
    } finally {
      if (aliveRef.current) setLocating(false);
    }
  }, []);

  const onContinue = useCallback(async () => {
    if (loading || saving) return;

    if (!canContinue) {
      setFormError("Complète les champs obligatoires (avatar sportif). ");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;

      await onboarding.saveOnboarding({
        profile: {
          name: name.trim(),
          sex,
          age: parsed.ageN,
          heightCm: parsed.h,
          weightKg: Math.round(parsed.w * 10) / 10,
          yearsPractice: parsed.years,
          level: parsed.level,
          sports,
          injuries: injuries.filter((x) => x.zone?.trim().length >= 2),
          availability: {
            trainingDays,
            sessionDurationMin: parsed.duration,
          },
          equipment,
          location:
            locationLat != null && locationLng != null
              ? {
                  lat: locationLat,
                  lng: locationLng,
                  city: city || undefined,
                }
              : undefined,
        } as any,
      });

      router.replace("/onboarding/program");
    } catch (e: any) {
      setFormError(String(e?.message ?? "Erreur lors de l'enregistrement."));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [
    loading,
    saving,
    canContinue,
    name,
    sex,
    parsed,
    sports,
    injuries,
    trainingDays,
    equipment,
    locationLat,
    locationLng,
    city,
    router,
  ]);

  if (loading) {
    return (
      <Screen>
        <View style={s.loadingWrap}>
          <ActivityIndicator />
          <Text style={s.loadingTxt}>Chargement du profil…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={s.wrap}>
          <Text style={s.h1}>Avatar sportif</Text>
          <Text style={s.hint}>On personnalise ton profil pour générer un plan IA précis.</Text>

          <Card style={{ marginTop: 14 }}>
            <SectionTitle>Identité sportive</SectionTitle>

            <Text style={s.label}>Nom</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={s.input}
              placeholder="Ex: Wistan"
              placeholderTextColor={theme.colors.text2}
            />

            <Text style={s.label}>Sexe</Text>
            <View style={s.chips}>
              {SEXES.map((x) => (
                <Chip key={x} label={x} active={x === sex} onPress={() => setSex(x)} />
              ))}
            </View>

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Âge</Text>
                <TextInput
                  value={age}
                  onChangeText={(v) => setAge(toDigits(v))}
                  keyboardType="number-pad"
                  style={s.input}
                  placeholder="35"
                  placeholderTextColor={theme.colors.text2}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.label}>Années de pratique</Text>
                <TextInput
                  value={yearsPractice}
                  onChangeText={(v) => setYearsPractice(toDigits(v))}
                  keyboardType="number-pad"
                  style={s.input}
                  placeholder="2"
                  placeholderTextColor={theme.colors.text2}
                />
              </View>
            </View>

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Taille (cm)</Text>
                <TextInput
                  value={heightCm}
                  onChangeText={(v) => setHeightCm(toDigits(v))}
                  keyboardType="number-pad"
                  style={s.input}
                  placeholder="175"
                  placeholderTextColor={theme.colors.text2}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.label}>Poids (kg)</Text>
                <TextInput
                  value={weightKg}
                  onChangeText={(v) => setWeightKg(v.replace(".", ","))}
                  keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "decimal-pad"}
                  style={s.input}
                  placeholder="68,5"
                  placeholderTextColor={theme.colors.text2}
                />
              </View>
            </View>

            <Text style={s.micro}>IMC auto: {bmiLabel(parsed.bmi)} • Niveau auto: {parsed.level}</Text>

            <SectionTitle>Sports</SectionTitle>
            <View style={s.chips}>
              {SPORTS.map((x) => (
                <Chip key={x} label={x} active={sports.includes(x)} onPress={() => toggleSport(x)} />
              ))}
            </View>

            <SectionTitle>Disponibilité</SectionTitle>
            <Text style={s.hint2}>Jours où tu veux t'entraîner</Text>
            <View style={s.days}>
              {DOW.map((d) => (
                <DayPill
                  key={d.idx}
                  label={d.label}
                  active={trainingDays.includes(d.idx)}
                  onPress={() => toggleDay(d.idx)}
                />
              ))}
            </View>

            <Text style={s.label}>Durée par séance (min)</Text>
            <TextInput
              value={sessionDurationMin}
              onChangeText={(v) => setSessionDurationMin(toDigits(v))}
              keyboardType="number-pad"
              style={s.input}
              placeholder="60"
              placeholderTextColor={theme.colors.text2}
            />

            <SectionTitle>Matériel disponible</SectionTitle>
            <View style={s.chips}>
              {EQUIPMENT.map((x) => (
                <Chip key={x} label={x} active={equipment.includes(x)} onPress={() => toggleEquipment(x)} />
              ))}
            </View>

            <SectionTitle>Blessures (historique)</SectionTitle>
            {injuries.map((injury, i) => (
              <View key={`inj-${i}`} style={s.injuryCard}>
                <TextInput
                  value={injury.type ?? ""}
                  onChangeText={(v) => updateInjury(i, { type: v })}
                  style={s.input}
                  placeholder="Type (ex: tendinite)"
                  placeholderTextColor={theme.colors.text2}
                />
                <TextInput
                  value={injury.zone ?? ""}
                  onChangeText={(v) => updateInjury(i, { zone: v })}
                  style={[s.input, { marginTop: 8 }]}
                  placeholder="Localisation (ex: genou droit)"
                  placeholderTextColor={theme.colors.text2}
                />
                <TextInput
                  value={injury.date ?? ""}
                  onChangeText={(v) => updateInjury(i, { date: v })}
                  style={[s.input, { marginTop: 8 }]}
                  placeholder="Date (YYYY-MM-DD)"
                  placeholderTextColor={theme.colors.text2}
                />
                <Pressable onPress={() => removeInjury(i)} style={{ marginTop: 8 }}>
                  <Text style={s.link}>Supprimer</Text>
                </Pressable>
              </View>
            ))}

            <Pressable onPress={addInjury} style={{ marginTop: 8 }}>
              <Text style={s.link}>+ Ajouter une blessure</Text>
            </Pressable>

            <SectionTitle>Localisation</SectionTitle>
            <Text style={s.hint2}>Détection automatique pour affiner terrain/météo.</Text>
            <View style={s.row}>
              <Pressable onPress={detectLocation} style={s.locBtn}>
                <Text style={s.locBtnTxt}>{locating ? "Localisation..." : "Utiliser ma position"}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.micro}>Ville: {city || "Non détectée"}</Text>
                <Text style={s.micro}>
                  Coord: {locationLat != null && locationLng != null ? `${locationLat.toFixed(4)}, ${locationLng.toFixed(4)}` : "-"}
                </Text>
              </View>
            </View>

            {!!formError ? <Text style={s.err}>{formError}</Text> : null}

            <View style={{ marginTop: 14, opacity: saving ? 0.7 : 1 }}>
              <ButtonPrimary label={saving ? "Enregistrement..." : "Continuer"} onPress={onContinue} disabled={saving} />
            </View>
          </Card>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
});

const s = StyleSheet.create({
  scrollContent: { paddingBottom: 40 },
  wrap: { padding: 16, paddingTop: 24 },
  h1: { fontSize: 26, fontWeight: "900", color: theme.colors.text },
  hint: { marginTop: 6, color: theme.colors.text2, fontWeight: "700" },
  hint2: { marginTop: 6, marginBottom: 8, color: theme.colors.text2, fontWeight: "700", fontSize: 12 },

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

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: "rgba(239,59,0,0.14)", borderColor: "rgba(239,59,0,0.35)" },
  chipTxt: { color: theme.colors.text, fontWeight: "900" },
  chipTxtOn: { color: theme.colors.primary },

  row: { flexDirection: "row", gap: 10, alignItems: "center" },

  days: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  day: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dayOn: { backgroundColor: theme.colors.primary, borderColor: "rgba(255,255,255,0.18)" },
  dayTxt: { color: theme.colors.text2, fontWeight: "900" },
  dayTxtOn: { color: "#fff" },

  injuryCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  locBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  locBtnTxt: { color: theme.colors.text, fontWeight: "800" },

  micro: { marginTop: 8, color: theme.colors.text2, fontWeight: "700", fontSize: 12 },
  err: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },
  link: { color: theme.colors.primary, fontWeight: "900" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: theme.colors.text2, fontWeight: "800" },
});
