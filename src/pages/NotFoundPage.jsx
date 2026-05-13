import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="text-sm font-bold uppercase text-acid">404</p>
      <h1 className="mt-3 text-4xl font-black">Page not found</h1>
      <Link to="/" className="mt-8 inline-flex rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white">Back home</Link>
    </section>
  );
}
