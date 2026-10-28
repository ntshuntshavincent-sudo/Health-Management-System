/* ASCII-only syntax checker: node --check every backend .js file. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'backend');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'logs') walk(p);
    } else if (e.name.endsWith('.js')) {
      files.push(p);
    }
  }
})(ROOT);

let fails = 0;
for (const f of files.sort()) {
  const rel = path.relative(ROOT, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('ok   ' + rel);
  } catch (err) {
    fails++;
    const out = ((err.stdout || '') + (err.stderr || '')).toString();
    const firstLines = out.split(/\r?\n/).filter(Boolean).slice(0, 4).join(' | ');
    console.log('FAIL ' + rel + ' :: ' + firstLines);
  }
}
console.log('backend syntax failures: ' + fails);
