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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function asNonEmptyString(x) {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

async function safeJson(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractAnthropicText(payload) {
  const items = Array.isArray(payload?.content) ? payload.content : [];
  const textItem = items.find((item) => item && item.type === "text" && typeof item.text === "string");
  return textItem?.text ?? null;
}

function parseJsonObjectFromText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();

  // Supporte un JSON direct ou entouré de markdown fences.
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const inner = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(inner);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

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

app.post("/ai/plan", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "ANTHROPIC_API_KEY missing on backend",
      });
    }

    const system = asNonEmptyString(req.body?.system);
    const userMessage = asNonEmptyString(req.body?.userMessage);
    const maxTokensRaw = Number(req.body?.maxTokens);
    const max_tokens = Number.isFinite(maxTokensRaw)
      ? Math.max(128, Math.min(4000, Math.trunc(maxTokensRaw)))
      : 2000;

    if (!system || !userMessage) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: system and userMessage",
      });
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const upstreamJson = await safeJson(upstream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: "Anthropic API error",
        details: upstreamJson,
      });
    }

    const text = extractAnthropicText(upstreamJson);
    const parsed = parseJsonObjectFromText(text);

    if (!parsed) {
      return res.status(502).json({
        ok: false,
        error: "Model returned non-JSON content",
        preview: typeof text === "string" ? text.slice(0, 400) : null,
      });
    }

    return res.json({ ok: true, data: parsed });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "AI plan generation failed",
      details: String(e),
    });
  }
});

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
