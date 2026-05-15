import { lazy, Suspense } from 'react';
import LoadingState from './LoadingState.jsx';

const ClerkRuntime = lazy(() => import('./ClerkRuntime.jsx'));

export default function ClerkBoundary({ children }) {
  return (
    <Suspense fallback={<LoadingState label="Loading secure session" />}>
      <ClerkRuntime>{children}</ClerkRuntime>
    </Suspense>
  );
}
