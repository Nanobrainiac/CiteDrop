import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import slugify from 'slugify';
import { z } from 'zod';
import { clerkMiddleware } from '@clerk/express';
import { query, requireDatabase } from './db.js';
import { currentUser, getUserFromRequest, requireAdmin, requireUser } from './auth.js';
import { ogImageHeight, ogImageVersion, ogImageWidth, renderArticleOgImage } from './og.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const generationJobs = new Map();
const generationStages = {
  queued: 'Queued',
  claim_extraction: 'Interpreting prompt',
  research: 'Gathering targeted evidence',
  source_ingestion: 'Verifying source text',
  evidence_synthesis: 'Ranking sources',
  counterevidence: 'Checking counterevidence',
  drafting: 'Writing the first draft',
  polish: 'Polishing the article',
  review: 'Running fact-check and bias review',
  revision: 'Revising the article',
  citation_audit: 'Auditing citations',
  citation_repair: 'Repairing citation issues',
  saving: 'Saving draft',
  completed: 'Draft ready',
  failed: 'Generation failed'
};
const fetchTimeoutMs = 9000;
const maxHtmlBytes = 900000;
const maxPdfBytes = 4000000;
const anonymousGenerationLimit = Number(process.env.ANON_GENERATION_LIMIT || 1);
const anonymousGenerationWindowMs = 24 * 60 * 60 * 1000;
const anonymousGenerationUsage = new Map();

app.enable('trust proxy');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: isProduction ? false : true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(redirectToCanonicalUrl);
if (process.env.CLERK_SECRET_KEY && clerkPublishableKey) {
  const clerk = clerkMiddleware({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: clerkPublishableKey
  });
  app.use((req, res, next) => {
    const isPublicPage = req.method === 'GET' && (req.path === '/' || req.path.startsWith('/articles/'));
    const isPublicOgImage = req.method === 'GET' && /^\/api\/articles\/[^/]+\/og-image$/.test(req.path);
    const isCrawlerFile = req.method === 'GET' && (req.path === '/robots.txt' || req.path === '/sitemap.xml');
    if (isPublicPage || isPublicOgImage || isCrawlerFile) return next();
    return clerk(req, res, next);
  });
}

const generationSchema = z.object({
  prompt: z.string().min(12).max(4000),
  topic: z.string().max(120).optional().default(''),
  position: z.string().max(500).optional().default(''),
  tone: z.string().min(2).max(80).default('Professional and persuasive'),
  category: z.string().max(80).optional().default(''),
  visualizations: z.array(z.string().max(80)).max(5).optional().default([]),
  sourceUrls: z.array(z.string().url()).max(12).optional().default([])
});

const articlePatchSchema = z.object({
  title: z.string().min(3).max(180).optional(),
  category: z.string().min(2).max(80).optional(),
  status: z.enum(['draft', 'published', 'archived', 'deleted']).optional()
});

const ownerArticlePatchSchema = z.object({
  status: z.enum(['draft', 'published'])
});

const rolePatchSchema = z.object({
  role: z.enum(['user', 'admin'])
});

const systemPrompt = `You generate professional, evidence-minded research articles for public debate.
Return only valid JSON. Do not include markdown fences.
Rules:
- Base the article on multiple specific sources found through web search and/or user-provided source URLs.
- Use the provided currentDate as the article's time context. Include an "As of [currentDate]" sentence in the summary or opening body section.
- Prefer sources from the last 24 months when reliable sources are available.
- For fast-moving topics such as politics, technology, war, markets, law, elections, public figures, companies, or current policy, prioritize sources from 2025-2026.
- If older data is used, explain why it is still relevant, authoritative, or the latest available.
- Use at least 6 source items when available, and more when the topic is contested, comparative, statistical, or current. Do not use a publisher homepage as a source unless the homepage itself is the evidence.
- Sources must be specific pages, reports, datasets, court records, government pages, speeches, press releases, articles, or studies.
- Do not fabricate citations, statistics, institutions, authors, URLs, titles, or publication details.
- If a requested coverage point cannot be supported by sources, include it as a limitation instead of skipping or inventing facts.
- If the user requests multiple periods, entities, terms, or comparisons, cover each one explicitly.
- Separate factual claims from analysis or opinion.
- Infer the article category from the user's research question. Prefer one of the provided existingCategories when it reasonably fits. Create a new category only when none of the existing categories fit well.
- Do not assume an intended position from the user. Answer the research question based on the evidence, including counterpoints and limitations where relevant.
- Avoid defamatory, harassing, or demeaning language about private people or protected groups.
- Prefer careful, measured persuasion over inflammatory rhetoric.
- If tone is "Silly but evidence-based", use playful phrasing and light wit while keeping claims, uncertainty, sources, and safety standards serious.
- Sources must include title, publisher, url, date when known, and note explaining the exact claim(s) it supports.
- Extract up to 3 concrete claims from the user's prompt. Do not invent claims the user did not make.
- Each extracted claim must include verdict true, false, mixed, or unsure; confidenceScore 0-100; confidenceLabel high, medium, or low; a short verdictSummary; and support reasoning.
- Title must be short and broad enough to cover all checked claims. Put nuance in subtitle and summary, not the title.
- Article body must be an array of sections with heading and paragraphs. Each paragraph must be an object with text, chartIds, and sourceIds.
- Write substantial article text. Return 4 to 7 body sections and at least 10 total paragraphs.
- Each body paragraph should usually be 120 to 190 words. Short transition paragraphs are allowed sparingly, but most paragraphs need specific evidence, context, caveats, counterpoints, and interpretation.
- Not every paragraph needs a chart. Use chartIds only when a visualization directly supports that paragraph.
- For each checked claim, include enough body text to explain what is supported, what is not supported, and what reasonable caveats remain.
- Do not put source lists, reference lists, bibliography sections, raw URLs, markdown links, or citation dumps in the article body. Put every source only in the sources array.
- Body paragraphs may mention source names naturally, but source URLs belong only in the sources array. Use paragraph sourceIds to connect each paragraph to the specific sources that support it.
- Place source IDs in each paragraph sourceIds array for the sources that support that paragraph. Evidence-heavy, comparison, statistical, or controversial paragraphs should usually include 2 or 3 sourceIds when multiple relevant sources exist. Conclusion paragraphs should include sourceIds when they restate a factual judgment. Place chart IDs in the chartIds array immediately after paragraphs they help explain. Leave chartIds empty when no chart belongs after that paragraph.
- Every generated chart must be referenced by at least one paragraph chartIds entry. If a chart is useful enough to include, write body text that explains it.
- Do not create orphan charts that introduce a new topic after the article text. Either place the chart after relevant discussion or omit the chart.
- Include 2 to 4 useful visualizations. Each visualization must answer a specific question, state a takeaway, identify units, note source support, and name limitations.
- Use timeline for dated events, legal/history sequences, campaign promise chronology, or any data where the main value is sequence rather than numeric trend.
- Timeline date fields must be human-readable and precision-honest. Use labels like "4.5B years ago", "350M years ago", "May 2024", or "2026"; do not invent exact month/day values such as YYYY-01-01 when only a year or era is known.
- Use line or area only for one continuous metric measured across 3 or more comparable time points. Do not use line charts for one-off events, category rankings, or single-month snapshots.
- Use metrics for standalone numbers or when datapoints use different units.
- Use comparison for side-by-side estimates, claims, people, or categories where the reader should compare context rather than infer a trend.
- Use delta for two-point before/after, first/last, or changed-from-to comparisons.
- Use ranked_bar for ranked lists, long category labels, and ordered comparisons where horizontal scanning helps.
- Use fact_table for legal criteria, definitions, categorical facts, and single facts that should not be forced into a chart.
- Use evidence_matrix for claim-by-claim support, contradiction, uncertainty, source mapping, or argument coverage.
- Use bar for discrete comparisons with the same units, scorecard for qualitative evidence/claim support, and pie only when values are parts of the same whole.
- Never insert zero values to mean "data unavailable." Omit unavailable items or explain the limitation.
- Prefer sourced quantitative data for comparison or outcome charts. If quantitative data is unavailable, create qualitative evidence maps such as claim support strength, source mix, timeline of sourced events, or argument coverage. Clearly label qualitative charts as qualitative or illustrative.
- Visualizations must use simple JSON renderable as bar, line, area, pie, timeline, scorecard, metrics, comparison, ranked_bar, delta, evidence_matrix, or fact_table. Each data point should include label, at least one numeric value, and optional group, date, source, and note fields.
- Never cite a URL that was not actually consulted.`;

const claimExtractionJsonSchema = {
  name: 'prompt_interpretation',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['promptType', 'answerMode', 'expectedVerdictStyle', 'claims', 'coverageRequirements', 'researchQuestions'],
    properties: {
      promptType: { type: 'string', enum: ['claim', 'question', 'comparison', 'mixed'] },
      answerMode: { type: 'string', enum: ['fact_check', 'explainer', 'comparison', 'limited_evidence'] },
      expectedVerdictStyle: { type: 'string', enum: ['claim_verdict', 'evidence_summary', 'insufficient_data'] },
      claims: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claim', 'type', 'needsCurrentSources', 'notes'],
          properties: {
            claim: { type: 'string' },
            type: { type: 'string', enum: ['factual', 'predictive', 'opinion', 'mixed'] },
            needsCurrentSources: { type: 'boolean' },
            notes: { type: 'string' }
          }
        }
      },
      coverageRequirements: { type: 'array', items: { type: 'string' } },
      researchQuestions: { type: 'array', items: { type: 'string' } }
    }
  },
  strict: true
};

const reviewJsonSchema = {
  name: 'article_review',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['skepticalReview', 'neutralityReview', 'requiredRevisions'],
    properties: {
      skepticalReview: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'issue', 'fix'],
          properties: {
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            issue: { type: 'string' },
            fix: { type: 'string' }
          }
        }
      },
      neutralityReview: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'issue', 'fix'],
          properties: {
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            issue: { type: 'string' },
            fix: { type: 'string' }
          }
        }
      },
      requiredRevisions: { type: 'array', items: { type: 'string' } }
    }
  },
  strict: true
};

const citationAuditJsonSchema = {
  name: 'citation_audit',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['passed', 'blockingIssues', 'warnings'],
    properties: {
      passed: { type: 'boolean' },
      blockingIssues: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  },
  strict: true
};

const evidencePacketJsonSchema = {
  name: 'evidence_packet',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['promptSummary', 'targets', 'globalLimitations'],
    properties: {
      promptSummary: { type: 'string' },
      globalLimitations: { type: 'array', items: { type: 'string' } },
      targets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'targetType', 'answerSummary', 'confidenceLabel', 'keyFacts', 'bestSources', 'counterSources', 'limitations'],
          properties: {
            target: { type: 'string' },
            targetType: { type: 'string', enum: ['claim', 'question', 'comparison', 'coverage'] },
            answerSummary: { type: 'string' },
            confidenceLabel: { type: 'string', enum: ['high', 'medium', 'low'] },
            keyFacts: { type: 'array', items: { type: 'string' } },
            bestSources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'publisher', 'url', 'role', 'score', 'reason'],
                properties: {
                  title: { type: 'string' },
                  publisher: { type: 'string' },
                  url: { type: 'string' },
                  role: { type: 'string', enum: ['supports', 'contradicts', 'context', 'data'] },
                  score: { type: 'number', minimum: 0, maximum: 100 },
                  reason: { type: 'string' }
                }
              }
            },
            counterSources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'publisher', 'url', 'reason'],
                properties: {
                  title: { type: 'string' },
                  publisher: { type: 'string' },
                  url: { type: 'string' },
                  reason: { type: 'string' }
                }
              }
            },
            limitations: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  },
  strict: true
};

