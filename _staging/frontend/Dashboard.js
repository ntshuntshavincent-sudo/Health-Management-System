import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Calendar, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import { getAppointments } from '../api/client';
import { useAuth } from '../context/AuthContext';

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="card fade-up" style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8, fontWeight: 500 }}>{label}</p>
          <p style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1 }}>{value}</p>
          {sub && <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</p>}
        </div>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={20} color={color} />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    getAppointments({ date: today })
      .then(r => setAppts(r.data.appointments))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [today]);

  const scheduled  = appts.filter(a => a.status === 'scheduled').length;
  const inProgress = appts.filter(a => a.status === 'in_progress').length;
  const completed  = appts.filter(a => a.status === 'completed').length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
          {greeting}, {user?.username} 👋
        </h1>
        <p style={{ color: 'var(--text-2)' }}>
          {new Date().toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid-3" style={{ marginBottom: 32, gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard icon={Calendar}     label="Today's appointments" value={loading ? '—' : appts.length}    color="var(--blue)"  sub="total booked today" />
        <StatCard icon={Clock}        label="Scheduled"            value={loading ? '—' : scheduled}       color="var(--amber)" sub="waiting to be seen" />
        <StatCard icon={Users}        label="In progress"          value={loading ? '—' : inProgress}      color="var(--green)" sub="currently with doctor" />
        <StatCard icon={CheckCircle}  label="Completed"            value={loading ? '—' : completed}       color="var(--text-3)" sub="done for today" />
      </div>

      {/* Today's appointments table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Today's appointments</h2>
          <button className="btn btn-outline" style={{ fontSize: 13, padding: '6px 14px' }} onClick={() => navigate('/appointments')}>
            View all <ArrowRight size={14} />
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : appts.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>
            <Calendar size={32} style={{ margin: '0 auto 10px', opacity: .4 }} />
            <p>No appointments scheduled for today.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Time', 'Patient', 'ID Number', 'Doctor', 'Reason', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appts.slice(0, 8).map((a, i) => (
                <tr key={a.appointment_id}
                  style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', transition: 'background .1s' }}
                  onClick={() => navigate('/appointments')}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '13px 20px', fontSize: 13, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                    {new Date(a.scheduled_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '13px 20px', fontWeight: 500 }}>{a.first_name} {a.last_name}</td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{a.id_number}</td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-2)' }}>{a.doctor_name}</td>
                  <td style={{ padding: '13px 20px', fontSize: 13, color: 'var(--text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.reason || '—'}</td>
                  <td style={{ padding: '13px 20px' }}>
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    scheduled:   ['badge-amber', 'Scheduled'],
    in_progress: ['badge-blue',  'In progress'],
    completed:   ['badge-green', 'Completed'],
    cancelled:   ['badge-red',   'Cancelled'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
