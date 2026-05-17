import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import slugify from 'slugify';
import { z } from 'zod';
import { clerkMiddleware } from '@clerk/express';
import { query, requireDatabase } from './db.js';
import { currentUser, getUserFromRequest, requireAdmin, requireUser } from './auth.js';
import { ogImageVersion, renderArticleOgImage } from './og.js';

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
  research: 'Gathering sources',
  drafting: 'Writing the first draft',
  review: 'Running fact-check and bias review',
  revision: 'Revising the article',
  citation_audit: 'Auditing citations',
  citation_repair: 'Repairing citation issues',
  saving: 'Saving draft',
  completed: 'Draft ready',
  failed: 'Generation failed'
};

app.enable('trust proxy');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: isProduction ? false : true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
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
- Use the provided currentDate as the article's time context. Include an "As of [currentDate]" sentence in the summary or opening body section.
- Prefer sources from the last 24 months when reliable sources are available.
- For fast-moving topics such as politics, technology, war, markets, law, elections, public figures, companies, or current policy, prioritize sources from 2025-2026.
- If older data is used, explain why it is still relevant, authoritative, or the latest available.
- Use at least 4 source items when available. Do not use a publisher homepage as a source unless the homepage itself is the evidence.
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
- Article body must be an array of sections with heading and paragraphs. Each paragraph must be an object with text and chartIds.
- Write substantial article text. Return 3 to 6 body sections and at least 7 total paragraphs.
- Each body paragraph should usually be 90 to 160 words. Short transition paragraphs are allowed, but most paragraphs need specific evidence, context, caveats, and interpretation.
- Not every paragraph needs a chart. Use chartIds only when a visualization directly supports that paragraph.
- For each checked claim, include enough body text to explain what is supported, what is not supported, and what reasonable caveats remain.
- Do not put source lists, reference lists, bibliography sections, raw URLs, markdown links, or citation dumps in the article body. Put every source only in the sources array.
- Body paragraphs may mention source names naturally, but source URLs belong only in the sources array.
- Place chart IDs in the chartIds array immediately after paragraphs they help explain. Leave chartIds empty when no chart belongs after that paragraph.
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

