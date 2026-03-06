# 🏃 PacePilot — Instructions pour Claude Code

> Ce fichier est lu automatiquement par Claude Code à chaque session.
> Il contient toutes les instructions de développement et les prompts IA de l'application.

---

## 📱 PRÉSENTATION DU PROJET

**PacePilot** est une application mobile de coaching sportif IA.
Elle génère des plans d'entraînement personnalisés, suit les séances en temps réel via GPS et capteurs Bluetooth, et propose des parcours intelligents adaptés à chaque utilisateur.

---

## 🛠️ STACK TECHNIQUE

```
Framework       : React Native 0.81.5 + Expo SDK 54
Navigation      : expo-router (file-based routing)
Langage         : TypeScript 5.9 — types stricts obligatoires, jamais de `any`
Validation      : Zod 4 — toutes les données validées avant usage
Styles          : StyleSheet React Native UNIQUEMENT — pas de Tailwind, pas de className
Animations      : react-native-reanimated 4 — pas d'Animated de base
Storage local   : AsyncStorage — persistance offline
Base de données : Supabase (PostgreSQL + Auth + Realtime + Storage)
GPS             : expo-location (accuracy: BestForNavigation)
Bluetooth       : react-native-ble-plx (capteurs FC, puissance, cadence)
Carte           : react-native-maps
IA              : API Claude — modèle claude-haiku-4-5-20251001
Bottom sheets   : @gorhom/bottom-sheet
Icônes          : @expo/vector-icons
Dégradés        : expo-linear-gradient
SVG             : react-native-svg
Cibles          : iOS + Android + Web
```

---

## 📁 STRUCTURE DU PROJET

```
app/                        ← Routes expo-router
  (auth)/                   ← Écrans d'authentification
  (tabs)/                   ← Navigation principale (onglets)
    index.tsx               ← Dashboard / Accueil
    plan.tsx                ← Plan d'entraînement
    session.tsx             ← Séance en cours
    parcours.tsx            ← Gestion des parcours
    profil.tsx              ← Profil utilisateur
  onboarding/               ← Wizard onboarding
  session/[id].tsx          ← Détail séance live
  parcours/[id].tsx         ← Détail parcours

components/                 ← Composants réutilisables
  ui/                       ← Boutons, cards, inputs génériques
  session/                  ← Composants liés aux séances
  parcours/                 ← Composants liés aux parcours
  metrics/                  ← Affichage métriques live
  charts/                   ← Graphiques SVG

hooks/                      ← Custom hooks
  useSession.ts             ← Logique séance GPS live
  useBLE.ts                 ← Connexion capteurs Bluetooth
  useSupabase.ts            ← Client Supabase
  useAI.ts                  ← Appels API Claude

lib/
  supabase.ts               ← Initialisation client Supabase
  anthropic.ts              ← Appels API Claude (Haiku)
  zones.ts                  ← Calcul zones Z1-Z7
  haversine.ts              ← Calcul distance/dénivelé GPS
  ble/                      ← Parseurs GATT Bluetooth

constants/
  sports.ts                 ← Catalogue sports, exercices, zones
  prompts.ts                ← Tous les prompts Claude (voir Section IA)

types/
  profile.ts                ← Types profil utilisateur
  plan.ts                   ← Types plan d'entraînement
  session.ts                ← Types séance
  route.ts                  ← Types parcours
  metrics.ts                ← Types métriques live
```

---

## ⚙️ RÈGLES DE DÉVELOPPEMENT

### Code
- **TypeScript strict** : types explicites sur tous les props, state, et retours de fonction
- **Zod** : valider toutes les données venant de l'API IA, de Supabase, et des formulaires
- **Erreurs** : chaque appel async doit avoir try/catch avec message d'erreur visible pour l'utilisateur
- **États** : toujours gérer `loading` (ActivityIndicator), `error` (texte rouge), `success`
- **Composants** : un composant = une responsabilité. Max ~150 lignes par fichier
- **Hooks** : extraire la logique métier dans des custom hooks (`hooks/`)
- **Jamais** de clé API dans le code mobile — passer par Supabase Edge Functions

