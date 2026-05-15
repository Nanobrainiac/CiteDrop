import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import ClerkBoundary from './components/ClerkBoundary.jsx';
import LoadingState from './components/LoadingState.jsx';
import { AuthProvider } from './state/AuthContext.jsx';

const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const ArticlePage = lazy(() => import('./pages/ArticlePage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page" />}>
      <Routes>
        <Route path="/" element={<PublicFrame><HomePage /></PublicFrame>} />
        <Route path="/articles/:slug" element={<PublicFrame><ArticlePage /></PublicFrame>} />
        <Route path="/login" element={<ClerkFrame><LoginPage /></ClerkFrame>} />
        <Route
          path="/dashboard"
          element={(
            <ClerkFrame>
              <AuthGuard>
                <DashboardPage />
              </AuthGuard>
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
