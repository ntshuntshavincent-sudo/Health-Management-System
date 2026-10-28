import React, { useState } from 'react';
import { UserPlus, Search, X, ChevronRight } from 'lucide-react';
import { registerPatient, lookupByIdNumber } from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const EMPTY = {
  id_number:'', first_name:'', last_name:'', date_of_birth:'',
  gender:'', phone:'', address:'', blood_type:'', allergies:'',
  consent_popia:false,
};

export default function Patients() {
  const { user } = useAuth();
  const canRegister = ['admin','receptionist'].includes(user?.role);
  const [tab, setTab] = useState('search');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  // Search
  const [searchId, setSearchId] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleRegister = async (e) => {
    e.preventDefault();
    if (form.id_number.length !== 13) { toast.error('ID number must be 13 digits.'); return; }
    if (!form.first_name || !form.last_name) { toast.error('First and last name are required.'); return; }
    if (!form.consent_popia) { toast.error('POPIA consent must be recorded before registering.'); return; }
    setSaving(true);
    try {
      await registerPatient(form);
      toast.success(`${form.first_name} ${form.last_name} registered successfully!`);
      setForm(EMPTY);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    if (searchId.length !== 13) { setSearchErr('Enter a valid 13-digit ID number.'); return; }
    setSearching(true); setSearchErr(''); setSearchResult(null);
    try {
      const res = await lookupByIdNumber(searchId);
      setSearchResult(res.data);
    } catch (err) {
      setSearchErr(err.response?.status === 404 ? 'No patient found with that ID number.' : 'Lookup failed. Try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Patients</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {[['search','Search patient'], canRegister && ['register','Register new patient']].filter(Boolean).map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500,
            background: tab === id ? 'var(--surface)' : 'transparent',
            color: tab === id ? 'var(--text-1)' : 'var(--text-2)',
            boxShadow: tab === id ? 'var(--shadow-sm)' : 'none',
            border: tab === id ? '1px solid var(--border)' : '1px solid transparent',
            transition: 'all .15s',
          }}>{label}</button>
        ))}
      </div>

      {/* Search tab */}
      {tab === 'search' && (
        <div className="fade-up">
          <div className="card" style={{ padding: 28, marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              Enter a patient's 13-digit ID number to pull up their full record.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <input
                  type="text" inputMode="numeric" maxLength={13}
                  value={searchId}
                  onChange={e => { setSearchId(e.target.value.replace(/\D/g,'')); setSearchErr(''); setSearchResult(null); }}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="0000000000000"
                  style={{ fontFamily: 'var(--mono)', letterSpacing: 2, fontSize: 16 }}
                />
              </div>
              <button className="btn btn-primary" onClick={handleSearch} disabled={searching}
                style={{ padding: '9px 22px' }}>
                {searching ? <span className="spinner" style={{width:18,height:18}}/> : <><Search size={15}/> Search</>}
              </button>
            </div>
            {searchErr && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{searchErr}</p>}
          </div>

          {searchResult && (
            <div className="card fade-up" style={{ padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700 }}>
                    {searchResult.patient.first_name} {searchResult.patient.last_name}
                  </h2>
                  <p style={{ color: 'var(--text-2)', fontSize: 14, fontFamily: 'var(--mono)', marginTop: 2 }}>
                    ID: {searchResult.patient.id_number}
                  </p>
                </div>
                <button onClick={() => { setSearchResult(null); setSearchId(''); }}>
                  <X size={18} color="var(--text-3)" />
                </button>
              </div>
              <div className="grid-3" style={{ gap: 12 }}>
                {[
                  ['Date of birth', searchResult.patient.date_of_birth ? new Date(searchResult.patient.date_of_birth).toLocaleDateString('en-ZA') : '—'],
                  ['Gender', searchResult.patient.gender || '—'],
                  ['Blood type', searchResult.patient.blood_type || 'Unknown'],
                  ['Phone', searchResult.patient.phone || '—'],
                  ['Allergies', searchResult.patient.allergies || 'None recorded'],
                  ['Next appointment', searchResult.next_appointment
                    ? new Date(searchResult.next_appointment.scheduled_at).toLocaleString('en-ZA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'None scheduled'],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: 'var(--bg)', padding: '12px 14px', borderRadius: 8 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{label}</p>
                    <p style={{ fontSize: 14, fontWeight: 500 }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Register tab */}
      {tab === 'register' && canRegister && (
        <div className="card fade-up" style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <UserPlus size={20} color="var(--green)" />
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>New patient registration</h2>
          </div>
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label>SA ID Number *</label>
              <input type="text" inputMode="numeric" maxLength={13} value={form.id_number}
                onChange={set('id_number')} placeholder="0000000000000"
                style={{ fontFamily: 'var(--mono)', letterSpacing: 2 }} />
            </div>
            <div className="grid-2">
              <div className="field"><label>First name *</label><input type="text" value={form.first_name} onChange={set('first_name')} placeholder="Thabo" /></div>
              <div className="field"><label>Last name *</label><input type="text" value={form.last_name} onChange={set('last_name')} placeholder="Dlamini" /></div>
            </div>
            <div className="grid-2">
              <div className="field"><label>Date of birth</label><input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} /></div>
              <div className="field">
                <label>Gender</label>
                <select value={form.gender} onChange={set('gender')}>
                  <option value="">Select…</option>
                  {['Male','Female','Other','Prefer not to say'].map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="field"><label>Phone number</label><input type="tel" value={form.phone} onChange={set('phone')} placeholder="071 000 0000" /></div>
              <div className="field">
                <label>Blood type</label>
                <select value={form.blood_type} onChange={set('blood_type')}>
                  <option value="">Unknown</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label>Home address</label><input type="text" value={form.address} onChange={set('address')} placeholder="123 Main St, Mbombela, 1200" /></div>
            <div className="field"><label>Known allergies</label><textarea value={form.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin, peanuts…" /></div>
            <label style={{ display:'flex', alignItems:'flex-start', gap:10, fontSize:13, color:'var(--text-2)', cursor:'pointer' }}>
              <input type="checkbox" checked={form.consent_popia}
                onChange={e => setForm(f => ({ ...f, consent_popia: e.target.checked }))}
                style={{ marginTop:3, accentColor:'var(--green)' }} />
              <span>
                POPIA consent recorded * — the patient has been informed that their
                personal and health information is processed for treatment purposes only.
              </span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start', padding: '11px 28px' }}>
              {saving ? <span className="spinner" style={{width:18,height:18}}/> : <><UserPlus size={15}/> Register patient</>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
