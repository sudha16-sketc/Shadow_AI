import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import EventsPage from './pages/Events';
import UsersPage from './pages/Users';
import AnalyticsPage from './pages/Analytics';
import SettingsPage from './pages/Settings';

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }>
          <Route index element={<Navigate to="/overview" replace />} />
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