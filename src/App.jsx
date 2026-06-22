import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import ClerkBoundary from './components/ClerkBoundary.jsx';
import LoadingState from './components/LoadingState.jsx';
import { getSessionStatus } from './lib/api.js';
import { AuthProvider } from './state/AuthContext.jsx';
import HomePage from './pages/HomePage.jsx';

const ArticlePage = lazy(() => import('./pages/ArticlePage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page" />}>
      <Routes>
        <Route path="/" element={<PublicFrame><HomePage /></PublicFrame>} />
        <Route path="/privacy" element={<PublicFrame><PrivacyPage /></PublicFrame>} />
        <Route path="/articles/:slug" element={<ClerkFrame><ArticlePage /></ClerkFrame>} />
        <Route path="/login" element={<ClerkFrame><LoginPage /></ClerkFrame>} />
        <Route
          path="/dashboard"
          element={(
            <ClerkFrame>
              <DashboardPage />
            </ClerkFrame>
          )}
        />
        <Route
          path="/admin"
          element={(
            <ClerkFrame>
              <AuthGuard role="admin">
                <AdminPage />
              </AuthGuard>
            </ClerkFrame>
          )}
        />
        <Route path="*" element={<PublicFrame><NotFoundPage /></PublicFrame>} />
      </Routes>
    </Suspense>
  );
}

function PublicFrame({ children }) {
  const [shouldLoadClerk, setShouldLoadClerk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1200));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = schedule(() => {
      getSessionStatus()
        .then((result) => {
          if (!cancelled && result.signedIn) setShouldLoadClerk(true);
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      cancel(handle);
    };
  }, []);

  if (shouldLoadClerk) {
    return (
      <ClerkBoundary>
        <Layout>{children}</Layout>
      </ClerkBoundary>
    );
  }

  return (
    <AuthProvider configured>
      <Layout>{children}</Layout>
    </AuthProvider>
  );
}

function ClerkFrame({ children }) {
  return (
    <ClerkBoundary>
      <Layout>{children}</Layout>
    </ClerkBoundary>
  );
}