const articleJsonShape = {
  title: 'Specific article title',
  slug: 'url-safe-slug',
  subtitle: 'One-sentence subtitle',
  summary: 'Short public card summary',
  category: 'Category',
  body: [
    { heading: 'Section heading', paragraphs: [{ text: 'Paragraph text', chartIds: ['chart-id-when-relevant'] }] }
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
  const version = Date.parse(article.updated_at || article.created_at) || Date.now();
  const articleUrl = absoluteUrl(req, `/articles/${article.slug}`);
  const imageUrl = absoluteUrl(req, `/api/articles/${article.slug}/og-image?v=${ogImageVersion}-${version}`);
  const title = `${article.title} | CiteDrop`;
  const description = article.summary || article.subtitle || 'Evidence-backed AI research article.';
  const meta = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(article.title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(articleUrl)}" />
    <meta property="og:site_name" content="CiteDrop" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
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

  return cleanedHtml
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
  const imageUrl = absoluteUrl(req, '/og-home.png');
  const siteUrl = absoluteUrl(req, '/');
  const meta = `
    <meta property="og:url" content="${escapeHtml(siteUrl)}" />
    <meta property="og:site_name" content="CiteDrop" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `;
  const snapshot = await homeSnapshotData();
  const dataScript = `<script>window.__CITEDROP_HOME__=${safeJson(snapshot)};</script>`;
  return stripMetaTags(html, ['og:url', 'og:site_name', 'og:image', 'twitter:image'])
    .replace('<div id="root"></div>', `<div id="root">${renderHomeSnapshot(snapshot.articles)}</div>`)
    .replace('</head>', `${meta}\n    ${dataScript}\n  </head>`);
}

function buildGenerationInput(input, existingCategories = [], claimPlan = null) {
  const currentDate = currentDateString();
  return JSON.stringify({
    task: 'Research the user question using web search and return a source-grounded research brief.',
    userQuestion: input.prompt,
    requestedTone: input.tone,
    currentDate,
    existingCategories,
    promptType: claimPlan?.promptType || 'mixed',
    answerMode: claimPlan?.answerMode || 'fact_check',
    expectedVerdictStyle: claimPlan?.expectedVerdictStyle || 'claim_verdict',
    extractedClaims: claimPlan?.claims || [],
    coverageRequirements: claimPlan?.coverageRequirements || [],
    researchQuestions: claimPlan?.researchQuestions || [],
    inferenceRequirements: [
      'If the user asked a question rather than making a claim, answer the research question directly instead of forcing a true/false verdict.',
      'If the available public evidence is limited, create a limited-evidence draft explaining what was found, what was not found, and what would be needed for a stronger determination.',
      'Infer the best category from the question. Prefer an existing category if it reasonably fits.',
      'Only create a new category if none of the existingCategories fit the article topic.',
      'Infer the useful chart count and chart types from the evidence.',
      'Do not use an intended position unless the user clearly asks for a one-sided argument. Prefer evidence-led framing.'
    ],
    sourceQualityRequirements: [
      'Search for and use multiple specific source pages.',
      `Use ${currentDate} as the current date for freshness decisions and "as of" framing.`,
      'Prefer reliable sources from the last 24 months when available.',
      'For fast-moving topics, prioritize sources from 2025-2026.',
      'If older data is used, explain whether it is the latest available, authoritative historical context, or still relevant despite age.',
      'Do not cite generic homepages when a specific article/report/page is needed.',
      'Before writing, identify the core coverage requirements in the user prompt and ensure each is addressed explicitly.',
      'Extract up to 3 concrete claims only when the user actually makes claims. For questions, produce evidence findings tied to the research questions.',
      'If the prompt asks for first and second terms, cover first and second terms in separate sections or a direct comparison.',
      'Every key claim must identify source support or uncertainty.',
      'The final article should have 3 to 6 body sections and at least 7 total paragraphs. Most paragraphs should be 90 to 160 words and should provide evidence, context, caveats, and interpretation.',
      'Not every paragraph should have a chart. Charts are supporting evidence, not the article structure.',
      'Return 2 to 4 useful visualizations. Prefer one timeline when the topic has important dated events, one comparison when comparable data exists, one evidence/claim support scorecard, and one source mix or argument coverage chart when useful.',
      'Every visualization must correspond to article text. Do not return a visualization unless the article body includes a paragraph whose chartIds references that visualization id.',
      'Use line or area only for a continuous metric with 3 or more comparable time points.',
      'Use delta instead of line or area for two-point before/after, first/last, or changed-from-to comparisons.',
      'Use ranked_bar for ranked lists, long category labels, and ordered comparisons.',
      'Use fact_table for legal criteria, definitions, categorical facts, and single facts that should not be forced into a chart.',
      'Use evidence_matrix for claim-by-claim support, contradiction, uncertainty, source mapping, or argument coverage.',
      'Use timeline for sequences of events, metrics for standalone facts or mixed units, comparison for side-by-side estimates or categories, and scorecard for qualitative evidence maps.',
      'Timeline date fields must be human-readable and precision-honest; use labels like "4.5B years ago", "350M years ago", "May 2024", or "2026" rather than fake exact dates.',
      'Do not use zero as a placeholder for unavailable data.',
      'If no sourced numerical dataset is found, return qualitative evidence maps with labels and numeric scores, and clearly mark them as qualitative.'
    ],
    sourceUrls: input.sourceUrls
  });
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
  return [...byUrl.values()];
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
      sourceIds: validIds.length ? validIds : sourceIds.slice(0, Math.min(3, sourceIds.length))
    };
  });
}

function hardCitationAuditIssues(issues = []) {
  const hardFailurePattern = /(fabricat|invent|not actually consulted|no sources?|zero sources?|homepage-only|body text.*url|url\/citation dumps?|raw urls?)/i;
  return issues.filter((issue) => hardFailurePattern.test(String(issue || '')));
}

