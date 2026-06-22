# Proofer

Proofer is a full-stack AI-generated blog/research site for publishing evidence-backed, shareable debate pages. Public visitors can browse and search published articles. Authenticated users can generate drafts with OpenAI, store them in Neon Postgres, and publish or manage them from the admin page.

## Stack

- React, Vite, Tailwind CSS
- Node.js and Express
- Neon Postgres for database persistence
- Clerk for content-creator authentication
- OpenAI API for structured article generation
- Recharts for JSON-driven visualizations
- Heroku-ready deployment

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

3. Fill in `.env` with Neon, Clerk, and OpenAI credentials.

4. Run the app:

   ```bash
   npm run dev
   ```

   Frontend: `http://localhost:5173`  
   Backend: `http://localhost:5000`

The public homepage includes demo content when the database is not configured. Generation, login, admin, and persistence require real credentials.

## Neon Setup

You can initialize Neon from the project with the command Neon provided:

```bash
npx neonctl@latest init
```

Then either use Neon’s SQL editor or `psql` to run [`neon/schema.sql`](neon/schema.sql).

Set `DATABASE_URL` in `.env` to your Neon connection string. It should look like:

```bash
DATABASE_URL=postgresql://user:password@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require
```

This v1 does not require object storage because generated articles, claims, charts, and sources are all stored as Postgres rows/JSON. If image uploads are added later, use an object store such as S3, Cloudflare R2, or Uploadcare alongside Neon.

## Clerk Setup

Create a Clerk application, then copy the publishable and secret keys into `.env`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_ADMIN_USER_IDS=user_...
```

The React app uses Clerk UI for login/register. The Express API verifies Clerk session tokens with `@clerk/express`.

## Roles

Every signed-in Clerk user can:

- Generate articles.
- Preview their own unpublished drafts.
- See their own generated article list in the dashboard.

Only users with the `admin` role can:

- View all generated articles.
- Edit article title/category/status.
- Publish or unpublish articles.
- Delete articles.
- Assign roles through `PATCH /api/roles/:clerkUserId`.

To make yourself the first admin, copy your Clerk user ID from the Clerk dashboard and set:

```bash
CLERK_ADMIN_USER_IDS=user_your_clerk_user_id
```

You can add multiple bootstrap admins with comma-separated IDs. After at least one admin exists, roles can also be stored in the `content_roles` table.

## OpenAI Setup

1. Create an OpenAI API key.
2. Add it to `.env` as `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL`. The default is `gpt-4o-mini`.
4. Optionally set `OPENAI_RESEARCH_MODEL` and `OPENAI_WEB_SEARCH_TOOL` for the source-grounded generation path.

The backend uses the OpenAI Responses API with web search for article generation. It asks the model to ground the article in multiple specific source pages, avoid homepage-only citations, qualify uncertainty, separate claims from opinion, and keep language professional.

## Article Ready Email Setup

Set `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL` to email signed-in users when article generation completes. Anonymous generations do not send email.

## Facebook Page Auto-Posting

Set these config vars to automatically post an article link to your Facebook Page when its status first changes to `published`:

```bash
FACEBOOK_PAGE_ID=your-facebook-page-id
FACEBOOK_PAGE_ACCESS_TOKEN=your-page-access-token
FACEBOOK_GRAPH_API_VERSION=v25.0
```

The token must be a Page access token that can create Page posts. CiteDrop posts to `/{page-id}/feed` with the article title, summary, and public article link. Successful post IDs are stored on the article so republishing or later edits do not create duplicate Facebook posts.

## Unpublished Draft Reminders

Run this command daily from Heroku Scheduler to remind users about draft articles they have not published:

```bash
npm run reminders:unpublished
```

The job sends at most five reminders per draft on days 1, 3, 6, 10, and 14 after the article was created. Sent reminders are recorded in `article_publish_reminders`, so rerunning the job does not resend the same reminder. Test the job without sending email with:

```bash
npm run reminders:unpublished -- --dry-run
```

Required config vars are `DATABASE_URL`, `CLERK_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL` or `PUBLIC_SITE_URL`.

## Database Tables

The app uses:

- `articles`
- `article_publish_reminders`

Article fields include `title`, `slug`, `subtitle`, `summary`, `category`, `status`, `body`, `claims_json`, `charts_json`, `sources_json`, `created_by`, `created_at`, and `updated_at`.

## API Routes

- `POST /api/generate-article`
- `GET /api/articles`
- `GET /api/articles/:slug`
- `PATCH /api/articles/:id`
- `DELETE /api/articles/:id`
- `PATCH /api/roles/:clerkUserId`

Authenticated routes require a Clerk session bearer token.

## GitHub Push

```bash
git init
git add .
git commit -m "Initial Proofer app"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## Heroku Deployment

1. Create the app:

   ```bash
   heroku create your-proofer-app
   ```

2. Set config vars:

   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set VITE_API_BASE_URL=
   heroku config:set PUBLIC_SITE_URL=https://your-proofer-app.herokuapp.com
   heroku config:set DATABASE_URL=...
   heroku config:set VITE_CLERK_PUBLISHABLE_KEY=...
   heroku config:set CLERK_SECRET_KEY=...
   heroku config:set CLERK_ADMIN_USER_IDS=...
   heroku config:set OPENAI_API_KEY=...
   ```

3. Deploy:

   ```bash
   git push heroku main
   ```

Heroku runs `npm install`, `npm run build`, and then starts the Express server with the included `Procfile`.

## Social Sharing Images

Published article pages include server-injected Open Graph and Twitter card metadata in production. The image URL points to:

```bash
/api/articles/:slug/og-image
```

The backend generates a 1200x630 PNG on demand with `sharp`, caches it in memory, and sends long-lived cache headers. Set `PUBLIC_SITE_URL` in production so crawlers receive absolute article and image URLs.

## Production Notes

- Keep generated articles as drafts until reviewed.
- Review all sources before publishing.
- Add stricter role checks if multiple admin levels are needed.
- Consider adding full-text search indexes once article volume grows.
