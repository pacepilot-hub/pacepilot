// app/notifications.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Card, SectionTitle } from "@/components/ui";
import { theme } from "@/constants/theme";

/**
 * Notifications (MVP local)
 * ✅ liste + unread + mark read on open
 * ✅ "tout lire" + "supprimer lues"
 * ✅ persistance locale (AsyncStorage)
 * ✅ garde-fous: unmount safe, anti double-tap
 * ✅ prêt à brancher API/DB (table notifications)
 */

type NotifType = "coach" | "plan" | "checkin" | "achievement" | "system";

type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body?: string;
  dateLabel: string; // "Aujourd’hui • 18:10"
  isRead: boolean;
  deepLink?: string; // "/(tabs)/progress?toast=..."
};

const STORE_KEY = "pacepilot:notifications:v1";

/* -------------------------------- helpers -------------------------------- */

function iconForType(t: NotifType): keyof typeof Ionicons.glyphMap {
  switch (t) {
    case "coach":
      return "chatbubble-ellipses-outline";
    case "plan":
      return "calendar-outline";
    case "checkin":
      return "happy-outline";
    case "achievement":
      return "trophy-outline";
    default:
      return "notifications-outline";
  }
}

function labelForType(t: NotifType) {
  switch (t) {
    case "coach":
      return "Coach";
    case "plan":
      return "Plan";
    case "checkin":
      return "Check-in";
    case "achievement":
      return "Succès";
    default:
      return "Système";
  }
}

function safeNowLabel() {
  // simple label; en prod tu mettras un vrai formatter
  return "Aujourd’hui • maintenant";
}

function seedNotifs(): Notif[] {
  return [
    {
      id: "n1",
      type: "plan",
      title: "Séance du jour prête",
      body: "Ouvre la carte Aujourd’hui pour voir la séance.",
      dateLabel: "Aujourd’hui • 18:10",
      isRead: false,
      deepLink: "/(tabs)/home",
    },
    {
      id: "n2",
      type: "checkin",
      title: "Check-in quotidien",
      body: "20 secondes pour ajuster la charge (fatigue, sommeil, douleur).",
      dateLabel: "Aujourd’hui • 08:12",
      isRead: true,
      deepLink: "/checkins/daily",
    },
    {
      id: "n3",
      type: "achievement",
      title: "Succès débloqué : 20 km / semaine",
      body: "Continue comme ça. La régularité gagne.",
      dateLabel: "20 janv. 2026 • 21:05",
      isRead: true,
      deepLink: "/(tabs)/progress",
    },
    {
      id: "n4",
      type: "coach",
      title: "Conseil coach",
      body: "Si ta charge monte trop vite, reste sur 2 EF + 1 SL cette semaine.",
      dateLabel: "18 janv. 2026 • 09:40",
      isRead: true,
      deepLink: "/chat",
    },
  ];
}

async function safeLoad(): Promise<Notif[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(Boolean) as Notif[];
  } catch {
    return null;
  }
}

