/* Приёмочные проверки (браузерные). Запуск с NODE_PATH на qa/node_modules. */
const { chromium } = require("playwright-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://127.0.0.1:4173";
const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

const hasHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // 1. Неавторизованный доступ к API
  const unauth = await (await fetch(`${BASE}/api/events`)).status;
  ok("Серверная защита: /api/events без токена → 401", unauth === 401, `status=${unauth}`);

  // 2. Публичная страница мероприятий отображает карточки
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/events.html`, { waitUntil: "networkidle" });
  const cardCount = await page.locator(".event-card").count();
  ok("Публичная афиша: карточки мероприятий отображаются", cardCount >= 3, `cards=${cardCount}`);

  // 3. Календарь отображается
  const calDays = await page.locator(".calendar-day.has-event").count();
  ok("Календарь: даты с мероприятиями подсвечены", calDays > 0, `highlighted=${calDays}`);

  // 4. Мобильная версия без горизонтальной прокрутки (320/390)
  for (const w of [320, 390]) {
    const mp = await browser.newPage({ viewport: { width: w, height: 844 } });
    await mp.goto(`${BASE}/events.html`, { waitUntil: "networkidle" });
    const hscroll = await hasHorizontalScroll(mp);
    ok(`Мобильная афиша ${w}px без горизонтальной прокрутки`, !hscroll);
    await mp.close();
  }

  // 5. Админка: вход
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  ok("Неавторизованный вход в /admin показывает экран входа", await page.locator("#login-view").isVisible());

  await page.fill('#login-form input[name="email"]', "admin@4sezona.ru");
  await page.fill('#login-form input[name="password"]', "demo1234");
  await page.click("#login-submit");
  await page.waitForSelector("#app-view:not([hidden])", { timeout: 5000 });
  ok("Вход по логину/паролю успешен", true);

  await page.waitForTimeout(400);
  const statParticipants = await page.locator("#stat-participants").textContent();
  ok("Дашборд: счётчик участников реестра", /^\d+$/.test(statParticipants.trim()), `participants=${statParticipants}`);

  // 6. Полный цикл: создать мероприятие → опубликовать → видно на сайте
  await page.click('[data-tab="events"]');
  await page.waitForTimeout(300);
  await page.click("#new-event-btn");
  await page.waitForSelector("#event-dialog[open]");
  await page.fill('#event-form input[name="title"]', "Приёмочный тест: дегустация");
  await page.fill('#event-form input[name="date"]', "2026-12-30");
  await page.fill('#event-form textarea[name="description"]', "Мероприятие для проверки цикла публикации.");
  await page.click('#event-form button[type="submit"]');
  await page.waitForTimeout(800);
  const created = await page.locator(".admin-table td", { hasText: "Приёмочный тест: дегустация" }).count();
  ok("Создание мероприятия через админку", created > 0);

  // опубликовать созданное мероприятие
  const publishBtn = page.locator("tr", { hasText: "Приёмочный тест: дегустация" }).locator('[data-status]').first();
  await publishBtn.click();
  await page.waitForTimeout(600);

  // проверить на публичной странице
  const pub = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pub.goto(`${BASE}/events.html`, { waitUntil: "networkidle" });
  const visiblePublic = await pub.locator(".event-card", { hasText: "Приёмочный тест: дегустация" }).count();
  ok("Опубликованное мероприятие отображается на публичном сайте", visiblePublic > 0);
  await pub.close();

  // 7. Реестр: редактирование и поиск по ИНН
  await page.click('[data-tab="registry"]');
  await page.waitForTimeout(600);
  const registryRows = await page.locator("#registry-table tbody tr").count();
  ok("Реестр: отображаются записи (102)", registryRows >= 100, `rows=${registryRows}`);

  // открыть первую запись и задать ИНН
  await page.locator("#registry-table tbody tr").first().locator('[data-edit]').click();
  await page.waitForSelector("#registry-dialog[open]");
  await page.fill('#registry-form input[name="inn"]', "123456789012");
  await page.click('#registry-form button[type="submit"]');
  await page.waitForTimeout(600);

  // поиск по ИНН
  await page.fill("#registry-admin-search", "123456789012");
  await page.waitForTimeout(300);
  const searchRows = await page.locator("#registry-table tbody tr").count();
  ok("Реестр: поиск по ИНН находит запись", searchRows >= 1, `rows=${searchRows}`);
  await page.fill("#registry-admin-search", "");
  await page.waitForTimeout(200);

  // 8. Мобильная админка без горизонтальной прокрутки
  const madm = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await madm.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await madm.fill('#login-form input[name="email"]', "admin@4sezona.ru");
  await madm.fill('#login-form input[name="password"]', "demo1234");
  await madm.click("#login-submit");
  await madm.waitForSelector("#app-view:not([hidden])", { timeout: 5000 });
  await madm.waitForTimeout(400);
  const admHscroll = await hasHorizontalScroll(madm);
  ok("Мобильная админка 390px без горизонтальной прокрутки", !admHscroll);
  await madm.close();

  await browser.close();

  let pass = 0;
  for (const r of results) { console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`); if (r.pass) pass++; }
  console.log(`\nИтог: ${pass}/${results.length} проверок пройдено.`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
