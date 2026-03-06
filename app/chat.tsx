// app/chat.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card } from "@/components/ui";
import { theme } from "@/constants/theme";

/**
 * Chat "Coach IA" (MVP local)
 * ✅ UI propre + messages + header
 * ✅ quick replies
 * ✅ input auto-grow (borné)
 * ✅ typing mock (annulable)
 * ✅ persistance locale (draft + historique)
 * ✅ prêt à brancher API (sendToApi)
 * ✅ garde-fous: double-send / unmount / spam tap / scroll stable
 */

type Role = "user" | "coach";
type ChatMsg = {
  id: string;
  role: Role;
  text: string;
  ts: number;
};

const STORE_KEY = "pacepilot:chat:v1";
const DRAFT_KEY = "pacepilot:chat:draft:v1";

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const QUICK_REPLIES = [
  { id: "qr1", label: "Résume mon plan", prompt: "Peux-tu résumer mon plan de la semaine et l’objectif du jour ?" },
  { id: "qr2", label: "Allure EF ?", prompt: "Rappelle-moi comment reconnaître une bonne endurance fondamentale." },
  { id: "qr3", label: "Je suis fatigué", prompt: "Je suis fatigué aujourd’hui. Que me conseilles-tu ?" },
  { id: "qr4", label: "Je n’ai que 30 min", prompt: "Je n’ai que 30 minutes. Comment adapter la séance ?" },
] as const;

/* ------------------------------ coach mock ------------------------------ */

function makeCoachAnswer(userText: string) {
  const t = userText.toLowerCase();

  if (t.includes("douleur") || t.includes("bless") || t.includes("gêne") || t.includes("gen")) {
    return (
      "Ok, priorité sécurité.\n" +
      "• Si douleur vive / qui change ta foulée → stop + repos.\n" +
      "• Si gêne légère → séance très facile + on raccourcit.\n" +
      "• Si ça revient à chaque sortie → on adapte la semaine.\n" +
      "Tu me dis où c’est (mollet, genou, hanche…) et niveau (0–10) ?"
    );
  }

  if (t.includes("fatigu")) {
    return (
      "Ok. On va jouer sécurité :\n" +
      "• Si douleur ou signe inhabituel → repos.\n" +
      "• Si juste fatigue générale → 20–35 min très facile + 4×20s relâchées (optionnel).\n" +
      "• Objectif : finir plus frais que tu n’as commencé.\n" +
      "Fatigue plutôt physique, mentale, ou les deux ?"
    );
  }

  if (t.includes("30") || t.includes("minutes") || t.includes("min ")) {
    return (
      "Nickel, on adapte sans casser la progression :\n" +
      "• 8 min échauffement facile\n" +
      "• 14 min bloc principal (EF ou tempo léger)\n" +
      "• 6–8 min retour au calme\n" +
      "Règle d’or : régularité > perfection."
    );
  }

  if (t.includes("endurance") || t.includes("ef")) {
    return (
      "En endurance fondamentale, tu dois pouvoir parler en phrases.\n" +
      "Repères :\n" +
      "• respiration stable, pas de lutte\n" +
      "• sensation de contrôle\n" +
      "• tu pourrais tenir longtemps\n" +
      "Donne-moi ton allure EF habituelle + ressenti (0–10)."
    );
  }

  if (t.includes("plan") || t.includes("semaine")) {
    return (
      "Je peux te faire un résumé clair.\n" +
      "Pour être précis, il me faut 2 infos :\n" +
      "• séance du jour (titre + durée)\n" +
      "• dernière sortie (distance / ressenti)\n" +
      "Ensuite je te donne : objectif, vigilance, priorité."
    );
  }

  return (
    "Ok. Dis-moi ce que tu veux optimiser :\n" +
    "• régularité\n" +
    "• vitesse / seuil\n" +
    "• sortie longue\n" +
    "• récupération\n" +
    "Je te réponds en mode simple et actionnable."
  );
}

/* ------------------------------ storage helpers ------------------------------ */

async function safeLoadMessages(): Promise<ChatMsg[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(Boolean) as ChatMsg[];
  } catch {
    return null;
  }
}

