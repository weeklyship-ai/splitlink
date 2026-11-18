// The built pages must carry a CSP whose hashes cover every inline script, or the browser refuses to run them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'build.js')], { cwd: root, stdio: 'ignore' });

for (const page of ['index.html', 'app/index.html', 'terms/index.html', 'privacy/index.html', '404.html']) {
  test(`CSP covers inline scripts in dist/${page}`, () => {
    const html = fs.readFileSync(path.join(root, 'dist', page), 'utf8');
    assert.ok(!html.includes('\r'), 'output must use LF line endings');
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
    assert.ok(csp, 'CSP meta missing');
    assert.match(csp, /object-src 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
    let m, n = 0;
    while ((m = re.exec(html))) {
      n++;
      const h = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
      assert.ok(csp.includes(`'sha256-${h}'`), `inline script #${n} not allowed by CSP`);
    }
    assert.ok(n > 0);
  });
}

test('QR library is loaded with subresource integrity', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  assert.match(app, /s\.integrity = 'sha512-[A-Za-z0-9+/=]+'/);
});
