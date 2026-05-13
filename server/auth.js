import { getAuth } from '@clerk/express';
import { query } from './db.js';

const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY);
const clerkPublishableKeyConfigured = Boolean(process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY);
const bootstrapAdminIds = new Set(
  String(process.env.CLERK_ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);

console.log(`Loaded ${bootstrapAdminIds.size} bootstrap admin id(s).`);

async function getRole(clerkUserId) {
  if (bootstrapAdminIds.has(clerkUserId)) {
    await query(
      `insert into content_roles (clerk_user_id, role)
       values ($1, 'admin')
       on conflict (clerk_user_id)
       do update set role = 'admin', updated_at = now()`,
      [clerkUserId]
    );
    return 'admin';
  }
  const { rows } = await query('select role from content_roles where clerk_user_id = $1', [clerkUserId]);
  return rows[0]?.role || 'user';
}

async function buildUser(clerkUserId) {
  return {
    id: clerkUserId,
    role: await getRole(clerkUserId)
  };
}

export async function requireUser(req, res, next) {
  if (!clerkConfigured) {
    res.status(503).json({ error: 'Clerk is not configured. Set CLERK_SECRET_KEY.' });
    return;
  }
  if (!clerkPublishableKeyConfigured) {
    res.status(503).json({ error: 'Clerk publishable key is not configured. Set VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY.' });
    return;
  }

  let auth;
  try {
    auth = getAuth(req);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Clerk auth middleware is not available for this request. Restart the dev server and verify CLERK_SECRET_KEY is set.' });
    return;
  }

  if (!auth.isAuthenticated || !auth.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    req.user = await buildUser(auth.userId);
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to resolve user role.' });
  }
}

export async function getUserFromRequest(req) {
  if (!clerkConfigured) return null;
  let auth;
  try {
    auth = getAuth(req);
  } catch {
    return null;
  }
  if (!auth.isAuthenticated || !auth.userId) return null;
  return buildUser(auth.userId);
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required.' });
    return;
  }
  next();
}

export function currentUser(req, res) {
  res.json({ user: req.user });
}
