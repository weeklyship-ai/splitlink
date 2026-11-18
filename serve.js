// Local dev server that mirrors GitHub Pages: the site lives under /splitlink/. node serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { renderPage } = require('./build.js');
const root = path.join(__dirname, 'src');
const port = Number(process.argv[2]) || 5173;
const BASE = '/splitlink/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE)) { res.writeHead(302, { location: BASE }); return res.end(); }
  p = p.slice(BASE.length);
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || path.basename(file).startsWith('_')) { res.writeHead(403); return res.end(); }
  const send = (code, data, ext) => {
    res.writeHead(code, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  };
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(404, renderPage('404.html'), '.html');
    const rel = path.relative(root, file).split(path.sep).join('/');
    // Static pages expand their partials; the app shell loads its CSS/JS as separate files.
    if (rel.endsWith('.html') && rel !== 'app/index.html') return send(200, renderPage(rel), '.html');
    fs.readFile(file, (e, data) => (e ? send(500, 'error', '.html') : send(200, data, path.extname(file))));
  });
}).listen(port, () => console.log(`SplitLink dev server: http://localhost:${port}${BASE}`));
