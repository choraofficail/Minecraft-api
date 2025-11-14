// api/control.js (Serverless Vercel Function)
const { Client } = require('pg');

// ⚠️ WARNING: DO NOT HARD-CODE PASSWORDS IN REAL PROJECTS
// Your Supabase DB URL (replace [YOUR_PASSWORD] with your real password)
const DATABASE_URL = "postgresql://postgres:[YOUR_PASSWORD]@db.uctckjijhflehspmmtts.supabase.co:5432/postgres";

// Your secret token
const AUTH_TOKEN = "Chorahimmat@2010#%";

async function withClient(fn) {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureTable() {
  await withClient(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        target VARCHAR(255),
        cmd TEXT,
        status VARCHAR(50) DEFAULT 'queued',
        result TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const token = req.headers["x-api-token"] || req.query.t || "";
  if (token !== AUTH_TOKEN) {
    return res.status(403).end(JSON.stringify({ error: "forbidden" }));
  }

  if (!DATABASE_URL) {
    return res.status(500).end(JSON.stringify({ error: "missing_database_url" }));
  }

  await ensureTable();

  try {
    const url = req.url || "";
    const method = req.method;

    // Submit job
    if (url.includes("/job/submit") && method === "POST") {
      const body = req.body || await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => (d += c));
        req.on("end", () => resolve(JSON.parse(d || "{}")));
      });

      const target = body.target || "default";
      const cmd = body.cmd || "";

      await withClient(async (c) => {
        const result = await c.query(
          "INSERT INTO jobs (target, cmd) VALUES ($1, $2) RETURNING id",
          [target, cmd]
        );
        res.status(200).end(JSON.stringify({ id: result.rows[0].id }));
      });
      return;
    }

    // Poll job
    if (url.includes("/job/poll") && method === "GET") {
      const target = req.query?.target || "default";

      await withClient(async (c) => {
        await c.query("BEGIN");

        const job = await c.query(
          "SELECT * FROM jobs WHERE target=$1 AND status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [target]
        );

        if (job.rows.length === 0) {
          await c.query("COMMIT");
          return res.status(200).end(JSON.stringify({ job: null }));
        }

        const j = job.rows[0];

        await c.query("UPDATE jobs SET status='in-progress' WHERE id=$1", [j.id]);
        await c.query("COMMIT");

        res.status(200).end(JSON.stringify({ job: j }));
      });

      return;
    }

    // Submit result
    if (url.includes("/job/result") && method === "POST") {
      const body = req.body || await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => (d += c));
        req.on("end", () => resolve(JSON.parse(d || "{}")));
      });

      const id = parseInt(body.id) || 0;
      const status = body.status || "done";
      const resultText = (body.result || "").toString().slice(0, 2000);

      await withClient(async (c) => {
        await c.query(
          "UPDATE jobs SET status=$1, result=$2 WHERE id=$3",
          [status, resultText, id]
        );
        res.status(200).end(JSON.stringify({ ok: true }));
      });

      return;
    }

    res.status(200).end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error(error);
    res.status(500).end(JSON.stringify({ error: "server_error", detail: String(error) }));
  }
};
