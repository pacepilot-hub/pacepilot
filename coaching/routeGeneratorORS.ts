// coaching/routeGeneratorORS.ts
import { fetchRoutedPath, type Waypoint } from "@/services/routeService";
import type { RouteCriteria, WorkoutSpec } from "@/coaching/routeGenerator";

export type ProposedRoute = {
  id: string;
  name: string;
  distanceKm: number;
  estimatedTimeMin: number;
  polyline: Array<{ latitude: number; longitude: number }>;
};

function uid(prefix = "route") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function estimateTimeMin(distanceKm: number, workout: WorkoutSpec) {
  const pace =
    workout.type === "seuil" ? 5.0 :
    workout.type === "ef" ? 6.0 :
    workout.type === "sl" ? 6.25 :
    workout.type === "cotes" ? 6.5 :
    workout.type === "trail" ? 7.0 :
    6.0;

  return Math.max(1, Math.round(distanceKm * pace));
}

function profileToORS(profile: RouteCriteria["profile"]) {
  return profile; // "foot-walking" | "foot-hiking"
}

// ✅ IMPORTANT: export nommé + export default (anti-piège Metro/barrel)
export async function generateCoachRoutesORS(input: {
  workout: WorkoutSpec;
  origin: { lat: number; lng: number };
  criteria: RouteCriteria;
}): Promise<ProposedRoute[]> {
  const { workout, origin, criteria } = input;

  const target = criteria.targetKm;
  const tol = criteria.tolerancePct;

  const minKm = target * (1 - tol);
  const maxKm = target * (1 + tol);

  const profile = profileToORS(criteria.profile);

  const dirs = Array.from({ length: 12 }, (_, i) => (Math.PI * 2 * i) / 12);

  const radiusKm = criteria.loop ? clamp(target / 2, 1.5, 18) : clamp(target, 2, 25);

  const kmToLat = (km: number) => km / 111;
  const kmToLng = (km: number, lat: number) => km / (111 * Math.cos((lat * Math.PI) / 180));

  const candWanted = clamp(Math.round(criteria.candidates), 3, 30);

  const proposals: ProposedRoute[] = [];

  for (let i = 0; i < dirs.length && proposals.length < candWanted; i++) {
    const a = dirs[i];

    const dLat = kmToLat(radiusKm * Math.sin(a));
    const dLng = kmToLng(radiusKm * Math.cos(a), origin.lat);

    const mid: Waypoint = { lat: origin.lat + dLat, lng: origin.lng + dLng };

    let waypoints: Waypoint[];

    if (criteria.loop) {
      waypoints = [
        { lat: origin.lat, lng: origin.lng },
        mid,
        { lat: origin.lat, lng: origin.lng },
      ];
    } else {
      waypoints = [
        { lat: origin.lat, lng: origin.lng },
        mid,
      ];
    }

    try {
      const routed = await fetchRoutedPath({ waypoints, profile });

      const distanceKm = Math.round((routed.distanceM / 1000) * 10) / 10;
      if (distanceKm < minKm || distanceKm > maxKm) continue;

      proposals.push({
        id: uid("ai"),
        name: criteria.loop ? `Boucle ${distanceKm} km` : `Aller ${distanceKm} km`,
        distanceKm,
        estimatedTimeMin: estimateTimeMin(distanceKm, workout),
        polyline: routed.coords,
      });
    } catch {
      // ignore
    }
  }

  return proposals;
}

export default generateCoachRoutesORS;
