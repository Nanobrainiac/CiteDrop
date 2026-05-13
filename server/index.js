import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import slugify from 'slugify';
import { z } from 'zod';
import { clerkMiddleware } from '@clerk/express';
import { query, requireDatabase } from './db.js';
import { currentUser, getUserFromRequest, requireAdmin, requireUser } from './auth.js';
import { renderArticleOgImage } from './og.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: isProduction ? false : true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
if (process.env.CLERK_SECRET_KEY && clerkPublishableKey) {
  app.use(clerkMiddleware({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: clerkPublishableKey
  }));
}

const generationSchema = z.object({
  prompt: z.string().min(20).max(4000),
  topic: z.string().min(2).max(120),
  position: z.string().max(500).optional().default(''),
  tone: z.string().min(2).max(80).default('Professional and persuasive'),
  category: z.string().min(2).max(80).default('Research'),
  visualizations: z.array(z.string().max(80)).max(5).optional().default([]),
  sourceUrls: z.array(z.string().url()).max(12).optional().default([])
});

const articlePatchSchema = z.object({
  title: z.string().min(3).max(180).optional(),
  category: z.string().min(2).max(80).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional()
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
- Use at least 4 source items when available. Do not use a publisher homepage as a source unless the homepage itself is the evidence.
- Sources must be specific pages, reports, datasets, court records, government pages, speeches, press releases, articles, or studies.
- Do not fabricate citations, statistics, institutions, authors, URLs, titles, or publication details.
- If a requested coverage point cannot be supported by sources, include it as a limitation instead of skipping or inventing facts.
- If the user requests multiple periods, entities, terms, or comparisons, cover each one explicitly.
- Separate factual claims from analysis or opinion.
- Avoid defamatory, harassing, or demeaning language about private people or protected groups.
- Prefer careful, measured persuasion over inflammatory rhetoric.
- Sources must include title, publisher, url, date when known, and note explaining the exact claim(s) it supports.
- Article body must be an array of sections with heading and paragraphs.
- Always include at least one chart. Charts must use simple JSON renderable as bar, line, area, or pie charts.
- Prefer sourced quantitative data. If quantitative data is unavailable, create a qualitative evidence-coverage chart and clearly label it as qualitative or illustrative in the note.
- Never cite a URL that was not actually consulted.`;

const articleJsonShape = {
  title: 'Specific article title',
  slug: 'url-safe-slug',
  subtitle: 'One-sentence subtitle',
  summary: 'Short public card summary',
  category: 'Category',
  body: [
    { heading: 'Section heading', paragraphs: ['Paragraph text'] }
  ],
  keyClaims: [
    { claim: 'Claim text', type: 'fact|analysis|opinion', confidence: 'high|medium|low', support: 'Why this is supported or what is uncertain' }
  ],
  charts: [
    {
      title: 'Chart title',
      type: 'bar',
      note: 'What the chart shows and whether data is sourced or illustrative',
      data: [{ label: 'A', value: 10 }]
    }
  ],
  sources: [
    { title: 'Source title', publisher: 'Publisher', url: 'https://example.com/specific-page', date: 'YYYY-MM-DD when known', note: 'Specific claim(s) this supports' }
  ]
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function absoluteUrl(req, pathname) {
  const configured = process.env.PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (configured) return `${configured}${pathname}`;
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return `${protocol}://${req.get('host')}${pathname}`;
}

async function findPublishedArticleBySlug(slug) {
  const { rows } = await query('select * from articles where slug = $1 and status = $2 limit 1', [slug, 'published']);
  return rows[0] || null;
}

function injectArticleMeta(html, article, req) {
  const version = encodeURIComponent(article.updated_at || article.created_at || Date.now());
  const articleUrl = absoluteUrl(req, `/articles/${article.slug}`);
  const imageUrl = absoluteUrl(req, `/api/articles/${article.slug}/og-image?v=${version}`);
  const title = `${article.title} | CiteDrop`;
  const description = article.summary || article.subtitle || 'Evidence-backed AI research article.';
  const meta = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(article.title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(articleUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(article.title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `;
  return html
    .replace(/<title>.*?<\/title>/, '')
    .replace(/<meta name="description" content=".*?" \/>/, '')
    .replace('</head>', `${meta}\n  </head>`);
}

function injectHomeMeta(html, req) {
  const imageUrl = absoluteUrl(req, '/og-home.png');
  const siteUrl = absoluteUrl(req, '/');
  const meta = `
    <meta property="og:url" content="${escapeHtml(siteUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `;
  return html
    .replace(/<meta property="og:image" content=".*?" \/>/, '')
    .replace(/<meta name="twitter:image" content=".*?" \/>/, '')
    .replace('</head>', `${meta}\n  </head>`);
}

function buildGenerationInput(input) {
  return JSON.stringify({
    task: 'Research the topic using web search and return a source-grounded research brief.',
    sourceQualityRequirements: [
      'Search for and use multiple specific source pages.',
      'Do not cite generic homepages when a specific article/report/page is needed.',
      'Before writing, identify the core coverage requirements in the user prompt and ensure each is addressed explicitly.',
      'If the prompt asks for first and second terms, cover first and second terms in separate sections or a direct comparison.',
      'Every key claim must identify source support or uncertainty.',
      'Return at least one chart. If no sourced numerical dataset is found, return a qualitative evidence-coverage chart with labels and numeric scores.'
    ],
    ...input
  });
}

function normalizeSources(articleSources = [], responseSources = []) {
  const byUrl = new Map();
  for (const source of articleSources) {
    if (!source?.url && !source?.title) continue;
    byUrl.set(source.url || source.title, source);
  }
  for (const source of responseSources) {
    if (!source?.url) continue;
    if (!byUrl.has(source.url)) {
      byUrl.set(source.url, {
        title: source.title || source.url,
        publisher: source.source || '',
        url: source.url,
        date: source.published_at || '',
        note: 'Consulted during web search.'
      });
    }
  }
  return [...byUrl.values()];
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
            paragraphs: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      keyClaims: {
        type: 'array',
        minItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claim', 'type', 'confidence', 'support'],
          properties: {
            claim: { type: 'string' },
            type: { type: 'string', enum: ['fact', 'analysis', 'opinion'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            support: { type: 'string' }
          }
        }
      },
      charts: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'type', 'note', 'data'],
          properties: {
            title: { type: 'string' },
            type: { type: 'string', enum: ['bar', 'line', 'area', 'pie'] },
            note: { type: 'string' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: { type: ['string', 'number'] },
                required: ['label'],
                properties: {
                  label: { type: 'string' }
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
          required: ['title', 'publisher', 'url', 'date', 'note'],
          properties: {
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
  return {
    title,
    slug: slugify(rawSlug, { lower: true, strict: true }).slice(0, 140) || `article-${Date.now()}`,
    subtitle: String(article.subtitle || '').slice(0, 240),
    summary: String(article.summary || '').slice(0, 700),
    category: String(article.category || fallbackCategory || 'Research').slice(0, 80),
    body: Array.isArray(article.body) ? article.body : [],
    keyClaims: Array.isArray(article.keyClaims) ? article.keyClaims : [],
    charts: Array.isArray(article.charts) ? article.charts : [],
    sources: Array.isArray(article.sources) ? article.sources : []
  };
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
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
}

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

app.post('/api/generate-article', requireDatabase, requireUser, async (req, res) => {
  if (!openai) {
    res.status(503).json({ error: 'OpenAI is not configured. Set OPENAI_API_KEY.' });
    return;
  }

  const parsed = generationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid generation request.', details: parsed.error.flatten() });
    return;
  }

  try {
    const input = parsed.data;
    const researchResponse = await openai.responses.create({
      model: process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      tools: [{ type: process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search_preview' }],
      tool_choice: 'auto',
      temperature: 0.35,
      include: ['web_search_call.action.sources'],
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildGenerationInput(input) }
      ]
    });

    const responseSources = researchResponse.output?.flatMap((item) => item.action?.sources || []) || [];
    const draftingResponse = await openai.responses.create({
      model: process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      text: {
        format: {
          type: 'json_schema',
          ...articleJsonSchema
        }
      },
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Convert this source-grounded research brief into the required article JSON. Use only facts supported by the research brief and listed sources. Preserve all requested coverage requirements.',
            requiredShape: articleJsonShape,
            originalRequest: input,
            researchBrief: researchResponse.output_text,
            consultedSources: responseSources
          })
        }
      ]
    });

    const generatedRaw = JSON.parse(draftingResponse.output_text || '{}');
    generatedRaw.sources = normalizeSources(generatedRaw.sources, responseSources);
    const generated = normalizeGeneratedArticle(generatedRaw, input.category);
    const insertPayload = {
      title: generated.title,
      slug: uniqueSlug(generated.slug),
      subtitle: generated.subtitle,
      summary: generated.summary,
      category: generated.category,
      status: 'draft',
      body: generated.body,
      claims_json: generated.keyClaims,
      charts_json: generated.charts,
      sources_json: generated.sources,
      created_by: req.user.id
    };

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
        req.user.id
      ]
    );

    res.status(201).json({ article: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(error?.status && error.status >= 400 && error.status < 500 ? error.status : 500).json({
      error: publicGenerationError(error)
    });
  }
});

app.get('/api/articles', requireDatabase, async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 12, 1), 50);
  const offset = (page - 1) * pageSize;
  const search = String(req.query.search || '').trim();
  const category = String(req.query.category || '').trim();
  const user = await getUserFromRequest(req);
  const includeDrafts = req.query.includeDrafts === 'true' && Boolean(user);
  const ownOnly = includeDrafts && (req.query.mine === 'true' || user?.role !== 'admin' || req.query.scope !== 'all');

  const filters = [];
  const values = [];
  if (!includeDrafts) {
    values.push('published');
    filters.push(`status = $${values.length}`);
  } else if (ownOnly) {
    values.push(user.id);
    filters.push(`created_by = $${values.length}`);
  }
  if (category) {
    values.push(category);
    filters.push(`category = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(title ilike $${values.length} or summary ilike $${values.length} or category ilike $${values.length})`);
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : '';

  try {
    const countResult = await query(`select count(*)::int as count from articles ${where}`, values);
    const articlesResult = await query(
      `select * from articles ${where} order by created_at desc limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, pageSize, offset]
    );
    res.json({ articles: articlesResult.rows, count: countResult.rows[0]?.count || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load articles.' });
  }
});

app.get('/api/articles/:slug', requireDatabase, async (req, res) => {
  const user = await getUserFromRequest(req);
  try {
    const { rows } = await query('select * from articles where slug = $1 limit 1', [req.params.slug]);
    const article = rows[0];
    const canPreviewDraft = user && (user.role === 'admin' || article?.created_by === user.id);
    if (!article || (article.status !== 'published' && !canPreviewDraft)) {
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
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
    res.json({ article: rows[0] });
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
    res.json({ article: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update article.' });
  }
});

app.delete('/api/articles/:id', requireDatabase, requireUser, async (req, res) => {
  try {
    const values = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id];
    const where = req.user.role === 'admin' ? 'id = $1' : 'id = $1 and created_by = $2';
    const result = await query(`delete from articles where ${where}`, values);
    if (result.rowCount === 0) {
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
  app.use(express.static(distPath));
  app.get('/', async (req, res) => {
    try {
      const html = await fs.promises.readFile(path.join(distPath, 'index.html'), 'utf8');
      res.type('html').send(injectHomeMeta(html, req));
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