### Styles
- StyleSheet.create() uniquement — pas de styles inline sauf cas exceptionnel
- Constantes de couleurs dans `constants/colors.ts`
- Constantes d'espacement dans `constants/spacing.ts`
- SafeAreaView ou useSafeAreaInsets sur tous les écrans

### Navigation (expo-router)
- Toujours utiliser `useRouter()` pour naviguer programmatiquement
- Paramètres de route via `useLocalSearchParams()`
- Liens statiques via `<Link href="..." />`

### Supabase
- Client singleton dans `lib/supabase.ts`
- RLS activé sur toutes les tables — vérifier les policies avant d'écrire
- Realtime pour les métriques live uniquement (économie batterie)
- Upsert plutôt qu'insert quand une ligne peut déjà exister

### Performance mobile
- `useMemo` et `useCallback` sur les composants de la carte et des métriques live
- FlatList avec `keyExtractor` et `getItemLayout` pour les longues listes
- Images avec `expo-image` (cache automatique)
- Éviter les re-renders inutiles sur les composants GPS (fréquence 1Hz)

---

## 🤖 MODÈLE IA — claude-haiku-4-5-20251001

**Pourquoi Haiku ?**
Haiku est rapide et économique, idéal pour les appels fréquents :
coaching live (plusieurs fois par séance), suggestions de parcours, analyse feedback quotidien.

**Configuration API dans `lib/anthropic.ts` :**

```typescript
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// ⚠️ Ne jamais mettre la clé API ici — utiliser une Supabase Edge Function

export async function callHaiku(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1000
): Promise<string> {
  const response = await fetch("/api/ai", { // → Edge Function Supabase
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) throw new Error("Erreur API IA");
  const data = await response.json();
  return data.content[0].text;
}
```

---

## 🧠 PROMPTS IA — À UTILISER DANS `constants/prompts.ts`

---

### PROMPT 1 — GÉNÉRATION DE PLAN D'ENTRAÎNEMENT

**Quand l'utiliser :** lors de l'onboarding ou quand l'utilisateur demande un nouveau plan.
**Max tokens :** 4000
**Modèle :** claude-haiku-4-5-20251001

```typescript
export const PLAN_GENERATION_SYSTEM = `
Tu es PacePilot, un coach sportif IA expert, bienveillant et ultra-personnalisé.
Tu génères des plans d'entraînement structurés, semaine par semaine, séance par séance.
Chaque plan est unique et basé sur les données réelles de l'utilisateur.

SPORTS MAÎTRISÉS :
Course à pied (5km, 10km, semi, marathon, trail, ultra)
Cyclisme (route, VTT, indoor, gran fondo)
Natation (piscine, eau libre)
Triathlon (Sprint, Olympique, Half 70.3, Full Ironman)
Musculation / Fitness (masse, force, perte de poids, tonification)

ZONES D'INTENSITÉ :
Z1 Récupération    < 60% FCmax  |  < 55% FTP
Z2 Endurance       60-70%       |  56-75%
Z3 Tempo           70-80%       |  76-90%
Z4 Seuil           80-90%       |  91-105%
Z5 VO2max          90-95%       |  106-120%
Z6 Anaérobie       95-100%      |  121-150%
Z7 Sprint max      > 100%       |  > 150%

RÈGLES ABSOLUES :
- Progression volume max +10%/semaine
- Règle 80/20 : 80% basse intensité (Z1-Z2) / 20% haute (Z4-Z5)
- Semaine de récupération obligatoire toutes les 3-4 semaines (-35% volume)
- Jamais 2 séances dures consécutives
- Tapering avant compétition : -40% volume sur 2-3 semaines
- Adapter selon blessures, fatigue, disponibilité

