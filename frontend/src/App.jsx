import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import EventsPage from './pages/Events';
import UsersPage from './pages/Users';
import AnalyticsPage from './pages/Analytics';
import SettingsPage from './pages/Settings';
import Hero from './pages/Hero';

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  useEffect(() => {
  const ws = new WebSocket("ws://localhost:3001");

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "ALERT") {
      console.log("REALTIME EVENT:", data.event);

      // reload dashboard instantly
      window.location.reload(); 
      // OR call loadData() if you extract it
    }
  };

  return () => ws.close();
}, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/hero" element={<Hero />} />
        <Route path="/login" element={<LoginPage />} />
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