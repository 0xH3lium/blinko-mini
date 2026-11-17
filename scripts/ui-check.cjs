const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const errors=[]; page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()) }); page.on('pageerror', e=>errors.push('PAGEERROR '+e.message));
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const root = document.querySelector('#root');
    const app = root?.firstElementChild;
    const scroller = document.querySelector('.app-scroll');
    const cards = [...document.querySelectorAll('article')];
    const rect = (el) => el ? (({x,y,width,height})=>({x,y,width,height}))(el.getBoundingClientRect()) : null;
    return {
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      root: rect(root), app: rect(app), scroller: rect(scroller),
      cards: cards.map(rect),
      cardCount: cards.length,
      theme: document.documentElement.dataset.theme,
      bodyOverflow: getComputedStyle(document.body).overflow,
      text: document.body.innerText.slice(0,1000),
      consoleErrors: [],
      scrollHeight: scroller?.scrollHeight,
      clientHeight: scroller?.clientHeight,
      html: document.documentElement.outerHTML.slice(0,200),
    };
  });
  data.errors = errors;
  console.log(JSON.stringify(data, null, 2));
  await page.screenshot({ path: 'E:/Blink/screenshots/playwright-light.png', fullPage: false });
  await browser.close();
})();
