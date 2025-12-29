import express from "express";
import crypto from "crypto";
import { savePaste, getPaste } from "./db.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- TIME HANDLING ---------- */
function now(req) {
  if (process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]) {
    return parseInt(req.headers["x-test-now-ms"], 10);
  }
  return Date.now();
}

/* ---------- EXPIRY CHECK ---------- */
function isUnavailable(paste, currentTime) {
  if (paste.expires_at && currentTime >= paste.expires_at) return true;
  if (paste.max_views !== null && paste.views >= paste.max_views) return true;
  return false;
}

/* ---------- HEALTH CHECK ---------- */
app.get("/api/healthz", async (req, res) => {
  try {
    await savePaste({ id: "__health__", ok: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/* ---------- HOME UI ---------- */
app.get("/", (req, res) => {
  res.send(`
    <h2>Create Paste</h2>
    <form method="POST" action="/create">
      <textarea name="content" rows="10" cols="60" required></textarea><br><br>
      TTL (seconds): <input type="number" name="ttl_seconds" min="1"><br><br>
      Max Views: <input type="number" name="max_views" min="1"><br><br>
      <button>Create Paste</button>
    </form>
  `);
});

/* ---------- CREATE PASTE (UI) ---------- */
app.post("/create", async (req, res) => {
  const { content, ttl_seconds, max_views } = req.body;

  if (!content || content.trim() === "") {
    return res.send("Content required");
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = ttl_seconds ? createdAt + ttl_seconds * 1000 : null;

  const paste = {
    id,
    content,
    created_at: createdAt,
    expires_at: expiresAt,
    max_views: max_views ? Number(max_views) : null,
    views: 0
  };

  await savePaste(paste);

  const url = `${req.protocol}://${req.get("host")}/p/${id}`;

  res.send(`
    <h3>Paste Created ✅</h3>
    <p><b>Shareable URL:</b></p>
    <input value="${url}" size="70" readonly />
    <p><a href="${url}" target="_blank">Open Paste</a></p>
    <p><a href="/">Create another</a></p>
  `);
});

/* ---------- CREATE PASTE (API) ---------- */
app.post("/api/pastes", async (req, res) => {
  const { content, ttl_seconds, max_views } = req.body;

  if (!content || typeof content !== "string" || content.trim() === "") {
    return res.status(400).json({ error: "Invalid content" });
  }

  if (ttl_seconds !== undefined && (!Number.isInteger(ttl_seconds) || ttl_seconds < 1)) {
    return res.status(400).json({ error: "Invalid ttl_seconds" });
  }

  if (max_views !== undefined && (!Number.isInteger(max_views) || max_views < 1)) {
    return res.status(400).json({ error: "Invalid max_views" });
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = ttl_seconds ? createdAt + ttl_seconds * 1000 : null;

  const paste = {
    id,
    content,
    created_at: createdAt,
    expires_at: expiresAt,
    max_views: max_views ?? null,
    views: 0
  };

  await savePaste(paste);

  res.status(201).json({
    id,
    url: `${req.protocol}://${req.get("host")}/p/${id}`
  });
});

/* ---------- FETCH PASTE (API) ---------- */
app.get("/api/pastes/:id", async (req, res) => {
  const paste = await getPaste(req.params.id);
  const currentTime = now(req);

  if (!paste || isUnavailable(paste, currentTime)) {
    return res.status(404).json({ error: "Not found" });
  }

  paste.views++;
  await savePaste(paste);

  res.json({
    content: paste.content,
    remaining_views:
      paste.max_views === null ? null : paste.max_views - paste.views,
    expires_at: paste.expires_at
      ? new Date(paste.expires_at).toISOString()
      : null
  });
});

/* ---------- VIEW PASTE (HTML) ---------- */
app.get("/p/:id", async (req, res) => {
  const paste = await getPaste(req.params.id);
  const currentTime = now(req);

  if (!paste || isUnavailable(paste, currentTime)) {
    return res.status(404).send("Not Found");
  }

  paste.views++;
  await savePaste(paste);

  res.send(`<pre>${paste.content}</pre>`);
});

export default app;
