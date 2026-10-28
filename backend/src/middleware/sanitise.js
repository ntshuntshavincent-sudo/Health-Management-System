/**
 * INPUT SANITISATION
 * ──────────────────
 * SQL injection is already impossible because every query uses parameterised
 * placeholders. This layer deals with the other risks: stored XSS in clinical
 * free text, control characters, and oversized payloads.
 *
 * NOTE — deliberate change from the first draft: the old rules stripped
 * "--" and any text matching /on\w+\s*=/, which silently mangled legitimate
 * clinical notes such as "onset = 3 days". Event handlers are now only removed
 * where they can actually execute (inside a tag), and SQL comment markers are
 * left alone because they are inert inside a parameterised query.
 */

const LIMITS = { maxStringLength: 4000, maxDepth: 6 };

// Script-ish payloads that have no place in any field of this system.
const DANGEROUS_PATTERNS = [
  /<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi,   // <script>…</script>
  /<\s*\/?\s*(script|iframe|object|embed|link|meta)\b[^>]*>/gi,
  /javascript\s*:/gi,                                 // javascript: URLs
  /data\s*:\s*text\/html/gi,                          // data:text/html URLs
  // Event handlers, but only in an attribute position: <img onerror=…>
  /(<[^>]*?)\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
];

function sanitiseValue(value) {
  if (typeof value !== 'string') return value;

  let clean = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')  // control chars
    .replace(/\r\n?/g, '\n')                                          // normalise newlines
    .trim();

  for (const pattern of DANGEROUS_PATTERNS) {
    clean = clean.replace(pattern, (match, prefix) => (prefix ? `${prefix} ` : ''));
  }

  return clean.length > LIMITS.maxStringLength ? clean.slice(0, LIMITS.maxStringLength) : clean;
}

function sanitiseObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > LIMITS.maxDepth) return obj;

  if (Array.isArray(obj)) return obj.map((v) => sanitiseObject(v, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'object' && value !== null
      ? sanitiseObject(value, depth + 1)
      : sanitiseValue(value);
  }
  return result;
}

/** Express middleware: cleans body, query and route params in place. */
function sanitise(req, _res, next) {
  if (req.body   && typeof req.body   === 'object') req.body   = sanitiseObject(req.body);
  if (req.query  && typeof req.query  === 'object') req.query  = sanitiseObject(req.query);
  if (req.params && typeof req.params === 'object') req.params = sanitiseObject(req.params);
  next();
}

module.exports = { sanitise, sanitiseValue, sanitiseObject, DANGEROUS_PATTERNS };