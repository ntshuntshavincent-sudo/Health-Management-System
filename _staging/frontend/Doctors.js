import React, { useState, useEffect } from 'react';
import { Stethoscope, Plus, X } from 'lucide-react';
import { getDoctors, addDoctor } from '../api/client';
import toast from 'react-hot-toast';

export default function Doctors() {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name:'', specialisation:'', employee_number:'' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getDoctors()
      .then(r => setDoctors(r.data.doctors))
      .catch(() => toast.error('Failed to load doctors.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  const set = k => e => setForm(f => ({...f, [k]: e.target.value}));

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name || !form.specialisation || !form.employee_number) {
      toast.error('All fields are required.'); return;
    }
    setSaving(true);
    try {
      await addDoctor(form);
      toast.success(`Dr. ${form.name} added.`);
      setForm({ name:'', specialisation:'', employee_number:'' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add doctor.');
    } finally {
      setSaving(false);
    }
  };

  const SPECS = ['General Practitioner','Internal Medicine','Paediatrics','Gynaecology','Cardiology','Orthopaedics','Dermatology','Psychiatry','Surgery','Emergency Medicine','Radiology','Other'];

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700 }}>Doctors</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(v=>!v)}>
          {showForm ? <><X size={15}/> Cancel</> : <><Plus size={15}/> Add doctor</>}
        </button>
      </div>

      {showForm && (
        <div className="card fade-up" style={{ padding:28, marginBottom:24 }}>
          <h2 style={{ fontSize:15, fontWeight:600, marginBottom:18 }}>New doctor</h2>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="grid-2">
              <div className="field"><label>Full name</label><input type="text" value={form.name} onChange={set('name')} placeholder="Dr. Nomsa Naidoo"/></div>
              <div className="field"><label>Employee number</label><input type="text" value={form.employee_number} onChange={set('employee_number')} placeholder="EMP-001" style={{fontFamily:'var(--mono)'}}/></div>
            </div>
            <div className="field">
              <label>Specialisation</label>
              <select value={form.specialisation} onChange={set('specialisation')}>
                <option value="">Select…</option>
                {SPECS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf:'flex-start', padding:'10px 24px' }}>
              {saving ? <span className="spinner" style={{width:16,height:16}}/> : <><Plus size={15}/> Add doctor</>}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:40 }}><div className="spinner" style={{margin:'0 auto'}}/></div>
      ) : doctors.length === 0 ? (
        <div className="card" style={{ padding:48, textAlign:'center', color:'var(--text-3)' }}>
          <Stethoscope size={36} style={{ margin:'0 auto 12px', opacity:.3 }}/>
          <p>No doctors added yet.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          {doctors.map((d, i) => (
            <div key={d.doctor_id} style={{
              padding:'18px 24px', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              display:'flex', alignItems:'center', gap:16,
            }}>
              <div style={{ width:42, height:42, borderRadius:10, background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Stethoscope size={18} color="var(--green-dark)" />
              </div>
              <div style={{ flex:1 }}>
                <p style={{ fontWeight:600 }}>{d.name}</p>
                <p style={{ fontSize:13, color:'var(--text-2)', marginTop:1 }}>{d.specialisation}</p>
              </div>
              <p style={{ fontSize:12, color:'var(--text-3)', fontFamily:'var(--mono)' }}>{d.employee_number}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
