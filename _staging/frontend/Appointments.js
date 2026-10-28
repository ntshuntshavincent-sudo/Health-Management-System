import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, X, Clock } from 'lucide-react';
import { getAppointments, bookAppointment, updateAppointmentStatus, getDoctors } from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const STATUS_FLOW = {
  scheduled:   { next: 'in_progress', label: 'Start visit',    cls: 'badge-amber' },
  in_progress: { next: 'completed',   label: 'Mark complete',  cls: 'badge-blue'  },
  completed:   { next: null,          label: 'Completed',      cls: 'badge-green' },
  cancelled:   { next: null,          label: 'Cancelled',      cls: 'badge-red'   },
};

export default function Appointments() {
  const { user } = useAuth();
  const canBook = ['admin','receptionist'].includes(user?.role);
  const today = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState(today);
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ patient_id:'', id_number:'', doctor_id:'', scheduled_at:'', reason:'' });
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getAppointments({ date })
      .then(r => setAppts(r.data.appointments))
      .catch(() => toast.error('Failed to load appointments.'))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getDoctors().then(r => setDoctors(r.data.doctors)).catch(() => {}); }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleBook = async (e) => {
    e.preventDefault();
    if (!form.patient_id || !form.doctor_id || !form.scheduled_at) {
      toast.error('Patient ID, doctor, and date/time are required.'); return;
    }
    setSaving(true);
    try {
      await bookAppointment({ patient_id: form.patient_id, doctor_id: form.doctor_id, scheduled_at: form.scheduled_at, reason: form.reason });
      toast.success('Appointment booked successfully!');
      setShowModal(false);
      setForm({ patient_id:'', id_number:'', doctor_id:'', scheduled_at:'', reason:'' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Booking failed.');
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (appt) => {
    const next = STATUS_FLOW[appt.status]?.next;
    if (!next) return;
    setUpdatingId(appt.appointment_id);
    try {
      await updateAppointmentStatus(appt.appointment_id, next);
      setAppts(prev => prev.map(a => a.appointment_id === appt.appointment_id ? { ...a, status: next } : a));
      toast.success(`Status updated to "${next.replace('_',' ')}"`);
    } catch {
      toast.error('Failed to update status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const grouped = appts.reduce((acc, a) => {
    const key = a.doctor_name || 'Unassigned';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700 }}>Appointments</h1>
        {canBook && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16}/> Book appointment
          </button>
        )}
      </div>

      {/* Date picker */}
      <div className="card" style={{ padding:'14px 20px', marginBottom:24, display:'flex', alignItems:'center', gap:12 }}>
        <Calendar size={18} color="var(--text-2)" />
        <span style={{ fontSize:14, color:'var(--text-2)', fontWeight:500 }}>Showing appointments for:</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ border:'none', outline:'none', fontSize:14, fontWeight:600, color:'var(--text-1)', background:'transparent' }} />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign:'center', padding:60 }}><div className="spinner" style={{margin:'0 auto'}}/></div>
      ) : appts.length === 0 ? (
        <div className="card" style={{ padding:60, textAlign:'center', color:'var(--text-3)' }}>
          <Calendar size={36} style={{ margin:'0 auto 12px', opacity:.3 }}/>
          <p style={{ fontWeight:500 }}>No appointments on this date.</p>
          {canBook && <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{marginTop:16}}><Plus size={15}/> Book one</button>}
        </div>
      ) : (
        Object.entries(grouped).map(([doctor, list]) => (
          <div key={doctor} style={{ marginBottom:28 }}>
            <h3 style={{ fontSize:13, fontWeight:600, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>
              Dr. {doctor} — {list.length} appointment{list.length !== 1 ? 's':''} 
            </h3>
            <div className="card" style={{ overflow:'hidden' }}>
              {list.map((a, i) => {
                const sf = STATUS_FLOW[a.status] || {};
                const isUpdating = updatingId === a.appointment_id;
                return (
                  <div key={a.appointment_id} style={{
                    padding:'16px 24px', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                    display:'flex', alignItems:'center', gap:16,
                  }}>
                    <div style={{ minWidth:56, textAlign:'center' }}>
                      <p style={{ fontSize:15, fontWeight:700, fontFamily:'var(--mono)' }}>
                        {new Date(a.scheduled_at).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}
                      </p>
                      <p style={{ fontSize:11, color:'var(--text-3)' }}>
                        {new Date(a.scheduled_at).toLocaleDateString('en-ZA',{month:'short',day:'numeric'})}
                      </p>
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontWeight:600, marginBottom:2 }}>{a.first_name} {a.last_name}</p>
                      <p style={{ fontSize:13, color:'var(--text-2)', fontFamily:'var(--mono)' }}>{a.id_number}</p>
                      {a.reason && <p style={{ fontSize:13, color:'var(--text-3)', marginTop:2 }}>{a.reason}</p>}
                    </div>
                    <span className={`badge ${sf.cls}`}>{a.status.replace('_',' ')}</span>
                    {sf.next && (
                      <button className="btn btn-outline" onClick={() => advanceStatus(a)}
                        disabled={isUpdating}
                        style={{ fontSize:13, padding:'7px 14px', whiteSpace:'nowrap' }}>
                        {isUpdating ? <span className="spinner" style={{width:14,height:14}}/> : <><Clock size={13}/> {sf.label}</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Book modal */}
      {showModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.45)',
          display:'flex', alignItems:'center', justifyContent:'center',
          zIndex:200, padding:20,
        }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="card fade-up" style={{ width:'100%', maxWidth:520, padding:36 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
              <h2 style={{ fontSize:18, fontWeight:700 }}>Book appointment</h2>
              <button onClick={() => setShowModal(false)}><X size={18} color="var(--text-3)"/></button>
            </div>
            <form onSubmit={handleBook} style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div className="field">
                <label>Patient UUID *</label>
                <input type="text" value={form.patient_id} onChange={set('patient_id')} placeholder="Paste patient_id from search result" />
                <span style={{ fontSize:11, color:'var(--text-3)' }}>Look up the patient first to get their UUID.</span>
              </div>
              <div className="field">
                <label>Doctor *</label>
                <select value={form.doctor_id} onChange={set('doctor_id')}>
                  <option value="">Select a doctor…</option>
                  {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>{d.name} — {d.specialisation}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Date & time *</label>
                <input type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} min={new Date().toISOString().slice(0,16)} />
              </div>
              <div className="field">
                <label>Reason for visit</label>
                <textarea value={form.reason} onChange={set('reason')} placeholder="e.g. General check-up, follow-up…" style={{ minHeight:70 }}/>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:4 }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" style={{width:16,height:16}}/> : <><Plus size={15}/> Book</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
