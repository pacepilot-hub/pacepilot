// backend/server.js
const express = require("express");
const cors = require("cors");

// Node 18+ : fetch global OK
// Node <18 : décommente les 2 lignes suivantes :
// const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const ORS_KEY = process.env.ORS_KEY;

function toOrsCoord(p) {
  // Accepte {lng,lat} OU {longitude,latitude} OU [lng,lat] OU [lat,lng] (on essaye d’être tolérant)
  if (Array.isArray(p) && p.length >= 2) {
    const a = Number(p[0]);
    const b = Number(p[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // On suppose par défaut [lng,lat] (format ORS)
      return [a, b];
    }
    return null;
  }

  if (p && typeof p === "object") {
    const lng = Number(p.lng ?? p.longitude);
    const lat = Number(p.lat ?? p.latitude);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }

  return null;
}

function isProfileOk(profile) {
  return profile === "foot-walking" || profile === "foot-hiking" || profile === "cycling-regular";
}

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/route", async (req, res) => {
  try {
    if (!ORS_KEY) return res.status(500).json({ error: "ORS_KEY missing" });

    const profile = isProfileOk(req.body?.profile) ? req.body.profile : "foot-walking";
    const coordinates = Array.isArray(req.body?.coordinates) ? req.body.coordinates : null;

    if (!coordinates || coordinates.length < 2) {
      return res.status(400).json({ error: "Need at least 2 coordinates" });
    }

    const orsCoords = coordinates
      .map(toOrsCoord)
      .filter(Boolean);

    if (orsCoords.length < 2) {
      return res.status(400).json({
        error: "Invalid coordinates shape",
        hint: "Send [{latitude,longitude}, ...] or [{lat,lng}, ...] or [[lng,lat], ...]",
      });
    }

    const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: ORS_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: orsCoords,
        preference: "recommended",
      }),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(r.status).json({
        error: "ORS error",
        status: r.status,
        details: data,
      });
    }

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
});

const PORT = Number(process.env.PORT) || 3333;
app.listen(PORT, () => console.log(`ORS proxy listening on http://localhost:${PORT}`));
