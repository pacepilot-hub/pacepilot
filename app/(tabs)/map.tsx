// app/(tabs)/map.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView, BottomSheetView } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { theme } from "@/constants/theme";
import { Screen, Card, IconButton } from "@/components/ui";

import { fetchRoutedPath, type Waypoint } from "@/services/routeService";
import { listRoutes, upsertRoute, deleteRoute, type SavedRoute } from "@/storage/routes";

// ✅ source de vérité (critères)
import { criteriaFromWorkout, type WorkoutSpec, type RouteCriteria, type ProfileKey } from "@/coaching/routeGenerator";
// ✅ ORS adapter
import { generateCoachRoutesORS, type ProposedRoute } from "@/coaching/routeGeneratorORS";

/* -------------------------------- helpers -------------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeNum(v: unknown) {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function formatMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m} min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function samePoint(a: Waypoint, b: Waypoint) {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

function hashPolyline(coords: Array<{ latitude: number; longitude: number }>) {
  if (coords.length < 2) return "";
  const head = coords[0];
  const tail = coords[coords.length - 1];
  return `${coords.length}|${head.latitude.toFixed(5)},${head.longitude.toFixed(5)}|${tail.latitude.toFixed(5)},${tail.longitude.toFixed(5)}`;
}

/* ----------------------------- theme fallbacks ----------------------------- */

const BG = (theme as any)?.colors?.bg ?? (theme as any)?.colors?.background ?? "#0b0b0f";
const SURFACE = (theme as any)?.colors?.surface2 ?? (theme as any)?.colors?.surface ?? (theme as any)?.colors?.card ?? BG;
const MUTED = (theme as any)?.colors?.text2 ?? (theme as any)?.colors?.muted ?? "rgba(255,255,255,0.65)";
const PRIMARY = (theme as any)?.colors?.primary ?? "#7CFF4E";
const TEXT = (theme as any)?.colors?.text ?? "#fff";
const BORDER = (theme as any)?.colors?.border ?? "rgba(255,255,255,0.10)";

/* ----------------------------- small UI pieces ---------------------------- */

