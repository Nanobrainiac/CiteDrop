import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function HashScroll() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location]);

  return null;
}
