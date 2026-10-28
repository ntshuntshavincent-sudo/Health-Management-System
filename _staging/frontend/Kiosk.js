import React, { useState, useRef } from 'react';
import { Search, User, Calendar, AlertCircle, CheckCircle2, Droplets, Phone } from 'lucide-react';
import { lookupByIdNumber } from '../api/client';

export default function Kiosk() {
  const [idNum, setIdNum] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  const lookup = async () => {
    if (idNum.length !== 13) {
      setError('Please enter a valid 13-digit ID number.');
      return;
    }
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await lookupByIdNumber(idNum);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.status === 404
        ? 'No patient found. Please visit the reception desk.'
        : 'An error occurred. Please try again or see reception.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setIdNum(''); setResult(null); setError('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const calcAge = (dob) => {
    if (!dob) return '—';
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          Patient Check-in Kiosk
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 16 }}>
          Enter your South African ID number to view your record and appointment.
        </p>
      </div>

      {/* ID input */}
      <div className="card fade-up" style={{ padding: 32, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>ID Number (13 digits)</label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={13}
              value={idNum}
              onChange={e => { setIdNum(e.target.value.replace(/\D/g, '')); setError(''); setResult(null); }}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              placeholder="0000000000000"
              style={{ fontSize: 20, letterSpacing: 3, textAlign: 'center', fontFamily: 'var(--mono)' }}
              autoFocus
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={lookup} disabled={loading || idNum.length !== 13}
            style={{ flex: 1, justifyContent: 'center', padding: 13, fontSize: 15 }}>
            {loading
              ? <span className="spinner" style={{ width: 20, height: 20 }} />
              : <><Search size={17} /> Look up my record</>}
          </button>
          {(result || error) && (
            <button className="btn btn-outline" onClick={reset} style={{ padding: '13px 20px' }}>
              Clear
            </button>
          )}
        </div>

        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: 4, marginTop: 16, justifyContent: 'center' }}>
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} style={{
              width: 12, height: 6, borderRadius: 3,
              background: i < idNum.length ? 'var(--green)' : 'var(--border)',
              transition: 'background .15s',
            }} />
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card fade-up" style={{ padding: '18px 24px', borderColor: 'var(--red)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertCircle size={20} color="var(--red)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <p style={{ fontWeight: 500, color: 'var(--red)', marginBottom: 2 }}>Not found</p>
            <p style={{ fontSize: 14, color: 'var(--text-2)' }}>{error}</p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          {/* Green header bar */}
          <div style={{
            background: 'var(--green)', padding: '20px 28px',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(255,255,255,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <User size={26} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                {result.patient.full_name}
              </h2>
              <p style={{ color: 'rgba(255,255,255,.8)', fontSize: 14 }}>
                {calcAge(result.patient.date_of_birth)} years old · {result.patient.gender || 'Gender not specified'}
              </p>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <CheckCircle2 size={32} color="rgba(255,255,255,.7)" />
            </div>
          </div>

          <div style={{ padding: 28 }}>
            {/* Info grid */}
            <div className="grid-3" style={{ marginBottom: 24 }}>
              <InfoTile icon={<Droplets size={15} />} label="Blood type" value={result.patient.blood_type || 'Unknown'} />
              <InfoTile icon={<Phone size={15} />} label="Phone" value={result.patient.phone || '—'} />
              <InfoTile icon={<AlertCircle size={15} />} label="Allergies"
                value={result.patient.allergies || 'None recorded'}
                highlight={!!result.patient.allergies}
              />
            </div>

            {/* Appointment */}
            <div style={{
              padding: '18px 22px',
              borderRadius: 12,
              background: result.next_appointment ? 'var(--green-light)' : 'var(--bg)',
              border: `1px solid ${result.next_appointment ? 'var(--green-mid)' : 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: result.next_appointment ? 12 : 0 }}>
                <Calendar size={17} color={result.next_appointment ? 'var(--green-dark)' : 'var(--text-3)'} />
                <p style={{ fontWeight: 600, color: result.next_appointment ? 'var(--green-dark)' : 'var(--text-2)' }}>
                  {result.next_appointment ? 'Upcoming appointment confirmed' : 'No upcoming appointment'}
                </p>
              </div>
              {result.next_appointment && (
                <div className="grid-2">
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>DATE & TIME</p>
                    <p style={{ fontWeight: 600, marginTop: 2 }}>
                      {new Date(result.next_appointment.scheduled_at).toLocaleString('en-ZA', {
                        weekday: 'short', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>DOCTOR</p>
                    <p style={{ fontWeight: 600, marginTop: 2 }}>
                      {result.next_appointment.doctor_name}
                      <span style={{ fontWeight: 400, color: 'var(--text-2)', fontSize: 13 }}>
                        {' '}· {result.next_appointment.specialisation}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)', marginTop: 20 }}>
              Please have a seat — a nurse will call your name shortly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoTile({ icon, label, value, highlight }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 10,
      background: highlight ? 'var(--amber-light)' : 'var(--bg)',
      border: `1px solid ${highlight ? '#FDE68A' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, color: highlight ? 'var(--amber)' : 'var(--text-3)' }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
      </div>
      <p style={{ fontSize: 14, fontWeight: 500 }}>{value}</p>
    </div>
  );
}
