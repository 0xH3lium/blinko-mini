const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'light', deviceScaleFactor: 2 });
  await page.goto('http://localhost:3000/?final=' + Date.now(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'E:/Blink/screenshots/blinks-light.png' });
  await page.getByRole('button', { name: 'Notes' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'E:/Blink/screenshots/notes-light.png' });
  await page.locator('article').first().getByRole('button', { name: /^Open note/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'E:/Blink/screenshots/editor-light.png' });
  // Desktop check.
  const desk = await browser.newPage({ viewport: { width: 1100, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 });
  await desk.goto('http://localhost:3000/?desk=' + Date.now(), { waitUntil: 'networkidle' });
  await desk.waitForTimeout(1000);
  await desk.screenshot({ path: 'E:/Blink/screenshots/blinks-desktop.png' });
  console.log(await desk.evaluate(()=>({app:document.querySelector('#root > div')?.getBoundingClientRect().width, body:document.body.scrollWidth, win:innerWidth})));
  await browser.close();
})();
