// Inline src/ into self-contained single files (no dependencies):
//   dist/index.html     standalone page for any static host (GitHub Pages, Netlify, local file)
//   dist/embed.html     body-only variant for sandboxed hosts (share codes instead of #g= links)
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const style = `<style>\n${src('style.css')}</style>`;
const core = `<script>\n${safe(src('core.js'))}</script>`;
const app = `<script>\n${safe(src('app.js'))}</script>`;

let html = src('index.html')
  .replace('<link rel="stylesheet" href="style.css">', () => style)
  .replace('<script src="core.js"></script>', () => core)
  .replace('<script src="app.js"></script>', () => app);

const embed = [
  '<title>SplitLink 分帳連結</title>',
  style,
  '<div id="app"></div>',
  '<script>window.SPLITLINK_EMBED = true;</script>',
  core,
  app,
].join('\n');

const out = path.join(__dirname, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'embed.html'), embed);

// PWA + social assets
const version = require('crypto').createHash('sha256').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(out, 'sw.js'), src('sw.js').replace('__VERSION__', version));
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'og.png']) {
  fs.copyFileSync(path.join(__dirname, 'src', f), path.join(out, f));
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://rax0609.github.io/splitlink/sitemap.xml\n');
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://rax0609.github.io/splitlink/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url></urlset>
`);
console.log(`sw version ${version}`);
for (const f of ['index.html', 'embed.html']) {
  console.log(`dist/${f}  ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(1)} KB`);
}