const articleJsonShape = {
  title: 'Specific article title',
  slug: 'url-safe-slug',
  subtitle: 'One-sentence subtitle',
  summary: 'Short public card summary',
  category: 'Category',
  body: [
    { heading: 'Section heading', paragraphs: [{ text: 'Paragraph text', chartIds: ['chart-id-when-relevant'], sourceIds: ['source-id-for-this-paragraph'] }] }
  ],
  keyClaims: [
    {
      claim: 'Claim from the user prompt or evidence finding for a user question',
      verdict: 'true|false|mixed|unsure',
      verdictSummary: 'Short plain-English judgment',
      confidenceScore: 82,
      confidenceLabel: 'high|medium|low',
      support: 'Why this verdict is supported or uncertain',
      sourceIds: ['source-id']
    }
  ],
  charts: [
    {
      id: 'stable-chart-id',
      title: 'Chart title',
      question: 'Question this chart answers',
      type: 'bar | line | area | pie | timeline | scorecard | metrics | comparison | ranked_bar | delta | evidence_matrix | fact_table',
      takeaway: 'Main interpretation in one sentence',
      units: 'Percent, dollars, index score, count, qualitative score, etc.',
      sourceNote: 'Source basis for the chart',
      limitation: 'Important caveat or uncertainty',
      note: 'What the chart shows and whether data is sourced or illustrative',
      data: [{ label: 'A', value: 10, group: 'Optional group', date: 'YYYY-MM-DD when relevant', source: 'Short source name', note: 'Optional datapoint note' }]
    }
  ],
  sources: [
    { id: 'stable-source-id', title: 'Source title', publisher: 'Publisher', url: 'https://example.com/specific-page', date: 'YYYY-MM-DD when known', note: 'Specific claim(s) this supports' }
  ]
};

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function stripMetaTags(html, selectors) {
  return selectors.reduce((output, selector) => {
    const attr = selector.startsWith('og:') ? 'property' : 'name';
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return output.replace(new RegExp(`\\s*<meta\\s+${attr}="${escapedSelector}"[^>]*\\/?>`, 'gi'), '');
  }, html);
}

function stripCanonicalLinks(html) {
  return html.replace(/\s*<link\s+rel=["']canonical["'][^>]*\/?>/gi, '');
}

function canonicalSiteBase(req) {
  const configured = process.env.PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (configured) return normalizeCanonicalSiteBase(configured);
  if (isProduction) return 'https://www.citedrop.com';
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function normalizeCanonicalSiteBase(base) {
  try {
    const url = new globalThis.URL(base);
    if (url.hostname === 'citedrop.com') {
      url.hostname = 'www.citedrop.com';
      url.protocol = 'https:';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return base;
  }
}

function absoluteUrl(req, pathname) {
  return `${canonicalSiteBase(req)}${pathname}`;
}

function publicAppBaseUrl() {
  const configured = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  if (configured) return normalizeCanonicalSiteBase(configured);
  return isProduction ? 'https://www.citedrop.com' : 'http://localhost:5173';
}

function publicArticleUrl(slug) {
  return `${publicAppBaseUrl()}/articles/${slug}`;
}

function publicArticleReviewUrl(slug) {
  const destination = `/articles/${slug}`;
  return `${publicAppBaseUrl()}/login?redirect_url=${encodeURIComponent(destination)}`;
}

function canonicalPath(pathname) {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function redirectToCanonicalUrl(req, res, next) {
  if (!isProduction || !['GET', 'HEAD'].includes(req.method)) {
    next();
    return;
  }

  let canonical;
  try {
    canonical = new globalThis.URL(canonicalSiteBase(req));
  } catch {
    next();
    return;
  }

  const requestHost = req.get('host');
  const requestProto = req.get('x-forwarded-proto') || req.protocol;
  const isPublicPage = req.path === '/' || req.path.startsWith('/articles/');
  const targetPath = isPublicPage ? canonicalPath(req.path) : req.path;
  const needsOriginRedirect = requestHost && (
    requestHost.toLowerCase() !== canonical.host.toLowerCase() ||
    requestProto !== canonical.protocol.replace(':', '')
  );
  const needsPathRedirect = isPublicPage && targetPath !== req.path;

  if (!needsOriginRedirect && !needsPathRedirect) {
    next();
    return;
  }

  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `${canonical.origin}${targetPath}${query}`);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function anonymousTokenFromRequest(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies.cd_anon_id;
  if (existing && /^[a-f0-9-]{24,}$/i.test(existing)) return existing;
  const token = randomUUID();
  res.cookie('cd_anon_id', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 90
  });
  return token;
}

function anonymousUsageKey(req, token) {
  return `${token}:${req.ip || req.get('x-forwarded-for') || 'unknown'}`;
}

function anonymousUsage(req, token) {
  const key = anonymousUsageKey(req, token);
  const now = Date.now();
  const usage = anonymousGenerationUsage.get(key);
  if (!usage || now - usage.startedAt > anonymousGenerationWindowMs) {
    return { key, count: 0, startedAt: now };
  }
  return { key, ...usage };
}

function recordAnonymousGeneration(req, token) {
  const usage = anonymousUsage(req, token);
  anonymousGenerationUsage.set(usage.key, {
    count: usage.count + 1,
    startedAt: usage.startedAt
  });
  return usage.count + 1;
}

function releaseAnonymousGeneration(req, token) {
  const usage = anonymousUsage(req, token);
  anonymousGenerationUsage.set(usage.key, {
    count: Math.max(usage.count - 1, 0),
    startedAt: usage.startedAt
  });
}

async function clerkPrimaryEmail(clerkUserId) {
  if (!clerkUserId || !process.env.CLERK_SECRET_KEY) return '';
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      console.warn(`Unable to load Clerk user email for ${clerkUserId}: HTTP ${response.status}`);
      return '';
    }
    const user = await response.json();
    const primaryId = user.primary_email_address_id;
    const primary = Array.isArray(user.email_addresses)
      ? user.email_addresses.find((email) => email.id === primaryId) || user.email_addresses[0]
      : null;
    return primary?.email_address || '';
  } catch (error) {
    console.warn(`Unable to load Clerk user email for ${clerkUserId}: ${error.message}`);
    return '';
  }
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    if (to) console.info('Email not sent; configure RESEND_API_KEY and EMAIL_FROM.');
    return false;
  }

  try {
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
      console.warn(`Email send failed: HTTP ${response.status} ${body.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`Email send failed: ${error.message}`);
    return false;
  }
}

function articleEmailPreview(article = {}, prompt = '') {
  const body = Array.isArray(article.body) ? article.body : [];
  const firstParagraph = body
    .flatMap((section) => Array.isArray(section.paragraphs) ? section.paragraphs : [])
    .map((paragraph) => typeof paragraph === 'string' ? paragraph : paragraph?.text)
    .find(Boolean) || '';
  const claims = Array.isArray(article.claims_json) ? article.claims_json : [];
  const charts = Array.isArray(article.charts_json) ? article.charts_json : [];
  const sources = Array.isArray(article.sources_json) ? article.sources_json : [];
  return {
    prompt: String(prompt || article.summary || article.title || '').trim().slice(0, 700),
    summary: String(article.summary || '').trim().slice(0, 700),
    excerpt: String(firstParagraph || article.subtitle || '').trim().slice(0, 520),
    category: String(article.category || 'Research').trim(),
    status: String(article.status || 'draft').trim(),
    claimsCount: claims.length,
    chartsCount: charts.length,
    sourcesCount: sources.length
  };
}

function articleReadyEmailHtml({ title, url, preview }) {
  const prompt = preview.prompt || 'Your article request';
  const summary = preview.summary || 'Your source-backed article has finished generating.';
  const excerpt = preview.excerpt || summary;
  return `
    <div style="margin:0;background:#05070b;padding:0;font-family:Inter,Arial,sans-serif;color:#f7f7f2">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#05070b;margin:0;padding:28px 12px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid rgba(255,255,255,0.12);background:#10141c;border-radius:8px;overflow:hidden">
            <tr><td style="padding:24px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.1)">
              <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#d7ff3f">CiteDrop</div>
              <h1 style="margin:10px 0 0;font-size:30px;line-height:1.05;color:#ffffff">Your article is ready</h1>
              <p style="margin:10px 0 0;color:#aeb4c0;font-size:15px;line-height:1.6">It is saved as a draft. Review it, then publish when it is ready to share.</p>
            </td></tr>
            <tr><td style="padding:22px 24px">
              <div style="margin:0 0 18px;padding:16px;border:1px solid rgba(215,255,63,0.35);background:rgba(215,255,63,0.08);border-radius:8px">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#d7ff3f">Your original question</div>
                <p style="margin:8px 0 0;color:#ffffff;font-size:17px;line-height:1.55;font-weight:700">${escapeHtml(prompt)}</p>
              </div>
              <div style="margin:0 0 16px">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8c95a3">${escapeHtml(preview.category)} / ${escapeHtml(preview.status)}</div>
                <h2 style="margin:8px 0 0;font-size:24px;line-height:1.18;color:#ffffff">${escapeHtml(title)}</h2>
                <p style="margin:12px 0 0;color:#c6cbd3;font-size:15px;line-height:1.65">${escapeHtml(summary)}</p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border-collapse:separate;border-spacing:8px 0">
                <tr>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${preview.claimsCount}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Claims</div></td>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${preview.chartsCount}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Charts</div></td>
                  <td style="background:#171c26;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#d7ff3f">${preview.sourcesCount}</div><div style="font-size:12px;color:#8c95a3;text-transform:uppercase">Sources</div></td>
                </tr>
              </table>
              <div style="margin:18px 0 22px;padding:16px;background:#0b0f16;border-left:3px solid #d7ff3f;border-radius:4px">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8c95a3">Article preview</div>
                <p style="margin:8px 0 0;color:#d8dde5;font-size:15px;line-height:1.65">${escapeHtml(excerpt)}${excerpt.length >= 520 ? '...' : ''}</p>
              </div>
              <a href="${escapeHtml(url)}" style="display:inline-block;background:#d7ff3f;color:#080a0f;padding:13px 20px;border-radius:999px;font-weight:900;text-decoration:none">Review and publish article</a>
              <p style="margin:18px 0 0;color:#8c95a3;font-size:13px;line-height:1.55">You can close CiteDrop while articles generate. We will email you when they are ready.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </div>
  `;
}

async function sendArticleReadyEmail({ userId, article, prompt = '' }) {
  if (process.env.EMAIL_TEMPLATE_VERSION !== 'legacy') {
    return sendStyledArticleReadyEmail({ userId, article, prompt });
  }
  if (!userId || String(userId).startsWith('anonymous:') || !article?.slug) return false;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.info('Article-ready email not sent; configure RESEND_API_KEY and EMAIL_FROM.');
    return false;
  }
  const email = await clerkPrimaryEmail(userId);
  if (!email) return false;

  const url = publicArticleReviewUrl(article.slug);
  const title = article.title || 'Your CiteDrop article';
  return sendEmail({
    to: email,
    subject: `Your CiteDrop article is ready: ${title}`,
    text: [
      `Your CiteDrop article is ready: ${title}`,
      '',
      `Review it here: ${url}`,
      '',
      'It is saved as a draft until you publish it.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
        <h1 style="font-size:22px;margin:0 0 12px">Your CiteDrop article is ready</h1>
        <p><strong>${escapeHtml(title)}</strong> has finished generating and is saved as a draft.</p>
        <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#d7ff3f;color:#111;padding:12px 18px;border-radius:999px;font-weight:700;text-decoration:none">Review and publish article</a></p>
        <p style="color:#555">You can close CiteDrop while articles generate. We’ll email you when they’re ready.</p>
      </div>
    `
  });
}

async function sendStyledArticleReadyEmail({ userId, article, prompt = '' }) {
  if (!userId || String(userId).startsWith('anonymous:') || !article?.slug) return false;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.info('Article-ready email not sent; configure RESEND_API_KEY and EMAIL_FROM.');
    return false;
  }
  const email = await clerkPrimaryEmail(userId);
  if (!email) return false;

  const url = publicArticleReviewUrl(article.slug);
  const title = article.title || 'Your CiteDrop article';
  const preview = articleEmailPreview(article, prompt);
  return sendEmail({
    to: email,
    subject: `Your CiteDrop article is ready: ${title}`,
    text: [
      `Your CiteDrop article is ready: ${title}`,
      '',
      `Original question: ${preview.prompt}`,
      '',
      preview.summary,
      '',
      `Preview: ${preview.excerpt}`,
      '',
      `Review it here: ${url}`,
      '',
      'It is saved as a draft until you publish it.'
    ].join('\n'),
    html: articleReadyEmailHtml({ title, url, preview })
  });
}

