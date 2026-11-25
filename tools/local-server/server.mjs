/* Локальный тестовый сервер для приёмки функционала без Supabase.
 * Реализует серверную авторизацию, хранение мероприятий/реестра, журнал изменений
 * и загрузку файлов с проверкой. Используется только для локального тестирования.
 *
 * Запуск: node tools/local-server/server.mjs
 * Сайт:   http://127.0.0.1:4173/
 * Админ:  http://127.0.0.1:4173/admin/  (admin@4sezona.ru / demo1234)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const STATE_FILE = path.join(__dirname, "state.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const PORT = Number(process.env.PORT || 4173);

const ADMIN_EMAIL = process.env.FAIR_ADMIN_EMAIL || "admin@4sezona.ru";
const ADMIN_PASSWORD = process.env.FAIR_ADMIN_PASSWORD || "demo1234";

const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOC_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx"]);
const MAX_IMG = 10 * 1024 * 1024;
const MAX_DOC = 20 * 1024 * 1024;

const tokens = new Set();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const loadState = () => {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (_) { /* пересоздаём */ }
  return seedState();
};

const seedState = () => {
  const events = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "events.json"), "utf8")).events;
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "participants-public.json"), "utf8"));
  const participants = raw.participants || raw;
  const registry = participants.map((r) => ({
    id: crypto.randomUUID(), name: r.name, products: r.products || "",
    inn: "", phone: "", settlement: "", representative: "", status: "active", notes: "",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }));
  return { events, registry, changeLog: [] };
};

