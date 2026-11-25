/* Единый слой доступа к данным для публичного сайта и админки.
 * Реализации: static (локальные JSON), supabase (Postgres/Auth/Storage),
 * local (тестовый Node-сервер с серверной авторизацией).
 */
(function () {
  "use strict";

  const cfg = window.FAIR_CONFIG || {};

  const normalizeEvent = (e) => ({
    id: String(e.id),
    title: e.title || "",
    description: e.description || "",
    date: (e.event_date || e.date || "").slice(0, 10),
    time: (e.start_time || e.time || "").slice(0, 5),
    endTime: (e.end_time || e.endTime || "").slice(0, 5),
    place: e.place || "",
    coverUrl: e.cover_url || e.coverUrl || "",
    status: e.status || "draft",
    photos: (e.event_photos || e.photos || []).map((p) => ({ id: String(p.id), url: p.url, caption: p.caption || "" })),
    documents: (e.event_documents || e.documents || []).map((d) => ({ id: String(d.id), url: d.url, name: d.name || "" }))
  });

  const normalizeRegistry = (r) => ({
    id: String(r.id),
    name: r.name || "",
    products: r.products || "",
    inn: r.inn || "",
    phone: r.phone || "",
    settlement: r.settlement || "",
    representative: r.representative || "",
    status: r.status || "active",
    notes: r.notes || ""
  });

  const stripStaff = (r) => ({ id: String(r.id), name: r.name, products: r.products });

  /* ---------- STATIC (публичный сайт без бэкенда) ---------- */
  const staticBackend = {
    async getPublicEvents() {
      const res = await fetch("./data/events.json", { cache: "no-store" });
      if (!res.ok) throw new Error("events_unavailable");
      const payload = await res.json();
      const list = Array.isArray(payload) ? payload : (payload.events || []);
      return list.filter((e) => e.status === "published").map(normalizeEvent);
    },
    async getPublicRegistry() {
      const res = await fetch("./data/participants-public.json", { cache: "no-store" });
      if (!res.ok) throw new Error("registry_unavailable");
      const payload = await res.json();
      const list = Array.isArray(payload) ? payload : (payload.participants || []);
      return list.map((r) => ({ id: String(r.id || r.name), name: r.name, products: r.products }));
    }
  };

  /* ---------- SUPABASE ---------- */
  const supabaseBackend = () => {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    const admin = () => ({ isAdmin: () => cfg.isSupabase() });

    return {
      isSupabase: true,
      admin,
      async getPublicEvents() {
        const { data, error } = await sb
          .from("events")
          .select("*, event_photos(*), event_documents(*)")
          .eq("status", "published")
          .order("event_date", { ascending: true });
        if (error) throw error;
        return (data || []).map(normalizeEvent);
      },
      async getPublicRegistry() {
        const { data, error } = await sb.from("public_registry").select("id, name, products");
        if (error) throw error;
        return (data || []).map((r) => ({ id: String(r.id), name: r.name, products: r.products }));
      },
      async login(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return { user: data.user, token: data.session?.access_token || "" };
      },
      async logout() { await sb.auth.signOut(); },
      async getSession() {
        const { data } = await sb.auth.getSession();
        return data?.session ? { user: data.session.user, token: data.session.access_token } : null;
      },
      async listEvents() {
        const { data, error } = await sb
          .from("events")
          .select("*, event_photos(*), event_documents(*)")
          .order("event_date", { ascending: true });
        if (error) throw error;
        return (data || []).map(normalizeEvent);
      },
      async saveEvent(ev) {
        const row = {
          title: ev.title, description: ev.description,
          event_date: ev.date, start_time: ev.time, end_time: ev.endTime || null,
          place: ev.place, cover_url: ev.coverUrl, status: ev.status
        };
        if (ev.id && ev.id !== "new") {
          const { data, error } = await sb.from("events").update(row).eq("id", ev.id).select().single();
          if (error) throw error;
          return normalizeEvent(data);
        }
        const { data, error } = await sb.from("events").insert(row).select().single();
        if (error) throw error;
        return normalizeEvent(data);
      },
      async deleteEvent(id) {
        const { error } = await sb.from("events").delete().eq("id", id);
        if (error) throw error;
      },
      async setEventStatus(id, status) {
        const { error } = await sb.from("events").update({ status }).eq("id", id);
        if (error) throw error;
      },
      async addEventPhoto(eventId, url, caption) {
        const { error } = await sb.from("event_photos").insert({ event_id: eventId, url, caption });
        if (error) throw error;
      },
      async addEventDocument(eventId, url, name) {
        const { error } = await sb.from("event_documents").insert({ event_id: eventId, url, name });
        if (error) throw error;
      },
      async listRegistry() {
        const { data, error } = await sb.from("registry").select("*").order("name", { ascending: true });
        if (error) throw error;
        return (data || []).map(normalizeRegistry);
      },
      async saveRegistry(rec) {
        const row = {
          name: rec.name, products: rec.products, inn: rec.inn, phone: rec.phone,
          settlement: rec.settlement, representative: rec.representative, status: rec.status, notes: rec.notes
        };
        if (rec.id && rec.id !== "new") {
          const { data, error } = await sb.from("registry").update(row).eq("id", rec.id).select().single();
          if (error) throw error;
          return normalizeRegistry(data);
        }
        const { data, error } = await sb.from("registry").insert(row).select().single();
        if (error) throw error;
        return normalizeRegistry(data);
      },
      async deleteRegistry(id) {
        const { error } = await sb.from("registry").delete().eq("id", id);
        if (error) throw error;
      },
      async importRegistry(rows) {
        const { error } = await sb.from("registry").upsert(
          rows.map((r) => ({
            name: r.name, products: r.products, inn: r.inn, phone: r.phone,
            settlement: r.settlement, representative: r.representative, status: r.status || "active", notes: r.notes
          })),
          { onConflict: "name" }
        );
        if (error) throw error;
        return { imported: rows.length, skipped: 0 };
      },
      async listChangeLog() {
        const { data, error } = await sb.from("change_log").select("*").order("changed_at", { ascending: false }).limit(200);
        if (error) throw error;
        return data || [];
      },
      async uploadAsset(file, bucket) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb.storage.from(bucket).upload(path, file);
        if (error) throw error;
        const { data } = sb.storage.from(bucket).getPublicUrl(path);
        return { url: data.publicUrl };
      }
    };
  };

  /* ---------- LOCAL (тестовый сервер) ---------- */
  const localBackend = () => {
    const base = cfg.localApi || "/api";
    let token = localStorage.getItem("fair-admin-token") || "";
    const headers = (extra) => Object.assign({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, extra || {});
    const req = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
      if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
      if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(t || ("HTTP " + res.status)); }
      const ct = res.headers.get("content-type") || "";
      return ct.includes("application/json") ? res.json() : res.text();
    };
    const upload = async (file, bucket) => {
      const q = `/upload?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(file.name)}`;
      const res = await fetch(base + q, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
      if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(t || ("HTTP " + res.status)); }
      return res.json();
    };

    return {
      isSupabase: false,
      admin: () => ({ isAdmin: () => Boolean(token) }),
      async getPublicEvents() { return (await req("GET", "/public/events")).map(normalizeEvent); },
      async getPublicRegistry() { return (await req("GET", "/public/registry")).map(stripStaff); },
      async login(email, password) {
        const r = await req("POST", "/auth/login", { email, password });
        token = r.token;
        localStorage.setItem("fair-admin-token", token);
        return r;
      },
      async logout() {
        try { await req("POST", "/auth/logout"); } catch (_) {}
        token = "";
        localStorage.removeItem("fair-admin-token");
      },
      async getSession() {
        try { const r = await req("GET", "/auth/session"); return { user: r.user, token }; } catch (_) { return null; }
      },
      async listEvents() { return (await req("GET", "/events")).map(normalizeEvent); },
      async saveEvent(ev) { return normalizeEvent(await req(ev.id && ev.id !== "new" ? "PUT" : "POST", ev.id && ev.id !== "new" ? `/events/${ev.id}` : "/events", ev)); },
      async deleteEvent(id) { await req("DELETE", `/events/${id}`); },
      async setEventStatus(id, status) { await req("PUT", `/events/${id}`, { status }); },
      async addEventPhoto(eventId, url, caption) { await req("POST", `/events/${eventId}/photos`, { url, caption }); },
      async addEventDocument(eventId, url, name) { await req("POST", `/events/${eventId}/documents`, { url, name }); },
      async listRegistry() { return (await req("GET", "/registry")).map(normalizeRegistry); },
      async saveRegistry(rec) { return normalizeRegistry(await req(rec.id && rec.id !== "new" ? "PUT" : "POST", rec.id && rec.id !== "new" ? `/registry/${rec.id}` : "/registry", rec)); },
      async deleteRegistry(id) { await req("DELETE", `/registry/${id}`); },
      async importRegistry(rows) { return req("POST", "/registry/import", { rows }); },
      async listChangeLog() { return req("GET", "/change-log"); },
      async uploadAsset(file, bucket) { return upload(file, bucket); }
    };
  };

  const backend = cfg.isSupabase() ? supabaseBackend() : (cfg.isLocal() ? localBackend() : staticBackend);

  window.fairData = {
    getPublicEvents: () => backend.getPublicEvents(),
    getPublicRegistry: () => backend.getPublicRegistry(),
    login: (email, password) => backend.login(email, password),
    logout: () => backend.logout(),
    getSession: () => backend.getSession(),
    isAdmin: () => backend.admin().isAdmin(),
    listEvents: () => backend.listEvents(),
    saveEvent: (ev) => backend.saveEvent(ev),
    deleteEvent: (id) => backend.deleteEvent(id),
    setEventStatus: (id, status) => backend.setEventStatus(id, status),
    addEventPhoto: (eventId, url, caption) => backend.addEventPhoto(eventId, url, caption),
    addEventDocument: (eventId, url, name) => backend.addEventDocument(eventId, url, name),
    listRegistry: () => backend.listRegistry(),
    saveRegistry: (rec) => backend.saveRegistry(rec),
    deleteRegistry: (id) => backend.deleteRegistry(id),
    importRegistry: (rows) => backend.importRegistry(rows),
    listChangeLog: () => backend.listChangeLog(),
    uploadAsset: (file, bucket) => backend.uploadAsset(file, bucket),
    backendType: cfg.isSupabase() ? "supabase" : (cfg.isLocal() ? "local" : "static")
  };
})();
