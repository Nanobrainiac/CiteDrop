import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const REMINDER_OFFSETS_DAYS = [1, 3, 6, 10, 14];
const MAX_REMINDERS = REMINDER_OFFSETS_DAYS.length;
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

const databaseUrl = process.env.DATABASE_URL;
const publicAppUrl = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function articleUrl(article) {
  const slug = article?.slug ? encodeURIComponent(article.slug) : '';
  const destination = slug ? `/articles/${slug}` : '';
  return publicAppUrl && destination ? `${publicAppUrl}/login?redirect_url=${encodeURIComponent(destination)}` : '';
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value));
}

function textPreview(article) {
  const summary = String(article.summary || '').trim();
  if (summary) return summary.slice(0, 520);

  const body = Array.isArray(article.body) ? article.body : [];
  const paragraph = body
    .flatMap((section) => Array.isArray(section.paragraphs) ? section.paragraphs : [])
    .map((item) => typeof item === 'string' ? item : item?.text)
    .find(Boolean);
  return String(paragraph || article.subtitle || '').trim().slice(0, 520);
}

function reminderEmailHtml({ article, url, reminderNumber }) {
  const title = article.title || 'Your CiteDrop article';
  const preview = textPreview(article) || 'Your source-backed article is still saved as a draft.';
  const created = formatDate(article.created_at);

  return `
    <div style="margin:0;background:#05070b;padding:0;font-family:Inter,Arial,sans-serif;color:#f7f7f2">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#05070b;margin:0;padding:28px 12px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid rgba(255,255,255,0.12);background:#10141c;border-radius:8px;overflow:hidden">
            <tr><td style="padding:24px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.1)">
              <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#d7ff3f">CiteDrop</div>
              <h1 style="margin:10px 0 0;font-size:30px;line-height:1.05;color:#ffffff">Your draft is waiting</h1>
              <p style="margin:10px 0 0;color:#aeb4c0;font-size:15px;line-height:1.6">This article has not been published yet. Review it when you have a minute, then publish it when it is ready to share.</p>
            </td></tr>
            <tr><td style="padding:22px 24px">
              <div style="margin:0 0 16px">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8c95a3">${escapeHtml(article.category || 'Research')} / Draft</div>
                <h2 style="margin:8px 0 0;font-size:24px;line-height:1.18;color:#ffffff">${escapeHtml(title)}</h2>
                <p style="margin:12px 0 0;color:#c6cbd3;font-size:15px;line-height:1.65">${escapeHtml(preview)}${preview.length >= 520 ? '...' : ''}</p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border-collapse:separate;border-spacing:8px 0">
                <tr>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${reminderNumber}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Reminder</div></td>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${MAX_REMINDERS}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Maximum</div></td>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${escapeHtml(created || '-')}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Created</div></td>
                </tr>
              </table>
              <a href="${escapeHtml(url)}" style="display:inline-block;background:#d7ff3f;color:#080a0f;padding:13px 20px;border-radius:999px;font-weight:900;text-decoration:none">Review and publish article</a>
              <p style="margin:18px 0 0;color:#8c95a3;font-size:13px;line-height:1.55">We will only send up to five reminders for this draft over two weeks.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </div>
  `;
}

function reminderEmailText({ article, url, reminderNumber }) {
  return [
    'Your CiteDrop draft is waiting',
    '',
    article.title || 'Your CiteDrop article',
    textPreview(article),
    '',
    `Reminder ${reminderNumber} of ${MAX_REMINDERS}.`,
    `Review and publish it here: ${url}`,
    '',
    'We will only send up to five reminders for this draft over two weeks.'
  ].filter(Boolean).join('\n');
}

async function clerkPrimaryEmail(clerkUserId) {
  if (!clerkUserId || String(clerkUserId).startsWith('anonymous:') || !process.env.CLERK_SECRET_KEY) return '';

  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`Unable to load Clerk user ${clerkUserId}: HTTP ${response.status} ${body.slice(0, 180)}`);
    return '';
  }

  const user = await response.json();
  const primaryId = user.primary_email_address_id;
  const primary = Array.isArray(user.email_addresses)
    ? user.email_addresses.find((email) => email.id === primaryId) || user.email_addresses[0]
    : null;
  return primary?.email_address || '';
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.info('Email not sent; configure RESEND_API_KEY and EMAIL_FROM.');
    return false;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`Email send failed for ${to}: HTTP ${response.status} ${body.slice(0, 240)}`);
    return false;
  }

  return true;
}

