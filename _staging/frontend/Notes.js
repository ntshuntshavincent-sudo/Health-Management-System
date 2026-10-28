import React, { useState, useEffect } from 'react';
import { FileText, Plus, Search } from 'lucide-react';
import { getAppointments, saveNote, getNotes } from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Notes() {
  const { user } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [existingNotes, setExistingNotes] = useState([]);
  const [form, setForm] = useState({ diagnosis:'', prescription:'', notes:'' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAppointments({ date: today })
      .then(r => setAppts(r.data.appointments.filter(a => ['in_progress','completed','scheduled'].includes(a.status))))
      .catch(() => toast.error('Failed to load appointments.'))
      .finally(() => setLoading(false));
  }, [today]);

  const selectAppt = async (appt) => {
    setSelected(appt);
    setForm({ diagnosis:'', prescription:'', notes:'' });
    try {
      const res = await getNotes(appt.appointment_id);
      setExistingNotes(res.data.notes);
    } catch { setExistingNotes([]); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.diagnosis && !form.prescription && !form.notes) {
      toast.error('Please fill in at least one field.'); return;
    }
    setSaving(true);
    try {
      await saveNote({ appointment_id: selected.appointment_id, ...form });
      toast.success('Visit note saved. Appointment marked complete.');
      setAppts(prev => prev.map(a => a.appointment_id === selected.appointment_id ? {...a, status:'completed'} : a));
      setSelected(prev => ({...prev, status:'completed'}));
      const res = await getNotes(selected.appointment_id);
      setExistingNotes(res.data.notes);
      setForm({ diagnosis:'', prescription:'', notes:'' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display:'flex', gap:24, height:'calc(100vh - 64px)' }}>
      {/* Left: appointment list */}
      <div style={{ width:300, flexShrink:0 }}>
        <h2 style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>Today's patients</h2>
        {loading ? (
          <div style={{ textAlign:'center', padding:40 }}><div className="spinner" style={{margin:'0 auto'}}/></div>
        ) : appts.length === 0 ? (
          <div className="card" style={{ padding:28, textAlign:'center', color:'var(--text-3)' }}>
            <Search size={24} style={{margin:'0 auto 8px', opacity:.3}}/>
            <p style={{fontSize:14}}>No appointments today.</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {appts.map(a => (
              <button key={a.appointment_id} onClick={() => selectAppt(a)} style={{
                display:'block', width:'100%', textAlign:'left',
                padding:'14px 16px', borderRadius:10,
                background: selected?.appointment_id === a.appointment_id ? 'var(--green-light)' : 'var(--surface)',
                border: `1px solid ${selected?.appointment_id === a.appointment_id ? 'var(--green-mid)' : 'var(--border)'}`,
                cursor:'pointer', transition:'all .15s',
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                  <p style={{ fontWeight:600, fontSize:14 }}>{a.first_name} {a.last_name}</p>
                  <span className={`badge ${a.status==='completed'?'badge-green':a.status==='in_progress'?'badge-blue':'badge-amber'}`} style={{fontSize:11}}>
                    {a.status.replace('_',' ')}
                  </span>
                </div>
                <p style={{ fontSize:12, color:'var(--text-3)', fontFamily:'var(--mono)' }}>{a.id_number}</p>
                <p style={{ fontSize:12, color:'var(--text-2)', marginTop:2 }}>
                  {new Date(a.scheduled_at).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}
                  {a.reason && ` · ${a.reason}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: note editor */}
      <div style={{ flex:1 }}>
        {!selected ? (
          <div className="card" style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--text-3)' }}>
            <FileText size={40} style={{ marginBottom:12, opacity:.3 }}/>
            <p style={{ fontWeight:500 }}>Select a patient to write visit notes</p>
          </div>
        ) : (
          <div className="card fade-up" style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* Patient header */}
            <div style={{ padding:'20px 28px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <h2 style={{ fontSize:18, fontWeight:700 }}>{selected.first_name} {selected.last_name}</h2>
                  <p style={{ fontSize:13, color:'var(--text-2)', fontFamily:'var(--mono)', marginTop:2 }}>{selected.id_number}</p>
                </div>
                <div style={{ textAlign:'right', fontSize:13, color:'var(--text-2)' }}>
                  {selected.blood_type && <span className="badge badge-red" style={{marginBottom:4}}>{selected.blood_type}</span>}
                  {selected.allergies && <p style={{ fontSize:12, color:'var(--amber)', marginTop:4 }}>⚠ {selected.allergies}</p>}
                </div>
              </div>
            </div>

            <div style={{ flex:1, overflow:'auto', padding:28 }}>
              {/* Previous notes */}
              {existingNotes.length > 0 && (
                <div style={{ marginBottom:28 }}>
                  <h3 style={{ fontSize:13, fontWeight:600, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:12 }}>
                    Previous visit notes
                  </h3>
                  {existingNotes.map(n => (
                    <div key={n.note_id} style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px', marginBottom:10 }}>
                      <p style={{ fontSize:12, color:'var(--text-3)', marginBottom:10 }}>
                        {new Date(n.created_at).toLocaleString('en-ZA')} · {n.doctor_name}
                      </p>
                      {n.diagnosis    && <p style={{fontSize:14,marginBottom:6}}><strong>Diagnosis:</strong> {n.diagnosis}</p>}
                      {n.prescription && <p style={{fontSize:14,marginBottom:6}}><strong>Prescription:</strong> {n.prescription}</p>}
                      {n.notes        && <p style={{fontSize:14,color:'var(--text-2)'}}>{n.notes}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* New note form */}
              {selected.status !== 'completed' ? (
                <form onSubmit={handleSave} style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <h3 style={{ fontSize:15, fontWeight:600 }}>Write visit note</h3>
                  <div className="field">
                    <label>Diagnosis</label>
                    <textarea value={form.diagnosis} onChange={e => setForm(f=>({...f,diagnosis:e.target.value}))}
                      placeholder="Patient presents with…" style={{minHeight:80}}/>
                  </div>
                  <div className="field">
                    <label>Prescription / Treatment</label>
                    <textarea value={form.prescription} onChange={e => setForm(f=>({...f,prescription:e.target.value}))}
                      placeholder="Amoxicillin 500mg 3x daily for 7 days…" style={{minHeight:80}}/>
                  </div>
                  <div className="field">
                    <label>Additional notes</label>
                    <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                      placeholder="Follow up in 2 weeks, refer to specialist if…" style={{minHeight:70}}/>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={saving} style={{alignSelf:'flex-start', padding:'11px 24px'}}>
                    {saving ? <span className="spinner" style={{width:16,height:16}}/> : <><Plus size={15}/> Save note & complete visit</>}
                  </button>
                </form>
              ) : (
                <div style={{ textAlign:'center', padding:'28px 0', color:'var(--text-3)' }}>
                  <span className="badge badge-green" style={{fontSize:14, padding:'6px 16px'}}>Visit completed</span>
                  <p style={{ marginTop:10, fontSize:14 }}>This appointment has been completed.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