RÉPONDS UNIQUEMENT EN JSON VALIDE selon ce schéma exact :
{
  "plan": {
    "sport": "string",
    "objectif": "string",
    "duree_semaines": number,
    "semaines": [{
      "numero": number,
      "theme": "string",
      "volume_total": "string",
      "seances": [{
        "jour": "string",
        "type": "string",
        "zone": "string",
        "duree": "string",
        "echauffement": "string",
        "corps": [{
          "exercice": "string",
          "series": number,
          "reps_ou_duree": "string",
          "intensite": "string",
          "repos": "string",
          "notes": "string"
        }],
        "retour_au_calme": "string",
        "objectif_seance": "string",
        "indicateur_reussite": "string"
      }],
      "conseils_semaine": "string",
      "note_recuperation": "string"
    }]
  }
}
Ne retourne rien d'autre que le JSON. Pas de texte avant, pas de texte après.
`;

export function buildPlanUserMessage(profile: UserProfile): string {
  return `
Génère un plan d'entraînement complet pour ce profil :
${JSON.stringify(profile, null, 2)}

Génère les ${profile.duree_semaines || 8} premières semaines.
  `.trim();
}
```

---

### PROMPT 2 — SUGGESTIONS DE PARCOURS IA

**Quand l'utiliser :** quand l'utilisateur consulte les parcours ou avant une séance.
**Max tokens :** 800
**Modèle :** claude-haiku-4-5-20251001

```typescript
export const ROUTE_SUGGESTION_SYSTEM = `
Tu es PacePilot, coach sportif IA spécialisé dans les parcours d'entraînement.
Tu suggères les parcours les plus adaptés à la séance du jour de l'utilisateur.

Tu analyses :
- Le type et zone d'intensité de la séance prévue
- Le profil et niveau de l'utilisateur
- Sa position GPS actuelle
- La météo du jour
- Ses blessures éventuelles
- Son historique de parcours récents (éviter la répétition)

RÈGLES DE SUGGESTION :
- Endurance Z2 → parcours plat, régulier, distance ≈ objectif
- Fractionné / Côtes Z4-Z5 → parcours vallonné, côtes courtes et répétées
- Récupération Z1 → parcours très plat, court, agréable
- Vent fort → suggérer parcours abrité (forêt, vallée)
- Blessure cheville → éviter trail et chemins irréguliers
- Blessure genou → éviter descentes raides (gradient > 8%)
- Toujours expliquer POURQUOI le parcours est adapté à cette séance

RÉPONDS UNIQUEMENT EN JSON VALIDE :
{
  "suggestions": [{
    "route_id": "string",
    "nom": "string",
    "distance_km": number,
    "denivele_m": number,
    "raison": "string (max 80 caractères)",
    "tips_seance": "string (conseil spécifique pour cette séance sur ce parcours)",
    "score_adaptation": number
  }]
}
Trie les suggestions par score_adaptation décroissant (1.0 = parfait).
Ne retourne rien d'autre que le JSON.
`;

export function buildRouteUserMessage(
  seance: PlanSession,
  profile: UserProfile,
  position: { lat: number; lng: number; ville: string },
  meteo: MeteoData,
  routesDisponibles: Route[]
): string {
  return `
SÉANCE DU JOUR : ${JSON.stringify(seance)}
PROFIL : ${JSON.stringify({ niveau: profile.niveau, blessures: profile.blessures, fatigue: profile.fatigue_actuelle })}
POSITION : ${JSON.stringify(position)}
MÉTÉO : ${JSON.stringify(meteo)}
PARCOURS DISPONIBLES : ${JSON.stringify(routesDisponibles.map(r => ({
    id: r.id, nom: r.name, distance_km: r.distance_m / 1000,
    denivele: r.elevation_gain_m, difficulte: r.difficulty, tags: r.tags
  })))}

Suggère les 3 meilleurs parcours pour cette séance.
  `.trim();
}
```

---

### PROMPT 3 — COACHING LIVE PENDANT LA SÉANCE