async function safeSaveMessages(msgs: ChatMsg[]) {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(msgs));
  } catch {
    // ignore
  }
}

async function safeLoadDraft(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(DRAFT_KEY)) ?? "";
  } catch {
    return "";
  }
}

async function safeSaveDraft(v: string) {
  try {
    await AsyncStorage.setItem(DRAFT_KEY, v);
  } catch {
    // ignore
  }
}

/* -------------------------------- component -------------------------------- */

export default memo(function Chat() {
  const scrollRef = useRef<ScrollView | null>(null);
  const aliveRef = useRef(true);

  // typing timeout guard (so we can cancel on reset/unmount)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hydrated, setHydrated] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    {
      id: uid(),
      role: "coach",
      text: "Salut 👋\nJe suis ton coach. Dis-moi ce que tu ressens aujourd’hui, et je te propose la meilleure décision simple.",
      ts: Date.now(),
    },
  ]);

  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);

  const [inputH, setInputH] = useState(44);
  const maxInputH = 120;

  const canSend = useMemo(() => input.trim().length > 0 && !typing, [input, typing]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const setMessagesAndPersist = useCallback((updater: (prev: ChatMsg[]) => ChatMsg[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      safeSaveMessages(next);
      return next;
    });
  }, []);

  const pushMessage = useCallback(
    (m: ChatMsg) => {
      setMessagesAndPersist((prev) => [...prev, m]);
      scrollToEnd();
    },
    [setMessagesAndPersist, scrollToEnd]
  );

  const cancelTyping = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    setTyping(false);
  }, []);

  // --- hydration (messages + draft) ---
  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      const [saved, draft] = await Promise.all([safeLoadMessages(), safeLoadDraft()]);
      if (!aliveRef.current) return;

      if (saved && saved.length) {
        setMessages(saved);
      }
      if (draft) setInput(draft);

      setHydrated(true);
      requestAnimationFrame(scrollToEnd);
    })();

    return () => {
      aliveRef.current = false;
      cancelTyping();
    };
  }, [cancelTyping, scrollToEnd]);

  // persist draft (debounced light)
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => safeSaveDraft(input), 180);
    return () => clearTimeout(t);
  }, [input, hydrated]);

  // --- API hook (future) ---
  const sendToApi = useCallback(async (userText: string): Promise<string> => {
    // TODO: replace by real API call
    return makeCoachAnswer(userText);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (typing) return; // anti-spam

      pushMessage({ id: uid(), role: "user", text: clean, ts: Date.now() });
      setInput("");
      setTyping(true);

      // cancel previous timer (just in case)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      // small fake latency + API call
      const startedAt = Date.now();

      typingTimerRef.current = setTimeout(async () => {
        try {
          const answer = await sendToApi(clean);

          // keep a minimum typing feel
          const elapsed = Date.now() - startedAt;
          const minDelay = 380;
          const extra = Math.max(0, minDelay - elapsed);

          setTimeout(() => {
            if (!aliveRef.current) return;
            pushMessage({ id: uid(), role: "coach", text: answer, ts: Date.now() });
            setTyping(false);
          }, extra);
        } catch {
          if (!aliveRef.current) return;
          pushMessage({
            id: uid(),
            role: "coach",
            text: "Oups. Petit bug de mon côté.\nRéessaie dans 10 secondes, et on repart propre.",
            ts: Date.now(),
          });
          setTyping(false);
        } finally {
          typingTimerRef.current = null;
        }
      }, 520);
    },
    [pushMessage, sendToApi, typing]
  );

  const onQuickReply = useCallback(
    (prompt: string) => {
      if (typing) return;
      send(prompt);
    },
    [send, typing]
  );

  const onInputSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = Math.min(maxInputH, Math.max(44, Math.ceil(e.nativeEvent.contentSize.height)));
      setInputH(h);
    },
    []
  );

  const resetChat = useCallback(() => {
    cancelTyping();
    const seed: ChatMsg[] = [
      {
        id: uid(),
        role: "coach",
        text: "On repart propre.\nDis-moi ce que tu ressens aujourd’hui.",
        ts: Date.now(),
      },
    ];
    setMessages(seed);
    safeSaveMessages(seed);
    setInput("");
    safeSaveDraft("");
    requestAnimationFrame(scrollToEnd);
  }, [cancelTyping, scrollToEnd]);

  // iOS multiline: handle "send" via button only; android can use submit (optional)
  const onSubmitEditing = useCallback(() => {
    if (Platform.OS === "ios") return;
    if (canSend) send(input);
  }, [canSend, input, send]);

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.avatar}>
              <Ionicons name="sparkles" size={16} color={theme.colors.primary} />
            </View>
            <View>
              <Text style={s.title}>Coach IA</Text>
              <Text style={s.sub}>Réponses simples • sécurité d’abord</Text>
            </View>
          </View>

          <Pressable
            onPress={resetChat}
            hitSlop={10}
            style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.colors.text} />
          </Pressable>
        </View>

        {/* Quick replies */}
        <View style={s.qrWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.qrRow}>
            {QUICK_REPLIES.map((q) => (
              <Pressable
                key={q.id}
                onPress={() => onQuickReply(q.prompt)}
                disabled={typing}
                style={({ pressed }) => [s.qrPill, typing && { opacity: 0.55 }, pressed && !typing && { opacity: 0.85 }]}
              >
                <Text style={s.qrText}>{q.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Messages */}
        <ScrollView
          ref={(r) => (scrollRef.current = r)}
          style={{ flex: 1 }}
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
        >
          {messages.map((m) => {
            const isCoach = m.role === "coach";
            return (
              <View key={m.id} style={[s.row, isCoach ? s.rowLeft : s.rowRight]}>
                <View style={[isCoach ? s.bubbleCoach : s.bubbleUser]}>
                  <Text style={s.msgText}>{m.text}</Text>
                  <Text style={s.time}>{formatTime(m.ts)}</Text>
                </View>
              </View>
            );
          })}

          {typing ? (
            <View style={[s.row, s.rowLeft]}>
              <Card style={s.typingCard}>
                <View style={s.typingRow}>
                  <View style={s.dot} />
                  <View style={s.dot} />
                  <View style={s.dot} />
                  <Text style={s.typingTxt}>Le coach réfléchit…</Text>
                </View>
              </Card>
            </View>
          ) : null}

          <View style={{ height: 10 }} />
        </ScrollView>

        {/* Input */}
        <View style={s.inputBar}>
          <View style={[s.inputWrap, { height: inputH }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Écris ici… (sensations, question, doute)"
              placeholderTextColor={theme.colors.text2}
              style={[s.input, { height: inputH }]}
              multiline
              onContentSizeChange={onInputSizeChange}
              autoCorrect
              autoCapitalize="sentences"
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={onSubmitEditing}
            />
          </View>

          <Pressable
            onPress={() => send(input)}
            disabled={!canSend}
            hitSlop={10}
            style={({ pressed }) => [
              s.sendBtn,
              !canSend && { opacity: 0.5 },
              pressed && canSend && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="send" size={16} color={theme.colors.text} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
});

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,59,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,59,0,0.22)",
  },
  title: { color: theme.colors.text, fontWeight: "950", fontSize: 18 },
  sub: { marginTop: 2, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },

  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  qrWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  qrRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  qrPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  qrText: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },

  body: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10 },

  row: { flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  bubbleCoach: {
    maxWidth: "86%",
    borderRadius: 16,
    borderTopLeftRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  bubbleUser: {
    maxWidth: "86%",
    borderRadius: 16,
    borderTopRightRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(239,59,0,0.24)",
    backgroundColor: "rgba(239,59,0,0.12)",
  },

  msgText: { color: theme.colors.text, fontWeight: "800", lineHeight: 20 },
  time: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", fontSize: 11 },

  typingCard: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16 },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingTxt: { color: theme.colors.text2, fontWeight: "800", fontSize: 12 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.35)",
  },

  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 14 : 10,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  inputWrap: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  input: {
    color: theme.colors.text,
    fontWeight: "800",
    lineHeight: 20,
    padding: 0,
    margin: 0,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
});
