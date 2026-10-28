import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const api = axios.create({ baseURL: BASE });

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// If token expires, kick user to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 || err.response?.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (username, password) =>
  api.post('/api/auth/login', { username, password });

export const getMe = () => api.get('/api/auth/me');

export const createStaffUser = (data) =>
  api.post('/api/auth/users', data);

export const getUsers = () => api.get('/api/auth/users');

// ── Patients ──────────────────────────────────────────────────────────────────
export const lookupByIdNumber = (id_number) =>
  api.get('/api/patients', { params: { id_number } });

export const searchPatients = (params) =>
  api.get('/api/patients', { params });

export const registerPatient = (data) =>
  api.post('/api/patients', data);

export const getPatient = (patient_id) =>
  api.get(`/api/patients/${patient_id}`);

export const getPatientHistory = (patient_id) =>
  api.get(`/api/patients/${patient_id}/history`);

export const updatePatient = (patient_id, data) =>
  api.patch(`/api/patients/${patient_id}`, data);

// ── Appointments ──────────────────────────────────────────────────────────────
export const getAppointments = (params) =>
  api.get('/api/appointments', { params });

export const getWaitingRoom = () =>
  api.get('/api/appointments/waiting-room');

export const bookAppointment = (data) =>
  api.post('/api/appointments', data);

export const rescheduleAppointment = (appointment_id, data) =>
  api.patch(`/api/appointments/${appointment_id}`, data);

export const updateAppointmentStatus = (appointment_id, status) =>
  api.patch(`/api/appointments/${appointment_id}/status`, { status });

// ── Providers (doctors, nurses, specialists) ──────────────────────────────────
export const getDoctors = (params) =>
  api.get('/api/providers', { params });

export const getProviderSchedule = (provider_id, date) =>
  api.get(`/api/providers/${provider_id}/schedule`, { params: { date } });

export const addDoctor = (data) =>
  api.post('/api/providers', data);

// ── Visit Notes ───────────────────────────────────────────────────────────────
export const saveNote = (data) =>
  api.post('/api/notes', data);

export const getPatientNotes = (patient_id) =>
  api.get('/api/notes', { params: { patient_id } });

export const getNotes = (appointment_id) =>
  api.get(`/api/notes/${appointment_id}`);

// ── Vitals / Triage ───────────────────────────────────────────────────────────
export const recordVitals = (data) => api.post('/api/vitals', data);

export const getLatestVitals = (patient_id) =>
  api.get(`/api/vitals/latest/${patient_id}`);

export const getAppointmentVitals = (appointment_id) =>
  api.get(`/api/vitals/${appointment_id}`);

// ── Kiosk (public, optional kiosk key) ────────────────────────────────────────
export const kioskLookup = (id_number) =>
  api.post('/api/kiosk/lookup', { id_number });

export const kioskCheckIn = (id_number) =>
  api.post('/api/kiosk/check-in', { id_number });

