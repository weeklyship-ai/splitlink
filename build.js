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
for (const f of ['index.html', 'embed.html']) {
  console.log(`dist/${f}  ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(1)} KB`);
}
