import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import HomePage from './pages/HomePage.jsx';
import ArticlePage from './pages/ArticlePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <Layout>
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
    </Layout>
  );
}
