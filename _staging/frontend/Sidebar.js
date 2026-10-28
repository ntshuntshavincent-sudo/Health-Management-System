import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, FileText,
  Stethoscope, LogOut, Activity, MonitorSmartphone
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard',    roles: ['admin','doctor','receptionist'] },
  { to: '/kiosk',        icon: MonitorSmartphone,label: 'Patient kiosk', roles: ['admin','receptionist'] },
  { to: '/patients',     icon: Users,            label: 'Patients',     roles: ['admin','doctor','receptionist'] },
  { to: '/appointments', icon: Calendar,         label: 'Appointments', roles: ['admin','doctor','receptionist'] },
  { to: '/doctors',      icon: Stethoscope,      label: 'Doctors',      roles: ['admin'] },
  { to: '/notes',        icon: FileText,          label: 'Visit notes',  roles: ['admin','doctor'] },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  const visibleLinks = links.filter(l => l.roles.includes(user?.role));

  return (
    <aside style={{
      width: 'var(--sidebar-w)',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'fixed',
      top: 0, left: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: 'var(--green)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Activity size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>HealthRecord</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Patient System</div>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        {visibleLinks.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 8, marginBottom: 2,
            fontSize: 14, fontWeight: 500,
            color: isActive ? 'var(--green-dark)' : 'var(--text-2)',
            background: isActive ? 'var(--green-light)' : 'transparent',
            transition: 'all .12s',
            textDecoration: 'none',
          })}>
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border)' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: 'var(--bg)',
          marginBottom: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{user?.username}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'capitalize' }}>
            {user?.role}
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '8px 12px',
            borderRadius: 8, fontSize: 13,
            color: 'var(--text-2)',
            transition: 'background .12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </aside>
  );
}