async function attachCreatorEmails(articles = []) {
  const creatorIds = [...new Set(
    articles
      .map((article) => article.created_by)
      .filter((id) => id && !String(id).startsWith('anonymous:'))
  )];
  if (!creatorIds.length) return articles;

  const entries = await Promise.all(
    creatorIds.map(async (creatorId) => [creatorId, await clerkPrimaryEmail(creatorId)])
  );
  const emailByCreator = new Map(entries);
  return articles.map((article) => ({
    ...article,
    created_by_email: emailByCreator.get(article.created_by) || ''
  }));
}

function facebookArticleMessage(article = {}) {
  const summary = String(article.summary || '').trim();
  const title = String(article.title || 'New CiteDrop article').trim();
  return [
    title,
    summary ? `\n${summary}` : '',
    '\nRead the full article:'
  ].join('\n').slice(0, 1500);
}

async function postPublishedArticleToFacebook(article = {}) {
  if (!article?.id || article.status !== 'published' || article.facebook_post_id) return article;

  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !pageAccessToken) {
    console.info('Facebook post not sent; configure FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.');
    return article;
  }

  const link = publicArticleUrl(article.slug);
  if (!link) {
    console.warn(`Facebook post not sent for article ${article.id}; article URL is unavailable.`);
    return article;
  }

  const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION || 'v25.0';
  const endpoint = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/feed`;
  const body = new URLSearchParams({
    access_token: pageAccessToken,
    message: facebookArticleMessage(article),
    link
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id) {
      console.warn(`Facebook post failed for article ${article.id}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
      return article;
    }

    const { rows } = await query(
      `update articles
       set facebook_post_id = $1,
           facebook_posted_at = now()
       where id = $2
         and facebook_post_id is null
       returning *`,
      [payload.id, article.id]
    );
    return rows[0] || { ...article, facebook_post_id: payload.id, facebook_posted_at: new Date().toISOString() };
  } catch (error) {
    console.warn(`Facebook post failed for article ${article.id}: ${error.message}`);
    return article;
  }
}

async function anonymousArticleCount(token) {
  const { rows } = await query(
    `select count(*)::int as count
     from articles
     where created_by = $1
       and coalesce(status, 'draft') <> 'deleted'`,
    [`anonymous:${token}`]
  );
  return rows[0]?.count || 0;
}

async function claimAnonymousArticles(req, res, user) {
  if (!user?.id) return;
  const token = parseCookies(req).cd_anon_id;
  if (!token) return;
  await query(
    `update articles
     set created_by = $1, updated_at = now()
     where created_by = $2`,
    [user.id, `anonymous:${token}`]
  );
  res.clearCookie('cd_anon_id', { sameSite: 'lax', secure: isProduction });
}

async function findPublishedArticleBySlug(slug) {
  const { rows } = await query('select * from articles where slug = $1 and status = $2 limit 1', [slug, 'published']);
  return rows[0] || null;
}

function injectArticleMeta(html, article, req) {
  const version = Date.parse(article.updated_at || article.created_at) || Date.now();
  const articleUrl = absoluteUrl(req, `/articles/${article.slug}`);
  const imageUrl = absoluteUrl(req, `/api/articles/${article.slug}/og-image?v=${ogImageVersion}-${version}`);
  const title = `${article.title} | CiteDrop`;
  const description = article.summary || article.subtitle || 'Evidence-backed AI research article.';
  const meta = `
    <title>${escapeHtml(title)}</title>
    <link rel="canonical" href="${escapeHtml(articleUrl)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(article.title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(articleUrl)}" />
    <meta property="og:site_name" content="CiteDrop" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${ogImageWidth}" />
    <meta property="og:image:height" content="${ogImageHeight}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(article.title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `;
  const cleanedHtml = stripMetaTags(html, [
    'description',
    'og:type',
    'og:title',
    'og:description',
    'og:url',
    'og:site_name',
    'og:image',
    'og:image:secure_url',
    'og:image:type',
    'og:image:width',
    'og:image:height',
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image'
  ]);

  return stripCanonicalLinks(cleanedHtml)
    .replace(/<title>.*?<\/title>/, '')
    .replace('</head>', `${meta}\n  </head>`);
}

function renderHomeSnapshot(articles = []) {
  const cards = articles.map((article) => `
      <a href="/articles/${escapeHtml(article.slug)}" class="group glass-panel flex min-h-72 flex-col rounded-lg p-5 transition hover:-translate-y-1 hover:border-acid/50">
        <div class="flex items-center justify-between gap-3">
          <span class="rounded-full bg-white/10 px-3 py-1 text-xs uppercase text-white/60">${escapeHtml(article.category || 'Research')}</span>
          <span class="rounded-full bg-acid px-3 py-1 text-xs font-bold uppercase text-ink">${escapeHtml(article.status || 'published')}</span>
        </div>
        <div class="chart-grid mt-5 rounded-md border border-white/10 bg-black/25 p-4">
          <p class="text-xs uppercase text-acid/80">${escapeHtml(new Date(article.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</p>
          <h3 class="mt-3 line-clamp-3 text-2xl font-black leading-tight">${escapeHtml(article.title)}</h3>
        </div>
        <p class="mt-5 line-clamp-3 flex-1 text-sm leading-6 text-white/62">${escapeHtml(article.summary || article.subtitle || '')}</p>
        <span class="mt-5 inline-flex items-center gap-2 text-sm font-bold text-acid">Open brief</span>
      </a>
  `).join('');

  return `
    <div class="min-h-screen">
      <header class="sticky top-0 z-40 border-b border-white/10 bg-ink/85 backdrop-blur-xl">
        <nav class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:flex-nowrap sm:px-6 sm:py-4 lg:px-8">
          <a href="/" class="flex min-w-0 items-center gap-2 sm:gap-3">
            <img src="/citedrop-logo.png" alt="CiteDrop" class="h-10 w-14 shrink-0 object-contain sm:w-16" />
            <span class="min-w-0"><span class="block text-base font-black leading-none tracking-normal sm:text-lg">CiteDrop</span><span class="hidden text-xs uppercase text-white/45 sm:block">Turn Claims Into Evidence</span></span>
          </a>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto sm:flex-none sm:gap-2 sm:overflow-visible">
            <a class="shrink-0 rounded-full px-2.5 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white sm:px-3" href="/#latest">Browse</a>
            <a class="rounded-full bg-acid px-4 py-2 text-sm font-bold text-ink hover:bg-white" href="/login">Log in</a>
          </div>
        </nav>
      </header>
      <main>
        <section class="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:px-8 lg:py-18">
          <div class="flex flex-col justify-center">
            <div class="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-acid/30 bg-acid/10 px-4 py-2 text-sm font-bold text-acid">Sourced AI research pages</div>
            <h1 class="max-w-4xl text-5xl font-black leading-[0.95] sm:text-6xl lg:text-7xl">Generate research-backed responses to any claim, in seconds, for free</h1>
            <p class="mt-6 max-w-2xl text-lg leading-8 text-white/62">CiteDrop turns opinions into polished shareable research articles with chart visualizations, visible sources, and a clear separation between claims and opinion.</p>
            <div class="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/dashboard" class="inline-flex items-center justify-center gap-2 rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white">Generate article</a>
              <a href="#latest" class="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 font-bold text-white/75 hover:bg-white/10">Browse latest</a>
            </div>
          </div>
        </section>
        <section id="latest" class="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div class="mb-6">
            <p class="text-sm font-bold uppercase text-acid">Latest generated articles</p>
            <h2 class="mt-2 text-3xl font-black">Browse the public library</h2>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${cards}</div>
        </section>
      </main>
    </div>
  `;
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function homeSnapshotData(limit = 9) {
  const [articlesResult, countResult, categoriesResult] = await Promise.all([
    query(
    `select id, title, slug, subtitle, summary, category, status, created_at
     from articles
     where status = 'published'
     order by created_at desc
     limit $1`,
    [limit]
    ),
    query(`select count(*)::int as count from articles where status = 'published'`),
    query(`select distinct category from articles where status = 'published' and nullif(trim(category), '') is not null order by category asc`)
  ]);

  return {
    articles: articlesResult.rows,
    count: countResult.rows[0]?.count || 0,
    categories: categoriesResult.rows.map((row) => row.category)
  };
}

async function injectHomeMeta(html, req) {
  const imageUrl = absoluteUrl(req, '/og-home-2026-05-17.png');
  const siteUrl = absoluteUrl(req, '/');
  const meta = `
    <link rel="canonical" href="${escapeHtml(siteUrl)}" />
    <meta property="og:url" content="${escapeHtml(siteUrl)}" />
    <meta property="og:site_name" content="CiteDrop" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `;
  const snapshot = await homeSnapshotData();
  const dataScript = `<script>window.__CITEDROP_HOME__=${safeJson(snapshot)};</script>`;
  return stripCanonicalLinks(stripMetaTags(html, ['og:url', 'og:site_name', 'og:image', 'twitter:image']))
    .replace('<div id="root"></div>', `<div id="root">${renderHomeSnapshot(snapshot.articles)}</div>`)
    .replace('</head>', `${meta}\n    ${dataScript}\n  </head>`);
}

async function openaiJson({ model, schema, temperature = 0.2, input }) {
  const response = await openai.responses.create({
    model,
    temperature,
    text: {
      format: {
        type: 'json_schema',
        ...schema
      }
    },
    input
  });
  return JSON.parse(response.output_text || '{}');
}

function researchTargets(input, claimPlan) {
  const targets = [];
  for (const claim of claimPlan?.claims || []) {
    if (claim?.claim) targets.push({ type: 'claim', text: claim.claim, notes: claim.notes || '' });
  }
  for (const question of claimPlan?.researchQuestions || []) {
    if (question) targets.push({ type: 'question', text: question, notes: '' });
  }
  for (const requirement of claimPlan?.coverageRequirements || []) {
    if (requirement && targets.length < 5) targets.push({ type: 'coverage', text: requirement, notes: '' });
  }
  if (!targets.length) targets.push({ type: 'question', text: input.prompt, notes: '' });

  const seen = new Set();
  return targets
    .filter((target) => {
      const key = target.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function buildTargetResearchInput({ input, target, currentDate, existingCategories, claimPlan }) {
  return JSON.stringify({
    task: 'Gather a defensible evidence packet for this single target. Search broadly enough to find primary sources, opposing/contextual evidence, and recent updates. Return a concise source-grounded research brief; do not draft the article.',
    userPrompt: input.prompt,
    target,
    currentDate,
    existingCategories,
    promptInterpretation: claimPlan,
    searchRequirements: [
      'Run targeted searches for primary/authoritative sources, not just general summaries.',
      'Prefer government records, official reports, datasets, court records, regulator filings, direct transcripts, peer-reviewed work, reputable news with direct reporting, and original documents.',
      'Look for evidence that supports, contradicts, qualifies, or limits the target.',
      'Prioritize specific pages over homepages and avoid low-quality SEO pages.',
      'For fast-moving topics, prioritize 2025-2026 and the last 24 months, while using older sources only for historical context or latest-available data.',
      'Identify exact statistics, dates, definitions, and caveats that are safe to use.',
      'If the exact target cannot be verified, explain what public evidence does and does not show.'
    ],
    sourceUrls: input.sourceUrls
  });
}

function stageLabel(stage, fallback = '') {
  return generationStages[stage] || fallback || stage.replaceAll('_', ' ');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = fetchTimeoutMs) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'CiteDropBot/1.0 (+https://www.citedrop.com)',
        accept: options.accept || 'text/html,application/pdf;q=0.9,*/*;q=0.7'
      },
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseTextLimited(response, maxBytes = maxHtmlBytes) {
  const text = await response.text();
  return text.slice(0, maxBytes);
}

async function responseBufferLimited(response, maxBytes = maxPdfBytes) {
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.byteLength > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
}

function htmlToText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTextExcerpt(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2200);
}

function absoluteLink(baseUrl, href = '') {
  try {
    return new globalThis.URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function findPdfLinks(html = '', baseUrl = '') {
  const links = [];
  const linkPattern = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
  let match;
  while ((match = linkPattern.exec(html)) && links.length < 3) {
    const link = absoluteLink(baseUrl, match[1]);
    if (link && !links.includes(link)) links.push(link);
  }
  return links;
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    return parsed.text || '';
  } catch (error) {
    console.warn('PDF extraction failed:', error.message);
    return '';
  }
}

async function ingestOneSource(source) {
  if (!source?.url) return { ...source, verified: false, verificationNote: 'No URL available for source ingestion.' };
  try {
    const response = await fetchWithTimeout(source.url);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return { ...source, verified: false, verificationNote: `Source fetch returned HTTP ${response.status}.` };
    }

    if (/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(source.url)) {
      const text = await extractPdfText(await responseBufferLimited(response));
      return {
        ...source,
        verified: Boolean(text),
        contentType: 'pdf',
        sourceTextSample: sourceTextExcerpt(text),
        verificationNote: text ? 'PDF downloaded and text extracted.' : 'PDF downloaded, but text could not be extracted.'
      };
    }

    const html = await responseTextLimited(response);
    const text = htmlToText(html);
    const pdfLinks = findPdfLinks(html, source.url);
    let pdfText = '';
    let pdfUrl = '';
    for (const link of pdfLinks) {
      const pdfResponse = await fetchWithTimeout(link, { accept: 'application/pdf,*/*;q=0.7' });
      if (!pdfResponse.ok) continue;
      pdfText = await extractPdfText(await responseBufferLimited(pdfResponse));
      if (pdfText) {
        pdfUrl = link;
        break;
      }
    }

    return {
      ...source,
      verified: Boolean(text || pdfText),
      contentType: pdfText ? 'html+pdf' : 'html',
      pdfUrl,
      sourceTextSample: sourceTextExcerpt(pdfText || text),
      verificationNote: pdfText
        ? 'Source page fetched and linked PDF text extracted.'
        : text
          ? 'Source page fetched and readable text extracted.'
          : 'Source page fetched, but no readable text was extracted.'
    };
  } catch (error) {
    return { ...source, verified: false, verificationNote: `Source ingestion failed: ${error.message}` };
  }
}

async function ingestSources(sources = [], onStage = () => {}) {
  const candidates = sources.slice(0, 24);
  const ingested = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const source = candidates[index];
    onStage(`ingesting_source_${index + 1}`, `Verifying source ${index + 1} of ${candidates.length}: ${source.publisher || sourceDomain(source.url) || 'source'}`);
    ingested.push(await ingestOneSource(source));
  }
  return [
    ...ingested,
    ...sources.slice(candidates.length).map((source) => ({
      ...source,
      verified: false,
      verificationNote: 'Not fetched; source limit reached for this generation.'
    }))
  ];
}

function normalizeSources(articleSources = [], responseSources = []) {
  const byUrl = new Map();
  for (const source of articleSources) {
    const cleaned = cleanSource(source);
    if (!cleaned.url && !cleaned.title) continue;
    byUrl.set(cleaned.url || cleaned.title, cleaned);
  }
  for (const source of responseSources) {
    const cleaned = cleanSource({
      title: source.title,
      publisher: source.source || '',
      url: source.url,
      date: source.published_at || '',
      note: 'Consulted during web search.'
    });
    if (!cleaned.url) continue;
    if (!byUrl.has(cleaned.url)) {
      byUrl.set(cleaned.url, {
        ...cleaned,
        date: source.published_at || '',
        note: cleaned.note || 'Consulted during web search.'
      });
    }
  }
  return [...byUrl.values()].map((source, index) => ({
    ...source,
    originalId: source.id ? String(source.id) : '',
    id: `source-${index + 1}`
  }));
}

function sourceIdRemap(originalSources = [], normalizedSources = []) {
  const remap = new Map();
  originalSources.forEach((source, index) => {
    const normalized = normalizedSources[index];
    if (!normalized?.id) return;
    const originalId = source?.id ? String(source.id) : '';
    if (originalId) remap.set(originalId, normalized.id);
    remap.set(`source-${index + 1}`, normalized.id);
    const key = sourceKey(source);
    if (key) remap.set(key, normalized.id);
  });
  return remap;
}

function remapSourceIds(ids = [], remap = new Map(), validIds = new Set()) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => remap.get(String(id)) || String(id))
      .filter((id) => validIds.has(id))
  )];
}

