/**
 * INPUT SANITISATION
 * ──────────────────
 * Strips dangerous characters from all incoming request bodies.
 * This is a second line of defence on top of parameterised SQL queries
 * (which already prevent SQL injection at the database layer).
 */

// Characters and patterns that are never valid in our forms
const DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,  // <script> tags
  /javascript:/gi,                          // javascript: URLs
  /on\w+\s*=/gi,                           // onclick=, onload= etc.
  /--/g,                                   // SQL comment sequences
  /;.*?(DROP|DELETE|TRUNCATE|ALTER)\s/gi,  // destructive SQL keywords
];

function sanitiseValue(val) {
  if (typeof val !== 'string') return val;
  let clean = val.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean;
}

function sanitiseObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = sanitiseObject(value);
    } else {
      result[key] = sanitiseValue(value);
    }
  }
  return result;
}

// Express middleware — cleans req.body, req.query, req.params automatically
function sanitise(req, _res, next) {
  if (req.body)   req.body   = sanitiseObject(req.body);
  if (req.query)  req.query  = sanitiseObject(req.query);
  if (req.params) req.params = sanitiseObject(req.params);
  next();
}

// Validates SA ID number check digit using Luhn algorithm
function validateSAIdNumber(idNumber) {
  if (!/^\d{13}$/.test(idNumber)) return false;

  // Luhn check
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(idNumber[i]);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(idNumber[12]);
}

// Middleware specifically for the kiosk lookup — validates SA ID format
function validateIdNumber(req, res, next) {
  const id = req.query.id_number || req.body.id_number;
  if (id && !validateSAIdNumber(id)) {
    return res.status(400).json({
      error: 'Invalid ID number. Please check and try again.',
    });
  }
  next();
}

module.exports = { sanitise, validateIdNumber, validateSAIdNumber };
