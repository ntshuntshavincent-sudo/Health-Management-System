import React, { useState, useEffect } from 'react';
import { Stethoscope, Plus, X } from 'lucide-react';
import { getDoctors, addDoctor } from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const ROLES = [
  ['doctor',             'Doctor'],
  ['specialist',         'Specialist'],
  ['nurse',              'Nurse'],
  ['clinical_associate', 'Clinical associate'],
  ['pharmacist',         'Pharmacist'],
];

const EMPTY = { name:'', role:'doctor', specialisation:'', employee_number:'', registration_number:'', phone:'' };

export default function Providers() {
  const { user } = useAuth();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getDoctors()
      .then(r => setProviders(r.data.providers || r.data.doctors || []))
      .catch(() => toast.error('Failed to load clinical staff.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  const set = k => e => setForm(f => ({...f, [k]: e.target.value}));

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name || !form.role || !form.employee_number) {
      toast.error('Name, role and employee number are required.'); return;
    }
    setSaving(true);
    try {
      // The backend scopes every provider to a facility — use the admin's own.
      await addDoctor({ ...form, facility_id: user?.facility_id });
      toast.success(`${form.name} added to the roster.`);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add provider.');
    } finally {
      setSaving(false);
    }
  };

  const SPECS = ['General Practitioner','Internal Medicine','Paediatrics','Gynaecology','Cardiology','Orthopaedics','Dermatology','Psychiatry','Surgery','Emergency Medicine','Radiology','Other'];

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700 }}>Clinical staff</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(v=>!v)}>
          {showForm ? <><X size={15}/> Cancel</> : <><Plus size={15}/> Add staff member</>}
        </button>
      </div>

      {showForm && (
        <div className="card fade-up" style={{ padding:28, marginBottom:24 }}>
          <h2 style={{ fontSize:15, fontWeight:600, marginBottom:18 }}>New clinical staff member</h2>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="grid-2">
              <div className="field"><label>Full name *</label><input type="text" value={form.name} onChange={set('name')} placeholder="Dr. Nomsa Naidoo"/></div>
              <div className="field">
                <label>Role *</label>
                <select value={form.role} onChange={set('role')}>
                  {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="field"><label>Employee number *</label><input type="text" value={form.employee_number} onChange={set('employee_number')} placeholder="EMP-001" style={{fontFamily:'var(--mono)'}}/></div>
              <div className="field"><label>Registration number</label><input type="text" value={form.registration_number} onChange={set('registration_number')} placeholder="MP0123456 / SANC-00000" style={{fontFamily:'var(--mono)'}}/></div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Specialisation</label>
                <select value={form.specialisation} onChange={set('specialisation')}>
                  <option value="">None</option>
                  {SPECS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Phone</label><input type="tel" value={form.phone} onChange={set('phone')} placeholder="071 000 0000"/></div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf:'flex-start', padding:'10px 24px' }}>
              {saving ? <span className="spinner" style={{width:16,height:16}}/> : <><Plus size={15}/> Add to roster</>}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:40 }}><div className="spinner" style={{margin:'0 auto'}}/></div>
      ) : providers.length === 0 ? (
        <div className="card" style={{ padding:48, textAlign:'center', color:'var(--text-3)' }}>
          <Stethoscope size={36} style={{ margin:'0 auto 12px', opacity:.3 }}/>
          <p>No clinical staff added yet.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          {providers.map((d, i) => (
            <div key={d.provider_id} style={{
              padding:'18px 24px', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              display:'flex', alignItems:'center', gap:16,
            }}>
              <div style={{ width:42, height:42, borderRadius:10, background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Stethoscope size={18} color="var(--green-dark)" />
              </div>
              <div style={{ flex:1 }}>
                <p style={{ fontWeight:600, display:'flex', alignItems:'center', gap:10 }}>
                  {d.name}
                  <span className="badge badge-green">{(d.role || '').replace('_', ' ')}</span>
                </p>
                <p style={{ fontSize:13, color:'var(--text-2)', marginTop:1 }}>
                  {d.specialisation || 'General'}
                  {d.department_name ? ` · ${d.department_name}` : ''}
                  {d.facility_name ? ` · ${d.facility_name}` : ''}
                </p>
              </div>
              <p style={{ fontSize:12, color:'var(--text-3)', fontFamily:'var(--mono)' }}>{d.employee_number}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
