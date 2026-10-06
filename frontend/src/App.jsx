import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './hooks/useAuth';
import Layout from './components/Layout';
import Signup from './pages/Signup';
import OverviewPage from './pages/Overview';
import EventsPage from './pages/Events';
import UsersPage from './pages/Users';
import AnalyticsPage from './pages/Analytics';
import SettingsPage from './pages/Settings';
import AuditLogPage from './pages/AuditLog';
import JustificationsPage from './pages/Justifications';
import Hero from './pages/Hero';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/hero" replace />;
}

export default function App() {
  const token = useAuthStore(s => s.token);

  useEffect(() => {
    if (!token) return undefined;
    let socket;
    let cancelled = false;

    fetch(`${API_BASE}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (cancelled || !data?.ticket) return;
        const wsBase = API_BASE.replace(/^http/, 'ws');
        socket = new WebSocket(`${wsBase}/api/alerts?ticket=${encodeURIComponent(data.ticket)}`);
        socket.onmessage = message => {
          const event = JSON.parse(message.data);
          if (event.type === 'ALERT') window.location.reload();
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [token]);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/hero" element={<Hero />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="hero" element={<Hero />} />
          <Route path="overview"  element={<OverviewPage />} />
          <Route path="events"    element={<EventsPage />} />
          <Route path="users"     element={<UsersPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings"  element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}