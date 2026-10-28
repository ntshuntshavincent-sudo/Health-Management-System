# Patient Management System — Backend API

Node.js + Express + PostgreSQL backend for the patient kiosk system.

---

## Setup (step by step)

### 1. Install Node.js
Download from https://nodejs.org — install the LTS version.

### 2. Install PostgreSQL
Download from https://www.postgresql.org/download/
During install, set a password for the `postgres` user — you'll need it.

### 3. Create the database
Open pgAdmin (installed with PostgreSQL) or run in terminal:
```
psql -U postgres
CREATE DATABASE patient_system;
\q
```

### 4. Run the schema
```
psql -U postgres -d patient_system -f schema.sql
```
This creates all 6 tables and inserts 2 sample patients and 2 doctors.

### 5. Configure environment
```
cp .env.example .env
```
Open `.env` and fill in your PostgreSQL password and a JWT secret.

### 6. Install dependencies
```
npm install
```

### 7. Start the server
```
node server.js
```
You should see:
```
✅ Connected to PostgreSQL database
🏥 Patient System API running on http://localhost:3000
```

---

## API Reference

### Auth
| Method | Endpoint | Description | Auth required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | Staff login | No |
| POST | `/api/auth/create-user` | Create staff account | Admin only |

**Login example:**
```json
POST /api/auth/login
{ "username": "admin", "password": "password123" }
```
Returns a `token` — include it in all protected requests:
```
Authorization: Bearer <token>
```

---

### Patients
| Method | Endpoint | Description | Auth required |
|--------|----------|-------------|---------------|
| GET | `/api/patients?id_number=XXXXXXXXXXXXX` | Kiosk lookup by ID | **No** |
| POST | `/api/patients` | Register new patient | Receptionist, Admin |
| GET | `/api/patients/search?q=nomsa` | Search by name/ID | Any staff |
| GET | `/api/patients/:patient_id` | Full record + history | Doctor, Admin |
| PUT | `/api/patients/:patient_id` | Update patient details | Receptionist, Admin |

**Register patient example:**
```json
POST /api/patients
{
  "id_number": "9001015009087",
  "first_name": "Lungelo",
  "last_name": "Zulu",
  "date_of_birth": "1990-01-01",
  "gender": "Male",
  "phone": "076 000 1234",
  "blood_type": "A+",
  "allergies": "None"
}
```

---

### Appointments
| Method | Endpoint | Description | Auth required |
|--------|----------|-------------|---------------|
| GET | `/api/appointments/today` | Today's schedule | Any staff |
| POST | `/api/appointments` | Book appointment | Receptionist, Admin |
| PATCH | `/api/appointments/:id/status` | Update status | Any staff |

**Book appointment example:**
```json
POST /api/appointments
{
  "patient_id": "uuid-here",
  "doctor_id": "uuid-here",
  "scheduled_at": "2026-06-01T09:00:00",
  "reason": "Annual checkup"
}
```

---

### Visit Notes (doctors only)
| Method | Endpoint | Description | Auth required |
|--------|----------|-------------|---------------|
| POST | `/api/notes` | Write visit notes | Doctor, Admin |
| GET | `/api/notes/patient/:patient_id` | Patient visit history | Doctor, Admin |

---

## Project structure

```
patient-system/
├── server.js               ← Start here
├── schema.sql              ← Run this in PostgreSQL first
├── .env.example            ← Copy to .env and fill in values
└── src/
    ├── db/
    │   └── pool.js         ← PostgreSQL connection
    ├── middleware/
    │   ├── auth.js         ← JWT authentication + role checks
    │   └── audit.js        ← POPIA compliance logging
    ├── controllers/
    │   ├── authController.js
    │   ├── patientController.js
    │   ├── appointmentController.js
    │   └── notesController.js
    └── routes/
        └── index.js        ← All route definitions
```

## Next steps
- Build the React frontend that calls these endpoints
- Add the doctor dashboard
- Set up HTTPS before deploying (required for POPIA compliance)
- Add password reset functionality
- Deploy to a local clinic server or cloud (AWS/Azure)
