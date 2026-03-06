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
const ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS || 28000);

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
    // Continue with tolerant extraction strategies below.
  }

  // Tolerant fallback: extract first JSON object/array from mixed text.
  const firstBrace = trimmed.search(/[\[{]/);
  if (firstBrace < 0) return null;

  const startChar = trimmed[firstBrace];
  const endChar = startChar === "[" ? "]" : "}";

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === startChar) depth += 1;
    if (ch === endChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(firstBrace, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

async function callAnthropicJson(payload, timeoutMs = ANTHROPIC_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs));

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const upstreamJson = await safeJson(upstream);
    return { upstream, upstreamJson };
  } finally {
    clearTimeout(timeoutId);
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

    let upstream;
    let upstreamJson;
    try {
      const result = await callAnthropicJson({
        model: ANTHROPIC_MODEL,
        max_tokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      });
      upstream = result.upstream;
      upstreamJson = result.upstreamJson;
    } catch (err) {
      if (err?.name === "AbortError") {
        return res.status(504).json({
          ok: false,
          error: `Anthropic timeout after ${Math.max(3000, ANTHROPIC_TIMEOUT_MS)}ms`,
        });
      }
      throw err;
    }

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
