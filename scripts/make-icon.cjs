// Renders assets/icon.png (512x512) with Chromium. Run once: node scripts/make-icon.cjs
const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<body style="margin:0;background:transparent">
    <div style="width:512px;height:512px;border-radius:112px;background:linear-gradient(135deg,#3ea0ff,#1262d8);
      display:grid;place-items:center;font-size:280px;line-height:1">💬</div></body>`);
  await page.screenshot({ path: path.join(__dirname, '..', 'assets', 'icon.png'), omitBackground: true });
  await browser.close();
})();
