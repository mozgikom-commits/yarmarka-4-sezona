/* Общая конфигурация данных для публичного сайта и админки.
 *
 * backend: "static"    — публичный сайт читает локальные JSON (без бэкенда);
 *           "supabase" — Supabase (Postgres + Auth + Storage);
 *           "local"    — локальный тестовый сервер (./tools/local-server).
 *
 * Значения Supabase подставляются владельцем. Ключи в репозитории не хранятся.
 * При запуске локального тестового сервера (порт 4173) по умолчанию используется
 * бэкенд "local"; иначе — "static" (публичный сайт читает локальные JSON).
 */
const __defaultBackend = (typeof location !== "undefined" && location.port === "4173") ? "local" : "static";
window.FAIR_CONFIG = window.FAIR_CONFIG || {
  backend: __defaultBackend,
  supabaseUrl: "",
  supabaseAnonKey: "",
  localApi: "/api"
};

(function () {
  const cfg = window.FAIR_CONFIG;
  cfg.isSupabase = () => cfg.backend === "supabase" && cfg.supabaseUrl && cfg.supabaseAnonKey;
  cfg.isLocal = () => cfg.backend === "local";
})();
