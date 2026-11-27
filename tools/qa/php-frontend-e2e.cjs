/* Браузерный E2E полного стека в режиме backend=php (REG.RU / PHP / SQLite).
 *
 * Поднимает статический фронтенд (репозиторий) на 127.0.0.1:4173, бэкенд — PHP-сервер
 * на FAIR_API_URL (по умолчанию http://127.0.0.1:4180). Инжектирует window.FAIR_CONFIG
 * (backend=php + apiBase). Проверяет афишу/реестр, документы без авторизации, вход,
 * дашборд (102), цикл создание→публикация→показ, поиск по ИНН и мобильную админку.
 *
 * Запуск: FAIR_API_URL=http://127.0.0.1:4180 node tools/qa/php-frontend-e2e.cjs
 */

const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(__dirname, "..", "..");
const API = (process.env.FAIR_API_URL || "http://127.0.0.1:4180").replace(/\/+$/, "");
const MOUNT = (process.env.FAIR_API_MOUNT || "/fair-api").replace(/^\/+|\/+$/g, "");
const API_BASE = API + (MOUNT ? "/" + MOUNT : "");
const ADMIN_EMAIL = process.env.FAIR_ADMIN_EMAIL || "admin@4sezona.ru";
const ADMIN_PASSWORD = process.env.FAIR_ADMIN_PASSWORD || "local-demo-1234";
const STATIC_PORT = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".pdf": "application/pdf", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function startStatic(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      if (p === "/admin" || p === "/admin/") p = "/admin/index.html";
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });
const hasHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const srv = await startStatic(STATIC_PORT);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const newPage = async (viewport) => {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript((cfg) => { window.FAIR_CONFIG = cfg; }, { backend: "php", apiBase: API_BASE });
    return ctx.newPage();
  };
  const goto = (page, url, sel) => page.goto(url, { waitUntil: "domcontentloaded" }).then(() => sel ? page.waitForSelector(sel, { timeout: 8000 }) : null);

  // 1. Публичная афиша
  let page = await newPage({ width: 1280, height: 900 });
  await goto(page, `http://127.0.0.1:${STATIC_PORT}/events.html`, ".event-card");
  const cards = await page.locator(".event-card").count();
  ok("Публичная афиша (php): карточки мероприятий", cards >= 3, `cards=${cards}`);
  await page.close();

  // 2. Публичный реестр (102)
  page = await newPage({ width: 1280, height: 900 });
  await goto(page, `http://127.0.0.1:${STATIC_PORT}/participants.html`);
  await page.waitForTimeout(800);
  const hasRegistry = await page.evaluate(() => document.body.innerText.includes("102"));
  ok("Публичный реестр (php): признак «102» присутствует", hasRegistry);
  await page.close();

  // 3. Документы без авторизации
  for (const doc of ["/docs/privacy-policy.html", "/docs/public-offer.html", "/docs/docs-legal.html", "/docs/downloads/application.docx"]) {
    const st = await (await fetch(`http://127.0.0.1:${STATIC_PORT}${doc}`)).status;
    ok(`Документ без авторизации: ${doc}`, st === 200, `status=${st}`);
  }

  // 4. Вход в админку
  page = await newPage({ width: 1280, height: 900 });
  await goto(page, `http://127.0.0.1:${STATIC_PORT}/admin/`, "#login-view");
  ok("Админка (php): экран входа виден", await page.locator("#login-view").isVisible());
  await page.fill('#login-form input[name="email"]', ADMIN_EMAIL);
  await page.fill('#login-form input[name="password"]', ADMIN_PASSWORD);
  await page.click("#login-submit");
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 8000 });
  ok("Вход по логину/паролю (php) успешен", true);
  await page.waitForTimeout(600);
  const statParticipants = (await page.locator("#stat-participants").textContent()).trim();
  ok("Дашборд: счётчик участников = 102", statParticipants === "102", `participants=${statParticipants}`);

  // 5. Создать мероприятие → опубликовать → видно публично
  const title = "Приёмочный тест PHP " + Date.now();
  await page.click('[data-tab="events"]');
  await page.waitForTimeout(400);
  await page.click("#new-event-btn");
  await page.waitForSelector("#event-dialog[open]");
  await page.fill('#event-form input[name="title"]', title);
  await page.fill('#event-form input[name="date"]', "2026-12-30");
  await page.fill('#event-form textarea[name="description"]', "E2E PHP+SQLite.");
  await page.click('#event-form button[type="submit"]');
  await page.waitForTimeout(900);
  const created = await page.locator(".admin-table td", { hasText: title }).count();
  ok("Создание мероприятия через админку (php)", created > 0);
  await page.locator("tr", { hasText: title }).locator('[data-status]').first().click();
  await page.waitForTimeout(700);

  const pub = await newPage({ width: 1280, height: 900 });
  await goto(pub, `http://127.0.0.1:${STATIC_PORT}/events.html`, ".event-card");
  const visiblePublic = await pub.locator(".event-card", { hasText: title }).count();
  ok("Опубликованное мероприятие видно публично (php)", visiblePublic > 0);
  await pub.close();

  // 6. Реестр: редактирование + поиск по ИНН
  await page.click('[data-tab="registry"]');
  await page.waitForTimeout(800);
  const registryRows = await page.locator("#registry-table tbody tr").count();
  ok("Реестр: записи отображаются (102)", registryRows >= 100, `rows=${registryRows}`);
  await page.locator("#registry-table tbody tr").first().locator('[data-edit]').click();
  await page.waitForSelector("#registry-dialog[open]");
  const inn = "987654321098";
  await page.fill('#registry-form input[name="inn"]', inn);
  await page.click('#registry-form button[type="submit"]');
  await page.waitForTimeout(700);
  await page.fill("#registry-admin-search", inn);
  await page.waitForTimeout(400);
  const searchRows = await page.locator("#registry-table tbody tr").count();
  ok("Реестр: поиск по ИНН находит запись", searchRows >= 1, `rows=${searchRows}`);
  await page.close();

  // 7. Мобильные версии без горизонтальной прокрутки
  const mEvents = await newPage({ width: 390, height: 844 });
  await goto(mEvents, `http://127.0.0.1:${STATIC_PORT}/events.html`, ".event-card");
  ok("Мобильная афиша 390px без горизонтальной прокрутки", !(await hasHorizontalScroll(mEvents)));
  await mEvents.close();

  const mAdm = await newPage({ width: 390, height: 844 });
  await goto(mAdm, `http://127.0.0.1:${STATIC_PORT}/admin/`, "#login-view");
  await mAdm.fill('#login-form input[name="email"]', ADMIN_EMAIL);
  await mAdm.fill('#login-form input[name="password"]', ADMIN_PASSWORD);
  await mAdm.click("#login-submit");
  await mAdm.waitForSelector("#app-view:not([hidden])", { timeout: 8000 });
  await mAdm.waitForTimeout(500);
  ok("Мобильная админка 390px без горизонтальной прокрутки", !(await hasHorizontalScroll(mAdm)));
  await mAdm.close();

  await browser.close();
  srv.close();

  let pass = 0;
  for (const r of results) { console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`); if (r.pass) pass++; }
  console.log(`\nИтог: ${pass}/${results.length} проверок пройдено.`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
