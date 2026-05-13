export function articleUrl(slug) {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const browserOrigin = window.location.origin;
  const origin = configured || (window.location.hostname === 'citedrop.com' ? 'https://www.citedrop.com' : browserOrigin);
  return `${origin}/articles/${slug}`;
}
