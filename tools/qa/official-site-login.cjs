/* Проверка входа через официальный сайт (Tilda → iframe GitHub Pages). */
const { chromium } = require("playwright-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OFFICIAL = "https://xn--4-8sboi4afs.online/";
const LOGIN = process.env.FAIR_ADMIN_LOGIN || "ADMINDEV";
const PASSWORD = process.env.FAIR_ADMIN_PASSWORD || "";

(async () => {
  if (!PASSWORD) throw new Error("FAIR_ADMIN_PASSWORD not set");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(OFFICIAL, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Дожидаемся iframe ярмарки (его создаёт блок Tilda T123).
  await page.waitForSelector("iframe", { timeout: 40000 });
  await page.waitForTimeout(2000);
  const frames = page.frames();
  console.log("frames:", frames.map((f) => f.url()).join(" | "));
  let frame = frames.find((f) => f.url().includes("mozgikom-commits.github.io"));
  if (!frame) throw new Error("yarmarka iframe not found");

  // Внутри iframe: ссылка «Вход для сотрудников» (./admin/).
  await frame.waitForSelector('a[href*="/admin/"]', { timeout: 30000 });
  await frame.click('a[href*="/admin/"]');
  await frame.waitForSelector("#login-view", { timeout: 30000 });
  await frame.waitForFunction(() => window.fairData && window.fairData.backendType, { timeout: 20000 });
  const backendType = await frame.evaluate(() => window.fairData.backendType);
  console.log("backendType =", backendType);

  await frame.fill('#login-form input[name="email"]', LOGIN);
  await frame.fill('#login-form input[name="password"]', PASSWORD);
  await frame.click("#login-submit");
  await frame.waitForSelector("#app-view:not([hidden])", { timeout: 25000 });
  await frame.waitForFunction(() => document.querySelector("#stat-participants")?.textContent?.trim() === "102", { timeout: 25000 });
  const participants = (await frame.locator("#stat-participants").textContent()).trim();
  console.log(`PASS  вход через официальный сайт: кабинет открыт, участников=${participants}`);
  console.log("URL верхнего окна (без пароля):", page.url());

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
