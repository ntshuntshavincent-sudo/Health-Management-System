/**
 * SOUTH AFRICAN ID NUMBER UTILITIES
 * ─────────────────────────────────
 * A 13-digit SA ID is structured as:
 *
 *   YY MM DD  SSSS  C  A  Z
 *   │  │  │   │     │  │  └─ Z: Luhn check digit
 *   │  │  │   │     │  └──── A: historically a citizen/resident flag
 *   │  │  │   │     └─────── C: 0 = SA citizen, 1 = permanent resident
 *   │  │  │   └───────────── SSSS: 0000-4999 female, 5000-9999 male
 *   ──┴──┴───────────────── date of birth
 *
 * Validating and decoding the number locally means the kiosk catches typos
 * before a database round-trip, and registration can pre-fill date of birth
 * and gender — reducing reception workload, which is the whole point.
 */

const ONLY_DIGITS = /^\d{13}$/;

/** Strip spaces/dashes so patients can type "900101 5009 087". */
function normaliseIdNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[^\d]/g, '');
}

/** Luhn (mod 10) checksum — the standard used by SA ID numbers. */
function luhnCheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(first12[i], 10);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidIdNumber(value) {
  const id = normaliseIdNumber(value);
  if (!ONLY_DIGITS.test(id)) return false;
  if (parseDateOfBirth(id) === null) return false;   // impossible date (e.g. month 13)
  return luhnCheckDigit(id) === parseInt(id[12], 10);
}

/** Decode YYMMDD into an ISO date, inferring the century. */
function parseDateOfBirth(value) {
  const id = normaliseIdNumber(value);
  if (id.length < 6) return null;

  const yy = parseInt(id.slice(0, 2), 10);
  const mm = parseInt(id.slice(2, 4), 10);
  const dd = parseInt(id.slice(4, 6), 10);

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  // Nobody born in the future: 00-25 => 2000s, otherwise 1900s.
  const currentYY = new Date().getFullYear() % 100;
  const year = yy <= currentYY ? 2000 + yy : 1900 + yy;

  const date = new Date(Date.UTC(year, mm - 1, dd));
  // Reject roll-overs such as 31 February.
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;

  return date.toISOString().slice(0, 10);
}

function parseGender(value) {
  const id = normaliseIdNumber(value);
  if (id.length < 13) return null;
  const sequence = parseInt(id.slice(6, 10), 10);
  return sequence >= 5000 ? 'Male' : 'Female';
}

function parseCitizenship(value) {
  const id = normaliseIdNumber(value);
  if (id.length < 13) return null;
  return id[10] === '1' ? 'Permanent resident' : 'South African citizen';
}

function parseAge(value) {
  const dob = parseDateOfBirth(value);
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

/** Everything the registration form can pre-fill from an ID number. */
function decodeIdNumber(value) {
  return {
    id_number:   normaliseIdNumber(value),
    date_of_birth: parseDateOfBirth(value),
    gender:        parseGender(value),
    citizenship:   parseCitizenship(value),
    age:           parseAge(value),
  };
}

module.exports = {
  normaliseIdNumber,
  isValidIdNumber,
  luhnCheckDigit,
  parseDateOfBirth,
  parseGender,
  parseCitizenship,
  parseAge,
  decodeIdNumber,
};