function sourceKey(source = {}) {
  return canonicalSourceUrl(source.url || '') || String(source.title || '').trim();
}

function verifiedUsableSources(sources = []) {
  const verifiedKeys = new Set(
    sources
      .filter((source) => source.verified && source.sourceTextSample)
      .map(sourceKey)
      .filter(Boolean)
  );
  return sources.filter((source) => verifiedKeys.has(sourceKey(source)));
}

function removeUnusableSourcesFromArticle(article, usableSources) {
  const usableKeys = new Set(usableSources.map(sourceKey).filter(Boolean));
  const usableIds = new Set(usableSources.map((source) => String(source.id)));
  const filteredSources = normalizeSources(article.sources || [])
    .filter((source) => usableKeys.has(sourceKey(source)));

  return {
    ...article,
    sources: filteredSources,
    keyClaims: Array.isArray(article.keyClaims)
      ? article.keyClaims.map((claim) => ({
        ...claim,
        sourceIds: Array.isArray(claim.sourceIds) ? claim.sourceIds.filter((id) => usableIds.has(String(id))) : []
      }))
      : [],
    body: Array.isArray(article.body)
      ? article.body.map((section) => ({
        ...section,
        paragraphs: Array.isArray(section.paragraphs)
          ? section.paragraphs.map((paragraph) => ({
            ...paragraph,
            sourceIds: Array.isArray(paragraph.sourceIds) ? paragraph.sourceIds.filter((id) => usableIds.has(String(id))) : []
          }))
          : []
      }))
      : []
  };
}

function repairClaimSourceIds(claims = [], sources = []) {
  const sourceIds = sources.map((source, index) => String(source.id || `source-${index + 1}`));
  if (!sourceIds.length) return claims;
  return claims.map((claim) => {
    const validIds = Array.isArray(claim?.sourceIds)
      ? claim.sourceIds.map(String).filter((id) => sourceIds.includes(id))
      : [];
    return {
      ...claim,
      sourceIds: validIds
    };
  });
}

function repairParagraphSourceIds(body = [], sources = []) {
  const sourceIds = new Set(sources.map((source, index) => String(source.id || `source-${index + 1}`)));
  if (!sourceIds.size) return body;
  return body.map((section) => ({
    ...section,
    paragraphs: Array.isArray(section?.paragraphs)
      ? section.paragraphs.map((paragraph) => ({
        ...paragraph,
        sourceIds: Array.isArray(paragraph?.sourceIds)
          ? paragraph.sourceIds.map(String).filter((id) => sourceIds.has(id))
          : []
      }))
      : []
  }));
}

function hardCitationAuditIssues(issues = []) {
  const hardFailurePattern = /(fabricat|invent|not actually consulted|no sources?|zero sources?|homepage-only|body text.*url|url\/citation dumps?|raw urls?)/i;
  return issues.filter((issue) => hardFailurePattern.test(String(issue || '')));
}

function articleBodyQualityIssues(article = {}) {
  const sections = Array.isArray(article.body) ? article.body : [];
  const paragraphs = sections.flatMap((section) => Array.isArray(section.paragraphs) ? section.paragraphs : []);
  const issues = [];
  if (sections.length < 4) issues.push('Article has fewer than 4 sourced body sections after source enforcement.');
  if (paragraphs.length < 6) issues.push('Article has fewer than 6 sourced body paragraphs after source enforcement.');
  const bodySourceIds = paragraphs.flatMap((paragraph) => Array.isArray(paragraph.sourceIds) ? paragraph.sourceIds.map(String) : []);
  const distinctBodySources = new Set(bodySourceIds);
  if (paragraphs.length >= 4 && distinctBodySources.size < 3) {
    issues.push('Article body relies on fewer than 3 distinct sources; add relevant sourced coverage or remove unsupported sections.');
  }
  const sourceUseCounts = bodySourceIds.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map());
  const maxUse = Math.max(0, ...sourceUseCounts.values());
  if (paragraphs.length >= 4 && maxUse / paragraphs.length > 0.7) {
    issues.push('Article body overuses one source across unrelated sections; use more relevant source IDs or remove weak sections.');
  }
  const firstText = String(paragraphs[0]?.text || '').trim();
  if (/^(also|additionally|furthermore|moreover|however|conversely|therefore|meanwhile|in addition)\b/i.test(firstText)) {
    issues.push('Article appears to start midstream with a continuation transition.');
  }
  return issues;
}

function citationAuditWithBodyQuality(citationAudit = {}, article = {}) {
  const qualityIssues = articleBodyQualityIssues(article);
  if (!qualityIssues.length) return citationAudit;
  return {
    ...citationAudit,
    passed: false,
    blockingIssues: [...(citationAudit.blockingIssues || []), ...qualityIssues],
    warnings: citationAudit.warnings || []
  };
}

async function auditGeneratedArticle({ reviewModel, input, claimPlan, article, consultedSources }) {
  return openaiJson({
    model: reviewModel,
    schema: citationAuditJsonSchema,
    temperature: 0,
    input: [
      {
        role: 'system',
        content: 'Audit citations before draft save. Fail for factual claims with no relevant source support or no clear uncertainty/insufficient-evidence label, fabricated citations, sources that were not actually consulted, no usable sources, homepage-only citations where a specific page is required, or body text containing URL/citation dumps. Treat source specificity gaps and claims needing better pinpoint citation as warnings only when the article already has relevant source support. Paragraph sourceIds should connect evidence-bearing paragraphs to supporting sources. Do not fail for invalid sourceIds; the server validates and repairs sourceIds before this audit.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Return whether this generated article passes a final citation audit.',
          originalRequest: input,
          claimPlan,
          article,
          consultedSources
        })
      }
    ]
  });
}

async function repairArticleCitations({ writingModel, input, claimPlan, existingCategories, currentDate, researchBrief, consultedSources, article, citationAudit, attempt }) {
  return openaiJson({
    model: writingModel,
    schema: articleJsonSchema,
    temperature: 0.1,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Repair citation audit problems in this article. Preserve the required article JSON shape.',
          currentDate,
          attempt,
          repairRules: [
            'Change only the specific claims, paragraphs, charts, or source mappings needed to resolve citationAudit blockingIssues and warnings. Preserve unaffected sections verbatim when possible.',
            'If the article is too short after source enforcement, add only source-backed paragraphs from consultedSources and the compact repair context. Do not add unsourced filler.',
            'If the first paragraph starts with a continuation transition such as additionally, however, or moreover, rewrite it as a proper opening paragraph using only sourced facts.',
            'Use source IDs that match the actual evidence in each paragraph. Do not use one source as a generic fallback for unrelated sections.',
            'For every unsupported factual claim or unanswered research question, either attach relevant existing source support, remove the claim, soften it, or explicitly state that available public evidence is insufficient to make a determination.',
            'Do not invent new sources, URLs, statistics, quotes, or source metadata.',
            'Use only the compact repair context and consulted sources. Prefer sources with verified readable text or extracted PDF text.',
            'If there is not enough public data, save a useful limited-evidence draft: explain what was found, what was not found, and what evidence would be needed for a stronger determination.',
            'Every paragraph object must include sourceIds. Evidence-bearing paragraphs should include the source IDs that support them. Use 2 or 3 sourceIds for evidence-heavy, comparison, statistical, or controversial paragraphs when possible.',
            'Keep sources only in the sources array. Do not place raw URLs, citation dumps, references sections, or markdown links in body text. Use paragraph sourceIds to connect paragraphs to sources.',
            'Keep chart IDs attached only to paragraphs they directly support.'
          ],
          originalRequest: input,
          claimPlan,
          existingCategories,
          researchBrief,
          consultedSources,
          citationAudit,
          article,
          requiredShape: articleJsonShape
        })
      }
    ]
  });
}

