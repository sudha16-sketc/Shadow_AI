import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';

const navItems = [
  { path: '/overview',  label: 'Overview',    icon: '⬡' },
  { path: '/events',    label: 'Events',      icon: '⚡' },
  { path: '/users',     label: 'Users',       icon: '◎' },
  { path: '/analytics', label: 'Analytics',   icon: '↗' },
  { path: '/settings',  label: 'Settings',    icon: '⚙' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-white/[0.07] bg-gray-950">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 text-sm">
              ⚔
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">Shadow AI</p>
              <p className="text-[10px] text-gray-500 mt-0.5 leading-none">Auditor</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ path, label, icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-white/[0.08] text-white font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                }`
              }
            >
              <span className="text-base w-4 text-center opacity-60">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-white/[0.07]">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-6 h-6 rounded-full bg-indigo-500/30 flex items-center justify-center text-indigo-300 text-xs font-semibold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-200 truncate">{user?.name ?? 'Admin'}</p>
              <p className="text-[10px] text-gray-500 truncate">{user?.role ?? 'admin'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
              title="Logout"
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}