async function ensureReminderTable() {
  await pool.query('create extension if not exists "pgcrypto"');
  await pool.query(`
    create table if not exists article_publish_reminders (
      id uuid primary key default gen_random_uuid(),
      article_id uuid not null references articles(id) on delete cascade,
      reminder_number int not null check (reminder_number between 1 and 5),
      sent_to text not null,
      sent_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      unique (article_id, reminder_number)
    )
  `);
  await pool.query(`
    create index if not exists article_publish_reminders_article_id_idx
      on article_publish_reminders(article_id, sent_at desc)
  `);
}

function nextReminderNumber(article) {
  const sentCount = Number(article.reminders_sent || 0);
  if (sentCount >= MAX_REMINDERS) return 0;
  return sentCount + 1;
}

function isReminderDue(article, reminderNumber, now = new Date()) {
  if (!reminderNumber) return false;
  const createdAt = new Date(article.created_at);
  const dueAt = new Date(createdAt.getTime() + REMINDER_OFFSETS_DAYS[reminderNumber - 1] * 24 * 60 * 60 * 1000);
  return now >= dueAt;
}

async function loadReminderCandidates() {
  const { rows } = await pool.query(`
    select
      a.id,
      a.title,
      a.slug,
      a.subtitle,
      a.summary,
      a.category,
      a.status,
      a.body,
      a.created_by,
      a.created_at,
      count(r.id)::int as reminders_sent
    from articles a
    left join article_publish_reminders r on r.article_id = a.id
    where a.status = 'draft'
      and a.created_by is not null
      and a.created_by !~ '^anonymous:'
      and a.created_at <= now() - interval '1 day'
    group by a.id
    having count(r.id) < $1
    order by a.created_at asc
  `, [MAX_REMINDERS]);

  return rows;
}

async function recordReminder({ articleId, reminderNumber, sentTo }) {
  await pool.query(
    `insert into article_publish_reminders (article_id, reminder_number, sent_to)
     values ($1, $2, $3)
     on conflict (article_id, reminder_number) do nothing`,
    [articleId, reminderNumber, sentTo]
  );
}

async function sendReminder(article, reminderNumber) {
  const url = articleUrl(article);
  if (!url) {
    console.warn(`Skipping article ${article.id}; PUBLIC_APP_URL or PUBLIC_SITE_URL is not configured.`);
    return false;
  }

  const to = await clerkPrimaryEmail(article.created_by);
  if (!to) {
    console.warn(`Skipping article ${article.id}; no email found for ${article.created_by}.`);
    return false;
  }

  const subject = `Reminder: publish your CiteDrop draft "${article.title || 'Untitled article'}"`;
  const payload = {
    to,
    subject,
    html: reminderEmailHtml({ article, url, reminderNumber }),
    text: reminderEmailText({ article, url, reminderNumber })
  };

  if (isDryRun) {
    console.info(`[dry-run] Would send reminder ${reminderNumber} for article ${article.id} to ${to}: ${subject}`);
    return true;
  }

  const sent = await sendEmail(payload);
  if (sent) await recordReminder({ articleId: article.id, reminderNumber, sentTo: to });
  return sent;
}

async function main() {
  await ensureReminderTable();

  const candidates = await loadReminderCandidates();
  const due = candidates
    .map((article) => ({ article, reminderNumber: nextReminderNumber(article) }))
    .filter(({ article, reminderNumber }) => isReminderDue(article, reminderNumber));

  console.info(`Found ${candidates.length} unpublished draft candidates; ${due.length} reminder(s) due.`);

  let sent = 0;
  let wouldSend = 0;
  let skipped = 0;
  for (const { article, reminderNumber } of due) {
    try {
      const didSend = await sendReminder(article, reminderNumber);
      if (didSend && isDryRun) wouldSend += 1;
      else if (didSend) sent += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      console.error(`Reminder failed for article ${article.id}: ${error.message}`);
    }
  }

  if (isDryRun) {
    console.info(`Dry run complete: ${wouldSend} would send, ${skipped} skipped.`);
  } else {
    console.info(`Reminder run complete: ${sent} sent, ${skipped} skipped.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
