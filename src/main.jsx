import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.jsx';
import './styles.css';
import { AuthProvider } from './state/AuthContext.jsx';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppTree() {
  return (
    <BrowserRouter>
      <AuthProvider clerkEnabled={Boolean(clerkPublishableKey)}>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <AppTree />
      </ClerkProvider>
    ) : (
      <AppTree />
    )}
  </React.StrictMode>
);
