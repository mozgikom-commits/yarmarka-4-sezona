/* Снимки интерфейсов для отчёта о приёмке. Запуск с NODE_PATH на qa/node_modules. */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://127.0.0.1:4173";
const OUT = path.resolve(__dirname, "..", "..", "screenshots");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const shot = async (page, name, full = true) => {
    await page.screenshot({ path: path.join(OUT, name), fullPage: full });
    console.log("shot:", name);
  };

  // 1. Публичная страница мероприятий
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/events.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "01-events-desktop.png");

  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/events.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "02-events-mobile.png");
  await page.close();

  // 2. Админка: экран входа (неавторизованный доступ)
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const loginVisible = await page.locator("#login-view").isVisible();
  console.log("login visible (unauthorized):", loginVisible);
  await shot(page, "03-admin-login-desktop.png", false);
  await page.close();

  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "04-admin-login-mobile.png", false);
  await page.close();

  // 3. Админка: вход и рабочие вкладки (desktop)
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await page.fill('#login-form input[name="email"]', "admin@4sezona.ru");
  await page.fill('#login-form input[name="password"]', "demo1234");
  await page.click("#login-submit");
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(600);
  await shot(page, "05-admin-dashboard-desktop.png", false);

  await page.click('[data-tab="events"]');
  await page.waitForTimeout(500);
  await shot(page, "06-admin-events-desktop.png", false);

  await page.click('[data-tab="registry"]');
  await page.waitForTimeout(600);
  await shot(page, "07-admin-registry-desktop.png", false);
  await page.close();

  // 4. Админка (mobile): вход, дашборд, реестр
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await page.fill('#login-form input[name="email"]', "admin@4sezona.ru");
  await page.fill('#login-form input[name="password"]', "demo1234");
  await page.click("#login-submit");
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(600);
  await shot(page, "08-admin-dashboard-mobile.png", false);

  await page.click("#admin-menu-toggle");
  await page.waitForTimeout(300);
  await page.click('[data-tab="registry"]');
  await page.waitForTimeout(600);
  await shot(page, "09-admin-registry-mobile.png", false);
  await page.close();

  await browser.close();
  console.log("done. output:", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
