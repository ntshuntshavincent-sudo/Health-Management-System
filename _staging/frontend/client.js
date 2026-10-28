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

export const createUser = (data) =>
  api.post('/api/auth/create-user', data);

// ── Patients ──────────────────────────────────────────────────────────────────
export const lookupByIdNumber = (id_number) =>
  api.get('/api/patients', { params: { id_number } });

export const registerPatient = (data) =>
  api.post('/api/patients', data);

export const getPatient = (patient_id) =>
  api.get(`/api/patients/${patient_id}`);

export const updatePatient = (patient_id, data) =>
  api.patch(`/api/patients/${patient_id}`, data);

// ── Appointments ──────────────────────────────────────────────────────────────
export const getAppointments = (params) =>
  api.get('/api/appointments', { params });

export const bookAppointment = (data) =>
  api.post('/api/appointments', data);

export const updateAppointmentStatus = (appointment_id, status) =>
  api.patch(`/api/appointments/${appointment_id}/status`, { status });

// ── Doctors ───────────────────────────────────────────────────────────────────
export const getDoctors = () =>
  api.get('/api/doctors');

export const addDoctor = (data) =>
  api.post('/api/doctors', data);

// ── Visit Notes ───────────────────────────────────────────────────────────────
export const saveNote = (data) =>
  api.post('/api/notes', data);

export const getNotes = (appointment_id) =>
  api.get(`/api/notes/${appointment_id}`);
