// storage/checkins.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Check-ins storage (V2.1 - beta clean)
 * - Daily check-in: affichage 1x/jour + dernière réponse
 * - Post-session: flag pending + dernière activité + dernière réponse
 * - Robuste: parse safe, dates ISO "YYYY-MM-DD"
 * - Anti-races: gate global (lectures critiques incluses)
 * - Perf: multiGet/multiSet/multiRemove quand utile
 */

const KEY = {
  DAILY_LAST_SHOWN: "pp_checkin_daily_last_shown", // "YYYY-MM-DD"
  DAILY_LAST_ANSWER: "pp_checkin_daily_last_answer", // JSON
  POST_PENDING: "pp_checkin_post_pending", // "1" | "0"
  POST_LAST_ANSWER: "pp_checkin_post_last_answer", // JSON
  POST_LAST_ACTIVITY_ID: "pp_checkin_post_last_activity_id", // string
} as const;

/* ---------------------------------- utils --------------------------------- */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function ymd(d: Date = new Date()): string {
  // Date locale (OK pour usage UI quotidien)
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function readJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Mutex simple (anti-races) : garantit 1 writer/reader critique à la fois.
 * - évite les flashes de UI (shouldShow pendant save)
 * - évite les incohérences pending/answer
 */
let gate = Promise.resolve<void>(undefined);

function withGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn, fn);
  gate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/* ----------------------------- daily check-in ----------------------------- */

export type DailyCheckinAnswer = {
  date: string; // YYYY-MM-DD
  choice: string;
  note?: string;
  createdAt: number;
};

function sanitizeDailyAnswer(x: unknown): DailyCheckinAnswer | null {
  if (!isObj(x)) return null;

  const date = safeStr((x as any).date);
  const choice = safeStr((x as any).choice);
  const noteRaw = (x as any).note;
  const createdAtRaw = (x as any).createdAt;

  const createdAt =
    typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw) ? createdAtRaw : NaN;

  const note = typeof noteRaw === "string" ? noteRaw.trim() : undefined;

  if (!isYmd(date)) return null;
  if (!choice) return null;
  if (!Number.isFinite(createdAt)) return null;

  return { date, choice, note: note || undefined, createdAt };
}

/**
 * Affiche le check-in quotidien si:
 * - pas marqué "shown" aujourd'hui
 * ET
 * - pas déjà répondu aujourd'hui (safety)
 *
 * ✅ gated pour éviter l’affichage pendant un save en vol
 */
export async function shouldShowDailyCheckin(): Promise<boolean> {
  return await withGate(async () => {
    const today = ymd();

    const [[, lastShown], [, lastAnswerRaw]] = await AsyncStorage.multiGet([
      KEY.DAILY_LAST_SHOWN,
      KEY.DAILY_LAST_ANSWER,
    ]);

    if (lastShown === today) return false;

    // safety: si une réponse du jour existe déjà, on n'affiche pas
    if (lastAnswerRaw) {
      try {
        const parsed = JSON.parse(lastAnswerRaw);
        const ans = sanitizeDailyAnswer(parsed);
        if (ans?.date === today) return false;
      } catch {
        // ignore: payload corrompu -> on continue
      }
    }

    return true;
  });
}

/**
 * ✅ gated: évite les races avec shouldShow/save
 */
export async function markDailyCheckinShownToday(): Promise<void> {
  await withGate(async () => {
    await AsyncStorage.setItem(KEY.DAILY_LAST_SHOWN, ymd());
  });
}

/**
 * Sauve la réponse + marque shown aujourd’hui.
 * - refuse si choice vide
 * - gated (anti-races)
 */
export async function saveDailyCheckinAnswer(
  answer: Omit<DailyCheckinAnswer, "date" | "createdAt">
): Promise<void> {
  await withGate(async () => {
    const payload: DailyCheckinAnswer = {
      date: ymd(),
      createdAt: Date.now(),
      choice: safeStr(answer.choice),
      note: typeof answer.note === "string" ? answer.note.trim() || undefined : undefined,
    };

    if (!payload.choice) return;

    await AsyncStorage.multiSet([
      [KEY.DAILY_LAST_ANSWER, JSON.stringify(payload)],
      [KEY.DAILY_LAST_SHOWN, payload.date],
    ]);
  });
}

export async function getLastDailyCheckinAnswer(): Promise<DailyCheckinAnswer | null> {
  // lecture simple OK (pas critique)
  const raw = await readJson<unknown>(KEY.DAILY_LAST_ANSWER);
  return sanitizeDailyAnswer(raw);
}

/* ---------------------------- post-session check -------------------------- */

export type PostSessionAnswer = {
  choice: string;
  note?: string;
  createdAt: number;
  activityId?: string | null;
};

