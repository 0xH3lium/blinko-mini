const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors=[]; page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()) }); page.on('pageerror', e=>errors.push('PAGEERROR '+e.message));
  const log=(...a)=>console.log(...a);
  try {
    await page.goto('http://localhost:3000/?t=' + Date.now(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    log('theme:', await page.evaluate(()=>({theme:document.documentElement.dataset.theme,bg:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color})));
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-dark-real.png' });

    // Search filtering.
    const search = page.getByLabel('Search your blinks');
    await search.fill('tag system');
    await page.waitForTimeout(900);
    log('search cards:', await page.locator('article').count());
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-search.png' });
    await search.fill('');
    await page.waitForTimeout(900);

    // Promote the newest blink through the card action.
    const blinkBefore = await page.locator('article').count();
    const firstCard = page.locator('article').first();
    const promoteBtn = firstCard.getByRole('button', { name: 'Promote to Note' });
    if (await promoteBtn.count()) {
      await promoteBtn.click();
      await page.waitForTimeout(1200);
      log('promote toast:', await page.getByRole('status').innerText().catch(()=>'NONE'));
      log('blink count before/after promote:', blinkBefore, await page.locator('article').count());
      await page.getByRole('button', { name: 'Notes' }).click();
      await page.waitForTimeout(900);
      log('promoted note top title:', await page.locator('article h2').first().innerText().catch(()=>'NONE'));
    }

    // Archive, then restore from archived view.
    await page.getByRole('button', { name: 'Blinks' }).click();
    await page.waitForTimeout(700);
    const beforeArchive = await page.locator('article').count();
    await page.locator('article').first().getByRole('button', { name: 'Archive' }).click();
    await page.waitForTimeout(1100);
    log('archive count:', beforeArchive, '->', await page.locator('article').count());
    await page.getByRole('button', { name: 'Active' }).click();
    await page.waitForTimeout(900);
    log('archived view cards:', await page.locator('article').count());
    await page.screenshot({ path: 'E:/Blink/screenshots/blinks-archived.png' });
    await page.locator('article').first().getByRole('button', { name: 'Restore' }).click();
    await page.waitForTimeout(1000);
    log('archived after restore:', await page.locator('article').count());
    await page.getByRole('button', { name: 'Archived' }).click();
    await page.waitForTimeout(700);

    // Unsaved close confirmation.
    if (await page.locator('article').count()) {
      await page.locator('article').first().getByRole('button', { name: /^Open blink/ }).click();
      await page.waitForTimeout(300);
      await page.getByLabel('Content').fill('Unsaved edit for QA');
      await page.getByRole('button', { name: 'Close editor' }).click();
      await page.waitForTimeout(300);
      log('discard dialog:', await page.getByRole('alertdialog').innerText().catch(()=>'NONE'));
      await page.getByRole('button', { name: 'Keep editing' }).click();
      await page.waitForTimeout(200);
      log('editor still open:', await page.getByLabel('Content').count());
      await page.getByRole('button', { name: 'Close editor' }).click();
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'Discard changes' }).click();
      await page.waitForTimeout(400);
      log('editor closed:', (await page.getByLabel('Content').count()) === 0);
    }

    // Narrow notes layout.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(800);
    log('narrow doc overflow:', await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth})));
    await page.screenshot({ path: 'E:/Blink/screenshots/notes-narrow-dark.png' });
    await page.getByRole('button', { name: /New/ }).click();
    await page.waitForTimeout(400);
    log('narrow editor overflow:', await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth})));
    await page.screenshot({ path: 'E:/Blink/screenshots/editor-narrow-dark.png' });
  } catch (err) {
    log('FLOW ERROR:', err.message);
    await page.screenshot({ path: 'E:/Blink/screenshots/extended-error.png' });
    process.exitCode = 1;
  } finally {
    log('console errors:', errors);
    await browser.close();
  }
})();