async function polishGeneratedArticle({ writingModel, input, claimPlan, existingCategories, currentDate, evidencePacket, targetedResearch, consultedSources, article }) {
  return openaiJson({
    model: writingModel,
    schema: articleJsonSchema,
    temperature: 0.12,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Polish this generated article for publication quality without changing its factual basis. Preserve the required article JSON shape.',
          currentDate,
          polishRules: [
            'Do not add sources, URLs, statistics, quotes, or claims that are not already supported by consultedSources, evidencePacket, targetedResearch, or the current article.',
            'Improve thin one-paragraph sections by adding context, caveats, and interpretation only from the provided evidence.',
            'Remove or rename generic filler sections such as Additional Evidence when they only repeat chart takeaways. Integrate chart explanation into relevant article sections when possible.',
            'Keep all paragraph sourceIds valid and tied to the supporting consultedSources.',
            'Keep chartIds attached only to paragraphs that directly explain those charts.',
            'Do not rewrite for style alone; prioritize depth, specificity, source-label clarity, and reader trust.'
          ],
          originalRequest: input,
          claimPlan,
          existingCategories,
          evidencePacket,
          targetedResearch,
          consultedSources,
          article,
          requiredShape: articleJsonShape
        })
      }
    ]
  });
}

function reviewRequiresFullRevision(review = {}) {
  const requiredRevisions = Array.isArray(review.requiredRevisions) ? review.requiredRevisions.filter(Boolean) : [];
  const skepticalIssues = Array.isArray(review.skepticalReview) ? review.skepticalReview : [];
  const neutralityIssues = Array.isArray(review.neutralityReview) ? review.neutralityReview : [];
  const blockingIssues = [...skepticalIssues, ...neutralityIssues]
    .filter((issue) => ['high', 'medium'].includes(String(issue?.severity || '').toLowerCase()));
  return requiredRevisions.length > 0 || blockingIssues.length > 0;
}

function compactCitationRepairContext({ evidencePacket, researchBriefs, citationAudit }) {
  return JSON.stringify({
    promptSummary: evidencePacket?.promptSummary || '',
    globalLimitations: evidencePacket?.globalLimitations || [],
    targets: Array.isArray(evidencePacket?.targets)
      ? evidencePacket.targets.map((target) => ({
        target: target.target,
        answerMode: target.answerMode,
        evidenceSummary: target.evidenceSummary,
        limitations: target.limitations,
        topSources: Array.isArray(target.topSources) ? target.topSources.slice(0, 5) : [],
        counterSources: Array.isArray(target.counterSources) ? target.counterSources.slice(0, 3) : []
      }))
      : [],
    targetedResearch: Array.isArray(researchBriefs)
      ? researchBriefs.map((item) => ({
        target: item.target,
        brief: String(item.brief || '').slice(0, 1800)
      }))
      : [],
    citationAudit: {
      blockingIssues: citationAudit?.blockingIssues || [],
      warnings: citationAudit?.warnings || []
    }
  });
}

function compactResearchBriefs(researchBriefs = [], maxChars = 2400) {
  return researchBriefs.map((item) => ({
    target: item.target,
    brief: String(item.brief || '').slice(0, maxChars)
  }));
}

function cleanSource(source = {}) {
  const url = canonicalSourceUrl(source.url || '');
  const domain = sourceDomain(url);
  const title = cleanSourceTitle(source.title, domain);
  const publisher = String(source.publisher || domain || '').trim();
  return {
    ...source,
    title,
    publisher,
    url,
    note: String(source.note || '').trim()
  };
}

function canonicalSourceUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const url = new globalThis.URL(value);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'msclkid'].forEach((param) => {
      url.searchParams.delete(param);
    });
    url.hash = '';
    const trailingSlash = url.pathname !== '/' && url.pathname.endsWith('/');
    if (trailingSlash) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return value;
  }
}

function sourceDomain(url = '') {
  try {
    return new globalThis.URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cleanSourceTitle(title = '', domain = '') {
  const value = String(title || '').trim();
  if (!value || /^https?:\/\//i.test(value)) return domain || 'Source';
  return value;
}

function normalizeCategory(category = '', fallbackCategory = 'Research') {
  const cleaned = String(category || fallbackCategory || 'Research').trim();
  const lower = cleaned.toLowerCase();
  const categoryMap = new Map([
    ['science and relikgion', 'Science and Religion'],
    ['science & relikgion', 'Science and Religion'],
    ['science and religion', 'Science and Religion']
  ]);
  return (categoryMap.get(lower) || cleaned || 'Research').slice(0, 80);
}

const articleJsonSchema = {
  name: 'generated_research_article',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slug', 'subtitle', 'summary', 'category', 'body', 'keyClaims', 'charts', 'sources'],
    properties: {
      title: { type: 'string' },
      slug: { type: 'string' },
      subtitle: { type: 'string' },
      summary: { type: 'string' },
      category: { type: 'string' },
      body: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'paragraphs'],
          properties: {
            heading: { type: 'string' },
            paragraphs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'chartIds', 'sourceIds'],
                properties: {
                  text: { type: 'string' },
                  chartIds: { type: 'array', items: { type: 'string' } },
                  sourceIds: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      },
      keyClaims: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claim', 'verdict', 'verdictSummary', 'confidenceScore', 'confidenceLabel', 'support', 'sourceIds'],
          properties: {
            claim: { type: 'string' },
            verdict: { type: 'string', enum: ['true', 'false', 'mixed', 'unsure'] },
            verdictSummary: { type: 'string' },
            confidenceScore: { type: 'number', minimum: 0, maximum: 100 },
            confidenceLabel: { type: 'string', enum: ['high', 'medium', 'low'] },
            support: { type: 'string' },
            sourceIds: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      charts: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'question', 'type', 'takeaway', 'units', 'sourceNote', 'limitation', 'note', 'data'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            question: { type: 'string' },
            type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'timeline', 'scorecard', 'metrics', 'comparison', 'ranked_bar', 'delta', 'evidence_matrix', 'fact_table'] },
            takeaway: { type: 'string' },
            units: { type: 'string' },
            sourceNote: { type: 'string' },
            limitation: { type: 'string' },
            note: { type: 'string' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: { type: ['string', 'number'] },
                required: ['label', 'value', 'group', 'date', 'source', 'note'],
                properties: {
                  label: { type: 'string' },
                  value: { type: 'number' },
                  group: { type: 'string' },
                  date: { type: 'string' },
                  source: { type: 'string' },
                  note: { type: 'string' }
                }
              }
            }
          }
        }
      },
      sources: {
        type: 'array',
        minItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'publisher', 'url', 'date', 'note'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            publisher: { type: 'string' },
            url: { type: 'string' },
            date: { type: 'string' },
            note: { type: 'string' }
          }
        }
      }
    }
  },
  strict: true
};

function normalizeGeneratedArticle(article, fallbackCategory) {
  const title = String(article.title || 'Untitled research brief').slice(0, 180);
  const rawSlug = article.slug || title;
  const body = Array.isArray(article.body) ? sanitizeArticleBody(article.body) : [];
  const category = normalizeCategory(article.category, fallbackCategory);
  const charts = Array.isArray(article.charts) ? article.charts : [];
  const rawSources = Array.isArray(article.sources) ? article.sources : [];
  const sources = normalizeSources(rawSources);
  const idRemap = sourceIdRemap(rawSources, sources);
  const validSourceIds = new Set(sources.map((source) => source.id));
  const remappedBody = remapBodySourceIds(body, idRemap, validSourceIds);
  const remappedClaims = Array.isArray(article.keyClaims)
    ? article.keyClaims.slice(0, 3).map((claim) => ({
      ...claim,
      sourceIds: remapSourceIds(claim.sourceIds, idRemap, validSourceIds)
    }))
    : [];
  return {
    title,
    slug: slugify(rawSlug, { lower: true, strict: true }).slice(0, 140) || `article-${Date.now()}`,
    subtitle: String(article.subtitle || '').slice(0, 240),
    summary: String(article.summary || '').slice(0, 700),
    category,
    body: enforceParagraphSourceCoverage({
      body: attachOrphanCharts(remappedBody, charts, sources),
      charts,
      sources
    }).body,
    keyClaims: remappedClaims,
    charts,
    sources
  };
}

function remapBodySourceIds(body = [], remap = new Map(), validIds = new Set()) {
  return body.map((section) => ({
    ...section,
    paragraphs: Array.isArray(section.paragraphs)
      ? section.paragraphs.map((paragraph) => ({
        ...paragraph,
        sourceIds: remapSourceIds(paragraph.sourceIds, remap, validIds)
      }))
      : []
  }));
}

function chartSourceIds(chart = {}, sources = []) {
  const haystack = [
    chart.sourceNote,
    chart.note,
    ...(Array.isArray(chart.data) ? chart.data.map((point) => point?.source) : [])
  ].join(' ').toLowerCase();
  if (!haystack.trim()) return [];
  return sources
    .filter((source) => {
      const publisher = String(source.publisher || '').toLowerCase();
      const title = String(source.title || '').toLowerCase();
      const domain = sourceDomain(source.url).toLowerCase();
      return (publisher && haystack.includes(publisher)) ||
        (domain && haystack.includes(domain)) ||
        (title && title.length > 12 && haystack.includes(title.slice(0, 48)));
    })
    .map((source) => source.id)
    .slice(0, 3);
}

function attachOrphanCharts(body, charts, sources = []) {
  if (!charts.length) return body;
  const referencedIds = new Set();
  for (const section of body) {
    for (const paragraph of section.paragraphs || []) {
      if (typeof paragraph === 'object' && Array.isArray(paragraph.chartIds)) {
        paragraph.chartIds.forEach((id) => referencedIds.add(id));
      }
    }
  }

  const orphanCharts = charts.filter((chart, index) => {
    const id = chart.id || `chart-${index + 1}`;
    return id && !referencedIds.has(id);
  });
  if (!orphanCharts.length) return body;

  return [
    ...body,
    {
      heading: 'Visual Evidence',
      paragraphs: orphanCharts.map((chart) => ({
        text: chart.takeaway || chart.note || `${chart.title} adds context to the report.`,
        chartIds: [chart.id],
        sourceIds: chartSourceIds(chart, sources)
      }))
    }
  ];
}

function enforceParagraphSourceCoverage(article = {}) {
  const sources = Array.isArray(article.sources) ? article.sources : [];
  const charts = Array.isArray(article.charts) ? article.charts : [];
  const validSourceIds = new Set(sources.map((source) => String(source.id)));
  const chartsById = new Map(charts.map((chart) => [String(chart.id), chart]));

  return {
    ...article,
    body: Array.isArray(article.body)
      ? article.body.map((section) => ({
        ...section,
        paragraphs: Array.isArray(section.paragraphs)
          ? section.paragraphs
            .map((paragraph) => {
              const chartIds = Array.isArray(paragraph?.chartIds) ? paragraph.chartIds.map(String).filter(Boolean) : [];
              const sourceIds = remapSourceIds(paragraph?.sourceIds, new Map(), validSourceIds);
              const chartBackedSourceIds = chartIds.flatMap((chartId) => chartSourceIds(chartsById.get(chartId), sources));
              return {
                ...paragraph,
                chartIds,
                sourceIds: sourceIds.length ? sourceIds : [...new Set(chartBackedSourceIds)]
              };
            })
            .filter((paragraph) => paragraph.sourceIds.length > 0)
          : []
      }))
        .filter((section) => section.paragraphs.length > 0)
      : [],
    keyClaims: Array.isArray(article.keyClaims)
      ? article.keyClaims
        .map((claim) => ({
          ...claim,
          sourceIds: remapSourceIds(claim.sourceIds, new Map(), validSourceIds)
        }))
        .filter((claim) => claim.sourceIds.length > 0)
        .slice(0, 3)
      : []
  };
}

