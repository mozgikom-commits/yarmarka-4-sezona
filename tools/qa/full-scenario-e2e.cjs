/* Полный пользовательский сценарий на БОЕВОЙ версии (production).
 *
 * Требования: FAIR_ADMIN_LOGIN (по умолчанию ADMINDEV), FAIR_ADMIN_PASSWORD.
 * Открывает админку БЕЗ параметров URL (как по ссылке «Вход для сотрудников»)
 * и выполняет вход/кабинет/реестр/мероприятия/выход/повторный вход в десктопном
 * и мобильном режиме. Неверный пароль проверяется ПОСЛЕДНИМ, чтобы не упираться
 * в rate-limit (лимит 5 попыток/окно). Снимки сохраняются в screenshots/.
 */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_URL = "https://mozgikom-commits.github.io/yarmarka-4-sezona/admin/";
const LOGIN = process.env.FAIR_ADMIN_LOGIN || "ADMINDEV";
const PASSWORD = process.env.FAIR_ADMIN_PASSWORD || "";
const OUT = path.resolve(__dirname, "..", "..", "screenshots");

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

(async () => {
  if (!PASSWORD) throw new Error("FAIR_ADMIN_PASSWORD not set");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const login = async (page, password) => {
    await page.fill('#login-form input[name="email"]', LOGIN);
    await page.fill('#login-form input[name="password"]', password);
    await page.click("#login-submit");
  };
  const waitDashboard = (page) => page.waitForFunction(
    () => document.querySelector("#stat-participants")?.textContent?.trim() === "102",
    { timeout: 20000 }
  );

  // ---------- ДЕСКТОП ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-view", { timeout: 20000 });
  await page.waitForFunction(() => window.fairData && window.fairData.backendType, { timeout: 20000 });
  const backendType = await page.evaluate(() => window.fairData.backendType);
  ok("1. Админка без параметров → PHP-бэкенд", backendType === "php", `backend=${backendType}`);
  await page.screenshot({ path: path.join(OUT, "prod-01-login-desktop.png") });

  await login(page, PASSWORD);
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 20000 });
  await waitDashboard(page);
  ok("2. Вход ADMINDEV успешен (кабинет открыт)", true);
  const statPublished = (await page.locator("#stat-published").textContent()).trim();
  const statParticipants = (await page.locator("#stat-participants").textContent()).trim();
  ok("3. Дашборд: реестр 102 / мероприятия", statParticipants === "102" && statPublished !== "—", `участников=${statParticipants}, опубликовано=${statPublished}`);
  await page.screenshot({ path: path.join(OUT, "prod-02-dashboard-desktop.png") });

  await page.click('.side-link[data-tab="registry"]');
  await page.waitForSelector("#registry-summary", { timeout: 20000 });
  await page.waitForFunction(() => (document.querySelector("#registry-summary") || {}).textContent?.includes("102"), { timeout: 20000 });
  const registrySummary = (await page.locator("#registry-summary").textContent()).trim();
  ok("4. Реестр участников доступен", registrySummary.includes("102"), registrySummary);
  await page.screenshot({ path: path.join(OUT, "prod-03-registry-desktop.png") });

  await page.click('.side-link[data-tab="events"]');
  await page.waitForSelector("#events-table table", { timeout: 20000 });
  const eventRows = await page.locator("#events-table tbody tr").count();
  ok("5. Раздел мероприятий доступен", eventRows >= 4, `строк=${eventRows}`);
  await page.screenshot({ path: path.join(OUT, "prod-04-events-desktop.png") });

  // Выход
  await page.click("#logout-btn");
  await page.waitForSelector("#login-view:not([hidden])", { timeout: 20000 });
  ok("6. Выход выполнен", true);
  await page.screenshot({ path: path.join(OUT, "prod-05-logout-desktop.png") });

  // Повторный вход
  await login(page, PASSWORD);
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 20000 });
  await waitDashboard(page);
  ok("7. Повторный вход успешен", true);

  // Сохранение сессии после обновления страницы
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.fairData && window.fairData.backendType, { timeout: 20000 });
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 20000 });
  await waitDashboard(page);
  ok("7b. Сессия сохранена после обновления страницы", true);
  await page.screenshot({ path: path.join(OUT, "prod-09-session-after-refresh-desktop.png") });

  await page.click("#logout-btn");
  await page.waitForSelector("#login-view:not([hidden])", { timeout: 20000 });
  await ctx.close();

  // ---------- МОБАЙЛ ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  await mpage.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await mpage.waitForSelector("#login-view", { timeout: 20000 });
  await mpage.waitForFunction(() => window.fairData && window.fairData.backendType, { timeout: 20000 });
  await mpage.screenshot({ path: path.join(OUT, "prod-07-login-mobile.png") });
  await login(mpage, PASSWORD);
  await mpage.waitForSelector("#app-view:not([hidden])", { timeout: 20000 });
  await waitDashboard(mpage);
  ok("8. Мобильный режим: вход успешен", true);
  await mpage.screenshot({ path: path.join(OUT, "prod-08-dashboard-mobile.png") });
  await mctx.close();

  // ---------- НЕВЕРНЫЙ ПАРСЛЬ (последним, чтобы не ловить rate-limit) ----------
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wpage = await wctx.newPage();
  await wpage.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await wpage.waitForSelector("#login-view", { timeout: 20000 });
  await login(wpage, "definitely-wrong-password-123");
  await wpage.waitForSelector("#login-error:not([hidden])", { timeout: 20000 });
  const loginErr = (await wpage.locator("#login-error").textContent()).trim();
  ok("9. Неверный пароль отклонён", /Неверный логин или пароль/.test(loginErr), loginErr);
  await wpage.screenshot({ path: path.join(OUT, "prod-06-wrong-password-desktop.png") });
  await wctx.close();

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== ИТОГ ===");
  console.log(`Пройдено: ${results.length - failed.length}/${results.length}`);
  if (failed.length) { failed.forEach((f) => console.log("FAIL:", f.name)); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
