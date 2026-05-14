export function trackEvent(eventName, parameters = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, cleanParameters(parameters));
}

export function trackPageView(path, title = document.title) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('config', 'G-3BEQ6WDW5M', {
    page_path: path,
    page_title: title
  });
}

function cleanParameters(parameters) {
  return Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}