function citedSourceIds(article = {}) {
  const ids = new Set();
  (article.keyClaims || []).forEach((claim) => {
    if (Array.isArray(claim.sourceIds)) claim.sourceIds.forEach((id) => ids.add(String(id)));
  });
  (article.body || []).forEach((section) => {
    (section.paragraphs || []).forEach((paragraph) => {
      if (Array.isArray(paragraph.sourceIds)) paragraph.sourceIds.forEach((id) => ids.add(String(id)));
    });
  });
  return ids;
}

function pruneUncitedSources(article = {}) {
  const ids = citedSourceIds(article);
  return {
    ...article,
    sources: Array.isArray(article.sources)
      ? article.sources.filter((source) => ids.has(String(source.id)))
      : []
  };
}

function sanitizeArticleBody(body) {
  const sourceHeadingPattern = /^(sources?|references?|bibliography|works cited|citations?)$/i;
  const urlPattern = /https?:\/\/\S+|www\.\S+|\[[^\]]+\]\([^)]+\)/gi;
  return body
    .filter((section) => !sourceHeadingPattern.test(String(section?.heading || '').trim()))
    .map((section) => ({
      heading: String(section?.heading || '').replace(urlPattern, '').trim(),
      paragraphs: Array.isArray(section?.paragraphs)
        ? section.paragraphs
          .map((paragraph) => {
            if (typeof paragraph === 'string') {
              return {
                text: String(paragraph || '').replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim(),
                chartIds: [],
                sourceIds: []
              };
            }
            return {
              text: String(paragraph?.text || '').replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim(),
              chartIds: Array.isArray(paragraph?.chartIds) ? paragraph.chartIds.map(String).filter(Boolean) : [],
              sourceIds: Array.isArray(paragraph?.sourceIds) ? paragraph.sourceIds.map(String).filter(Boolean) : []
            };
          })
          .filter((paragraph) => Boolean(paragraph.text))
        : []
    }))
    .filter((section) => section.heading || section.paragraphs.length);
}

function uniqueSlug(baseSlug) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseSlug.slice(0, 132)}-${suffix}`;
}

function publicGenerationError(error) {
  if (error?.status === 401) return 'OpenAI rejected the API key. Check OPENAI_API_KEY.';
  if (error?.status === 403) return 'OpenAI account or project does not have access to the configured model.';
  if (error?.status === 429) return 'OpenAI rate limit or quota was exceeded.';
  if (error?.code === '23505') return 'A generated article with that slug already exists. Try again.';
  if (error instanceof SyntaxError) return 'OpenAI returned invalid JSON. Try again with a more specific prompt.';
  return error?.message || 'Article generation failed.';
}

async function listExistingCategories() {
  const { rows } = await query(`
    select distinct category
    from articles
    where nullif(trim(category), '') is not null
    order by category asc
    limit 80
  `);
  return rows.map((row) => row.category);
}

function generatedArticlePayload(generated, userId, slug = uniqueSlug(generated.slug)) {
  return {
    title: generated.title,
    slug,
    subtitle: generated.subtitle,
    summary: generated.summary,
    category: generated.category,
    status: 'draft',
    body: generated.body,
    claims_json: generated.keyClaims,
    charts_json: generated.charts,
    sources_json: generated.sources,
    created_by: userId
  };
}

async function insertGeneratedArticle(generated, userId) {
  const insertPayload = generatedArticlePayload(generated, userId);
  const { rows } = await query(
    `insert into articles
      (title, slug, subtitle, summary, category, status, body, claims_json, charts_json, sources_json, created_by)
     values
      ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
     returning *`,
    [
      insertPayload.title,
      insertPayload.slug,
      insertPayload.subtitle,
      insertPayload.summary,
      insertPayload.category,
      insertPayload.status,
      JSON.stringify(insertPayload.body),
      JSON.stringify(insertPayload.claims_json),
      JSON.stringify(insertPayload.charts_json),
      JSON.stringify(insertPayload.sources_json),
      userId
    ]
  );
  return rows[0];
}

async function updateGeneratedArticle(articleId, generated, userId, currentArticle) {
  const payload = generatedArticlePayload(generated, userId, currentArticle.slug);
  const { rows } = await query(
    `update articles
     set title = $1,
         subtitle = $2,
         summary = $3,
         category = $4,
         body = $5::jsonb,
         claims_json = $6::jsonb,
         charts_json = $7::jsonb,
         sources_json = $8::jsonb,
         created_by = coalesce(created_by, $9),
         updated_at = now()
     where id = $10
     returning *`,
    [
      payload.title,
      payload.subtitle,
      payload.summary,
      payload.category,
      JSON.stringify(payload.body),
      JSON.stringify(payload.claims_json),
      JSON.stringify(payload.charts_json),
      JSON.stringify(payload.sources_json),
      userId,
      articleId
    ]
  );
  return rows[0];
}

async function performArticleGeneration(input, userId, onStage = () => {}, onTiming = () => {}, saveGeneratedArticle = insertGeneratedArticle) {
  const generationStartedAt = performance.now();
  const timings = [];
  const recordTiming = (name, startedAt, extra = {}) => {
    const timing = {
      name,
      ms: Math.round(performance.now() - startedAt),
      ...extra
    };
    timings.push(timing);
    onTiming(timings);
    return timing;
  };
  const timedStep = async (name, fn, extra = {}) => {
    const startedAt = performance.now();
    try {
      return await fn();
    } finally {
      recordTiming(name, startedAt, extra);
    }
  };

  const existingCategories = await timedStep('list_existing_categories', listExistingCategories);
  const currentDate = currentDateString();
  const planningModel = process.env.OPENAI_PLANNING_MODEL || process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const researchModel = process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const writingModel = process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const reviewModel = process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  onStage('claim_extraction');
  const claimPlan = await timedStep('claim_extraction', () => openaiJson({
    model: planningModel,
    schema: claimExtractionJsonSchema,
    temperature: 0.1,
    input: [
      {
        role: 'system',
        content: 'Extract only claims and coverage requirements from the user prompt. Do not research, argue, or decide truth yet. Return JSON only.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Interpret the prompt. Classify whether it is a claim, question, comparison, or mixed. Extract up to 3 concrete claims only if the user actually made claims; otherwise create research questions and coverage requirements.',
          currentDate,
          prompt: input.prompt,
          tone: input.tone,
          rules: [
            'Do not turn a genuine question into a fake claim.',
            'For questions, set expectedVerdictStyle to evidence_summary or insufficient_data.',
            'For comparisons, identify what evidence would fairly compare the subjects.',
            'If the likely answer depends on unavailable public evidence, set answerMode to limited_evidence.'
          ]
        })
      }
    ]
  }), { model: planningModel });

  onStage('research');
  const targets = researchTargets(input, claimPlan);
  const targetResearchResponses = await Promise.all(targets.map((target, index) => {
    const stageType = target.type === 'claim' ? 'claim' : target.type === 'question' ? 'question' : 'target';
    onStage(`searching_${stageType}_${index + 1}`, `Searching ${stageType} ${index + 1} of ${targets.length}: ${target.text.slice(0, 90)}`);
    return timedStep(`research_target_${index + 1}`, () => openai.responses.create({
      model: researchModel,
      tools: [{ type: process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search_preview' }],
      tool_choice: 'auto',
      temperature: 0.25,
      include: ['web_search_call.action.sources'],
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildTargetResearchInput({ input, target, currentDate, existingCategories, claimPlan }) }
      ]
    }), { model: researchModel, targetType: target.type });
  }));

  const researchBriefs = targetResearchResponses.map((response, index) => ({
    target: targets[index],
    brief: response.output_text
  }));
  const compactBriefs = compactResearchBriefs(researchBriefs);
  const responseSources = targetResearchResponses.flatMap((response) => response.output?.flatMap((item) => item.action?.sources || []) || []);
  const normalizedConsultedSources = normalizeSources([], responseSources);
  onStage('source_ingestion');
  const ingestedSources = await timedStep('source_ingestion', () => ingestSources(normalizedConsultedSources, onStage), { sourceCount: normalizedConsultedSources.length });
  const usableSources = verifiedUsableSources(ingestedSources);
  const draftSources = usableSources.length ? usableSources : ingestedSources.filter((source) => !source.verificationNote?.includes('source limit reached')).slice(0, 12);

  onStage('evidence_synthesis');
  onStage('ranking_primary_sources', 'Ranking primary and authoritative sources by relevance, recency, specificity, and authority.');
  const evidencePacket = await timedStep('evidence_synthesis', () => openaiJson({
    model: reviewModel,
    schema: evidencePacketJsonSchema,
    temperature: 0.1,
    input: [
      {
        role: 'system',
        content: 'Build a source-ranked evidence packet. Do not draft prose. Be skeptical, prefer primary sources, include opposing/limiting evidence, and clearly flag insufficient public data.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Synthesize targeted research into a defensible evidence packet for article drafting.',
          currentDate,
          originalRequest: input,
          claimPlan,
          targets,
          researchBriefs: compactBriefs,
          consultedSources: draftSources,
          scoringRules: [
            'Score sources higher when they are primary, specific, recent, authoritative, and directly answer the target.',
            'Score sources higher when sourceTextSample confirms readable page or PDF text was extracted.',
            'Treat verified false, HTTP 404/not found, failed fetches, pages with no readable text, and search-result-only citations as unusable unless no better public evidence exists.',
            'Score broad summaries, generic pages, stale pages, and indirect evidence lower.',
            'Include counterSources or limitations when evidence is mixed, weak, disputed, or not directly responsive.',
            'Do not invent source URLs or source details.'
          ]
        })
      }
    ]
  }), { model: reviewModel, sourceCount: draftSources.length });
  onStage('checking_counterevidence', 'Checking for opposing evidence, limitations, stale data, and missing context before drafting.');

  onStage('drafting');
  const draftArticle = await timedStep('drafting', () => openaiJson({
    model: writingModel,
    schema: articleJsonSchema,
    temperature: 0.2,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Convert the source-ranked evidence packet into the required article JSON. Use only facts supported by the evidence packet, targeted research briefs, and listed sources. Preserve all requested coverage requirements.',
          currentDate,
          freshnessRules: `Use ${currentDate} as the time context. Include an "As of ${currentDate}" framing sentence in the summary or opening body section. Prefer reliable sources from the last 24 months. For fast-moving topics, prioritize 2025-2026 sources. If older data is used, explain why it remains relevant, authoritative, or the latest available.`,
          qualityRules: 'Before returning, self-check for unsupported claims, stale evidence, missing coverage, bad chart fit, loaded wording, unfair framing, citation gaps, and safety risks. Delete or explicitly mark uncertain any idea that cannot be supported by the listed source IDs. Do not rely on a later full-article revision pass.',
          bodyRules: 'Write a substantive article, not a short chart caption. Return 4 to 7 body sections and at least 10 total paragraphs only if the available sources support that much coverage; otherwise return fewer, better-supported paragraphs. Most paragraphs should include evidence, context, caveats, counterpoints, and interpretation. Every body paragraph must include at least one valid sourceIds entry from consultedSources. If a paragraph would have no sourceIds, omit that paragraph. Not every paragraph needs a chart; use chartIds only when a visualization directly supports that paragraph. Do not include a Sources, References, Bibliography, Works Cited, or citation-list section in body. Do not place raw URLs or markdown links in body paragraphs. Put all source details only in the sources array. Use 2 or 3 sourceIds for evidence-heavy, comparison, statistical, or controversial paragraphs when multiple relevant sources exist. Every generated chart must be referenced by at least one paragraph that also has sourceIds.',
          claimRules: 'For claim prompts, extract up to 3 user-made claims. For question/comparison prompts, return up to 3 evidence findings instead of fake claims. Each item must still include claim, verdict, confidenceScore, confidenceLabel, verdictSummary, support, and sourceIds. Use verdict "unsure" when public evidence is insufficient, and explain what was and was not found.',
          chartRules: 'Return 2 to 4 visualizations with stable id values. Each visualization must answer a distinct question and include question, takeaway, units, sourceNote, limitation, note, and data. Do not create orphan charts. If a chart covers military spending, economic comparison, timeline, source mix, or any other topic, the body must contain relevant text and attach that chart id to that paragraph. Use timeline for dated event sequences. Timeline date fields must be human-readable and precision-honest; use labels like "4.5B years ago", "350M years ago", "May 2024", or "2026" rather than fake exact dates. Use metrics for standalone facts or mixed units. Use comparison for side-by-side estimates, claims, people, or categories. Use delta for two-point before/after or first/last changes. Use ranked_bar for ranked lists, long category labels, and ordered comparisons. Use fact_table for legal criteria, definitions, categorical facts, or single facts. Use evidence_matrix for claim-by-claim support, contradiction, uncertainty, source mapping, or argument coverage. Use line or area only for one continuous metric with 3 or more comparable time points. Use bar for discrete comparisons with the same units, scorecard for qualitative evidence/claim support, and pie only for parts of the same whole. Never use zero as a placeholder for unavailable data.',
          categoryRules: 'Choose the best category from existingCategories whenever one reasonably fits. Reuse exact spelling and capitalization. Create a new category only if the existing list has no good fit.',
          requiredShape: articleJsonShape,
          originalRequest: input,
          claimPlan,
          existingCategories,
          evidencePacket,
          targetedResearch: compactBriefs,
          consultedSources: draftSources
        })
      }
    ]
  }), { model: writingModel });

  let generatedRaw = draftArticle;
  const enablePolish = process.env.OPENAI_ENABLE_POLISH_PASS === 'true';
  if (enablePolish) {
    onStage('polish', 'Polishing article structure and source clarity.');
    generatedRaw = await timedStep('polish', () => polishGeneratedArticle({
      writingModel,
      input,
      claimPlan,
      existingCategories,
      currentDate,
      evidencePacket,
      targetedResearch: compactBriefs,
      consultedSources: draftSources,
      article: generatedRaw
    }), { model: writingModel });
  } else {
    recordTiming('polish_skipped', performance.now(), { reason: 'disabled' });
  }

  const enableFullReview = process.env.OPENAI_ENABLE_FULL_REVIEW === 'true';
  if (enableFullReview) {
    onStage('review');
    const articleReview = await timedStep('review', () => openaiJson({
      model: reviewModel,
      schema: reviewJsonSchema,
      temperature: 0.1,
      input: [
        {
          role: 'system',
          content: 'Review the draft as both a skeptical fact-checker and a neutrality/bias editor. Do not rewrite the article. Return concise JSON revision requirements only.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Find unsupported claims, stale evidence, missing coverage, bad chart fit, loaded wording, unfair framing, citation gaps, and safety risks.',
            currentDate,
            originalRequest: input,
            claimPlan,
            evidencePacket,
            targetedResearch: compactBriefs,
            consultedSources: draftSources,
            draftArticle
          })
        }
      ]
    }), { model: reviewModel });

    if (reviewRequiresFullRevision(articleReview)) {
      onStage('revision');
      generatedRaw = await timedStep('revision', () => openaiJson({
        model: writingModel,
        schema: articleJsonSchema,
        temperature: 0.15,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Revise the draft article to satisfy every required review item. Use only the research brief and consulted sources. Preserve the required article JSON shape.',
              currentDate,
              revisionRules: [
                'Resolve or clearly disclose every skeptical fact-check issue.',
                'Resolve neutrality issues without making the article bland.',
                'Remove unsupported claims rather than inventing support.',
                'Keep article text substantial with at least 10 total paragraphs across 4 to 7 sections.',
                'Every paragraph object must include sourceIds. Evidence-bearing paragraphs should include sourceIds for the sources supporting that paragraph. Use 2 or 3 sourceIds for evidence-heavy, comparison, statistical, or controversial paragraphs when multiple relevant sources exist.',
                'Keep chart IDs attached only to paragraphs they directly support.',
                'Do not add sources that were not consulted.'
              ],
              originalRequest: input,
              claimPlan,
              existingCategories,
              evidencePacket,
              targetedResearch: compactBriefs,
              consultedSources: draftSources,
              draftArticle,
              articleReview,
              requiredShape: articleJsonShape
            })
          }
        ]
      }), { model: writingModel });
    } else {
      recordTiming('revision_skipped', performance.now(), { reason: 'review_clear' });
    }
  } else {
    recordTiming('review_skipped', performance.now(), { reason: 'fast_pipeline' });
    recordTiming('revision_skipped', performance.now(), { reason: 'fast_pipeline' });
  }

  let citationAudit = null;
  const configuredRepairAttempts = Number(process.env.OPENAI_CITATION_REPAIR_ATTEMPTS ?? 1);
  const maxCitationRepairAttempts = Number.isFinite(configuredRepairAttempts) ? Math.max(0, Math.floor(configuredRepairAttempts)) : 1;
  for (let attempt = 0; attempt <= maxCitationRepairAttempts; attempt += 1) {
    const rawLoopSources = Array.isArray(generatedRaw.sources) ? generatedRaw.sources : [];
    generatedRaw.sources = normalizeSources(rawLoopSources, draftSources);
    const loopRemap = sourceIdRemap(rawLoopSources, generatedRaw.sources);
    const loopValidIds = new Set(generatedRaw.sources.map((source) => source.id));
    generatedRaw.keyClaims = Array.isArray(generatedRaw.keyClaims)
      ? generatedRaw.keyClaims.map((claim) => ({
        ...claim,
        sourceIds: remapSourceIds(claim.sourceIds, loopRemap, loopValidIds)
      }))
      : [];
    generatedRaw.body = remapBodySourceIds(generatedRaw.body, loopRemap, loopValidIds);
    if (draftSources.length >= 4) {
      generatedRaw = removeUnusableSourcesFromArticle(generatedRaw, draftSources);
    }
    generatedRaw.keyClaims = repairClaimSourceIds(generatedRaw.keyClaims, generatedRaw.sources);
    generatedRaw.body = repairParagraphSourceIds(generatedRaw.body, generatedRaw.sources);
    generatedRaw = enforceParagraphSourceCoverage(generatedRaw);
    onStage('citation_audit');
    citationAudit = await timedStep(`citation_audit_${attempt + 1}`, () => auditGeneratedArticle({
      reviewModel,
      input,
      claimPlan,
      article: generatedRaw,
      consultedSources: draftSources
    }), { model: reviewModel, attempt: attempt + 1 });
    citationAudit = citationAuditWithBodyQuality(citationAudit, generatedRaw);

    const blockingIssues = Array.isArray(citationAudit.blockingIssues) ? citationAudit.blockingIssues : [];
    if (citationAudit.passed || !blockingIssues.length) break;

    if (attempt === maxCitationRepairAttempts) {
      const hardAuditIssues = hardCitationAuditIssues(blockingIssues);
      if (hardAuditIssues.length) {
        throw new Error(`CiteDrop could not create a source-safe draft. ${hardAuditIssues.slice(0, 2).join(' ')}`);
      }
      break;
    }

    onStage(`repair_attempt_${attempt + 1}`, `Repair attempt ${attempt + 1} of ${maxCitationRepairAttempts}: fixing citation gaps or marking unsupported claims as uncertain.`);
    generatedRaw = await timedStep(`citation_repair_${attempt + 1}`, () => repairArticleCitations({
      writingModel,
      input,
      claimPlan,
      existingCategories,
      currentDate,
      researchBrief: compactCitationRepairContext({ evidencePacket, researchBriefs: compactBriefs, citationAudit }),
      consultedSources: draftSources,
      article: generatedRaw,
      citationAudit,
      attempt: attempt + 1
    }), { model: writingModel, attempt: attempt + 1 });
  }

  const generated = normalizeGeneratedArticle(pruneUncitedSources(generatedRaw), input.category || 'Research');
  onStage('saving');
  const article = await timedStep('saving', () => saveGeneratedArticle(generated, userId));

  recordTiming('total', generationStartedAt, {
    targetCount: targets.length,
    sourceCount: normalizedConsultedSources.length,
    usableSourceCount: usableSources.length
  });

  return { article, generated, timings };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(`User-agent: *
