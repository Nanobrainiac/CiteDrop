import pg from 'pg';

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

export function requireDatabase(_req, res, next) {
  if (!pool) {
    res.status(503).json({ error: 'Database is not configured. Set DATABASE_URL from Neon.' });
    return;
  }
  next();
}

export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  const result = await pool.query(text, params);
  return result;
}
