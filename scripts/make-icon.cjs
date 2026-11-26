// Renders assets/icon.png (512x512) from static/icon.svg with Chromium.
// Run after editing the SVG: node scripts/make-icon.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'static', 'icon.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
  await page.screenshot({ path: path.join(root, 'assets', 'icon.png'), omitBackground: true });
  await browser.close();
})();
