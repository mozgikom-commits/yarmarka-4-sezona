/* E2E облачного Supabase: Auth, RLS (реестр/события/журнал), Storage.
 * Читает `../.env.supabase` (переменные владельца, вне git). Только синтетические данные.
 * Запуск: NODE_PATH=./node_modules node supabase-e2e.cjs
 *
 * Проверяет: публичный реестр без служебных полей; аноним не читает/не пишет базовые
 * таблицы; вход админа; CRUD события (черновик скрыт → опубликовано видно); журнал;
 * storage (аноним не пишет, админ пишет, публичный URL доступен).
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..", "..");
const envFile = path.join(ROOT, ".env.supabase");
if (!fs.existsSync(envFile)) {
  console.error("Нет .env.supabase — нужны доступы владельца (см. .env.supabase.example).");
  process.exit(2);
}
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const url = env.SUPABASE_URL, anon = env.SUPABASE_ANON_KEY, sr = env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = env.FAIR_ADMIN_EMAIL, adminPw = env.FAIR_ADMIN_PASSWORD;
if (!url || !anon || !sr || !adminEmail || !adminPw) {
  console.error("Неполные переменные в .env.supabase (нужны URL/ANON/SERVICE_ROLE/ADMIN_EMAIL/ADMIN_PASSWORD).");
  process.exit(2);
}

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

(async () => {
  const anonC = createClient(url, anon, { auth: { persistSession: false } });
  const srC = createClient(url, sr, { auth: { persistSession: false } });

  // ---- Подготовка: администратор (идемпотентно) ----
  let adminUser = (await srC.auth.admin.listUsers({ perPage: 1000 })).data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    const cu = await srC.auth.admin.createUser({ email: adminEmail, password: adminPw, email_confirm: true });
    adminUser = cu.data?.user;
  }
  if (adminUser?.id) {
    await srC.from("admin_users").upsert({ user_id: adminUser.id }, { onConflict: "user_id" });
  }
  ok("Администратор подготовлен (auth + admin_users)", Boolean(adminUser?.id), adminEmail);

  // ---- 1. Публичный реестр: только id,name,products ----
  const pub = await anonC.from("public_registry").select("*").limit(5);
  const pubCols = pub.data?.[0] ? Object.keys(pub.data[0]).sort().join(",") : "";
  ok("Аноним читает public_registry", !pub.error && pub.data.length >= 1, pub.error?.message || `rows=${pub.data?.length}`);
  ok("public_registry отдаёт только id,name,products", pubCols === "id,name,products", `cols=${pubCols || "(нет строк)"}`);

  // ---- 2. Аноним не читает базовый registry ----
  const reg = await anonC.from("registry").select("*").limit(5);
  ok("Аноним не читает registry (RLS)", !!reg.error || reg.data.length === 0, reg.error?.message || `rows=${reg.data?.length}`);

  // ---- 3. Аноним видит только published события ----
  const evs = await anonC.from("events").select("id,status");
  const onlyPublished = !evs.error && evs.data.every((e) => e.status === "published");
  ok("Аноним видит только published события", onlyPublished, evs.error?.message);

  // ---- 4. Аноним не может вставить событие ----
  const ins = await anonC.from("events").insert({ title: "hack", description: "", event_date: "2026-12-01", start_time: "12:00", status: "published" }).select();
  ok("Аноним не может вставить событие (RLS)", !!ins.error, ins.error?.message);

  // ---- 5. Вход администратора ----
  const login = await anonC.auth.signInWithPassword({ email: adminEmail, password: adminPw });
  const access = login.data?.session?.access_token;
  ok("Вход администратора по логину/паролю", !!access, login.error?.message);
  const adminC = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: access ? { Authorization: `Bearer ${access}` } : {} }
  });

  // ---- 6. Админ читает служебные поля реестра ----
  const areg = await adminC.from("registry").select("id,name,products,inn,phone,settlement").limit(5);
  ok("Админ читает registry со служебными полями", !areg.error && areg.data.length >= 1, areg.error?.message || `rows=${areg.data?.length}`);

  // ---- 7. Цикл: черновик скрыт → публикация видна ----
  const title = `E2E синтетика ${Date.now()}`;
  const created = await adminC.from("events").insert({ title, description: "synthetic", event_date: "2026-12-31", start_time: "12:00", status: "draft" }).select().single();
  const evId = created.data?.id;
  ok("Админ создаёт черновик события", !created.error && !!evId, created.error?.message);
  if (evId) {
    const anonDraft = await anonC.from("events").select("id").eq("id", evId);
    ok("Аноним не видит черновик", !anonDraft.error && anonDraft.data.length === 0, `rows=${anonDraft.data?.length}`);
    await adminC.from("events").update({ status: "published" }).eq("id", evId);
    const anonPub = await anonC.from("events").select("id").eq("id", evId);
    ok("После публикации аноним видит событие", !anonPub.error && anonPub.data.length === 1, `rows=${anonPub.data?.length}`);
  }

  // ---- 8. Журнал изменений ----
  const clog = await adminC.from("change_log").select("id").limit(1);
  ok("Журнал изменений доступен админу и непуст", !clog.error && clog.data.length >= 1, clog.error?.message || `rows=${clog.data?.length}`);

  // ---- 9/10. Storage: аноним не пишет, админ пишет, URL публичен ----
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upAnon = await anonC.storage.from("event-covers").upload(`e2e-anon-${Date.now()}.png`, png, { contentType: "image/png" });
  ok("Аноним не может загрузить файл в storage (RLS)", !!upAnon.error, upAnon.error?.message);

  const upAdmin = await adminC.storage.from("event-covers").upload(`e2e-${Date.now()}.png`, png, { contentType: "image/png" });
  ok("Админ загружает файл в storage", !upAdmin.error, upAdmin.error?.message);
  if (!upAdmin.error) {
    const purl = adminC.storage.from("event-covers").getPublicUrl(upAdmin.data.path).data.publicUrl;
    const fr = await fetch(purl);
    ok("Публичный URL файла доступен анонимно", fr.status === 200, `status=${fr.status}`);
  }

  // ---- cleanup синтетики ----
  if (evId) await adminC.from("events").delete().eq("id", evId);

  let pass = 0;
  for (const r of results) { console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`); if (r.pass) pass++; }
  console.log(`\nИтог: ${pass}/${results.length} E2E Supabase проверок пройдено.`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