const Pill = memo(function Pill(props: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      hitSlop={12}
      style={[styles.pill, props.active && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
    >
      <Text style={[styles.pillTxt, props.active && { color: "#000" }]}>{props.label}</Text>
    </Pressable>
  );
});

const RouteCard = memo(function RouteCard(props: {
  title: string;
  subtitle: string;
  selected?: boolean;
  badge?: string;
  onPress: () => void;
  actions?: Array<{ label: string; onPress: () => void }>;
}) {
  return (
    <Card style={[styles.card, props.selected && styles.cardSelected]}>
      <Pressable onPress={props.onPress} hitSlop={12} style={({ pressed }) => [pressed && styles.pressed]}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{props.title}</Text>
            <Text style={styles.cardSub}>{props.subtitle}</Text>
          </View>

          {props.badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{props.badge}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {props.actions?.length ? (
        <View style={styles.rowBtns}>
          {props.actions.map((a) => (
            <Pressable
              key={a.label}
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
              hitSlop={12}
              onPress={a.onPress}
            >
              <Text style={styles.btnTxt}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
});

/* -------------------------------- component ------------------------------ */

type TabKey = "today" | "create" | "mine";

type RouteInfo = { distanceKm: number; timeMin: number };

type LocState =
  | { status: "idle" | "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; origin: { lat: number; lng: number } };

export default function MapTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; wType?: string; wDur?: string; wKm?: string }>();

  const lockToday = params.mode === "today";

  const mapRef = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);

  // anti-boucle fit
  const mapInteractingRef = useRef(false);
  const isFittingRef = useRef(false);
  const lastFitHashRef = useRef<string>("");
  const fitReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // bottom sheet
  const snapPoints = useMemo(() => ["3%", "42%", "88%"] as const, []);
  const [sheetIndex, setSheetIndex] = useState<number>(lockToday ? 2 : 1);

  // location
  const [loc, setLoc] = useState<LocState>({ status: "idle" });

  // tabs
  const [tab, setTab] = useState<TabKey>("today");

  // map state
  const [tapPoints, setTapPoints] = useState<Waypoint[]>([]);
  const [polyline, setPolyline] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  // workout
  const [workout, setWorkout] = useState<WorkoutSpec>(() => {
    const fromParamsType = typeof params.wType === "string" ? params.wType : undefined;
    const fromParamsDur = safeNum(params.wDur);
    const fromParamsKm = safeNum(params.wKm);

    const type =
      fromParamsType === "ef" ||
      fromParamsType === "sl" ||
      fromParamsType === "seuil" ||
      fromParamsType === "cotes" ||
      fromParamsType === "trail"
        ? (fromParamsType as WorkoutSpec["type"])
        : "ef";

    return {
      type,
      durationMin: Number.isFinite(fromParamsDur) ? clamp(fromParamsDur!, 20, 240) : 60,
      distanceKm: Number.isFinite(fromParamsKm) ? clamp(fromParamsKm!, 2, 60) : undefined,
      label: "Séance du jour",
    };
  });

  // criteria UI
  const [targetKmUI, setTargetKmUI] = useState<number>(10);
  const [tolerancePctUI, setTolerancePctUI] = useState<number>(0.08);
  const [profileUI, setProfileUI] = useState<ProfileKey>("foot-walking");
  const [candidatesUI] = useState<number>(12);
  const [loopUI, setLoopUI] = useState<boolean>(true);

  // coach routes
  const [aiRoutes, setAiRoutes] = useState<ProposedRoute[]>([]);
  const [selectedAi, setSelectedAi] = useState<ProposedRoute | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // saved routes
  const [myRoutes, setMyRoutes] = useState<SavedRoute[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);

  // save modal (android/fallback)
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  // mirrors (évite closures périmées)
  const selectedAiRef = useRef<ProposedRoute | null>(null);
  useEffect(() => {
    selectedAiRef.current = selectedAi;
  }, [selectedAi]);

  const myRoutesRef = useRef<SavedRoute[]>([]);
  useEffect(() => {
    myRoutesRef.current = myRoutes;
  }, [myRoutes]);

  useEffect(() => {
    return () => {
      if (fitReleaseTimer.current) clearTimeout(fitReleaseTimer.current);
    };
  }, []);

  /* ------------------------ region stable + fallback ----------------------- */

  const origin = loc.status === "ready" ? loc.origin : null;
  const center = useMemo(() => origin ?? { lat: 43.49, lng: -1.47 }, [origin]);

  const initialRegion = useMemo(
    () => ({
      latitude: center.lat,
      longitude: center.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }),
    [center]
  );

  /* -------------------------------- data ---------------------------------- */

  const refreshMyRoutes = useCallback(async () => {
    try {
      const routes = await listRoutes();
      setMyRoutes(Array.isArray(routes) ? routes : []);
    } catch (e: any) {
      console.log("listRoutes error:", e?.message ?? e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMyRoutes().catch(() => {});
    }, [refreshMyRoutes])
  );

  /* -------------------------------- GPS ----------------------------------- */

  const requestLocation = useCallback(async () => {
    setLoc({ status: "loading" });

    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        const ask = await Location.requestForegroundPermissionsAsync();
        if (ask.status !== "granted") {
          setLoc({ status: "denied", message: "Permission GPS refusée." });
          return;
        }
      }

      // last known (rapide)
      const last = await Location.getLastKnownPositionAsync({});
      if (last?.coords?.latitude && last?.coords?.longitude) {
        setLoc({ status: "ready", origin: { lat: last.coords.latitude, lng: last.coords.longitude } });
      }

      // current (plus fiable)
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLoc({ status: "ready", origin: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
    } catch (e: any) {
      setLoc({ status: "error", message: "Impossible de récupérer la position." });
      console.log("location error:", e?.message ?? e);
    }
  }, []);

  useEffect(() => {
    requestLocation().catch(() => {});
  }, [requestLocation]);

  /* ----------------------------- mode=today UX ----------------------------- */

  useEffect(() => {
    if (!lockToday) return;
    setTab("today");
    requestAnimationFrame(() => setSheetIndex(2));
  }, [lockToday]);

  /* --------------------------- defaults from workout ----------------------- */

  const userTouchedTargetRef = useRef(false);

  useEffect(() => {
    const base = criteriaFromWorkout(workout);
    if (!userTouchedTargetRef.current) setTargetKmUI(base.targetKm);
    setProfileUI(base.profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout.type, workout.durationMin, workout.distanceKm]);

  useEffect(() => {
    if (workout.type === "trail") setProfileUI("foot-hiking");
  }, [workout.type]);

  /* -------------------------- fit polyline (guarded) ----------------------- */

  const fitPolyline = useCallback((coords: Array<{ latitude: number; longitude: number }>) => {
    if (coords.length < 2) return;
    if (mapInteractingRef.current) return;

    const h = hashPolyline(coords);
    if (!h || h === lastFitHashRef.current) return;
    lastFitHashRef.current = h;

    isFittingRef.current = true;
    if (fitReleaseTimer.current) clearTimeout(fitReleaseTimer.current);

    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 90, right: 60, bottom: 340, left: 60 },
      animated: true,
    });

    fitReleaseTimer.current = setTimeout(() => {
      isFittingRef.current = false;
    }, 650);
  }, []);

  /* ---------------------------- coach generation --------------------------- */

  const buildCriteria = useCallback((): RouteCriteria => {
    return criteriaFromWorkout(workout, {
      targetKm: targetKmUI,
      tolerancePct: tolerancePctUI,
      profile: profileUI,
      candidates: candidatesUI,
      loop: loopUI,
    });
  }, [workout, targetKmUI, tolerancePctUI, profileUI, candidatesUI, loopUI]);

  const refreshCoachRoutes = useCallback(async () => {
    if (!origin) return;

    try {
      setAiLoading(true);

      const routes = await generateCoachRoutesORS({
        workout,
        origin,
        criteria: buildCriteria(),
      });

      const arr = Array.isArray(routes) ? routes : [];
      setAiRoutes(arr);
      setSelectedAi(arr[0] ?? null);

      // reset “create”
      setTapPoints([]);

      setSheetIndex(lockToday ? 2 : 1);
    } catch (e: any) {
      console.log("Coach routes error:", e?.message ?? e);
      Alert.alert("Erreur", "Impossible de générer les routes pour le moment.");
    } finally {
      setAiLoading(false);
    }
  }, [origin, workout, buildCriteria, lockToday]);

  // 1) une seule génération au premier GPS ready
  const didGenOnOriginRef = useRef(false);
  useEffect(() => {
    if (!origin) return;
    if (didGenOnOriginRef.current) return;
    didGenOnOriginRef.current = true;
    refreshCoachRoutes().catch(() => {});
  }, [origin, refreshCoachRoutes]);

  // 2) si critères changent → debounce refresh
  const criteriaTick = useMemo(
    () =>
      `${workout.type}|${workout.durationMin ?? ""}|${workout.distanceKm ?? ""}|${targetKmUI}|${tolerancePctUI}|${profileUI}|${candidatesUI}|${loopUI}`,
    [workout.type, workout.durationMin, workout.distanceKm, targetKmUI, tolerancePctUI, profileUI, candidatesUI, loopUI]
  );

  const didInitCriteriaRef = useRef(false);
  useEffect(() => {
    if (!origin) return;
    if (!didInitCriteriaRef.current) {
      didInitCriteriaRef.current = true;
      return;
    }
    const t = setTimeout(() => refreshCoachRoutes().catch(() => {}), 450);
    return () => clearTimeout(t);
  }, [criteriaTick, origin, refreshCoachRoutes]);

  /* -------------------------- apply selected route ------------------------- */

  const selectedAiId = selectedAi?.id ?? null;

  useEffect(() => {
    if (!selectedAi?.polyline?.length) return;
    setSelectedSavedId(null);
    setPolyline(selectedAi.polyline);
    setRouteInfo({ distanceKm: selectedAi.distanceKm, timeMin: selectedAi.estimatedTimeMin });
    fitPolyline(selectedAi.polyline);
  }, [selectedAi?.id, fitPolyline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedSavedId) return;
    const r = myRoutes.find((x) => x.id === selectedSavedId);
    if (!r) return;

    setSelectedAi(null);
    setPolyline(r.polyline);
    setRouteInfo({ distanceKm: r.distanceKm, timeMin: r.estimatedTimeMin });

    setTapPoints([]);
    fitPolyline(r.polyline);
  }, [selectedSavedId, myRoutes, fitPolyline]);

  /* ------------------------------ create route ----------------------------- */

  const canTapMap = !lockToday && tab === "create" && sheetIndex > 0;

  const computeTapRoute = useCallback(async () => {
    try {
      if (tapPoints.length < 2) {
        Alert.alert("Tracer une route", "Ajoute au moins 2 points sur la carte.");
        return;
      }

      let waypoints = [...tapPoints];
      if (loopUI) {
        const first = waypoints[0];
        const last = waypoints[waypoints.length - 1];
        if (!samePoint(first, last)) waypoints = [...waypoints, first];
      }

      const routed = await fetchRoutedPath({ waypoints, profile: profileUI });

      const distanceKm = Math.round((routed.distanceM / 1000) * 10) / 10;
      const timeMin = Math.max(1, Math.round(routed.durationS / 60));

      setSelectedAi(null);
      setSelectedSavedId(null);
      setPolyline(routed.coords);
      setRouteInfo({ distanceKm, timeMin });

      fitPolyline(routed.coords);
    } catch (e: any) {
      console.log("Tap route error:", e?.message ?? e);
      Alert.alert("Erreur", "Impossible de calculer la route.");
    }
  }, [tapPoints, loopUI, profileUI, fitPolyline]);

  /* ---------------------------- save / delete route ------------------------ */

  const resolveDefaultName = useCallback(() => {
    const ai = selectedAiRef.current;
    if (ai?.name) return ai.name;

    if (selectedSavedId) {
      const r = myRoutesRef.current.find((x) => x.id === selectedSavedId);
      if (r?.name) return r.name;
    }

    if (tab === "create") return "Route perso";
    return "Route sauvegardée";
  }, [selectedSavedId, tab]);

  const doSaveCurrentRoute = useCallback(
    async (name: string, createdBy: "user" | "ai") => {
      if (polyline.length < 2 || !routeInfo) return;

      const editingId = selectedSavedId ? selectedSavedId : null;

      const saved: SavedRoute = {
        id: editingId ?? uid(createdBy),
        name: name.trim() || resolveDefaultName(),
        profile: profileUI,
        polyline,
        distanceKm: routeInfo.distanceKm,
        estimatedTimeMin: routeInfo.timeMin,
        createdAt: Date.now(),
        createdBy,
      };

      await upsertRoute(saved);
      await refreshMyRoutes();

      if (!lockToday) {
        setTab("mine");
        setSelectedSavedId(saved.id);
        setSheetIndex(1);
      } else {
        setSheetIndex(2);
      }
    },
    [polyline, routeInfo, profileUI, refreshMyRoutes, lockToday, resolveDefaultName, selectedSavedId]
  );

  const openSavePrompt = useCallback(() => {
    if (!routeInfo || polyline.length < 2) return;

    const createdBy: "user" | "ai" = tab === "today" || lockToday ? "ai" : "user";
    const defaultName = resolveDefaultName();

    if (Platform.OS === "ios" && (Alert as any).prompt) {
      (Alert as any).prompt(
        "Nom de la route",
        "Donne un nom clair (ex: “Boucle EF 10 km”).",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Sauver",
            onPress: (txt: string) => {
              doSaveCurrentRoute(txt || defaultName, createdBy).catch((e) =>
                console.log("save error:", e?.message ?? e)
              );
            },
          },
        ],
        "plain-text",
        defaultName
      );
      return;
    }

    setSaveName(defaultName);
    setSaveModalOpen(true);
  }, [routeInfo, polyline.length, tab, lockToday, resolveDefaultName, doSaveCurrentRoute]);

  const confirmSaveModal = useCallback(() => {
    const createdBy: "user" | "ai" = tab === "today" || lockToday ? "ai" : "user";
    const name = saveName.trim() || resolveDefaultName();

    setSaveModalOpen(false);
    doSaveCurrentRoute(name, createdBy).catch((e) => console.log("save error:", e?.message ?? e));
  }, [tab, lockToday, saveName, resolveDefaultName, doSaveCurrentRoute]);

  const removeRoute = useCallback(
    async (id: string) => {
      await deleteRoute(id);
      await refreshMyRoutes();
      if (selectedSavedId === id) setSelectedSavedId(null);
    },
    [refreshMyRoutes, selectedSavedId]
  );

  /* ----------------------------- start / export ---------------------------- */

  const getActiveRouteSummary = useCallback(() => {
    const ai = selectedAiRef.current;
    if (ai?.polyline?.length && routeInfo) {
      return { name: ai.name, distanceKm: routeInfo.distanceKm, timeMin: routeInfo.timeMin, source: "ai" as const };
    }

    if (selectedSavedId) {
      const r = myRoutesRef.current.find((x) => x.id === selectedSavedId);
      if (r) return { name: r.name, distanceKm: r.distanceKm, timeMin: r.estimatedTimeMin, source: "saved" as const };
    }

    if (polyline.length > 1 && routeInfo) {
      return { name: "Route", distanceKm: routeInfo.distanceKm, timeMin: routeInfo.timeMin, source: "create" as const };
    }

    return null;
  }, [polyline.length, routeInfo, selectedSavedId]);

  const onStartRun = useCallback(() => {
    const s = getActiveRouteSummary();
    if (!s) {
      Alert.alert("Sélectionne une route", "Choisis une proposition, une route enregistrée, ou trace une route.");
      return;
    }
    Alert.alert("Démarrer", `Route: ${s.name}\n${s.distanceKm} km • ~${formatMin(s.timeMin)}`);
  }, [getActiveRouteSummary]);

  const onSendToWatch = useCallback(() => {
    const s = getActiveRouteSummary();
    if (!s) {
      Alert.alert("Sélectionne une route", "Choisis une route avant l’export.");
      return;
    }
    Alert.alert("Montre", `Export à brancher (Garmin/Coros/Suunto).\nRoute: ${s.name}`);
  }, [getActiveRouteSummary]);

  /* ------------------------------ BottomSheet UX --------------------------- */

  const onSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  /* --------------------------------- UI ----------------------------------- */

  const headerTitle = lockToday ? "Séance du jour" : "Carte";
  const headerKicker = lockToday ? "Parcours coach" : "Bonjour";

  const locError =
    loc.status === "denied" || loc.status === "error" ? loc.message : loc.status === "loading" ? "GPS…" : null;

  const whyText = useMemo(() => {
    const surf = profileUI === "foot-walking" ? "route" : "trail";
    const loop = loopUI ? "boucle" : "aller simple";
    const tol = Math.round(tolerancePctUI * 100);
    const km = targetKmUI;
    return `Objectif ${km} km (±${tol}%) • ${surf} • ${loop}`;
  }, [profileUI, loopUI, tolerancePctUI, targetKmUI]);

  // Nettoyage “create” total : pas de “route fantôme”
  useEffect(() => {
    if (tab !== "create") return;
    setSelectedAi(null);
    setSelectedSavedId(null);
    setPolyline([]);
    setRouteInfo(null);
    lastFitHashRef.current = "";
    setTapPoints([]);
  }, [tab]);

  useEffect(() => {
    if (tab === "today") setTapPoints([]);
  }, [tab]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Screen>
        {/* header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>{headerKicker}</Text>
            <Text style={styles.title}>{headerTitle}</Text>
          </View>

          <View style={styles.headerBtns}>
            {!lockToday ? (
              <>
                <IconButton icon="chatbubble-ellipses-outline" onPress={() => router.push("/chat")} />
                <IconButton icon="notifications-outline" onPress={() => router.push("/notifications")} />
              </>
            ) : (
              <IconButton icon="close-outline" onPress={() => router.replace("/(tabs)/home")} />
            )}
          </View>
        </View>

        {/* map */}
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
            rotateEnabled={false}
            pitchEnabled={false}
            onRegionChange={() => {
              if (isFittingRef.current) return;
              mapInteractingRef.current = true;
            }}
            onRegionChangeComplete={() => {
              if (isFittingRef.current) return;
              mapInteractingRef.current = false;
            }}
            onPress={(e) => {
              if (!canTapMap) return;
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setTapPoints((prev) => [...prev, { lat: latitude, lng: longitude }]);
            }}
          >
            {origin && <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Moi" />}

            {canTapMap &&
              tapPoints.map((p, idx) => (
                <Marker
                  key={`${p.lat}_${p.lng}_${idx}`}
                  coordinate={{ latitude: p.lat, longitude: p.lng }}
                  title={`Point ${idx + 1}`}
                />
              ))}

            {polyline.length > 1 ? <Polyline coordinates={polyline} strokeWidth={4} strokeColor={PRIMARY} /> : null}
          </MapView>

          {/* center */}
          <Pressable
            style={({ pressed }) => [styles.centerBtn, pressed && styles.pressed]}
            hitSlop={12}
            onPress={() => {
              if (!origin) {
                requestLocation().catch(() => {});
                return;
              }
              isFittingRef.current = true;
              mapRef.current?.animateToRegion(
                {
                  latitude: origin.lat,
                  longitude: origin.lng,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                },
                280
              );

              if (fitReleaseTimer.current) clearTimeout(fitReleaseTimer.current);
              fitReleaseTimer.current = setTimeout(() => {
                isFittingRef.current = false;
              }, 450);
            }}
          >
            <Text style={styles.centerBtnTxt}>📍</Text>
          </Pressable>
        </View>

        {/* bottom sheet */}
        <BottomSheet
          ref={sheetRef}
          index={sheetIndex}
          snapPoints={snapPoints}
          onChange={onSheetChange}
          enablePanDownToClose={false}
          handleIndicatorStyle={{ backgroundColor: BORDER }}
          backgroundStyle={{ backgroundColor: BG }}
        >
          <BottomSheetView style={{ flex: 1 }}>
            {sheetIndex === 0 ? (
              <View style={{ height: 1 }} />
            ) : (
              <>
                {/* tabs */}
                {!lockToday ? (
                  <View style={styles.tabs}>
                    <Pressable onPress={() => setTab("today")} style={[styles.tabBtn, tab === "today" && styles.tabBtnActive]} hitSlop={12}>
                      <Text style={[styles.tabTxt, tab === "today" && styles.tabTxtActive]}>Aujourd’hui</Text>
                    </Pressable>

                    <Pressable onPress={() => setTab("create")} style={[styles.tabBtn, tab === "create" && styles.tabBtnActive]} hitSlop={12}>
                      <Text style={[styles.tabTxt, tab === "create" && styles.tabTxtActive]}>Créer</Text>
                    </Pressable>

                    <Pressable onPress={() => setTab("mine")} style={[styles.tabBtn, tab === "mine" && styles.tabBtnActive]} hitSlop={12}>
                      <Text style={[styles.tabTxt, tab === "mine" && styles.tabTxtActive]}>Mes routes</Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* infobar */}
                {routeInfo ? (
                  <View style={styles.infoBar}>
                    <Text style={styles.infoTxt}>
                      {routeInfo.distanceKm} km • ~{formatMin(routeInfo.timeMin)}
                    </Text>

                    <Pressable style={({ pressed }) => [styles.infoBtn, pressed && styles.pressed]} hitSlop={12} onPress={openSavePrompt}>
                      <Text style={styles.infoBtnTxt}>{selectedSavedId ? "Mettre à jour" : "Sauver"}</Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* TODAY */}
                {tab === "today" || lockToday ? (
                  <BottomSheetScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 220 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    <Card style={styles.card}>
                      <Text style={styles.cardTitle}>{workout.label ?? "Séance du jour"}</Text>
                      <Text style={styles.cardSub}>
                        {workout.type.toUpperCase()} •{" "}
                        {workout.durationMin ? formatMin(workout.durationMin) : workout.distanceKm ? `${workout.distanceKm} km` : "—"} •{" "}
                        {profileUI === "foot-walking" ? "Route" : "Trail"} • {loopUI ? "Boucle" : "Aller simple"}
                      </Text>

                      <Text style={[styles.cardSub, { marginTop: 8 }]}>Pourquoi ?</Text>
                      <Text style={styles.help}>{whyText}</Text>

                      {locError ? <Text style={styles.warn}>{locError}</Text> : null}
                    </Card>

                    <Text style={styles.section}>Critères</Text>
                    <Card style={styles.card}>
                      <Text style={styles.cardSub}>Séance</Text>
                      <View style={styles.pillRow}>
                        {(["ef", "sl", "seuil", "cotes", "trail"] as const).map((tKey) => (
                          <Pill
                            key={tKey}
                            label={tKey.toUpperCase()}
                            active={workout.type === tKey}
                            onPress={() => setWorkout((w) => ({ ...w, type: tKey, label: "Séance du jour" }))}
                          />
                        ))}
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Durée</Text>
                      <View style={styles.pillRow}>
                        {[30, 45, 60, 75, 90, 105, 120].map((m) => (
                          <Pill
                            key={m}
                            label={`${m} min`}
                            active={workout.durationMin === m}
                            onPress={() => setWorkout((w) => ({ ...w, durationMin: m, distanceKm: undefined }))}
                          />
                        ))}
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Ou distance</Text>
                      <View style={styles.pillRow}>
                        {[5, 8, 10, 12, 15, 18, 21].map((km) => (
                          <Pill
                            key={km}
                            label={`${km} km`}
                            active={workout.distanceKm === km}
                            onPress={() => setWorkout((w) => ({ ...w, distanceKm: km, durationMin: undefined }))}
                          />
                        ))}
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Tracé</Text>
                      <View style={styles.pillRow}>
                        <Pill label="Boucle" active={loopUI} onPress={() => setLoopUI(true)} />
                        <Pill label="Aller simple" active={!loopUI} onPress={() => setLoopUI(false)} />
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Surface</Text>
                      <View style={styles.pillRow}>
                        <Pill label="Route" active={profileUI === "foot-walking"} onPress={() => setProfileUI("foot-walking")} />
                        <Pill label="Trail" active={profileUI === "foot-hiking"} onPress={() => setProfileUI("foot-hiking")} />
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Distance cible</Text>
                      <View style={styles.pillRow}>
                        {[5, 8, 10, 12, 15, 20].map((km) => (
                          <Pill
                            key={km}
                            label={`${km} km`}
                            active={targetKmUI === km}
                            onPress={() => {
                              userTouchedTargetRef.current = true;
                              setTargetKmUI(km);
                            }}
                          />
                        ))}
                      </View>

                      <Text style={[styles.cardSub, { marginTop: 10 }]}>Tolérance</Text>
                      <View style={styles.pillRow}>
                        <Pill label="±5%" active={tolerancePctUI === 0.05} onPress={() => setTolerancePctUI(0.05)} />
                        <Pill label="±8%" active={tolerancePctUI === 0.08} onPress={() => setTolerancePctUI(0.08)} />
                        <Pill label="±12%" active={tolerancePctUI === 0.12} onPress={() => setTolerancePctUI(0.12)} />
                      </View>

                      <Pressable
                        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                        onPress={refreshCoachRoutes}
                        disabled={aiLoading}
                        hitSlop={12}
                      >
                        <Text style={styles.primaryTxt}>{aiLoading ? "Calcul…" : "Proposer des routes"}</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [styles.ghostBtn, { marginTop: 10 }, pressed && styles.pressed]}
                        onPress={() => setSheetIndex(0)}
                        hitSlop={12}
                      >
                        <Text style={styles.ghostTxt}>Masquer (voir la carte)</Text>
                      </Pressable>
                    </Card>

                    <Text style={styles.section}>Propositions du coach</Text>

                    {aiLoading && aiRoutes.length === 0 ? (
                      <Card style={styles.card}>
                        <Text style={styles.help}>Calcul des itinéraires…</Text>
                      </Card>
                    ) : null}

                    {!aiLoading && aiRoutes.length === 0 ? (
                      <Card style={styles.card}>
                        <Text style={styles.help}>Aucune proposition pour l’instant. Ajuste les critères, ou réessaie.</Text>
                      </Card>
                    ) : null}

                    {aiRoutes.map((r, idx) => (
                      <RouteCard
                        key={r.id}
                        title={r.name}
                        subtitle={`${r.distanceKm} km • ~${formatMin(r.estimatedTimeMin)}`}
                        selected={selectedAiId === r.id}
                        badge={idx === 0 ? "Meilleure" : undefined}
                        onPress={() => setSelectedAi(r)}
                        actions={[
                          { label: "Prévisualiser", onPress: () => setSelectedAi(r) },
                          {
                            label: "Sauvegarder",
                            onPress: () => {
                              setSelectedAi(r);
                              setTimeout(() => openSavePrompt(), 0);
                            },
                          },
                        ]}
                      />
                    ))}

                    <View style={styles.ctaBar}>
                      <Pressable
                        style={({ pressed }) => [styles.ctaBtn, styles.ctaPrimary, pressed && styles.pressed]}
                        onPress={onStartRun}
                        hitSlop={12}
                      >
                        <Text style={styles.ctaPrimaryTxt}>Démarrer</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [styles.ctaBtn, styles.ctaGhost, pressed && styles.pressed]}
                        onPress={onSendToWatch}
                        hitSlop={12}
                      >
                        <Text style={styles.ctaGhostTxt}>Envoyer à la montre</Text>
                      </Pressable>
                    </View>
                  </BottomSheetScrollView>
                ) : null}

                {/* CREATE */}
                {!lockToday && tab === "create" ? (
                  <BottomSheetFlatList
                    style={{ flex: 1 }}
                    data={[{ id: "create" }]}
                    keyExtractor={(x) => x.id}
                    renderItem={() => (
                      <View style={{ paddingHorizontal: 12 }}>
                        <Text style={styles.section}>Tracer (tap sur la carte)</Text>

                        <Card style={styles.card}>
                          <Text style={styles.help}>
                            1) Tape sur la carte pour poser des points (2 minimum).{"\n"}
                            2) “Calculer route” = route ORS réelle.
                          </Text>

                          <Text style={[styles.cardSub, { marginTop: 10 }]}>Surface</Text>
                          <View style={styles.pillRow}>
                            <Pill label="Route" active={profileUI === "foot-walking"} onPress={() => setProfileUI("foot-walking")} />
                            <Pill label="Trail" active={profileUI === "foot-hiking"} onPress={() => setProfileUI("foot-hiking")} />
                          </View>

                          <Text style={[styles.cardSub, { marginTop: 10 }]}>Tracé</Text>
                          <View style={styles.pillRow}>
                            <Pill label="Boucle" active={loopUI} onPress={() => setLoopUI(true)} />
                            <Pill label="Aller simple" active={!loopUI} onPress={() => setLoopUI(false)} />
                          </View>

                          <View style={styles.rowBtns}>
                            <Pressable style={({ pressed }) => [styles.btn, pressed && styles.pressed]} hitSlop={12} onPress={computeTapRoute}>
                              <Text style={styles.btnTxt}>Calculer route</Text>
                            </Pressable>
                            <Pressable style={({ pressed }) => [styles.btn, pressed && styles.pressed]} hitSlop={12} onPress={() => setTapPoints((p) => p.slice(0, -1))}>
                              <Text style={styles.btnTxt}>Annuler dernier</Text>
                            </Pressable>
                          </View>

                          <View style={styles.rowBtns}>
                            <Pressable style={({ pressed }) => [styles.btn, pressed && styles.pressed]} hitSlop={12} onPress={() => setTapPoints([])}>
                              <Text style={styles.btnTxt}>Effacer points</Text>
                            </Pressable>
                            <Pressable style={({ pressed }) => [styles.btn, pressed && styles.pressed]} hitSlop={12} onPress={() => setSheetIndex(0)}>
                              <Text style={styles.btnTxt}>Masquer</Text>
                            </Pressable>
                          </View>

                          {tapPoints.length > 0 ? <Text style={[styles.cardSub, { marginTop: 8 }]}>Points: {tapPoints.length}</Text> : null}

                          {routeInfo ? (
                            <View style={{ marginTop: 10 }}>
                              <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={openSavePrompt} hitSlop={12}>
                                <Text style={styles.primaryTxt}>Sauver cette route</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </Card>
                      </View>
                    )}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{ paddingBottom: 140 }}
                    ListFooterComponent={<View style={{ height: 140 }} />}
                  />
                ) : null}

                {/* MINE */}
                {!lockToday && tab === "mine" ? (
                  <BottomSheetFlatList
                    style={{ flex: 1 }}
                    data={myRoutes}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{ paddingBottom: 140, paddingHorizontal: 12 }}
                    ListFooterComponent={<View style={{ height: 140 }} />}
                    ListHeaderComponent={<Text style={styles.section}>Mes routes</Text>}
                    ListEmptyComponent={
                      <Card style={styles.card}>
                        <Text style={styles.help}>Aucune route enregistrée. Sauvegarde une route du coach ou trace une route.</Text>
                      </Card>
                    }
                    renderItem={({ item: r }) => (
                      <RouteCard
                        title={r.name}
                        subtitle={`${r.distanceKm} km • ~${formatMin(r.estimatedTimeMin)} • ${r.createdBy.toUpperCase()}`}
                        selected={selectedSavedId === r.id}
                        onPress={() => setSelectedSavedId(r.id)}
                        actions={[
                          { label: "Voir", onPress: () => setSelectedSavedId(r.id) },
                          {
                            label: "Supprimer",
                            onPress: () => {
                              Alert.alert("Supprimer", `Supprimer “${r.name}” ?`, [
                                { text: "Annuler", style: "cancel" },
                                { text: "Supprimer", style: "destructive", onPress: () => removeRoute(r.id) },
                              ]);
                            },
                          },
                        ]}
                      />
                    )}
                  />
                ) : null}
              </>
            )}
          </BottomSheetView>
        </BottomSheet>

        {/* Save Modal (Android/fallback) */}
        <Modal visible={saveModalOpen} transparent animationType="fade" onRequestClose={() => setSaveModalOpen(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalCardWrap}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Nom de la route</Text>
                <Text style={styles.modalSub}>Donne un nom clair (ex: “Boucle EF 10 km”).</Text>

                <TextInput
                  value={saveName}
                  onChangeText={setSaveName}
                  placeholder="Nom"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                  autoFocus
                />

                <View style={styles.rowBtns}>
                  <Pressable style={({ pressed }) => [styles.btn, pressed && styles.pressed]} onPress={() => setSaveModalOpen(false)} hitSlop={12}>
                    <Text style={styles.btnTxt}>Annuler</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]} onPress={confirmSaveModal} hitSlop={12}>
                    <Text style={[styles.btnTxt, { color: "#000" }]}>Sauver</Text>
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </Screen>
    </GestureHandlerRootView>
  );
}

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hello: { color: MUTED, fontSize: 12, fontWeight: "800" },
  title: { color: TEXT, fontSize: 20, fontWeight: "900" },
  headerBtns: { flexDirection: "row", gap: 10 },

  mapWrap: { flex: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },

  centerBtn: {
    position: "absolute",
    right: 12,
    top: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  centerBtnTxt: { color: TEXT, fontWeight: "900" },

  tabs: { flexDirection: "row", gap: 8, paddingBottom: 10, paddingTop: 6, paddingHorizontal: 12 },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  tabBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  tabTxt: { color: TEXT, fontWeight: "900", fontSize: 12 },
  tabTxtActive: { color: "#000" },

  infoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  infoTxt: { color: MUTED, fontWeight: "800" },
  infoBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: PRIMARY,
  },
  infoBtnTxt: { color: "#000", fontWeight: "900" },

  section: { color: TEXT, fontWeight: "900", marginTop: 10, marginBottom: 8, paddingHorizontal: 12 },

  card: { padding: 12, marginBottom: 10 },
  cardSelected: { borderWidth: 1, borderColor: PRIMARY },

  cardTitle: { color: TEXT, fontWeight: "900", fontSize: 14 },
  cardSub: { color: MUTED, marginTop: 4, lineHeight: 18, fontWeight: "800" },
  warn: { color: TEXT, marginTop: 8, fontWeight: "800" },

  help: { color: MUTED, lineHeight: 18, fontWeight: "800" },

  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  pillTxt: { color: TEXT, fontWeight: "900", fontSize: 12 },

  primaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: "center",
  },
  primaryTxt: { color: "#000", fontWeight: "900" },

  ghostBtn: {
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    alignItems: "center",
  },
  ghostTxt: { color: TEXT, fontWeight: "900" },

  rowBtns: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  btnPrimary: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  btnTxt: { color: TEXT, fontWeight: "900" },

  ctaBar: {
    marginTop: 6,
    gap: 10,
    paddingHorizontal: 12,
  },
  ctaBtn: {
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  ctaPrimary: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  ctaPrimaryTxt: { color: "#000", fontWeight: "900" },
  ctaGhost: { backgroundColor: SURFACE, borderColor: BORDER },
  ctaGhostTxt: { color: TEXT, fontWeight: "900" },

  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  badgeTxt: { color: TEXT, fontWeight: "900", fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 16,
  },
  modalCardWrap: { width: "100%" },
  modalCard: {
    backgroundColor: BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  modalTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  modalSub: { color: MUTED, marginTop: 6, lineHeight: 18, fontWeight: "800" },
  input: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT,
    backgroundColor: SURFACE,
    fontWeight: "800",
  },
});
