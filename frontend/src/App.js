import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import Login        from './pages/Login';
import Dashboard    from './pages/Dashboard';
import Kiosk        from './pages/Kiosk';
import Patients     from './pages/Patients';
import Appointments from './pages/Appointments';
import Notes        from './pages/Notes';
import Providers     from './pages/Providers';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontFamily: "'DM Sans', sans-serif", fontSize: 14, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.12)' },
            success: { iconTheme: { primary: '#00A86B', secondary: '#fff' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/kiosk"        element={<Kiosk />} />
            <Route path="/patients"     element={<Patients />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/notes"        element={<Notes />} />
            <Route path="/doctors"     element={<Providers />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
