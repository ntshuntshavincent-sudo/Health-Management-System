# POPIA Compliance Checklist
## Patient System — Protection of Personal Information Act (South Africa)

This checklist maps each POPIA requirement to what the system does to comply.
Keep this document for your Department of Health audit.

---

## Condition 1 — Accountability
**Requirement:** A responsible party must ensure POPIA conditions are met.

- [ ] Appoint an **Information Officer** at the clinic (usually the clinic manager)
- [ ] Register the Information Officer with the **Information Regulator**
      (https://inforegulator.org.za — free, required by law)
- [ ] Maintain this compliance document and review it annually

**System support:** All access is role-based. Admins are the accountable party in the system.

---

## Condition 2 — Processing Limitation
**Requirement:** Only collect data with the patient's knowledge and consent.

- [ ] Display a **consent notice** at registration (e.g. "We store your information to provide healthcare services")
- [ ] Only collect what is needed for healthcare — do NOT collect unnecessary fields
- [ ] Do not share data with third parties without consent

**System support:** Registration form only collects healthcare-relevant fields. No marketing, no third-party sharing.

---

## Condition 3 — Purpose Specification
**Requirement:** Collect data for a specific, explicit purpose.

**Your stated purpose:** "To register patients, facilitate appointments, and maintain medical records for healthcare delivery."

- [ ] State this purpose clearly on your registration form
- [ ] Do not use patient data for any other purpose

---

## Condition 4 — Further Processing Limitation
**Requirement:** Don't process data in a way incompatible with the original purpose.

- [x] Doctors can only see patient data relevant to their appointments
- [x] Receptionists see contact details only — clinical data is restricted
- [x] No bulk export of patient data without admin approval

---

## Condition 5 — Information Quality
**Requirement:** Keep data accurate, complete, and up to date.

- [x] PATCH /api/patients endpoint allows updating contact details
- [ ] Implement a process for patients to request corrections
- [ ] Review records older than 12 months for accuracy

---

## Condition 6 — Openness
**Requirement:** Patients must be able to request what data you hold about them.

- [ ] Post a **POPIA Privacy Notice** at the clinic and on any website
- [ ] Create a process for patients to submit **data access requests**
      (Suggested: written request to the Information Officer, 30-day response window)
- [ ] Document your data retention policy (see Condition 7)

**Data access request template:** Patient submits their ID number + written request → admin uses GET /api/patients?id_number= to pull full record → printed copy given to patient.

---

## Condition 7 — Security Safeguards
**Requirement:** Take reasonable measures to secure personal information.

### Technical safeguards — IMPLEMENTED ✓
- [x] **HTTPS (SSL/TLS)** — all data encrypted in transit via Let's Encrypt certificate
- [x] **JWT authentication** — staff must log in to access any patient data
- [x] **Role-based access control** — doctors, receptionists, and admins see only what they need
- [x] **Rate limiting** — brute-force login protection (10 attempts per 15 minutes)
- [x] **Helmet.js** — HTTP security headers (XSS, clickjacking, MIME sniffing protection)
- [x] **Input sanitisation** — all inputs cleaned before database queries
- [x] **Parameterised SQL** — SQL injection impossible by design
- [x] **Audit log** — every API access logged with user, timestamp, and action
- [x] **Request logging** — full HTTP access log retained for 90 days
- [x] **Firewall (UFW)** — only ports 22, 80, 443 open on the server
- [x] **Fail2Ban** — auto-bans IPs with repeated failed SSH attempts
- [x] **PM2 cluster mode** — app stays running if a process crashes

### Organisational safeguards — YOUR RESPONSIBILITY
- [ ] Password policy: minimum 10 characters, changed every 90 days
- [ ] Staff training on POPIA and data handling (document attendance)
- [ ] Physical security: server room locked, no unauthorised access to clinic PCs
- [ ] Screen lock: clinic PCs lock after 5 minutes of inactivity
- [ ] Incident response plan: what to do if a data breach occurs
      (Must notify Information Regulator within 72 hours of discovering a breach)

---

## Condition 8 — Data Subject Participation
**Requirement:** Patients have the right to access, correct, and delete their data.

| Right | How to fulfil it |
|-------|-----------------|
| Access | Admin uses GET /api/patients?id_number= and prints record |
| Correction | Admin uses PATCH /api/patients/:id to update details |
| Deletion | Admin deletes record in database (document the request) |
| Objection | Patient can object to processing; document in writing |

---

## Data Retention Policy
**Requirement (National Health Act, South Africa):** Medical records must be kept for **at least 6 years** from the date of last entry, or until the patient turns 21 (whichever is longer) for minors.

- [ ] After 7 years of inactivity, flag records for review (use `getExpiredRecords()` in popia.js)
- [ ] Do not delete records without confirming the retention period has passed
- [ ] Document any deletions in writing

---

## Breach Response Procedure
If patient data is accessed without authorisation (e.g. a hack, a lost laptop):

1. **Contain** — immediately revoke affected credentials, change JWT_SECRET (forces all logins to expire)
2. **Assess** — determine which records were accessed and how
3. **Notify** — inform the Information Regulator within **72 hours** (inforegulator.org.za)
4. **Notify patients** — if there is a real risk of harm, notify affected patients
5. **Document** — record the incident, your response, and steps taken to prevent recurrence

---

## Contacts

| Role | Contact |
|------|---------|
| Information Regulator (SA) | inforegulator.org.za · 010 023 5207 |
| Your Information Officer | _fill in_ |
| System Administrator | _fill in_ |

---

*Last reviewed: [DATE] by [NAME]*
*Next review due: [DATE + 1 year]*