async function safeSave(items: Notif[]) {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/* -------------------------------- component -------------------------------- */

export default memo(function Notifications() {
  const router = useRouter();

  const aliveRef = useRef(true);
  const openingRef = useRef<string | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<Notif[]>(seedNotifs);

  const setItemsAndPersist = useCallback((updater: (prev: Notif[]) => Notif[]) => {
    setItems((prev) => {
      const next = updater(prev);
      safeSave(next);
      return next;
    });
  }, []);

  // hydrate
  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      const saved = await safeLoad();
      if (!aliveRef.current) return;

      if (saved && saved.length) {
        setItems(saved);
      } else {
        // seed + persist once
        const seed = seedNotifs();
        setItems(seed);
        safeSave(seed);
      }

      setHydrated(true);
    })();

    return () => {
      aliveRef.current = false;
    };
  }, []);

  const unreadCount = useMemo(() => items.filter((n) => !n.isRead).length, [items]);

  const markAllRead = useCallback(() => {
    setItemsAndPersist((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [setItemsAndPersist]);

  const clearRead = useCallback(() => {
    setItemsAndPersist((prev) => prev.filter((n) => !n.isRead));
  }, [setItemsAndPersist]);

  const clearAll = useCallback(() => {
    setItemsAndPersist(() => []);
  }, [setItemsAndPersist]);

  const addMock = useCallback(() => {
    // juste pratique pour tester l’UI
    const n: Notif = {
      id: `m-${Date.now()}`,
      type: "system",
      title: "Test notification",
      body: "Ceci est un message de test (local).",
      dateLabel: safeNowLabel(),
      isRead: false,
      deepLink: "/(tabs)/home",
    };
    setItemsAndPersist((prev) => [n, ...prev]);
  }, [setItemsAndPersist]);

  const openNotif = useCallback(
    (n: Notif) => {
      // anti double tap / multi navigate
      if (openingRef.current === n.id) return;
      openingRef.current = n.id;

      // mark read on open
      setItemsAndPersist((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));

      if (n.deepLink) {
        try {
          router.push(n.deepLink as any);
        } finally {
          // release lock next tick
          setTimeout(() => {
            openingRef.current = null;
          }, 0);
        }
        return;
      }

      setTimeout(() => {
        openingRef.current = null;
      }, 0);
    },
    [router, setItemsAndPersist]
  );

  return (
    <Screen scroll={false}>
      <View style={s.wrap}>
        {/* Header */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <SectionTitle>Notifications</SectionTitle>
            <Text style={s.sub}>
              {!hydrated ? "Chargement…" : unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? "s" : ""}` : "Tout est à jour"}
            </Text>
          </View>

          <Pressable
            onPress={markAllRead}
            disabled={items.length === 0}
            style={({ pressed }) => [s.headerBtn, (items.length === 0) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
            hitSlop={10}
          >
            <Ionicons name="checkmark-done-outline" size={16} color={theme.colors.text} />
            <Text style={s.headerBtnTxt}>Tout lire</Text>
          </Pressable>

          <Pressable
            onPress={clearRead}
            disabled={items.every((x) => !x.isRead)}
            style={({ pressed }) => [s.headerBtnGhost, items.every((x) => !x.isRead) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
            hitSlop={10}
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.text2} />
          </Pressable>
        </View>

        {/* mini actions (optionnel, pratique dev) */}
        <View style={s.miniRow}>
          <Pressable onPress={addMock} style={({ pressed }) => [s.miniBtn, pressed && { opacity: 0.85 }]} hitSlop={10}>
            <Ionicons name="add" size={16} color={theme.colors.text} />
            <Text style={s.miniTxt}>Ajouter</Text>
          </Pressable>

          <Pressable onPress={clearAll} style={({ pressed }) => [s.miniBtnGhost, pressed && { opacity: 0.85 }]} hitSlop={10}>
            <Ionicons name="close" size={16} color={theme.colors.text2} />
            <Text style={s.miniTxtGhost}>Tout vider</Text>
          </Pressable>
        </View>

        {/* List */}
        <ScrollView contentContainerStyle={{ paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
          {items.length === 0 ? (
            <Card>
              <Text style={s.emptyTitle}>Rien à signaler</Text>
              <Text style={s.emptyTxt}>Ici tu verras : météo, séance adaptée, rappels, succès, messages coach.</Text>
            </Card>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {items.map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => openNotif(n)}
                  style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                >
                  <Card style={[s.itemCard, !n.isRead && s.itemUnread]}>
                    <View style={s.itemTop}>
                      <View style={s.iconWrap}>
                        <Ionicons name={iconForType(n.type)} size={18} color={theme.colors.primary} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={s.itemTitleRow}>
                          <Text style={s.itemTitle} numberOfLines={1}>
                            {n.title}
                          </Text>
                          {!n.isRead ? <View style={s.dot} /> : null}
                        </View>

                        {!!n.body && (
                          <Text style={s.itemBody} numberOfLines={2}>
                            {n.body}
                          </Text>
                        )}

                        <View style={s.metaRow}>
                          <Text style={s.metaType}>{labelForType(n.type)}</Text>
                          <Text style={s.metaSep}>•</Text>
                          <Text style={s.metaDate}>{n.dateLabel}</Text>
                        </View>
                      </View>

                      <Ionicons name="chevron-forward" size={18} color={theme.colors.text2} />
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
});

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, paddingTop: 24 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sub: { marginTop: 4, color: theme.colors.text2, fontWeight: "800" },

  headerBtn: {
    height: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headerBtnTxt: { color: theme.colors.text, fontWeight: "900" },

  headerBtnGhost: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  miniRow: { marginTop: 10, flexDirection: "row", gap: 10 },
  miniBtn: {
    height: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  miniTxt: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },

  miniBtnGhost: {
    height: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  miniTxtGhost: { color: theme.colors.text2, fontWeight: "900", fontSize: 12 },

  itemCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  itemUnread: {
    borderColor: "rgba(239,59,0,0.32)",
    backgroundColor: "rgba(239,59,0,0.06)",
  },

  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },

  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,59,0,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,59,0,0.22)",
    marginTop: 1,
  },

  itemTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  itemTitle: { flex: 1, color: theme.colors.text, fontWeight: "900", fontSize: 14 },

  dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: theme.colors.primary },

  itemBody: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },

  metaRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  metaType: { color: theme.colors.primary, fontWeight: "900", fontSize: 12 },
  metaSep: { color: theme.colors.text2, fontWeight: "900" },
  metaDate: { color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  emptyTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  emptyTxt: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },
});
