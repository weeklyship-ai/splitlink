// Build and publish dist/ to the gh-pages branch (GitHub Pages).
const { execSync } = require('child_process');
const run = (cmd) => execSync(cmd, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

run('node build.js');
if (run('git status --porcelain dist')) {
  console.error('dist/ has uncommitted changes — commit them first so the deploy matches main.');
  process.exit(1);
}
const sha = run('git subtree split --prefix dist');
run(`git push --force origin ${sha}:refs/heads/gh-pages`);
console.log(`Deployed ${sha.slice(0, 7)} → https://rax0609.github.io/splitlink/`);
