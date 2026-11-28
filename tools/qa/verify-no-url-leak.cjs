/* Проверка безопасности: при отключённом JS форма входа должна отправляться POST,
 * а логин/пароль НЕ должны попадать в URL (GET). */
const { chromium } = require("playwright-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_URL = "https://mozgikom-commits.github.io/yarmarka-4-sezona/admin/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // JS отключён — имитация сбоя JavaScript.
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();

  let submitted = null;
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/admin/") && (r.method() !== "GET" || u.includes("email="))) {
      submitted = { method: r.method(), url: u };
    }
  });

  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-form", { timeout: 20000 });
  await page.fill('#login-form input[name="email"]', "ADMINDEV");
  await page.fill('#login-form input[name="password"]', "secret-pass-123");
  await page.press('#login-form input[name="password"]', "Enter");
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  const leak = /[?&](email|password)=/i.test(finalUrl);
  console.log("submitted =", JSON.stringify(submitted));
  console.log("finalUrl =", finalUrl);
  console.log(leak ? "FAIL  логин/пароль попали в URL" : "PASS  логин/пароль НЕ в URL");

  const ok = !leak && submitted && submitted.method === "POST";
  console.log(ok ? "PASS  форма без JS отправляет POST (метод=" + submitted.method + ")" : "FAIL  метод не POST: " + (submitted && submitted.method));

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
