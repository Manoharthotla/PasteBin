const express = require("express");
const crypto = require("crypto");
const db = require("./db");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- TIME HANDLING ---------- */
function getCurrentTime(req) {
  if (process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]) {
    return parseInt(req.headers["x-test-now-ms"], 10);
  }
  return Date.now();
}

/* ---------- EXPIRY CHECK ---------- */
function isUnavailable(paste, now) {
  if (paste.expires_at && now >= paste.expires_at) return true;
  if (paste.max_views !== null && paste.views >= paste.max_views) return true;
  return false;
}

/* ---------- HEALTH CHECK ---------- */
app.get("/api/healthz", (req, res) => {
  db.get("SELECT 1", [], (err) => {
    if (err) return res.status(500).json({ ok: false });
    res.json({ ok: true });
  });
});

/* ---------- HOME PAGE ---------- */
app.get("/", (req, res) => {
  res.status(200).send(`
    <html>
      <body>
        <h2>Create Paste</h2>
        <form method="POST" action="/create">
          <textarea name="content" rows="10" cols="60" required></textarea><br><br>
          TTL (seconds): <input name="ttl_seconds" type="number" min="1"><br><br>
          Max Views: <input name="max_views" type="number" min="1"><br><br>
          <button type="submit">Create Paste</button>
        </form>
      </body>
    </html>
  `);
});

/* ---------- CREATE PASTE (UI) ---------- */
app.post("/create", (req, res) => {
  const { content, ttl_seconds, max_views } = req.body;
  if (!content || content.trim() === "") {
    return res.status(400).send("Content required");
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = ttl_seconds ? createdAt + ttl_seconds * 1000 : null;

  db.run(
    `INSERT INTO pastes (id, content, created_at, expires_at, max_views, views)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, content, createdAt, expiresAt, max_views || null],
    () => {
      const url = `${req.protocol}://${req.headers.host}/p/${id}`;
      res.send(`
        <html>
          <body>
            <h3>Paste Created ✅</h3>
            <p>Shareable URL:</p>
            <input size="70" value="${url}" readonly />
            <p><a href="${url}">Open Paste</a></p>
            <p><a href="/">Create another</a></p>
          </body>
        </html>
      `);
    }
  );
});

/* ---------- VIEW PASTE ---------- */
app.get("/p/:id", (req, res) => {
  const now = getCurrentTime(req);

  db.get("SELECT * FROM pastes WHERE id = ?", [req.params.id], (err, paste) => {
    if (err || !paste || isUnavailable(paste, now)) {
      return res.status(404).send("Not Found");
    }

    db.run("UPDATE pastes SET views = views + 1 WHERE id = ?", [paste.id]);

    res.send(`
      <html>
        <body>
          <pre>${escapeHTML(paste.content)}</pre>
        </body>
      </html>
    `);
  });
});

/* ---------- SAFE HTML ---------- */
function escapeHTML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- VERCEL HANDLER (CRITICAL) ---------- */
module.exports = (req, res) => {
  app(req, res);
};
