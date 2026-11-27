/* Проверка входа в БОЕВУЮ админку ярмарки (production).
 *
 * Открывает GitHub Pages /admin/ с параметрами backend=php + apiBase=<боевой API>
 * и выполняет реальный вход администратора. Креды передаются через переменные
 * окружения (не хардкодятся в репозитории).
 *
 * Запуск:
 *   FAIR_ADMIN_URL="https://mozgikom-commits.github.io/yarmarka-4-sezona/admin/?backend=php&apiBase=https%3A%2F%2Fmozgikomlab.ru%2Ffair-api" \
 *   FAIR_ADMIN_EMAIL=admin@4sezona.ru FAIR_ADMIN_PASSWORD=... \
 *   node tools/qa/prod-admin-login.cjs
 */

const { chromium } = require("playwright-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_URL = process.env.FAIR_ADMIN_URL
  || "https://mozgikom-commits.github.io/yarmarka-4-sezona/admin/?backend=php&apiBase=https%3A%2F%2Fmozgikomlab.ru%2Ffair-api";
const EMAIL = process.env.FAIR_ADMIN_EMAIL || "admin@4sezona.ru";
const PASSWORD = process.env.FAIR_ADMIN_PASSWORD || "";

(async () => {
  if (!PASSWORD) throw new Error("FAIR_ADMIN_PASSWORD not set");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-view", { timeout: 20000 });
  console.log("PASS  экран входа виден (production /admin/)");

  await page.fill('#login-form input[name="email"]', EMAIL);
  await page.fill('#login-form input[name="password"]', PASSWORD);
  await page.click("#login-submit");
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 20000 });

  // Ждём загрузки данных дашборда (асинхронный listEvents/listRegistry).
  await page.waitForFunction(
    () => document.querySelector("#stat-participants")?.textContent?.trim() === "102",
    { timeout: 20000 }
  );
  const participants = (await page.locator("#stat-participants").textContent()).trim();
  console.log(`PASS  вход администратора в боевую админку (дашборд, участников=${participants})`);
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
