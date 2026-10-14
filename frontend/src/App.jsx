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
import PlatformLogin from './pages/PlatformLogin';
import PlatformAdmin from './pages/PlatformAdmin';
import AcceptInvitation from './pages/AcceptInvitation';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/hero" replace />;
}

function PlatformPrivateRoute({ children }) {
  const platformToken = useAuthStore(s => s.platformToken);
  return platformToken ? children : <Navigate to="/platform/login" replace />;
}

export default function App() {
  const token = useAuthStore(s => s.token);
  const platformToken = useAuthStore(s => s.platformToken);

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

  useEffect(() => {
    if (!platformToken) return undefined;
    // Platform tokens are short-lived (15m); return to login on expiry.
    const timer = setTimeout(() => {
      useAuthStore.getState().platformLogout();
      window.location.assign('/platform/login');
    }, 15 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [platformToken]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/hero" element={<Hero />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Signup initialLogin />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/platform/login" element={<PlatformLogin />} />
        <Route path="/platform" element={
          <PlatformPrivateRoute>
            <PlatformAdmin />
          </PlatformPrivateRoute>
        } />
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