**Quand l'utiliser :** toutes les 2-5 minutes pendant une séance active, ou sur événement (FC anormale, fin d'intervalle...).
**Max tokens :** 150 (réponse courte pour affichage rapide)
**Modèle :** claude-haiku-4-5-20251001

```typescript
export const LIVE_COACHING_SYSTEM = `
Tu es PacePilot, coach sportif IA en temps réel pendant la séance.
Tu envoies des messages courts, précis et motivants à l'athlète.

RÈGLES STRICTES :
- Message maximum 15 mots
- Ton : encourageant, direct, professionnel
- Si tout va bien → message motivant positif
- Si FC trop haute (> zone + 10%) → demande de ralentir
- Si FC trop basse (< zone - 10%) → encourage à accélérer
- Si fatigue élevée (RPE > 8 prévu) → adapter l'effort
- Si objectif d'intervalle atteint → féliciter + indiquer la suite

RÉPONDS UNIQUEMENT EN JSON :
{
  "message": "string (max 15 mots)",
  "type": "info|warning|success|encouragement",
  "action": "ralentir|accélérer|maintenir|ravitailler|récupérer|null"
}
`;

export function buildLiveCoachingMessage(liveData: LiveSessionData): string {
  return `
SÉANCE : ${liveData.session_type} | Zone cible : ${liveData.target_zone}
MÉTRIQUES LIVE :
- FC actuelle : ${liveData.heart_rate} bpm (zone : ${liveData.current_zone})
- Allure : ${liveData.current_pace} min/km (cible : ${liveData.target_pace})
- Distance : ${liveData.distance_km} km (objectif : ${liveData.target_distance_km} km)
- Durée écoulée : ${liveData.elapsed_minutes} min
- RPE ressenti : ${liveData.rpe}/10
- Intervalle en cours : ${liveData.current_interval || "N/A"}
Génère un message de coaching adapté à cette situation.
  `.trim();
}
```

---

### PROMPT 4 — ANALYSE DES FEEDBACKS QUOTIDIENS

**Quand l'utiliser :** chaque matin après remplissage du feedback, pour ajuster le plan du jour.
**Max tokens :** 600
**Modèle :** claude-haiku-4-5-20251001

```typescript
export const FEEDBACK_ANALYSIS_SYSTEM = `
Tu es PacePilot, coach sportif IA. Tu analyses le feedback matinal de l'athlète
et décides si la séance du jour doit être maintenue, modifiée ou annulée.

RÈGLES D'AJUSTEMENT :
HRV < -10% vs baseline   → Remplacer séance dure par Z1 ou repos
Fatigue > 7/10           → Réduire intensité -50%
Sommeil < 6h             → Séance allégée ou reportée
Douleur > 4/10 localisée → Supprimer exercices sur zone douloureuse
Stress > 7/10            → Réduire volume -30%, garder intensité modérée
Humeur < 2/5             → Séance courte et plaisante, Z1-Z2 uniquement
Maladie signalée         → Repos complet obligatoire, plan décalé
Tout normal              → Maintenir la séance prévue