Allow: /
Allow: /api/articles/*/og-image
Disallow: /admin
Disallow: /dashboard
Disallow: /login
Disallow: /api/

Sitemap: ${absoluteUrl(req, '/sitemap.xml')}
`);
});

app.get('/sitemap.xml', requireDatabase, async (req, res) => {
  try {
    const { rows } = await query(`
      select slug, created_at, updated_at
      from articles
      where status = 'published'
      order by coalesce(updated_at, created_at) desc
    `);

    const urls = [
      { loc: absoluteUrl(req, '/'), changefreq: 'daily', priority: '1.0' },
      ...rows.map((article) => ({
        loc: absoluteUrl(req, `/articles/${article.slug}`),
        lastmod: new Date(article.updated_at || article.created_at).toISOString(),
        changefreq: 'weekly',
        priority: '0.8'
      }))
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
${url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>
` : ''}    <changefreq>${escapeXml(url.changefreq)}</changefreq>
    <priority>${escapeXml(url.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;

    res.type('application/xml').send(xml);
  } catch (error) {
    console.error(error);
    res.status(500).type('text/plain').send('Unable to build sitemap.');
  }
});

app.get('/fb-health', (_req, res) => {
  res
    .type('html')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CiteDrop Facebook Health Check</title>
    <meta name="description" content="Static crawler health check for CiteDrop." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="CiteDrop Facebook Health Check" />
    <meta property="og:description" content="Static crawler health check for CiteDrop." />
    <meta property="og:url" content="https://www.citedrop.com/fb-health" />
    <meta property="og:image" content="https://www.citedrop.com/og-home-2026-05-17.png" />
    <meta property="og:image:secure_url" content="https://www.citedrop.com/og-home-2026-05-17.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
  </head>
  <body>ok</body>
</html>`);
});

if (!isProduction) {
  app.get('/', (_req, res) => {
    res
      .type('html')
      .send('<p>Proofer API is running. Open the frontend at <a href="http://localhost:5173">http://localhost:5173</a>.</p>');
  });

  app.get('/api/debug/config', (_req, res) => {
    res.json({
      app: 'proofer-api',
      clerkConfigured: Boolean(process.env.CLERK_SECRET_KEY),
      clerkPublishableKeyConfigured: Boolean(clerkPublishableKey),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      bootstrapAdminCount: String(process.env.CLERK_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean).length
    });
  });

  app.get('/api/debug/generation-jobs', (_req, res) => {
    res.json({
      jobs: [...generationJobs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20)
        .map((job) => ({
          id: job.id,
          userId: job.userId,
          status: job.status,
          stage: job.stage,
          stageLabel: job.stageLabel,
          timings: job.timings || [],
          error: job.error,
          createdAt: job.createdAt
        }))
    });
  });
}

app.get('/api/auth/session', requireDatabase, async (req, res) => {
  const user = await getUserFromRequest(req);
  res.json({ signedIn: Boolean(user), user });
});

app.get('/api/auth/me', requireDatabase, requireUser, currentUser);

app.patch('/api/roles/:clerkUserId', requireDatabase, requireUser, requireAdmin, async (req, res) => {
  const parsed = rolePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid role update.', details: parsed.error.flatten() });
    return;
  }

  try {
    const { rows } = await query(
      `insert into content_roles (clerk_user_id, role)
       values ($1, $2)
       on conflict (clerk_user_id)
       do update set role = excluded.role, updated_at = now()
       returning *`,
      [req.params.clerkUserId, parsed.data.role]
    );
    res.json({ role: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update role.' });
  }
});

app.post('/api/generate-article', requireDatabase, async (req, res) => {
  if (!openai) {
    res.status(503).json({ error: 'OpenAI is not configured. Set OPENAI_API_KEY.' });
    return;
  }

  const parsed = generationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid generation request.', details: parsed.error.flatten() });
    return;
  }

  const user = await getUserFromRequest(req);
  if (user) await claimAnonymousArticles(req, res, user);
  const anonymousToken = user ? '' : anonymousTokenFromRequest(req, res);
  let reservedAnonymousGeneration = false;
  if (!user) {
    const usage = anonymousUsage(req, anonymousToken);
    const savedAnonymousArticles = await anonymousArticleCount(anonymousToken);
    if (Math.max(usage.count, savedAnonymousArticles) >= anonymousGenerationLimit) {
      res.status(403).json({ error: 'Create a free account to keep generating and save your articles.' });
      return;
    }
    recordAnonymousGeneration(req, anonymousToken);
    reservedAnonymousGeneration = true;
  }

  const ownerId = user?.id || `anonymous:${anonymousToken}`;
  const jobId = randomUUID();
  generationJobs.set(jobId, {
    id: jobId,
    userId: ownerId,
    anonymousToken,
    status: 'queued',
    stage: 'queued',
    stageLabel: generationStages.queued,
    timings: [],
    article: null,
    error: '',
    createdAt: Date.now()
  });
  res.status(202).json({ jobId });

  try {
    const setStage = (stage, label = '') => {
      generationJobs.set(jobId, {
        ...generationJobs.get(jobId),
        status: 'running',
        stage,
        stageLabel: label || stageLabel(stage, generationStages.queued)
      });
    };
    const setTimings = (timings) => {
      generationJobs.set(jobId, {
        ...generationJobs.get(jobId),
        timings
      });
    };
    setStage('claim_extraction');
    const { article, timings } = await performArticleGeneration(parsed.data, ownerId, setStage, setTimings);
    console.info('[article-generation-timings]', JSON.stringify({
      jobId,
      userId: ownerId,
      timings
    }));
    generationJobs.set(jobId, {
      ...generationJobs.get(jobId),
      status: 'completed',
      stage: 'completed',
      stageLabel: generationStages.completed,
      timings,
      article
    });
    await sendArticleReadyEmail({ userId: ownerId, article, prompt: parsed.data.prompt });
  } catch (error) {
    if (reservedAnonymousGeneration) releaseAnonymousGeneration(req, anonymousToken);
    const failedJob = generationJobs.get(jobId);
    console.info('[article-generation-timings]', JSON.stringify({
      jobId,
      userId: ownerId,
      status: 'failed',
      stage: failedJob?.stage,
      timings: failedJob?.timings || []
    }));
    console.error(error);
    generationJobs.set(jobId, {
      ...generationJobs.get(jobId),
      status: 'failed',
      stage: 'failed',
      stageLabel: generationStages.failed,
      error: publicGenerationError(error)
    });
  }
});

app.post('/api/articles/:id/regenerate', requireDatabase, requireUser, requireAdmin, async (req, res) => {
  if (!openai) {
    res.status(503).json({ error: 'OpenAI is not configured. Set OPENAI_API_KEY.' });
    return;
  }

  const { rows } = await query('select * from articles where id = $1 limit 1', [req.params.id]);
  const currentArticle = rows[0];
  if (!currentArticle || currentArticle.status === 'deleted') {
    res.status(404).json({ error: 'Article not found.' });
    return;
  }

  const currentBody = Array.isArray(currentArticle.body)
    ? currentArticle.body.map((section) => `${section.heading}: ${(section.paragraphs || []).map((paragraph) => paragraph.text || paragraph).join(' ')}`).join('\n\n')
    : '';
  const input = {
    prompt: [
      `Regenerate and improve this existing CiteDrop article while preserving the core topic.`,
      `Title: ${currentArticle.title}`,
      currentArticle.subtitle ? `Subtitle: ${currentArticle.subtitle}` : '',
      currentArticle.summary ? `Current summary: ${currentArticle.summary}` : '',
      currentBody ? `Current body context:\n${currentBody.slice(0, 5000)}` : '',
      `Requirements: produce a source-controlled replacement article with stronger sourcing, source-backed paragraphs only, no unsupported claims, and no midstream opening.`
    ].filter(Boolean).join('\n\n'),
    tone: 'Professional and evidence-focused',
    category: currentArticle.category || 'Research',
    sourceUrls: Array.isArray(currentArticle.sources_json)
      ? currentArticle.sources_json.map((source) => source.url).filter(Boolean).slice(0, 12)
      : []
  };

  const jobId = randomUUID();
  const ownerId = req.user.id;
  generationJobs.set(jobId, {
    id: jobId,
    userId: ownerId,
    anonymousToken: '',
    status: 'queued',
    stage: 'queued',
    stageLabel: generationStages.queued,
    timings: [],
    article: null,
    error: '',
    regenerateArticleId: currentArticle.id,
    createdAt: Date.now()
  });
  res.status(202).json({ jobId });

  try {
    const setStage = (stage, label = '') => {
      generationJobs.set(jobId, {
        ...generationJobs.get(jobId),
        status: 'running',
        stage,
        stageLabel: label || stageLabel(stage, generationStages.queued)
      });
    };
    const setTimings = (timings) => {
      generationJobs.set(jobId, {
        ...generationJobs.get(jobId),
        timings
      });
    };

    setStage('claim_extraction');
    const { article: updatedArticle, timings } = await performArticleGeneration(
      input,
      ownerId,
      setStage,
      setTimings,
      (generated) => updateGeneratedArticle(currentArticle.id, generated, ownerId, currentArticle)
    );
    console.info('[article-generation-timings]', JSON.stringify({
      jobId,
      userId: ownerId,
      regenerateArticleId: currentArticle.id,
      timings
    }));
    generationJobs.set(jobId, {
      ...generationJobs.get(jobId),
      status: 'completed',
      stage: 'completed',
      stageLabel: generationStages.completed,
      timings,
      article: updatedArticle
    });
  } catch (error) {
    const failedJob = generationJobs.get(jobId);
    console.info('[article-generation-timings]', JSON.stringify({
      jobId,
      userId: ownerId,
      regenerateArticleId: currentArticle.id,
      status: 'failed',
      stage: failedJob?.stage,
      timings: failedJob?.timings || []
    }));
    console.error(error);
    generationJobs.set(jobId, {
      ...generationJobs.get(jobId),
      status: 'failed',
      stage: 'failed',
      stageLabel: generationStages.failed,
      error: publicGenerationError(error)
    });
  }
});

app.get('/api/generation-jobs/:id', requireDatabase, async (req, res) => {
  const job = generationJobs.get(req.params.id);
  const user = await getUserFromRequest(req);
  const anonymousToken = anonymousTokenFromRequest(req, res);
  const canView = user?.id === job?.userId || (!user && job?.anonymousToken === anonymousToken);
  if (!job || !canView) {
    res.status(404).json({ error: 'Generation job not found.' });
    return;
  }
  res.json({
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      stageLabel: job.stageLabel,
      timings: job.timings || [],
      article: job.article,
      error: job.error
    }
  });
});

app.get('/api/articles', requireDatabase, async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 12, 1), 50);
  const offset = (page - 1) * pageSize;
  const search = String(req.query.search || '').trim();
  const category = String(req.query.category || '').trim();
  const user = await getUserFromRequest(req);
  if (user) await claimAnonymousArticles(req, res, user);
  const anonymousToken = anonymousTokenFromRequest(req, res);
  const anonymousOwner = `anonymous:${anonymousToken}`;
  const includeDrafts = req.query.includeDrafts === 'true' && Boolean(user || anonymousToken);
  const ownOnly = includeDrafts && (!user || req.query.mine === 'true' || user?.role !== 'admin' || req.query.scope !== 'all');
  const adminAllArticles = includeDrafts && user?.role === 'admin' && req.query.scope === 'all' && !ownOnly;

  const visibilityFilters = [];
  const visibilityValues = [];
  if (!includeDrafts) {
    visibilityValues.push('published');
    visibilityFilters.push(`status = $${visibilityValues.length}`);
  } else if (ownOnly) {
    visibilityValues.push(user?.id || anonymousOwner);
    visibilityFilters.push(`created_by = $${visibilityValues.length}`);
    visibilityFilters.push(`status <> 'deleted'`);
  }

  const filters = [...visibilityFilters];
  const values = [...visibilityValues];
  const categoryFilters = [...visibilityFilters, `nullif(trim(category), '') is not null`];
  const categoryWhere = categoryFilters.length ? `where ${categoryFilters.join(' and ')}` : '';

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(title ilike $${values.length} or summary ilike $${values.length} or category ilike $${values.length})`);
  }
  if (category) {
    values.push(category);
    filters.push(`category = $${values.length}`);
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : '';

  try {
    const countResult = await query(`select count(*)::int as count from articles ${where}`, values);
    const categoriesResult = await query(
      `select distinct category from articles ${categoryWhere} order by category asc`,
      visibilityValues
    );
    const articlesResult = await query(
      `select * from articles ${where} order by created_at desc limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, pageSize, offset]
    );
    const articles = adminAllArticles
      ? await attachCreatorEmails(articlesResult.rows)
      : articlesResult.rows;
    res.json({
      articles,
      count: countResult.rows[0]?.count || 0,
      categories: categoriesResult.rows.map((row) => row.category)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load articles.' });
  }
});

app.get('/api/articles/:slug', requireDatabase, async (req, res) => {
  const user = await getUserFromRequest(req);
  const anonymousToken = anonymousTokenFromRequest(req, res);
  const anonymousOwner = `anonymous:${anonymousToken}`;
  try {
    const { rows } = await query('select * from articles where slug = $1 limit 1', [req.params.slug]);
    const article = rows[0];
    const canPreviewDraft = article?.status !== 'deleted' && (
      (user && (user.role === 'admin' || article?.created_by === user.id)) ||
      (!user && article?.created_by === anonymousOwner)
    );
    const canViewDeleted = user?.role === 'admin' && article?.status === 'deleted';
    if (!article || (article.status !== 'published' && !canPreviewDraft && !canViewDeleted)) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }
    res.json({ article });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load article.' });
  }
});

app.get('/api/articles/:slug/og-image', requireDatabase, async (req, res) => {
  try {
    const article = await findPublishedArticleBySlug(req.params.slug);
    if (!article) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }
    const png = await renderArticleOgImage(article);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    res.send(png);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to render Open Graph image.' });
  }
});

async function updateArticleById(req, res) {
  const parsed = articlePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid update.', details: parsed.error.flatten() });
    return;
  }

  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    values.push(value);
    updates.push(`${key} = $${values.length}`);
    if (key === 'title') {
      values.push(slugify(value, { lower: true, strict: true }).slice(0, 140));
      updates.push(`slug = $${values.length}`);
    }
  }
  values.push(new Date().toISOString());
  updates.push(`updated_at = $${values.length}`);
  values.push(req.params.id);

  try {
    const { rows } = await query(
      `update articles set ${updates.join(', ')} where id = $${values.length} returning *`,
      values
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }
    const article = await postPublishedArticleToFacebook(rows[0]);
    res.json({ article });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update article.' });
  }
}

app.patch('/api/articles/:id', requireDatabase, requireUser, async (req, res) => {
  if (req.user.role === 'admin') {
    await updateArticleById(req, res);
    return;
  }

  const parsed = ownerArticlePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Only draft/published status changes are allowed for your own articles.', details: parsed.error.flatten() });
    return;
  }

  try {
    const { rows } = await query(
      `update articles
       set status = $1, updated_at = now()
       where id = $2 and created_by = $3
       returning *`,
      [parsed.data.status, req.params.id, req.user.id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }
    const article = await postPublishedArticleToFacebook(rows[0]);
    res.json({ article });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update article.' });
  }
});

app.delete('/api/articles/:id', requireDatabase, requireUser, async (req, res) => {
  try {
    const values = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id];
    const where = req.user.role === 'admin' ? 'id = $1' : 'id = $1 and created_by = $2';
    const { rows } = await query(
      `update articles
       set status = 'deleted', updated_at = now()
       where ${where}
       returning id`,
      values
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to delete article.' });
  }
});

if (isProduction) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders(res, assetPath) {
      if (assetPath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.get('/', async (req, res) => {
    try {
      const html = await fs.promises.readFile(path.join(distPath, 'index.html'), 'utf8');
      res.type('html').send(await injectHomeMeta(html, req));
    } catch (error) {
      console.error(error);
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
  app.get('/articles/:slug', async (req, res) => {
    try {
      const html = await fs.promises.readFile(path.join(distPath, 'index.html'), 'utf8');
      const article = await findPublishedArticleBySlug(req.params.slug);
      res.type('html').send(article ? injectArticleMeta(html, article, req) : html);
    } catch (error) {
      console.error(error);
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Proofer server listening on ${port}`);
});