function sanitizePostAnswer(x: unknown): PostSessionAnswer | null {
  if (!isObj(x)) return null;

  const choice = safeStr((x as any).choice);
  const noteRaw = (x as any).note;
  const createdAtRaw = (x as any).createdAt;
  const activityIdRaw = (x as any).activityId;

  const createdAt =
    typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw) ? createdAtRaw : NaN;

  const note = typeof noteRaw === "string" ? noteRaw.trim() : undefined;

  const activityId =
    activityIdRaw === null || activityIdRaw === undefined
      ? (activityIdRaw as null | undefined)
      : typeof activityIdRaw === "string"
      ? activityIdRaw.trim() || undefined
      : undefined;

  if (!choice) return null;
  if (!Number.isFinite(createdAt)) return null;

  return { choice, note: note || undefined, createdAt, activityId };
}

/**
 * Marque pending + (optionnel) activityId.
 * ✅ gated
 */
export async function setPostSessionPending(activityId?: string): Promise<void> {
  await withGate(async () => {
    const id = safeStr(activityId);
    const pairs: Array<[string, string]> = [[KEY.POST_PENDING, "1"]];
    if (id) pairs.push([KEY.POST_LAST_ACTIVITY_ID, id]);
    await AsyncStorage.multiSet(pairs);
  });
}

/**
 * ✅ gated (sinon race possible avec set/save)
 */
export async function clearPostSessionPending(): Promise<void> {
  await withGate(async () => {
    await AsyncStorage.setItem(KEY.POST_PENDING, "0");
  });
}

export async function isPostSessionPending(): Promise<boolean> {
  // lecture simple OK
  return (await AsyncStorage.getItem(KEY.POST_PENDING)) === "1";
}

export async function getPendingActivityId(): Promise<string | null> {
  // lecture simple OK
  const id = await AsyncStorage.getItem(KEY.POST_LAST_ACTIVITY_ID);
  const t = safeStr(id);
  return t ? t : null;
}

/**
 * Sauve réponse + clear pending.
 * ✅ gated
 *
 * Note: on laisse POST_LAST_ACTIVITY_ID tel quel (utile debug).
 * Si tu veux le nettoyer en prod, décommente multiRemove.
 */
export async function savePostSessionAnswer(
  answer: Omit<PostSessionAnswer, "createdAt">
): Promise<void> {
  await withGate(async () => {
    const payload: PostSessionAnswer = {
      createdAt: Date.now(),
      choice: safeStr(answer.choice),
      note: typeof answer.note === "string" ? answer.note.trim() || undefined : undefined,
      activityId:
        answer.activityId === null || answer.activityId === undefined
          ? answer.activityId
          : safeStr(answer.activityId) || undefined,
    };

    if (!payload.choice) return;

    await AsyncStorage.multiSet([
      [KEY.POST_LAST_ANSWER, JSON.stringify(payload)],
      [KEY.POST_PENDING, "0"],
    ]);

    // Optionnel: si tu veux vraiment nettoyer l'id après réponse
    // await AsyncStorage.multiRemove([KEY.POST_LAST_ACTIVITY_ID]);
  });
}

export async function getLastPostSessionAnswer(): Promise<PostSessionAnswer | null> {
  const raw = await readJson<unknown>(KEY.POST_LAST_ANSWER);
  return sanitizePostAnswer(raw);
}

/* ---------------------------- optional helpers ---------------------------- */

/**
 * Pratique: snapshot (debug UI / logs)
 */
export async function getCheckinsSnapshot(): Promise<{
  today: string;
  dailyLastShown: string | null;
  dailyLastAnswer: DailyCheckinAnswer | null;
  postPending: boolean;
  postLastActivityId: string | null;
  postLastAnswer: PostSessionAnswer | null;
}> {
  const today = ymd();

  const [
    dailyLastShown,
    dailyLastAnswerRaw,
    postPendingRaw,
    postLastActivityId,
    postLastAnswerRaw,
  ] = await AsyncStorage.multiGet([
    KEY.DAILY_LAST_SHOWN,
    KEY.DAILY_LAST_ANSWER,
    KEY.POST_PENDING,
    KEY.POST_LAST_ACTIVITY_ID,
    KEY.POST_LAST_ANSWER,
  ]).then((pairs) => pairs.map((p) => p[1] ?? null));

  let dailyLastAnswer: DailyCheckinAnswer | null = null;
  if (dailyLastAnswerRaw) {
    try {
      dailyLastAnswer = sanitizeDailyAnswer(JSON.parse(dailyLastAnswerRaw));
    } catch {}
  }

  let postLastAnswer: PostSessionAnswer | null = null;
  if (postLastAnswerRaw) {
    try {
      postLastAnswer = sanitizePostAnswer(JSON.parse(postLastAnswerRaw));
    } catch {}
  }

  return {
    today,
    dailyLastShown,
    dailyLastAnswer,
    postPending: postPendingRaw === "1",
    postLastActivityId: postLastActivityId ? safeStr(postLastActivityId) || null : null,
    postLastAnswer,
  };
}

/**
 * Reset complet check-ins (debug/dev)
 * ✅ gated
 */
export async function clearAllCheckins(): Promise<void> {
  await withGate(async () => {
    await AsyncStorage.multiRemove([
      KEY.DAILY_LAST_SHOWN,
      KEY.DAILY_LAST_ANSWER,
      KEY.POST_PENDING,
      KEY.POST_LAST_ANSWER,
      KEY.POST_LAST_ACTIVITY_ID,
    ]);
  });
}
