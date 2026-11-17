// Render icons + Open Graph image with headless Chrome/Edge: node tools/make-assets.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const bin = browsers.find((b) => fs.existsSync(b));
if (!bin) throw new Error('No Chrome/Edge found');

const src = path.join(__dirname, '..', 'src');
// Headless windows have a minimum width, so content is sized in px and the shot crops the top-left corner.
function shot(html, out, w, h, query = '') {
  execFileSync(bin, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${path.join(src, out)}`, pathToFileURL(path.join(__dirname, html)).href + query,
  ], { stdio: 'ignore' });
  console.log(`src/${out}  ${w}x${h}`);
}
shot('icon.html', 'icon-192.png', 192, 192, '?s=192');
shot('icon.html', 'icon-512.png', 512, 512, '?s=512');
shot('icon.html', 'apple-touch-icon.png', 180, 180, '?s=180');
shot('og.html', 'og.png', 1200, 630);
