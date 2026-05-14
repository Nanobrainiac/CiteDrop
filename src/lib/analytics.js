const measurementId = 'G-3BEQ6WDW5M';

export function trackEvent(eventName, parameters = {}) {
  sendGtag('event', eventName, {
    send_to: measurementId,
    ...cleanParameters(parameters)
  });
}

export function trackPageView(path, title = document.title) {
  sendGtag('config', measurementId, {
    page_path: path,
    page_title: title
  });
}

function sendGtag(...args) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag(...args);
}

function cleanParameters(parameters) {
  return Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}