let state = loadState();
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const readBody = (req, limit) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > limit) { reject(new Error("body_too_large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const auth = (req) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return tokens.has(token);
};

const log = (entity, entityId, action, before, after) => {
  state.changeLog.unshift({
    id: crypto.randomUUID(), entity, entityId, action,
    changedAt: new Date().toISOString(), before, after
  });
  state.changeLog = state.changeLog.slice(0, 500);
};

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".woff2": "font/woff2"
};

const serveStatic = (req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/admin" || urlPath === "/admin/") urlPath = "/admin/index.html";

  if (urlPath.startsWith("/uploads/")) {
    const file = path.join(UPLOAD_DIR, path.basename(urlPath));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }

  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
};

const publicEvents = () => state.events
  .filter((e) => e.status === "published")
  .map((e) => ({
    id: e.id, title: e.title, description: e.description, event_date: e.event_date,
    start_time: e.start_time, end_time: e.end_time, place: e.place, cover_url: e.cover_url, status: e.status,
    photos: (e.photos || []), documents: (e.documents || [])
  }))
  .sort((a, b) => a.event_date.localeCompare(b.event_date));

const publicRegistry = () => state.registry
  .filter((r) => r.status === "active")
  .map((r) => ({ id: r.id, name: r.name, products: r.products }));

const findEvent = (id) => state.events.find((e) => String(e.id) === id);
const findRegistry = (id) => state.registry.find((r) => String(r.id) === id);

const cleanEvent = (body) => ({
  id: body.id && body.id !== "new" ? body.id : crypto.randomUUID(),
  title: String(body.title || "").trim(),
  description: String(body.description || "").trim(),
  event_date: String(body.event_date || body.date || "").slice(0, 10),
  start_time: String(body.start_time || body.time || "12:00").slice(0, 5),
  end_time: (body.end_time || body.endTime || "").toString().slice(0, 5) || null,
  place: String(body.place || "").trim(),
  cover_url: String(body.cover_url || body.coverUrl || ""),
  status: ["draft", "published", "archived"].includes(body.status) ? body.status : "draft"
});

const cleanRegistry = (body) => ({
  id: body.id && body.id !== "new" ? body.id : crypto.randomUUID(),
  name: String(body.name || "").trim(),
  products: String(body.products || "").trim(),
  inn: String(body.inn || "").trim(),
  phone: String(body.phone || "").trim(),
  settlement: String(body.settlement || "").trim(),
  representative: String(body.representative || "").trim(),
  status: body.status === "archived" ? "archived" : "active",
  notes: String(body.notes || "").trim()
});

const handleApi = async (req, res, urlPath) => {
  // ---- публичные ----
  if (req.method === "GET" && urlPath === "/api/public/events") return json(res, 200, publicEvents());
  if (req.method === "GET" && urlPath === "/api/public/registry") return json(res, 200, publicRegistry());

  // ---- авторизация ----
  if (req.method === "POST" && urlPath === "/api/auth/login") {
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    if (body.email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(24).toString("hex");
      tokens.add(token);
      return json(res, 200, { token, user: { email: ADMIN_EMAIL } });
    }
    return json(res, 401, { error: "unauthorized" });
  }
  if (req.method === "POST" && urlPath === "/api/auth/logout") {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) tokens.delete(h.slice(7));
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && urlPath === "/api/auth/session") {
    if (!auth(req)) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { user: { email: ADMIN_EMAIL } });
  }

  // ---- загрузка файлов (админ) ----
  if (req.method === "POST" && urlPath === "/api/upload") {
    if (!auth(req)) return json(res, 401, { error: "unauthorized" });
    const q = new URL(req.url, "http://x").searchParams;
    const bucket = q.get("bucket") || "event-documents";
    const name = q.get("name") || "file";
    const buf = await readBody(req, 25 * 1024 * 1024);
    const mime = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const ext = (name.split(".").pop() || "").toLowerCase();
    const isImage = IMG_TYPES.has(mime) && (bucket === "event-covers" || bucket === "event-photos");
    const isDoc = (DOC_TYPES.has(mime) || DOC_EXT.has(ext)) && bucket === "event-documents";
    const limit = isImage ? MAX_IMG : MAX_DOC;
    if (!isImage && !isDoc) return json(res, 400, { error: "Недопустимый тип файла для выбранного раздела." });
    if (buf.length > limit) return json(res, 400, { error: "Файл слишком большой." });
    const safeExt = isImage ? (ext || "bin") : ext;
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${safeExt}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buf);
    return json(res, 200, { url: `/uploads/${fileName}` });
  }

  // ---- мероприятия (админ) ----
  if (!auth(req)) return json(res, 401, { error: "unauthorized" });

  if (urlPath === "/api/events" && req.method === "GET") return json(res, 200, state.events.sort((a, b) => a.event_date.localeCompare(b.event_date)));
  if (urlPath === "/api/events" && req.method === "POST") {
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    const ev = cleanEvent(body);
    state.events.push(ev);
    log("event", ev.id, "insert", null, ev);
    saveState();
    return json(res, 201, ev);
  }

  const evMatch = urlPath.match(/^\/api\/events\/([^/]+)$/);
  if (evMatch && req.method === "PUT") {
    const id = evMatch[1];
    const idx = state.events.findIndex((e) => String(e.id) === id);
    if (idx < 0) return json(res, 404, { error: "not_found" });
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    const before = { ...state.events[idx] };
    if (body.status && !Object.keys(body).some((k) => k !== "status")) {
      state.events[idx].status = body.status;
    } else {
      const next = cleanEvent({ ...state.events[idx], ...body, id });
      state.events[idx] = { ...state.events[idx], ...next };
    }
    log("event", id, "update", before, state.events[idx]);
    saveState();
    return json(res, 200, state.events[idx]);
  }
  if (evMatch && req.method === "DELETE") {
    const id = evMatch[1];
    const idx = state.events.findIndex((e) => String(e.id) === id);
    if (idx < 0) return json(res, 404, { error: "not_found" });
    const [removed] = state.events.splice(idx, 1);
    log("event", id, "delete", removed, null);
    saveState();
    return json(res, 200, { ok: true });
  }

  const photoMatch = urlPath.match(/^\/api\/events\/([^/]+)\/photos$/);
  if (photoMatch && req.method === "POST") {
    const ev = findEvent(photoMatch[1]);
    if (!ev) return json(res, 404, { error: "not_found" });
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    ev.photos = ev.photos || [];
    ev.photos.push({ id: crypto.randomUUID(), url: body.url, caption: body.caption || "" });
    saveState();
    return json(res, 201, { ok: true });
  }
  const docMatch = urlPath.match(/^\/api\/events\/([^/]+)\/documents$/);
  if (docMatch && req.method === "POST") {
    const ev = findEvent(docMatch[1]);
    if (!ev) return json(res, 404, { error: "not_found" });
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    ev.documents = ev.documents || [];
    ev.documents.push({ id: crypto.randomUUID(), url: body.url, name: body.name || "Документ" });
    saveState();
    return json(res, 201, { ok: true });
  }

  // ---- реестр (админ) ----
  if (urlPath === "/api/registry" && req.method === "GET") return json(res, 200, state.registry.sort((a, b) => a.name.localeCompare(b.name, "ru")));
  if (urlPath === "/api/registry" && req.method === "POST") {
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    const rec = cleanRegistry(body);
    state.registry.push(rec);
    log("registry", rec.id, "insert", null, rec);
    saveState();
    return json(res, 201, rec);
  }
  if (urlPath === "/api/registry/import" && req.method === "POST") {
    const body = JSON.parse((await readBody(req, 10e6)).toString() || "{}");
    const rows = body.rows || [];
    let imported = 0;
    for (const r of rows) {
      const rec = cleanRegistry(r);
      const existing = state.registry.find((x) => x.name === rec.name || (rec.inn && x.inn === rec.inn));
      if (existing) {
        Object.assign(existing, rec, { id: existing.id });
        log("registry", existing.id, "update", null, existing);
      } else {
        state.registry.push(rec);
        log("registry", rec.id, "insert", null, rec);
      }
      imported++;
    }
    saveState();
    return json(res, 200, { imported, skipped: 0 });
  }

  const regMatch = urlPath.match(/^\/api\/registry\/([^/]+)$/);
  if (regMatch && req.method === "PUT") {
    const idx = state.registry.findIndex((r) => String(r.id) === regMatch[1]);
    if (idx < 0) return json(res, 404, { error: "not_found" });
    const body = JSON.parse((await readBody(req, 1e6)).toString() || "{}");
    const before = { ...state.registry[idx] };
    state.registry[idx] = cleanRegistry({ ...state.registry[idx], ...body, id: state.registry[idx].id });
    log("registry", state.registry[idx].id, "update", before, state.registry[idx]);
    saveState();
    return json(res, 200, state.registry[idx]);
  }
  if (regMatch && req.method === "DELETE") {
    const idx = state.registry.findIndex((r) => String(r.id) === regMatch[1]);
    if (idx < 0) return json(res, 404, { error: "not_found" });
    const [removed] = state.registry.splice(idx, 1);
    log("registry", regMatch[1], "delete", removed, null);
    saveState();
    return json(res, 200, { ok: true });
  }

  // ---- журнал (админ) ----
  if (urlPath === "/api/change-log" && req.method === "GET") return json(res, 200, state.changeLog);

  return json(res, 404, { error: "not_found" });
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  try {
    if (urlPath.startsWith("/api/")) return await handleApi(req, res, urlPath);
    serveStatic(req, res);
  } catch (ex) {
    if (ex.message === "body_too_large") return json(res, 413, { error: "Файл слишком большой." });
    json(res, 500, { error: String(ex && ex.message || ex) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fair-local] http://127.0.0.1:${PORT}/`);
  console.log(`[fair-local] admin: http://127.0.0.1:${PORT}/admin/  (${ADMIN_EMAIL} / ${ADMIN_PASSWORD})`);
});
