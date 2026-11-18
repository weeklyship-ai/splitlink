// Build src/ into dist/ for GitHub Pages (served at /splitlink/). No dependencies.
//   dist/index.html            landing page (marketing)
//   dist/app/index.html        the app, with CSS + JS inlined into one file
//   dist/terms/, dist/privacy/ legal pages;  dist/404.html
//   dist/embed.html            body-only app for sandboxed hosts (share codes instead of #g= links)
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

// Static pages share _head/_nav/_footer partials: <!--#include _nav.html-->
function renderPage(rel) {
  return read(rel).replace(/<!--#include ([\w.-]+)-->/g, (_, f) => read(f).trimEnd());
}
// Every page that lives on the site, with its source and output path.
const PAGES = [
  ['index.html', 'index.html'],
  ['terms/index.html', 'terms/index.html'],
  ['privacy/index.html', 'privacy/index.html'],
  ['404.html', '404.html'],
];

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const write = (rel, data) => {
    const p = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };

  for (const [from, to] of PAGES) write(to, renderPage(from));

  const style = `<style>\n${read('style.css')}</style>`;
  const core = `<script>\n${safe(read('core.js'))}</script>`;
  const app = `<script>\n${safe(read('app.js'))}</script>`;
  const appHtml = read('app/index.html')
    .replace('<link rel="stylesheet" href="../style.css">', () => style)
    .replace('<script src="../core.js"></script>', () => core)
    .replace('<script src="../app.js"></script>', () => app);
  write('app/index.html', appHtml);
  write('embed.html', ['<title>SplitLink 分帳連結</title>', style, '<div id="app"></div>', '<script>window.SPLITLINK_EMBED = true;</script>', core, app].join('\n'));

  for (const f of ['site.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'og.png']) {
    fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  }
  // Service worker version = hash of everything it caches, so each deploy refreshes clients.
  const hash = require('crypto').createHash('sha256');
  for (const f of ['index.html', 'app/index.html', 'terms/index.html', 'privacy/index.html', 'site.css']) hash.update(fs.readFileSync(path.join(OUT, f)));
  const version = hash.digest('hex').slice(0, 10);
  write('sw.js', read('sw.js').replace('__VERSION__', version));

  const site = 'https://weeklyship-ai.github.io/splitlink/';
  const day = new Date().toISOString().slice(0, 10);
  write('.nojekyll', '');
  write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /splitlink/app/\nSitemap: ${site}sitemap.xml\n`);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['', 'terms/', 'privacy/'].map((p) => `  <url><loc>${site}${p}</loc><lastmod>${day}</lastmod></url>`).join('\n')}
</urlset>
`);

  console.log(`sw version ${version}`);
  for (const f of ['index.html', 'app/index.html', 'site.css', 'terms/index.html', 'privacy/index.html']) {
    console.log(`dist/${f}  ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
  }
}

module.exports = { renderPage, PAGES };
if (require.main === module) build();