async function auditGeneratedArticle({ reviewModel, input, claimPlan, article, consultedSources }) {
  return openaiJson({
    model: reviewModel,
    schema: citationAuditJsonSchema,
    temperature: 0,
    input: [
      {
        role: 'system',
        content: 'Audit citations before draft save. Fail for factual claims with no relevant source support or no clear uncertainty/insufficient-evidence label, fabricated citations, sources that were not actually consulted, no usable sources, homepage-only citations where a specific page is required, or body text containing URL/citation dumps. Treat source specificity gaps and claims needing better pinpoint citation as warnings only when the article already has relevant source support. Do not fail for sourceIds; the server validates and repairs sourceIds before this audit.'
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
            'For every unsupported factual claim or unanswered research question, either attach relevant existing source support, remove the claim, soften it, or explicitly state that available public evidence is insufficient to make a determination.',
            'Do not invent new sources, URLs, statistics, quotes, or source metadata.',
            'Use only the research brief and consulted sources.',
            'If there is not enough public data, save a useful limited-evidence draft: explain what was found, what was not found, and what evidence would be needed for a stronger determination.',
            'Keep sources only in the sources array. Do not place raw URLs, citation dumps, references sections, or markdown links in body text.',
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
                required: ['text', 'chartIds'],
                properties: {
                  text: { type: 'string' },
                  chartIds: { type: 'array', items: { type: 'string' } }
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
  return {
    title,
    slug: slugify(rawSlug, { lower: true, strict: true }).slice(0, 140) || `article-${Date.now()}`,
    subtitle: String(article.subtitle || '').slice(0, 240),
    summary: String(article.summary || '').slice(0, 700),
    category,
    body: attachOrphanCharts(body, charts),
    keyClaims: Array.isArray(article.keyClaims) ? article.keyClaims.slice(0, 3) : [],
    charts,
    sources: normalizeSources(Array.isArray(article.sources) ? article.sources : [])
  };
}

function attachOrphanCharts(body, charts) {
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
      heading: 'Additional Evidence',
      paragraphs: orphanCharts.map((chart) => ({
        text: chart.takeaway || chart.note || `${chart.title} adds context to the report.`,
        chartIds: [chart.id]
      }))
    }
  ];
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
              return String(paragraph || '').replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim();
            }
            return {
              text: String(paragraph?.text || '').replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim(),
              chartIds: Array.isArray(paragraph?.chartIds) ? paragraph.chartIds.map(String).filter(Boolean) : []
            };
          })
          .filter((paragraph) => typeof paragraph === 'string' ? Boolean(paragraph) : Boolean(paragraph.text))
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

async function performArticleGeneration(input, userId, onStage = () => {}) {
  const existingCategories = await listExistingCategories();
  const currentDate = currentDateString();
  const planningModel = process.env.OPENAI_PLANNING_MODEL || process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const researchModel = process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const writingModel = process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const reviewModel = process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_JSON_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  onStage('claim_extraction');
  const claimPlan = await openaiJson({
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
  });

  onStage('research');
  const researchResponse = await openai.responses.create({
    model: researchModel,
    tools: [{ type: process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search_preview' }],
    tool_choice: 'auto',
    temperature: 0.35,
    include: ['web_search_call.action.sources'],
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildGenerationInput(input, existingCategories, claimPlan) }
    ]
  });

  const responseSources = researchResponse.output?.flatMap((item) => item.action?.sources || []) || [];
  onStage('drafting');
  const draftArticle = await openaiJson({
    model: writingModel,
    schema: articleJsonSchema,
    temperature: 0.2,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Convert this source-grounded research brief into the required article JSON. Use only facts supported by the research brief and listed sources. Preserve all requested coverage requirements.',
          currentDate,
          freshnessRules: `Use ${currentDate} as the time context. Include an "As of ${currentDate}" framing sentence in the summary or opening body section. Prefer reliable sources from the last 24 months. For fast-moving topics, prioritize 2025-2026 sources. If older data is used, explain why it remains relevant, authoritative, or the latest available.`,
          bodyRules: 'Write a substantive article, not a short chart caption. Return 3 to 6 body sections and at least 7 total paragraphs. Most paragraphs should be 90 to 160 words and include evidence, context, caveats, and interpretation. Not every paragraph needs a chart; many paragraphs should have empty chartIds. Do not include a Sources, References, Bibliography, Works Cited, or citation-list section in body. Do not place raw URLs or markdown links in body paragraphs. Put all source details only in the sources array. Paragraphs must be objects with text and chartIds. Put relevant chart IDs after the paragraph they support. Every chart id must appear in at least one paragraph chartIds array.',
          claimRules: 'For claim prompts, extract up to 3 user-made claims. For question/comparison prompts, return up to 3 evidence findings instead of fake claims. Each item must still include claim, verdict, confidenceScore, confidenceLabel, verdictSummary, support, and sourceIds. Use verdict "unsure" when public evidence is insufficient, and explain what was and was not found.',
          chartRules: 'Return 2 to 4 visualizations with stable id values. Each visualization must answer a distinct question and include question, takeaway, units, sourceNote, limitation, note, and data. Do not create orphan charts. If a chart covers military spending, economic comparison, timeline, source mix, or any other topic, the body must contain relevant text and attach that chart id to that paragraph. Use timeline for dated event sequences. Timeline date fields must be human-readable and precision-honest; use labels like "4.5B years ago", "350M years ago", "May 2024", or "2026" rather than fake exact dates. Use metrics for standalone facts or mixed units. Use comparison for side-by-side estimates, claims, people, or categories. Use delta for two-point before/after or first/last changes. Use ranked_bar for ranked lists, long category labels, and ordered comparisons. Use fact_table for legal criteria, definitions, categorical facts, or single facts. Use evidence_matrix for claim-by-claim support, contradiction, uncertainty, source mapping, or argument coverage. Use line or area only for one continuous metric with 3 or more comparable time points. Use bar for discrete comparisons with the same units, scorecard for qualitative evidence/claim support, and pie only for parts of the same whole. Never use zero as a placeholder for unavailable data.',
          categoryRules: 'Choose the best category from existingCategories whenever one reasonably fits. Reuse exact spelling and capitalization. Create a new category only if the existing list has no good fit.',
          requiredShape: articleJsonShape,
          originalRequest: input,
          claimPlan,
          existingCategories,
          researchBrief: researchResponse.output_text,
          consultedSources: responseSources
        })
      }
    ]
  });

  onStage('review');
  const articleReview = await openaiJson({
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
          researchBrief: researchResponse.output_text,
          consultedSources: responseSources,
          draftArticle
        })
      }
    ]
  });

  onStage('revision');
  let generatedRaw = await openaiJson({
    model: writingModel,
    schema: articleJsonSchema,
    temperature: 0.15,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Revise the draft article to satisfy every required review item. Use only the research brief and consulted sources. Preserve the required JSON shape.',
          currentDate,
          revisionRules: [
            'Resolve or clearly disclose every skeptical fact-check issue.',
            'Resolve neutrality issues without making the article bland.',
            'Remove unsupported claims rather than inventing support.',
            'Keep article text substantial with at least 7 total paragraphs.',
            'Keep chart IDs attached only to paragraphs they directly support.',
            'Do not add sources that were not consulted.'
          ],
          originalRequest: input,
          claimPlan,
          existingCategories,
          researchBrief: researchResponse.output_text,
          consultedSources: responseSources,
          draftArticle,
          articleReview,
          requiredShape: articleJsonShape
        })
      }
    ]
  });

  let citationAudit = null;
  const maxCitationRepairAttempts = 2;
  for (let attempt = 0; attempt <= maxCitationRepairAttempts; attempt += 1) {
    generatedRaw.sources = normalizeSources(generatedRaw.sources, responseSources);
    generatedRaw.keyClaims = repairClaimSourceIds(generatedRaw.keyClaims, generatedRaw.sources);
    onStage('citation_audit');
    citationAudit = await auditGeneratedArticle({
      reviewModel,
      input,
      claimPlan,
      article: generatedRaw,
      consultedSources: responseSources
    });

    const blockingIssues = Array.isArray(citationAudit.blockingIssues) ? citationAudit.blockingIssues : [];
    if (citationAudit.passed || !blockingIssues.length) break;

    if (attempt === maxCitationRepairAttempts) {
      const hardAuditIssues = hardCitationAuditIssues(blockingIssues);
      if (hardAuditIssues.length) {
        throw new Error(`CiteDrop could not create a source-safe draft. ${hardAuditIssues.slice(0, 2).join(' ')}`);
      }
      break;
    }

    onStage('citation_repair');
    generatedRaw = await repairArticleCitations({
      writingModel,
      input,
      claimPlan,
      existingCategories,
      currentDate,
      researchBrief: researchResponse.output_text,
      consultedSources: responseSources,
      article: generatedRaw,
      citationAudit,
      attempt: attempt + 1
    });
  }

  const generated = normalizeGeneratedArticle(generatedRaw, input.category || 'Research');
  onStage('saving');
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
    created_by: userId
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
      userId
    ]
  );

  return rows[0];
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
    <meta property="og:image" content="https://www.citedrop.com/og-home.png" />
    <meta property="og:image:secure_url" content="https://www.citedrop.com/og-home.png" />
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

  const jobId = randomUUID();
  generationJobs.set(jobId, {
    id: jobId,
    userId: req.user.id,
    status: 'queued',
    stage: 'queued',
    stageLabel: generationStages.queued,
    article: null,
    error: '',
    createdAt: Date.now()
  });
  res.status(202).json({ jobId });

  try {
    const setStage = (stage) => {
      generationJobs.set(jobId, {
        ...generationJobs.get(jobId),
        status: 'running',
        stage,
        stageLabel: generationStages[stage] || generationStages.queued
      });
    };
    setStage('claim_extraction');
    const article = await performArticleGeneration(parsed.data, req.user.id, setStage);
    generationJobs.set(jobId, {
      ...generationJobs.get(jobId),
      status: 'completed',
      stage: 'completed',
      stageLabel: generationStages.completed,
      article
    });
  } catch (error) {
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

app.get('/api/generation-jobs/:id', requireDatabase, requireUser, (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job || job.userId !== req.user.id) {
    res.status(404).json({ error: 'Generation job not found.' });
    return;
  }
  res.json({ job: { id: job.id, status: job.status, stage: job.stage, stageLabel: job.stageLabel, article: job.article, error: job.error } });
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

  const visibilityFilters = [];
  const visibilityValues = [];
  if (!includeDrafts) {
    visibilityValues.push('published');
    visibilityFilters.push(`status = $${visibilityValues.length}`);
  } else if (ownOnly) {
    visibilityValues.push(user.id);
    visibilityFilters.push(`created_by = $${visibilityValues.length}`);
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
    res.json({
      articles: articlesResult.rows,
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
  app.use(express.static(distPath, {
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
