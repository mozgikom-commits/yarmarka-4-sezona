/* Диагностика: реальная видимость #login-view / #app-view через getComputedStyle. */
const { chromium } = require("playwright-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_URL = process.env.FAIR_ADMIN_URL
  || "https://mozgikom-commits.github.io/yarmarka-4-sezona/admin/?utm_source=chatgpt.com";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#login-view", { timeout: 30000 });

  const dump = async (label) => {
    const s = await page.evaluate(() => {
      const g = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          hiddenAttr: el.hasAttribute("hidden"),
          hiddenProp: el.hidden,
          display: cs.display,
          visibility: cs.visibility,
          rect: JSON.stringify(el.getBoundingClientRect())
        };
      };
      return { login: g("#login-view"), app: g("#app-view") };
    });
    console.log(`\n=== ${label} ===`);
    console.log("login-view:", JSON.stringify(s.login));
    console.log("app-view:  ", JSON.stringify(s.app));
    return s;
  };

  await dump("initial");

  // После "входа" — просто переключим hidden вручную, чтобы увидеть CSS-поведение,
  // без реального логина (проверяем именно CSS).
  await page.evaluate(() => {
    document.querySelector("#login-view").hidden = true;
    document.querySelector("#app-view").hidden = false;
  });
  await dump("after hidden toggle");

  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
