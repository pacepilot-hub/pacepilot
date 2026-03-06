# AI Coding Instructions for PacePilot

**Project**: Sports coaching AI app (React Native + Expo)  
**Stack**: React Native 0.81.5 | Expo SDK 54 | TypeScript 5.9 | Zod 4 | expo-router

---

## 🏗️ Architecture

### **Core Layers**

1. **Navigation & State** (`app/_layout.tsx`, `app/(tabs)/_layout.tsx`)
   - expo-router file-based routing with path guards for auth/onboarding/tabs
   - Root layout redirects based on: `authed` → `onboarding:complete` → `/(tabs)/home`
   - Pattern: `safeGetBool()` for AsyncStorage boolean flags; `computeTarget()` for nav logic

2. **Data Access** (`storage/`)
   - **Source of truth**: AsyncStorage with Zod validation & versioning
   - Onboarding v4 (with legacy compat): `storage/onboarding.ts` handles profile/program/goals with merge-deep-minimal + mutex gate to prevent races
   - Activities: `storage/activities.ts` exports `ActivityType`, `Sport`, `ActivityKind`, tags (weather/sleep/stress/energy)
   - Central loader: `storage/db.ts` `LoadDBResult` bundles activities + weekly plan + coach advice + metrics in parallel

3. **Business Logic** (`coaching/`)
   - **Planning**: `planService.ts` manages weekly plans with fingerprinting + "silent IA patching" (aiStamp for daily tweaks without full regen)
   - **Decision engine**: `decisionEngine.ts` applies safety-first rules (pain > fatigue > continuity > data), returns `Decision` with confidence + reasons
   - **Dates**: `dates.ts` provides ISO date helpers (locale-aware Monday calculation, addDaysISO, toISODateLocal)
   - **Derived state**: `derivedState.ts` computes activity context (trends, fatigue, confidence) from historical data
   - **Metrics**: `buildLoadSeries()`, `summarizeLoad()` calculate training load

4. **UI Components** (`components/`)
   - **Base**: `ui/Screen.tsx` wraps SafeAreaView with insets + padding; `Card.tsx`, `ButtonPrimary.tsx`, `SectionTitle.tsx`, `IconButton.tsx`
   - **Feature**: `TodayCard.tsx` displays today's planned session; `WorkoutTodayCard.tsx` for active workout; `ActivityRow.tsx` for list items
   - **Patterns**: all memoized, use `@expo/vector-icons` (Ionicons), StyleSheet only (no Tailwind)

5. **Theme** (`constants/theme.ts`)
   - Dark mode: `primary: #EF3B00`, `bg: #0B0B0C`, `surface: #141417`, `text: #F2F2F2`
   - Helpers: `rgba()`, `mixHex()` for color ops; use `theme.colors.*` everywhere

---

## 🔑 Key Patterns

### **Storage & Validation**
- Always validate with Zod before storing/sending. Example: `OnboardingSchema.parse(data)`
- Use `await withGate(async () => {...})` in onboarding.ts to prevent concurrent writes
- Keys are versioned: `"pacepilot:onboarding:v4"`, `"pacepilot:auth:v1"`
- AsyncStorage error handling: wrap in try/catch, return sensible defaults

### **Component Lifecycle**
```tsx
// Pattern: useFocusEffect for data refresh on screen focus
useFocusEffect(
  useCallback(() => {
    loadData(); // refresh from storage/API
  }, [])
);

// Pattern: memo + useCallback for performance
export const MyComponent = memo(function MyComponent({ prop }: Props) {
  const handler = useCallback(() => { /* logic */ }, [deps]);
  return <Pressable onPress={handler}>...</Pressable>;
});
```

### **Decision-Making Flow**
1. Fetch `DerivedState` from activity history
2. Call `decideTodaySession(state, session, context)` → returns `Decision` with mode (recovery/progression/safety) + confidence
3. `reasonsToText(decision.reasons)` converts codes to user-friendly strings
4. Apply `WeatherConstraints` (soften intensity, shorten duration) if present
5. Fall back to minimum effective session (20 min default) if needed

### **Weekly Plan Generation**
- `ensureWeeklyPlan()` checks if plan exists + valid; regens if stale/fingerprint mismatch
- Silent IA patch: if `aiStamp` differs, update today's session only (don't regen whole week)
- Plan stored as `WeeklyPlan` (array of `WeeklyPlanDay`, each with planned `Session`)

---

## 📝 File Organization & Naming

