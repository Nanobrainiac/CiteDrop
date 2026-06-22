export default function PrivacyPage() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="border-l-4 border-acid pl-4">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-acid">Privacy Policy</p>
        <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">CiteDrop Privacy Policy</h1>
        <p className="mt-4 text-white/55">Last updated: June 22, 2026</p>
      </div>

      <div className="mt-10 space-y-8 text-base leading-8 text-white/70">
        <section>
          <h2 className="text-2xl font-black text-white">Overview</h2>
          <p className="mt-3">CiteDrop helps users generate, review, publish, and share source-backed research articles. This policy explains what information we collect, how we use it, and the services we rely on to operate the site.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Information We Collect</h2>
          <p className="mt-3">We collect account information provided through Clerk, such as your name, email address, user ID, and authentication status. We also store article prompts, generated drafts, published articles, sources, charts, article status, and related timestamps in our database.</p>
          <p className="mt-3">When you use the site, we may collect technical information such as pages visited, browser details, device information, approximate location from IP address, and analytics events.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">How We Use Information</h2>
          <p className="mt-3">We use information to provide the service, save drafts, publish articles, authenticate users, send article-ready and draft reminder emails, prevent abuse, improve article generation quality, measure site performance, and maintain security.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Generated Content</h2>
          <p className="mt-3">Draft articles are private to the creator and site administrators until published. Published articles are public and may be indexed, shared, or posted to connected social media pages. Users should review generated content and sources before publishing.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Service Providers</h2>
          <p className="mt-3">CiteDrop uses third-party providers to operate the service, including Clerk for authentication, Neon for database hosting, OpenAI for article generation, Resend for email delivery, Heroku for hosting, Google Analytics for usage measurement, and Meta/Facebook for social posting and link previews.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Email</h2>
          <p className="mt-3">If you generate an article while signed in, we may email you when the draft is ready. We may also send limited reminders for unpublished drafts. You can ignore those reminders or publish/delete drafts from your account.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Cookies and Analytics</h2>
          <p className="mt-3">We use cookies and similar technologies for authentication, session management, analytics, and basic site functionality. Analytics helps us understand usage patterns and improve the product.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Data Retention</h2>
          <p className="mt-3">We keep account and article data as long as needed to provide the service, comply with legal obligations, resolve disputes, and maintain backups. Deleted articles may remain in backups for a limited period.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Your Choices</h2>
          <p className="mt-3">You can choose whether to publish a draft. You can request access, correction, or deletion of your account-related information by contacting us. Some information may need to be retained for security, legal, or operational reasons.</p>
        </section>

        <section>
          <h2 className="text-2xl font-black text-white">Contact</h2>
          <p className="mt-3">For privacy questions or data requests, contact CiteDrop through the site owner or the support channel listed on citedrop.com.</p>
        </section>
      </div>
    </section>
  );
}
