const pool = require('../db/pool');

// Logs every staff action to the audit_log table
// Required for POPIA compliance — tracks who accessed which patient record
async function auditLog(userId, action, tableName, recordId, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, table_name, record_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, tableName, recordId, ipAddress]
    );
  } catch (err) {
    // Never let audit logging crash the main request
    console.error('Audit log error:', err.message);
  }
}

module.exports = { auditLog };
