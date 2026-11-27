/* Общая конфигурация данных для публичного сайта и админки.
 *
 * backend: "static"    — публичный сайт читает локальные JSON (без бэкенда);
 *           "supabase" — Supabase (Postgres + Auth + Storage);
 *           "php"      — REG.RU (PHP + SQLite), REST /api/*;
 *           "local"    — локальный тестовый Node-сервер (./tools/local-server).
 *
 * Порядок определения конфигурации:
 *   1) window.FAIR_CONFIG, если задан до загрузки этого скрипта (сборка/хостинг);
 *   2) параметры URL (?backend=php&apiBase=…), которые подставляет загрузчик Tilda
 *      в src iframe — реальные адреса/ключи в репозиторий не попадают;
 *   3) localStorage — конфигурация из параметров сохраняется, чтобы пережить переходы
 *      между страницами внутри iframe на том же origin;
 *   4) значение по умолчанию: "local" на локальном тестовом сервере (порт 4173),
 *      иначе "static" (публичный сайт читает локальные JSON).
 *
 * anon-ключ Supabase публичный и используется в браузере; service_role-ключ сюда НЕ вставляется.
 * apiBase для backend=php — абсолютный или относительный базовый URL REST API.
 */
const __FAIR_LS_KEY = "fair4sezona:config";
const __FAIR_BACKENDS = ["static", "supabase", "php", "local"];

const __fairReadLs = () => {
  try {
    const raw = localStorage.getItem(__FAIR_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
};
const __fairWriteLs = (cfg) => {
  try { localStorage.setItem(__FAIR_LS_KEY, JSON.stringify(cfg)); } catch (_) {}
};
const __fairFromParams = () => {
  if (typeof location === "undefined" || !location.search) return null;
  const p = new URLSearchParams(location.search);
  const backend = p.get("backend");
  if (!__FAIR_BACKENDS.includes(backend)) return null;
  return {
    backend,
    supabaseUrl: p.get("supabaseUrl") || "",
    supabaseAnonKey: p.get("supabaseAnonKey") || "",
    apiBase: p.get("apiBase") || ""
  };
};
const __fairDefault = () => ({
  backend: (typeof location !== "undefined" && location.port === "4173") ? "local" : "static",
  supabaseUrl: "",
  supabaseAnonKey: "",
  apiBase: "/api"
});
const __fairSanitize = (cfg) => ({
  backend: __FAIR_BACKENDS.includes(cfg && cfg.backend) ? cfg.backend : "static",
  supabaseUrl: typeof (cfg && cfg.supabaseUrl) === "string" ? cfg.supabaseUrl : "",
  supabaseAnonKey: typeof (cfg && cfg.supabaseAnonKey) === "string" ? cfg.supabaseAnonKey : "",
  apiBase: (cfg && cfg.apiBase) || (cfg && cfg.localApi) || "/api"
});

(function () {
  const preSet = window.FAIR_CONFIG;
  const paramCfg = __fairFromParams();
  let cfg;
  if (preSet) {
    cfg = __fairSanitize(preSet);
  } else {
    cfg = __fairSanitize(paramCfg || __fairReadLs() || __fairDefault());
    if (paramCfg) __fairWriteLs(cfg);
  }
  if (!cfg.isSupabase) {
    cfg.isSupabase = () => cfg.backend === "supabase" && Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }
  if (!cfg.isPhp) {
    cfg.isPhp = () => cfg.backend === "php";
  }
  if (!cfg.isLocal) {
    cfg.isLocal = () => cfg.backend === "local";
  }
  window.FAIR_CONFIG = cfg;
})();