RÉPONDS UNIQUEMENT EN JSON :
{
  "decision": "maintenir|modifier|annuler",
  "seance_ajustee": { (même structure que la séance originale, modifiée si besoin) },
  "raison": "string (explication courte, max 100 caractères)",
  "message_motivation": "string (message personnalisé pour l'athlète, max 30 mots)",
  "alertes": ["string"] (liste des points d'attention, peut être vide)
}
`;

export function buildFeedbackUserMessage(
  feedback: DailyFeedback,
  hrvBaseline: number,
  seancePrevue: PlanSession
): string {
  return `
FEEDBACK DU JOUR :
- Sommeil : ${feedback.heures_sommeil}h (qualité ${feedback.qualite_sommeil}/5)
- HRV : ${feedback.hrv} bpm (baseline : ${hrvBaseline}, écart : ${Math.round((feedback.hrv - hrvBaseline) / hrvBaseline * 100)}%)
- Fatigue : ${feedback.fatigue}/10
- Stress : ${feedback.stress}/10
- Douleurs : ${feedback.douleurs.length === 0 ? "Aucune" : JSON.stringify(feedback.douleurs)}
- Humeur : ${feedback.humeur}/5
- Notes libres : "${feedback.notes || "Aucune"}"

SÉANCE PRÉVUE AUJOURD'HUI :
${JSON.stringify(seancePrevue, null, 2)}

Analyse ce feedback et décide de l'ajustement optimal.
  `.trim();
}
```

---

## 🗄️ SUPABASE — TABLES PRINCIPALES

```sql
-- Profil utilisateur
profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  sport text, niveau text, age int, sexe text,
  poids_kg float, taille_cm float,
  fc_max int, fc_repos int, ftp_watts float, vma_kmh float,
  hrv_baseline float,
  objectif text, date_objectif date,
  disponibilite_jours int[], duree_seance_min int,
  blessures jsonb, materiel text[]
)

-- Plans d'entraînement
plans (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  sport text, statut text,
  date_debut date, date_fin date,
  semaines jsonb -- structure complète du plan
)

-- Feedbacks quotidiens
feedbacks (
  id uuid PRIMARY KEY,
  user_id uuid,
  date date,
  sommeil float, heures_sommeil float,
  hrv float, fatigue int, stress int,
  douleurs jsonb, humeur int, notes text,
  ajustement_applique jsonb
)

-- Sessions GPS live
live_sessions (
  id uuid PRIMARY KEY,
  user_id uuid,
  route_id uuid,
  sport text, statut text,
  started_at timestamptz
)

live_points (
  id uuid PRIMARY KEY,
  session_id uuid,
  lat float, lng float,
  altitude float, speed_kmh float,
  distance_cumul_m float,
  timestamp timestamptz
)

live_metrics (
  id uuid PRIMARY KEY,
  session_id uuid,
  heart_rate int, power_watts int,
  cadence int, zone text,
  timestamp timestamptz
)

-- Parcours
routes (
  id uuid PRIMARY KEY,
  user_id uuid,
  name text, sport text,
  distance_m float, elevation_gain_m float,
  difficulty text, is_public bool,
  gpx_data jsonb, tags text[]
)
```

---

## 🔧 COMMANDES UTILES

```bash
# Démarrer l'app
npx expo start

# Build iOS / Android
eas build --platform ios
eas build --platform android

# Vérifier TypeScript
npx tsc --noEmit

# Linter
npx eslint . --ext .ts,.tsx

# Supabase local (si installé)
supabase start
supabase db push
supabase functions serve
```

---

## ⚠️ POINTS D'ATTENTION POUR CLAUDE CODE

1. **Clé API Anthropic** → jamais dans le code mobile. Toujours via une Supabase Edge Function.
2. **GPS arrière-plan** → nécessite `react-native-background-fetch` + config spéciale dans `app.json`.
3. **Apple HealthKit** → iOS uniquement, nécessite entitlement dans `eas.json`.
4. **ANT+** → non supporté nativement par React Native (module natif requis ou API post-séance).
5. **BLE sur Android** → demander les permissions `BLUETOOTH_SCAN` et `BLUETOOTH_CONNECT` (Android 12+).
6. **Zod + JSON IA** → toujours parser avec `JSON.parse()` puis valider avec un schéma Zod avant d'utiliser les données.
7. **Haiku max_tokens** → Génération plan : 4000 | Parcours : 800 | Live coaching : 150 | Feedback : 600

---

## 📋 QUAND TU M'AIDES À CODER

Quand je te demande de développer un écran ou une fonctionnalité, fournis toujours :
1. Le composant / screen TypeScript complet
2. Le fichier de route expo-router correspondant (`app/...`)
3. Le schéma Zod pour les données
4. Les fonctions Supabase (select/insert/update)
5. Le hook custom si la logique est réutilisable
6. Les tests de cas limites (données manquantes, erreur réseau, timeout IA)
