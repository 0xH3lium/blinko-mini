const { chromium } = require('playwright-core');
const token = process.env.BOT_TOKEN || '';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const errors=[]; page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()) }); page.on('pageerror', e=>errors.push('PAGEERROR '+e.message));
  try {
    await page.goto('http://localhost:3000/?t=' + Date.now(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'E:/Blink/screenshots/notes-light-2.png' });
    await page.getByRole('button', { name: /New/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'E:/Blink/screenshots/editor-new-light-2.png' });
    const unique = 'UI flow note ' + Date.now();
    await page.getByLabel('Title').fill(unique);
    await page.getByLabel('Content').fill('This note verifies the editor and #flow.\n\nA second paragraph.');
    await page.getByLabel('Add a tag').fill('qa');
    await page.getByLabel('Add a tag').press('Enter');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'E:/Blink/screenshots/editor-filled-light-2.png' });
    const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
    console.log('save disabled before:', await saveBtn.isDisabled());
    await saveBtn.click();
    await page.waitForTimeout(1200);
    console.log('editor gone:', (await page.locator('textarea[aria-label="Content"]').count()) === 0);
    console.log('note title visible:', await page.getByRole('heading', { name: unique }).count());
    await page.screenshot({ path: 'E:/Blink/screenshots/notes-after-save.png' });

    // Editor for an existing note and clean close.
    await page.locator('article').first().getByRole('button', { name: /^Open note/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'E:/Blink/screenshots/editor-existing-light-2.png' });
    await page.getByRole('button', { name: 'Close editor' }).click();
    await page.waitForTimeout(300);
    console.log('editor gone after back:', (await page.locator('textarea[aria-label="Content"]').count()) === 0);

    // Capture a blink through the dock.
    await page.getByRole('button', { name: 'Blinks' }).click();
    await page.waitForTimeout(500);
    const before = await page.locator('article').count();
    await page.getByLabel('Capture a blink').fill('A UI-captured blink #qa #capture');
    await page.getByLabel('Capture a blink').press('Enter');
    await page.waitForTimeout(1200);
    const after = await page.locator('article').count();
    console.log('capture count before/after:', before, after);
    console.log('toast text:', await page.getByRole('status').innerText().catch(()=>'NONE'));
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-after-capture.png' });

    // Dark mode screenshot.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-dark.png' });

    // Narrow layout overflow check.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(400);
    const narrow = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      nav: [...document.querySelectorAll('nav button')].map(b=>b.getBoundingClientRect().toJSON()),
      capture: document.querySelector('form')?.getBoundingClientRect().toJSON(),
    }));
    console.log('narrow:', JSON.stringify(narrow));
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-narrow-dark.png' });
  } catch (err) {
    console.log('FLOW ERROR:', err.message);
    console.log('console errors:', errors);
    await page.screenshot({ path: 'E:/Blink/screenshots/flow-error.png' });
    process.exitCode = 1;
  } finally {
    console.log('console errors total:', errors);
    await browser.close();
  }
})();
