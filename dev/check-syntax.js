'use strict';
// Checks every .js file in scripts/, tests/ and dev/ with `node --check`, and
// that each userscript's metadata is complete and consistent:
// - @version is semver and not newer than the repository version in package.json
// - @updateURL and @downloadURL point at the script's own file on main
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const RAW = 'https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/';
let failed = false;

const semver = (v) => /^\d+\.\d+\.\d+$/.test(v || '');
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const fail = (msg) => { failed = true; console.error('FAIL ' + msg); };

if (!semver(pkg.version)) fail('package.json version ' + pkg.version + ' is not semver');

for (const dir of ['scripts', 'tests', 'dev']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(dir, name);
    try {
      execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
      console.log('ok   ' + file);
    } catch (err) {
      fail(file + '\n' + err.stderr);
    }
    if (!name.endsWith('.user.js')) continue;

    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const meta = (key) => {
      const m = src.match(new RegExp('^// @' + key + '\\s+(.+)$', 'm'));
      return m ? m[1].trim() : null;
    };
    const version = meta('version');
    if (!semver(version)) fail(file + ': @version ' + version + ' is not semver');
    else if (cmp(version, pkg.version) > 0) fail(file + ': @version ' + version + ' is newer than package.json ' + pkg.version);
    for (const key of ['updateURL', 'downloadURL']) {
      if (meta(key) !== RAW + name) fail(file + ': @' + key + ' should be ' + RAW + name);
    }
    for (const key of ['name', 'namespace', 'description', 'author', 'license', 'match']) {
      if (!meta(key)) fail(file + ': missing @' + key);
    }
    if (meta('grant') !== 'none') fail(file + ': @grant should be none');
  }
}
process.exit(failed ? 1 : 0);
