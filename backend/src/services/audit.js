/**
 * AUDIT SERVICE
 * ─────────────
 * One place that writes the POPIA trail, so every route logs the same shape of
 * record and a logging failure can never take a consultation down.
 *
 *   audit_log        — every meaningful action (login, create, update, export)
 *   data_access_log  — specifically: this staff member looked at this patient
 */

const db = require('../db/pool');
const { logger } = require('./log');

/** Best-effort client IP, correct behind the nginx reverse proxy. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Record an action. NEVER throws: audit problems are logged locally, and the
 * request continues. (Refusing a consultation because a log write failed would
 * be worse for the patient.)
 */
async function recordAudit(req, { action, entity = null, entityId = null, detail = null, facilityId = null }) {
  try {
    await db.query(
      `INSERT INTO audit_log
         (user_id, username, role, facility_id, action, entity, entity_id,
          ip_address, user_agent, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        req.user?.user_id   || null,
        req.user?.username  || null,
        req.user?.role      || null,
        facilityId || req.user?.facility_id || req.facilityId || null,
        action,
        entity,
        entityId,
        clientIp(req),
        (req.headers['user-agent'] || '').slice(0, 300) || null,
        detail ? JSON.stringify(detail) : null,
      ]
    );
  } catch (err) {
    logger.error('Failed to write audit_log entry', { action, entity, error: err.message });
  }
}

/** Record that a patient record was viewed (or exported). */
async function recordPatientAccess(req, { patientId, action = 'VIEW_PATIENT', reason = null }) {
  try {
    await db.query(
      `INSERT INTO data_access_log
         (user_id, username, role, facility_id, patient_id, action, reason, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user?.user_id    || null,
        req.user?.username   || null,
        req.user?.role       || null,
        req.user?.facility_id || req.facilityId || null,
        patientId,
        action,
        reason,
        clientIp(req),
      ]
    );
  } catch (err) {
    logger.error('Failed to write data_access_log entry', { patientId, action, error: err.message });
  }
}

module.exports = { recordAudit, recordPatientAccess, clientIp };