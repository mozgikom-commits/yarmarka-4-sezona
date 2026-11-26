/* Проверка горизонтального переполнения на целевых ширинах из P1/#3:
 * 360, 375, 393, 430, 768, 1440 px (публичные страницы + кабинет после входа).
 * Запуск: NODE_PATH=./node_modules node mobile-widths.cjs
 * Требует запущенный локальный сервер (порт 4173).
 */
const { chromium } = require("playwright-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://127.0.0.1:4173";
const WIDTHS = [360, 375, 393, 430, 768, 1440];

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // Публичные страницы
  for (const path of ["/events.html", "/index.html", "/participants.html"]) {
    for (const w of WIDTHS) {
      const p = await browser.newPage({ viewport: { width: w, height: 844 } });
      const resp = await p.goto(BASE + path, { waitUntil: "networkidle" });
      const status = resp ? resp.status() : 0;
      const hscroll = await overflow(p);
      ok(`${path} @${w}px: 200 и без горизонтальной прокрутки`, status === 200 && !hscroll, `status=${status} overflow=${hscroll}`);
      await p.close();
    }
  }

  // Кабинет администратора после входа
  for (const w of WIDTHS) {
    const p = await browser.newPage({ viewport: { width: w, height: 844 } });
    await p.goto(BASE + "/admin/", { waitUntil: "networkidle" });
    await p.fill('#login-form input[name="email"]', "admin@4sezona.ru");
    await p.fill('#login-form input[name="password"]', "demo1234");
    await p.click("#login-submit");
    await p.waitForSelector("#app-view:not([hidden])", { timeout: 5000 });
    await p.waitForTimeout(400);
    const hscroll = await overflow(p);
    ok(`/admin/ (вход) @${w}px: без горизонтальной прокрутки`, !hscroll, `overflow=${hscroll}`);
    await p.close();
  }

  await browser.close();

  let pass = 0;
  for (const r of results) { console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`); if (r.pass) pass++; }
  console.log(`\nИтог: ${pass}/${results.length} проверок ширины пройдено.`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
