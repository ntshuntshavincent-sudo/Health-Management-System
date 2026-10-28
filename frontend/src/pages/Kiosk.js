import React, { useState, useRef } from 'react';
import { Search, Calendar, AlertCircle, CheckCircle2, ShieldCheck, LogIn, RotateCcw, MapPin, User } from 'lucide-react';
import { kioskLookup, kioskCheckIn } from '../api/client';
import toast from 'react-hot-toast';

/**
 * PATIENT CHECK-IN KIOSK
 * ──────────────────────
 * Talks to the PUBLIC /api/kiosk endpoints — the only routes that answer
 * without a staff login. The backend deliberately returns only the patient's
 * name, date of birth and next appointment here — never allergies, blood
 * type, phone numbers or the ID number itself — so this screen can sit in a
 * public waiting room without creating a POPIA exposure.
 */
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
      const res = await kioskLookup(idNum);
      if (!res.data.found) {
        setError('No record found. Please visit the reception desk.');
      } else {
        setResult(res.data);
      }
    } catch (err) {
      setError(err.response?.status === 401
        ? 'This kiosk is not authorised. Please ask reception for help.'
        : 'An error occurred. Please try again or see reception.');
    } finally {
      setLoading(false);
    }
  };

  const checkIn = async () => {
    setLoading(true); setError('');
    try {
      const res = await kioskCheckIn(idNum);
      if (res.data.checked_in) {
        toast.success(res.data.message || 'You are checked in.');
        setResult((r) => ({ ...r, checked_in: true, can_check_in: false }));
      } else {
        setError(res.data.message || 'There is nothing to check in for today. Please see reception.');
      }
    } catch {
      setError('Check-in failed. Please see reception.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setIdNum(''); setResult(null); setError('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const calcAge = (dob) => {
    if (!dob) return null;
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Patient Check-in Kiosk</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 16 }}>
          Enter your South African ID number to view your appointment and check in.
        </p>
      </div>

      {/* ID input */}
      <div className="card fade-up" style={{ padding: 32, marginBottom: 24 }}>
        <div className="field">
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
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={lookup} disabled={loading || idNum.length !== 13}
            style={{ flex: 1, justifyContent: 'center', padding: '12px' }}>
            {loading ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <><Search size={16} /> Find my appointment</>}
          </button>
          {result && (
            <button className="btn btn-outline" onClick={reset} style={{ padding: '12px 18px' }}>
              <RotateCcw size={15} /> Start over
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card fade-up" style={{
          padding: '18px 24px', marginBottom: 24,
          background: 'var(--red-light)', borderColor: '#FED7D7',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <AlertCircle size={20} color="var(--red)" />
          <p style={{ color: 'var(--red)', fontSize: 15 }}>{error}</p>
        </div>
      )}

      {/* Result card — POPIA-minimised payload only */}
      {result && !error && (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%)',
            color: '#fff', padding: '26px 28px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <p style={{ fontSize: 13, opacity: .8, marginBottom: 2 }}>
                {result.checked_in ? 'Checked in' : 'Welcome'}
              </p>
              <p style={{ fontSize: 22, fontWeight: 700 }}>
                {result.greeting || result.first_name}
                {calcAge(result.date_of_birth) !== null && (
                  <span style={{ fontSize: 14, fontWeight: 400, opacity: .85, marginLeft: 8 }}>
                    {calcAge(result.date_of_birth)} yrs
                  </span>
                )}
              </p>
            </div>
            {result.checked_in
              ? <CheckCircle2 size={34} color="rgba(255,255,255,.85)" />
              : <User size={34} color="rgba(255,255,255,.7)" />}
          </div>

          <div style={{ padding: 28 }}>
            <div style={{
              padding: '18px 22px', borderRadius: 12,
              background: result.next_appointment ? 'var(--green-light)' : 'var(--bg)',
              border: `1px solid ${result.next_appointment ? 'var(--green-mid)' : 'var(--border)'}`,
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: result.next_appointment ? 14 : 0 }}>
                <Calendar size={17} color={result.next_appointment ? 'var(--green-dark)' : 'var(--text-3)'} />
                <p style={{ fontWeight: 600, color: result.next_appointment ? 'var(--green-dark)' : 'var(--text-2)' }}>
                  {result.next_appointment
                    ? (result.checked_in ? "Your appointment today" : 'Your next appointment')
                    : 'No upcoming appointment'}
                </p>
              </div>
              {result.next_appointment && (
                <div className="grid-2">
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>DATE & TIME</p>
                    <p style={{ fontWeight: 600, marginTop: 2 }}>
                      {new Date(result.next_appointment.scheduled_at).toLocaleString('en-ZA', {
                        weekday: 'short', day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>SEEING</p>
                    <p style={{ fontWeight: 600, marginTop: 2 }}>
                      {result.next_appointment.provider_name || 'Staff'}
                      {result.next_appointment.department_name && (
                        <span style={{ fontWeight: 400, color: 'var(--text-2)', fontSize: 13 }}>
                          {' '}· {result.next_appointment.department_name}
                        </span>
                      )}
                    </p>
                    {result.next_appointment.facility_name && (
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={12} /> {result.next_appointment.facility_name}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {result.can_check_in && !result.checked_in ? (
              <button className="btn btn-primary" onClick={checkIn} disabled={loading}
                style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 16 }}>
                {loading
                  ? <span className="spinner" style={{ width: 18, height: 18 }} />
                  : <><LogIn size={17} /> Check in for today's visit</>}
              </button>
            ) : result.checked_in ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: 16, borderRadius: 12,
                background: 'var(--green-light)', border: '1px solid var(--green-mid)',
              }}>
                <CheckCircle2 size={18} color="var(--green-dark)" />
                <p style={{ color: 'var(--green-dark)', fontWeight: 600, fontSize: 15 }}>
                  You are checked in — please take a seat and a nurse will call your name.
                </p>
              </div>
            ) : null}

            <p style={{
              textAlign: 'center', fontSize: 12, color: 'var(--text-3)',
              marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <ShieldCheck size={13} />
              {result.privacy_notice || 'Only your name and appointment are shown here. Full medical records are available to clinic staff only.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
