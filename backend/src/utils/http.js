/**
 * SHARED HTTP HELPERS
 * ───────────────────
 * Small utilities so every route file stays readable: a typed API error,
 * an async wrapper (Express 5 forwards rejected promises, but being explicit
 * keeps behaviour identical on older line-ups) and an express-validator bridge.
 */

const { validationResult } = require('express-validator');

class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message, details) { return new ApiError(400, message, details); }
  static unauthorized(message = 'Authentication required.') { return new ApiError(401, message); }
  static forbidden(message = 'You do not have access to this resource.') { return new ApiError(403, message); }
  static notFound(message = 'Resource not found.') { return new ApiError(404, message); }
  static conflict(message) { return new ApiError(409, message); }
}

/** Wrap an async route handler so thrown errors reach the global handler. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Bridge for express-validator: turns validation failures into a 400 with the
 * first human-readable message, which is what the frontend toasts.
 */
const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const list = errors.array().map((e) => ({ field: e.path || e.param, message: e.msg }));
  return next(ApiError.badRequest(list[0].message || 'Invalid request.', list));
};

/**
 * PostgreSQL error codes we translate into friendly client responses.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERRORS = {
  23505: [409, 'That record already exists.'],
  23503: [400, 'Related record not found (foreign key).'],
  23514: [400, 'Value not allowed by a database rule.'],
  22P02: [400, 'Malformed identifier or number in the request.'],
};

function translateDbError(err) {
  const mapped = PG_ERRORS[err.code];
  if (!mapped) return null;
  return new ApiError(mapped[0], err.detail || mapped[1]);
}

module.exports = { ApiError, asyncHandler, validate, translateDbError };
