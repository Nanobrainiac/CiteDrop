import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../lib/analytics.js';

export default function AnalyticsRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}${location.hash}`);
  }, [location]);

  return null;
}
