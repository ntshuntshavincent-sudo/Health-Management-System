/**
 * Dependency-free syntax verification: parses every backend .js file with
 * vm.Script (same parser node --check uses) WITHOUT executing it, so a missing
 * node_modules cannot pollute the results. Writes an ASCII report to
 * _verify.out.txt because console capture in this environment is unreliable.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, 'backend');
const files = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'logs') continue;
      walk(p);
    } else if (entry.name.endsWith('.js')) {
      files.push(p);
    }
  }
})(ROOT);

const out = [];
let failures = 0;

for (const f of files.sort()) {
  const rel = path.relative(__dirname, f);
  try {
    const code = fs.readFileSync(f, 'utf8');
    new vm.Script(code, { filename: rel });
    out.push(`OK    ${rel}`);
  } catch (err) {
    failures += 1;
    out.push(`FAIL  ${rel}  ->  ${err.name}: ${err.message}`);
  }
}

out.push('');
out.push(failures === 0
  ? `RESULT: ALL ${files.length} BACKEND FILES PARSE CLEANLY`
  : `RESULT: ${failures} OF ${files.length} FILES FAILED`);
fs.writeFileSync(path.join(__dirname, '_verify.out.txt'), out.join('\r\n'), 'utf8');
console.log('written _verify.out.txt failures=' + failures);