```
app/                      # expo-router screens (file = route)
├── _layout.tsx           # root guard + navigation logic
├── (tabs)/               # tab navigator group
│   ├── _layout.tsx       # tab config (home, activities, plan, progress, map)
│   └── home.tsx, plan.tsx, activities.tsx, progress.tsx, map.tsx
├── (auth)/               # auth screens (login, signup)
├── onboarding/           # multi-step wizard (profile, program, done)
└── chat.tsx, notifications.tsx, ping-test.tsx

components/
├── ui/                   # base: Screen, Card, Button, SectionTitle
├── header/               # CoachButton, etc.
├── gestures/             # SmartCard (gesture-driven components)
└── training/             # WeekPlanCard

storage/
├── db.ts                 # central async loader (activities + plan + coach + metrics)
├── onboarding.ts         # profile/program/goals with v4 compat
├── activities.ts         # activity type definitions + CRUD
├── trainingPlan.ts       # weekly/multi-week plan structures
├── plans.ts              # plan storage CRUD
└── coach.ts              # coach advice generation

coaching/
├── planService.ts        # ensureWeeklyPlan, fingerprinting, silent patch
├── decisionEngine.ts     # decideTodaySession (safety-first logic)
├── derivedState.ts       # compute activity trends + confidence
├── dates.ts              # ISO date helpers (locale Monday)
├── planGenerator.ts      # generateWeeklyPlan (IA integration)
└── metrics.ts            # buildLoadSeries, summarizeLoad

constants/
└── theme.ts              # color palette + helpers (rgba, mixHex)
```

---

## 🛠️ Development Workflows

### **Starting the app**
```bash
npm start                 # Expo dev server
# Choose: android | ios | web
```

### **Adding a new screen**
1. Create `app/my-feature.tsx` (file = route auto-added)
2. Import `Screen` from `components/ui`; wrap with `<Screen>` + `useSafeAreaInsets()`
3. Use `expo-router` `Link` or `useRouter()` for navigation
4. Fetch data via `storage/` functions (not direct AsyncStorage)

### **Adding a component**
1. Create in `components/` folder
2. Export as `memo(function MyComponent({props})` for perf
3. Use StyleSheet only (no className)
4. Import icons from `@expo/vector-icons` (Ionicons)
5. Colors from `@/constants/theme`

### **Modifying user data flow**
- Onboarding changes: update `storage/onboarding.schema.ts` (Zod schema) + bump v5 if breaking
- Activity tracking: extend `Activity` type in `storage/activities.ts`
- Plan updates: call `ensureWeeklyPlan()` to refresh; use aiStamp for silent patches

---

## ⚠️ Critical Guards & Errors

### **Authentication**
- Root layout checks `AUTH_KEY` before allowing any navigation
- If not authed, redirect to `/(auth)/login`

### **Onboarding**
- After auth, check `ONB_COMPLETE_KEY`
- If incomplete, redirect to `/onboarding/profile` (first step of wizard)

### **Data Validation**
- Always parse API responses + AsyncStorage reads with Zod
- Fallback values: `Activity[]` → `[]`, `WeeklyPlan` → `null`, `Profile` → sensible defaults
- `safeStringify()` for error logs (handles cycles, non-JSON types)

### **Plan Freshness**
- Compare fingerprint (user profile hash) + `planStartMondayISO` vs today
- If stale (>7 days old), regen full week
- If aiStamp differs, update only today's session (silent patch)

---

## 📦 Key Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `expo-router` | File-based routing | Use `Link`, `useRouter()`, `useLocalSearchParams` |
| `AsyncStorage` | Local persistence | Async only; wrap in try/catch |
| `zod` | Data validation | Every API/storage input must be parsed |
| `react-native-reanimated` | Animations | Use for smooth transitions (not Animated) |
| `expo-linear-gradient` | Gradient UI | For background gradients |
| `@expo/vector-icons` | Icons | Ionicons set available |
| `react-native-maps` | Map display | If GPS/location needed |
| `@gorhom/bottom-sheet` | Drawer UI | For modal sheets |

---

## ✅ Checklist for New Features

- [ ] Screen created in `app/` with file-based route
- [ ] Uses `Screen` component + `useSafeAreaInsets()`
- [ ] Data flow: `storage/` functions → validation → state → render
- [ ] Errors caught + user-facing messages
- [ ] Icons from `@expo/vector-icons`; colors from theme
- [ ] All functions/components memoized or have stable deps
- [ ] AsyncStorage writes use `withGate` or simple setItem
- [ ] TypeScript strict mode (no `any`)
- [ ] Zod schema for all external/user data
