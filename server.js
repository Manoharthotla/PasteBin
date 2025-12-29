const express = require("express");
const crypto = require("crypto");
const db = require("./db");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- TIME HANDLING ---------------- */
function getCurrentTime(req) {
  if (process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]) {
    return parseInt(req.headers["x-test-now-ms"], 10);
  }
  return Date.now();
}

/* ---------------- EXPIRY CHECK ---------------- */
function isUnavailable(paste, now) {
  if (paste.expires_at && now >= paste.expires_at) return true;
  if (paste.max_views !== null && paste.views >= paste.max_views) return true;
  return false;
}

/* ---------------- HEALTH CHECK ---------------- */
app.get("/api/healthz", (req, res) => {
  db.get("SELECT 1", [], (err) => {
    if (err) return res.status(500).json({ ok: false });
    res.json({ ok: true });
  });
});

/* ---------------- HOME PAGE (UI) ---------------- */
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body>
        <h2>Create Paste</h2>
        <form method="POST" action="/create">
          <textarea name="content" rows="10" cols="60" required></textarea><br><br>
          TTL (seconds): <input type="number" name="ttl_seconds" min="1"><br><br>
          Max Views: <input type="number" name="max_views" min="1"><br><br>
          <button type="submit">Create Paste</button>
        </form>
      </body>
    </html>
  `);
});

/* ---------------- CREATE PASTE (BROWSER FORM) ---------------- */
app.post("/create", (req, res) => {
  const { content, ttl_seconds, max_views } = req.body;

  if (!content || content.trim() === "") {
    return res.send("Content is required");
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = ttl_seconds ? createdAt + ttl_seconds * 1000 : null;

  db.run(
    `INSERT INTO pastes (id, content, created_at, expires_at, max_views, views)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, content, createdAt, expiresAt, max_views || null],
    (err) => {
      if (err) return res.send("Database error");

      const fullUrl = `${req.protocol}://${req.get("host")}/p/${id}`;

      res.send(`
        <html>
          <body>
            <h3>✅ Paste Created Successfully</h3>

            <p><b>Shareable URL:</b></p>
            <input type="text" value="${fullUrl}" size="70" readonly />

            <p>
              <a href="${fullUrl}" target="_blank">Open Paste</a>
            </p>

            <p>
              <a href="/">Create Another Paste</a>
            </p>
          </body>
        </html>
      `);
    }
  );
});

/* ---------------- CREATE PASTE (API) ---------------- */
app.post("/api/pastes", (req, res) => {
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

  db.run(
    `INSERT INTO pastes (id, content, created_at, expires_at, max_views, views)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, content, createdAt, expiresAt, max_views ?? null],
    (err) => {
      if (err) return res.status(500).json({ error: "Database error" });

      res.status(201).json({
        id,
        url: `${req.protocol}://${req.get("host")}/p/${id}`
      });
    }
  );
});

/* ---------------- FETCH PASTE (API) ---------------- */
app.get("/api/pastes/:id", (req, res) => {
  const now = getCurrentTime(req);

  db.get("SELECT * FROM pastes WHERE id = ?", [req.params.id], (err, paste) => {
    if (err || !paste || isUnavailable(paste, now)) {
      return res.status(404).json({ error: "Not found" });
    }

    db.run("UPDATE pastes SET views = views + 1 WHERE id = ?", [paste.id]);

    res.json({
      content: paste.content,
      remaining_views:
        paste.max_views === null ? null : paste.max_views - paste.views - 1,
      expires_at: paste.expires_at
        ? new Date(paste.expires_at).toISOString()
        : null
    });
  });
});

/* ---------------- VIEW PASTE (HTML) ---------------- */
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

/* ---------------- SAFE HTML ---------------- */
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
