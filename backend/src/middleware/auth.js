/**
 * AUTHENTICATION & AUTHORISATION
 * ──────────────────────────────
 * Two things every request must answer:
 *   1. Who is this?                        → authenticate()
 *   2. What are they allowed to touch?     → allowRoles() + facility scoping
 *
 * Facility scoping is the part that makes this safe for a district with many
 * clinics: a user bound to one facility can only ever read or write rows for
 * that facility, no matter what they put in the query string. Only a
 * superadmin (district / provincial oversight) may span facilities.
 */

const jwt    = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('../utils/http');

const ROLES = ['superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'];

// Who may see clinical data (diagnosis, prescriptions, vitals, allergies).
const CLINICAL_ROLES = ['superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'];
// Who may see contact/administrative data and manage the front desk.
const ADMIN_ROLES    = ['superadmin', 'admin'];
// Who may register patients and book appointments.
const REGISTER_ROLES = ['superadmin', 'admin', 'receptionist'];

/** Issue a token. Role and facility ride inside the token so we don't hit the DB per request. */
function signToken(user) {
  return jwt.sign(
    {
      user_id:     user.user_id,
      username:    user.username,
      full_name:   user.full_name,
      role:        user.role,
      facility_id: user.facility_id,
      provider_id: user.provider_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/** Require a valid Bearer token. */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) return next(ApiError.unauthorized('Access denied. No token provided.'));

  try {
    req.user = jwt.verify(token, config.jwt.secret);
    return next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return next(ApiError.unauthorized(
      expired ? 'Your session has expired. Please sign in again.' : 'Invalid token.'
    ));
  }
}

/**
 * Attach the user if a token is present, but never reject.
 * Used by the kiosk routes: staff get the full record, the public gets a
 * minimised one, and nobody gets a 401 in front of a patient.
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(header.slice(7).trim(), config.jwt.secret);
  } catch { /* treat as anonymous */ }
  return next();
}

/** Role gate: allowRoles('admin', 'receptionist') */
function allowRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(
        `Access denied. This action requires the role: ${roles.join(' or ')}.`
      ));
    }
    return next();
  };
}

const isSuperAdmin = (user) => user?.role === 'superadmin';

/** Throw unless the user may touch this facility. */
function assertFacilityAccess(user, facilityId) {
  if (!user) throw ApiError.unauthorized();
  if (isSuperAdmin(user)) return;
  if (!user.facility_id) {
    throw ApiError.forbidden('Your account is not linked to a facility. Contact your administrator.');
  }
  if (facilityId && facilityId !== user.facility_id) {
    throw ApiError.forbidden('You can only access records for your own facility.');
  }
}

/**
 * Work out which facility this request is scoped to and put it on req.facilityId.
 *   • facility user   → always their own facility (a different ?facility_id is refused)
 *   • superadmin      → ?facility_id if given, otherwise null = all facilities
 */
function facilityScope(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized());

  const requested = req.query.facility_id || req.body?.facility_id || null;

  if (isSuperAdmin(req.user)) {
    req.facilityId = requested;   // null means "district-wide"
    return next();
  }

  if (!req.user.facility_id) {
    return next(ApiError.forbidden('Your account is not linked to a facility.'));
  }
  if (requested && requested !== req.user.facility_id) {
    return next(ApiError.forbidden('You can only access records for your own facility.'));
  }

  req.facilityId = req.user.facility_id;
  return next();
}

/** Some endpoints cannot work without a facility (e.g. booking an appointment). */
function requireFacility(req, _res, next) {
  if (!req.facilityId) {
    return next(ApiError.badRequest('facility_id is required — specify which facility this applies to.'));
  }
  return next();
}

module.exports = {
  ROLES,
  CLINICAL_ROLES,
  ADMIN_ROLES,
  REGISTER_ROLES,
  signToken,
  authenticate,
  optionalAuth,
  allowRoles,
  isSuperAdmin,
  assertFacilityAccess,
  facilityScope,
  requireFacility,
};