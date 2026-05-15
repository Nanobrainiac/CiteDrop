import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import LoadingState from './components/LoadingState.jsx';

const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const ArticlePage = lazy(() => import('./pages/ArticlePage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<LoadingState label="Loading page" />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/articles/:slug" element={<ArticlePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={(
              <AuthGuard>
                <DashboardPage />
              </AuthGuard>
            )}
          />
          <Route
            path="/admin"
            element={(
              <AuthGuard role="admin">
                <AdminPage />
              </AuthGuard>
            )}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
