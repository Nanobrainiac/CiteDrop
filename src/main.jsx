import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';
import AnalyticsRouteTracker from './components/AnalyticsRouteTracker.jsx';
import HashScroll from './components/HashScroll.jsx';

function AppTree() {
  return (
    <BrowserRouter>
      <AnalyticsRouteTracker />
      <HashScroll />
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppTree />
  </React.StrictMode>
);
