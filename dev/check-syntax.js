'use strict';
// Checks every .js file in scripts/, tests/ and dev/ with `node --check`, and that
// each userscript's @version matches package.json.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let failed = false;

for (const dir of ['scripts', 'tests', 'dev']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(dir, name);
    try {
      execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
      console.log('ok   ' + file);
    } catch (err) {
      failed = true;
      console.error('FAIL ' + file + '\n' + err.stderr);
    }
    if (name.endsWith('.user.js')) {
      const m = fs.readFileSync(path.join(root, file), 'utf8').match(/^\/\/ @version\s+(\S+)/m);
      if (!m || m[1] !== pkg.version) {
        failed = true;
        console.error('FAIL ' + file + ': @version ' + (m && m[1]) + ' does not match package.json ' + pkg.version);
      }
    }
  }
}
process.exit(failed ? 1 : 0);
