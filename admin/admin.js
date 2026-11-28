/* Кабинет администратора: авторизация, мероприятия, реестр, Excel. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  const state = { events: [], registry: [], statusFilter: "all", eventFilter: "all" };
  const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const DOC_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
  const MAX_IMG = 10 * 1024 * 1024;
  const MAX_DOC = 20 * 1024 * 1024;

  const toast = (msg, isError) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3600);
  };

  /* ---------- Авторизация ---------- */
  const applyRoleGating = () => {
    const role = window.fairData?.role?.() || "";
    const canRegistry = role !== "editor"; // editor: только мероприятия
    document.querySelectorAll("[data-tab='registry']").forEach((el) => { el.hidden = !canRegistry; });
    document.querySelectorAll("[data-goto='registry']").forEach((el) => { el.hidden = !canRegistry; });
  };

  const showApp = (user) => {
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    $("#sidebar-user").textContent = user?.email ? `Логин: ${user.email}` : "";
    applyRoleGating();
    loadDashboard();
  };
  const showLogin = () => {
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
  };

  const updateBackendNote = () => {
    const note = $("#backend-note");
    const t = window.fairData?.backendType;
    if (t === "supabase") note.textContent = "Подключение: Supabase.";
    else if (t === "php") note.textContent = "Подключение: сервер ярмарки (REG.RU / PHP / SQLite).";
    else if (t === "local") note.textContent = "Локальный тестовый сервер. Демо-доступ: admin@4sezona.ru / demo1234.";
    else note.textContent = "Бэкенд не настроен — вход и административные функции недоступны. Укажите backend=php (REG.RU) или Supabase.";
  };

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    const err = $("#login-error");
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "Вход…";
    const email = e.target.email.value.trim();
    const password = e.target.password.value;
    try {
      const session = await window.fairData.login(email, password);
      showApp(session?.user || { email });
      toast("Вы вошли в кабинет");
    } catch (ex) {
      err.textContent = ex.status === 401 || /unauthorized|Invalid login/i.test(String(ex.message || ex))
        ? "Неверный логин или пароль."
        : "Не удалось выполнить вход: " + (ex.message || ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Войти";
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    await window.fairData.logout();
    showLogin();
    toast("Вы вышли из кабинета");
  });

  /* ---------- Навигация по вкладкам ---------- */
  const tabs = { dashboard: "Главная", events: "Мероприятия", registry: "Реестр" };
  const switchTab = (name) => {
    $$(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
    $$(".side-link[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $("#section-title").textContent = tabs[name] || "Главная";
    $("#admin-menu-toggle")?.classList.remove("open");
    $(".sidebar")?.classList.remove("open");
    if (name === "events") loadEvents();
    if (name === "registry") loadRegistry();
    if (name === "dashboard") loadDashboard();
  };
  $$(".side-link[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => { switchTab(b.dataset.goto); if (b.dataset.action === "new-event") openEventDialog(); }));
  $("#admin-menu-toggle").addEventListener("click", () => {
    const open = $(".sidebar").classList.toggle("open");
    $("#admin-menu-toggle").setAttribute("aria-expanded", String(open));
  });

  /* ---------- Дашборд ---------- */
  const loadDashboard = async () => {
    try {
      const [events, registry] = await Promise.all([window.fairData.listEvents(), window.fairData.listRegistry()]);
      state.events = events;
      state.registry = registry;
      const published = events.filter((e) => e.status === "published");
      const upcoming = published.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
      $("#stat-published").textContent = String(published.length);
      $("#stat-participants").textContent = String(registry.filter((r) => r.status === "active").length);
      $("#stat-upcoming").textContent = String(upcoming.length);
      $("#dashboard-upcoming").innerHTML = upcoming.slice(0, 5).map((e) =>
        `<div class="upcoming-item"><div><b>${esc(e.title)}</b><br><small>${esc(e.date)}${e.time ? " · " + esc(e.time) : ""} · ${esc(e.place)}</small></div><span class="status-pill status-published">Опубликовано</span></div>`
      ).join("") || `<p class="table-muted">Нет предстоящих опубликованных мероприятий.</p>`;
    } catch (ex) {
      toast("Не удалось загрузить данные: " + (ex.message || ex), true);
    }
  };

  /* ---------- Мероприятия ---------- */
  const loadEvents = async () => {
    try {
      state.events = await window.fairData.listEvents();
      renderEventsTable();
    } catch (ex) {
      toast("Не удалось загрузить мероприятия: " + (ex.message || ex), true);
    }
  };

  const renderEventsTable = () => {
    const wrap = $("#events-table");
    const items = state.events.filter((e) => state.eventFilter === "all" || e.status === state.eventFilter);
    const rows = items.map((e) => {
      const past = e.date < today();
      return `<tr>
        <td><div class="table-name">${esc(e.title)}</div><div class="table-muted">${esc(e.description || "").slice(0, 80)}</div></td>
        <td>${esc(e.date)}<br><small>${esc(e.time || "")}${e.endTime ? "–" + esc(e.endTime) : ""}</small></td>
        <td>${esc(e.place || "")}</td>
        <td><span class="status-pill status-${esc(e.status)}">${({ draft: "Черновик", published: "Опубликовано", archived: "Архив" })[e.status] || e.status}</span>${past ? " · прошло" : ""}</td>
        <td><div class="table-actions">
          <button class="mini-btn" data-edit="${esc(e.id)}">Изменить</button>
          <button class="mini-btn" data-preview="${esc(e.id)}">Предпросмотр</button>
          ${e.status === "published" ? `<button class="mini-btn" data-status="${esc(e.id)}:draft">Снять с публикации</button>` : `<button class="mini-btn" data-status="${esc(e.id)}:published">Опубликовать</button>`}
          ${e.status !== "archived" ? `<button class="mini-btn" data-status="${esc(e.id)}:archived">В архив</button>` : `<button class="mini-btn" data-status="${esc(e.id)}:draft">Вернуть</button>`}
          <button class="mini-btn danger" data-delete="${esc(e.id)}">Удалить</button>
        </div></td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Название</th><th>Дата и время</th><th>Место</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="table-muted">Нет мероприятий.</td></tr>`}</tbody></table>`;

    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEventDialog(state.events.find((e) => e.id === b.dataset.edit))));
    wrap.querySelectorAll("[data-preview]").forEach((b) => b.addEventListener("click", () => previewEvent(state.events.find((e) => e.id === b.dataset.preview))));
    wrap.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
      const [id, status] = b.dataset.status.split(":");
      try { await window.fairData.setEventStatus(id, status); toast("Статус обновлён"); loadEvents(); } catch (ex) { toast("Ошибка: " + (ex.message || ex), true); }
    }));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
      const ev = state.events.find((e) => e.id === b.dataset.delete);
      if (!confirm(`Удалить мероприятие «${ev?.title}»? Действие нельзя отменить.`)) return;
      try { await window.fairData.deleteEvent(ev.id); toast("Мероприятие удалено"); loadEvents(); } catch (ex) { toast("Ошибка: " + (ex.message || ex), true); }
    }));
  };

  const openEventDialog = (ev) => {
    const form = $("#event-form");
    form.reset();
    form.id.value = ev?.id || "new";
    $("#event-dialog-title").textContent = ev?.id ? "Редактирование мероприятия" : "Новое мероприятие";
    $("#event-form-error").hidden = true;
    if (ev) {
      form.title.value = ev.title || "";
      form.date.value = ev.date || "";
      form.time.value = ev.time || "12:00";
      form.endTime.value = ev.endTime || "";
      form.place.value = ev.place || "";
      form.description.value = ev.description || "";
      form.status.value = ev.status || "draft";
      form.cover.dataset.existingUrl = ev.coverUrl || "";
    } else {
      form.cover.dataset.existingUrl = "";
    }
    $("#event-dialog").showModal();
  };

  const validateFiles = (files, kinds, maxSize) => [...(files || [])].every((f) => {
    const okType = kinds === "image" ? IMG_TYPES.includes(f.type) : (DOC_TYPES.includes(f.type) || /\.(pdf|docx?|xlsx?)$/i.test(f.name));
    if (!okType) { toast(`Недопустимый файл: ${f.name}`, true); return false; }
    if (f.size > maxSize) { toast(`Файл слишком большой: ${f.name}`, true); return false; }
    return true;
  });

  const uploadAsset = async (file, bucket) => {
    const url = await window.fairData.uploadAsset(file, bucket);
    return url?.url || url;
  };

  $("#new-event-btn").addEventListener("click", () => openEventDialog());

  $("#event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $("#event-form-error");
    err.hidden = true;
    if (!form.title.value.trim() || !form.date.value) {
      err.textContent = "Укажите название и дату мероприятия.";
      err.hidden = false;
      return;
    }
    const coverFile = form.cover.files[0];
    const photoFiles = form.photos.files;
    const docFiles = form.documents.files;
    if (coverFile && !validateFiles([coverFile], "image", MAX_IMG)) return;
    if (photoFiles.length && !validateFiles(photoFiles, "image", MAX_IMG)) return;
    if (docFiles.length && !validateFiles(docFiles, "doc", MAX_DOC)) return;

    try {
      let coverUrl = form.cover.dataset.existingUrl || "";
      if (coverFile) coverUrl = await uploadAsset(coverFile, "event-covers");
      const ev = {
        id: form.id.value,
        title: form.title.value.trim(),
        description: form.description.value.trim(),
        date: form.date.value,
        time: form.time.value || "12:00",
        endTime: form.endTime.value || "",
        place: form.place.value.trim(),
        coverUrl,
        status: form.status.value
      };
      const saved = await window.fairData.saveEvent(ev);
      for (const f of photoFiles) {
        const url = await uploadAsset(f, "event-photos");
        await window.fairData.addEventPhoto(saved.id, url, "");
      }
      for (const f of docFiles) {
        const url = await uploadAsset(f, "event-documents");
        await window.fairData.addEventDocument(saved.id, url, f.name);
      }
      $("#event-dialog").close();
      toast("Мероприятие сохранено");
      loadEvents();
    } catch (ex) {
      err.textContent = "Не удалось сохранить: " + (ex.message || ex);
      err.hidden = false;
    }
  });

  $("#event-preview-btn").addEventListener("click", () => previewEvent({
    id: "preview", title: $("#event-form").title.value, description: $("#event-form").description.value,
    date: $("#event-form").date.value, time: $("#event-form").time.value, endTime: $("#event-form").endTime.value,
    place: $("#event-form").place.value, status: $("#event-form").status.value
  }));

  const previewEvent = (e) => {
    $("#preview-body").innerHTML = `<div class="preview-card"><div class="preview-media">${e.coverUrl ? `<img src="${esc(e.coverUrl)}" alt="" style="width:100%;height:200px;object-fit:cover">` : "🥕"}</div><div class="preview-content"><span class="status-pill status-${esc(e.status || 'draft')}">${({ draft: "Черновик", published: "Опубликовано", archived: "Архив" })[e.status || "draft"]}</span><h3>${esc(e.title)}</h3><div class="table-muted">${esc(e.date)} · ${esc(e.time || "")}</div><p>${esc(e.description)}</p><div class="table-muted">📍 ${esc(e.place || "")}</div></div></div>`;
    $("#preview-dialog").showModal();
  };

  $$(".events-filter-bar .chip").forEach((b) => b.addEventListener("click", () => {
    state.eventFilter = b.dataset.statusFilter;
    $$(".events-filter-bar .chip").forEach((x) => x.classList.toggle("is-active", x === b));
    renderEventsTable();
  }));

  /* ---------- Реестр ---------- */
  const loadRegistry = async () => {
    try {
      state.registry = await window.fairData.listRegistry();
      renderRegistryTable();
      loadChangeLog();
    } catch (ex) {
      toast("Не удалось загрузить реестр: " + (ex.message || ex), true);
    }
  };

  const renderRegistryTable = () => {
    const wrap = $("#registry-table");
    const q = ($("#registry-admin-search").value || "").toLowerCase().trim();
    const status = $("#registry-status-filter").value;
    const items = state.registry.filter((r) => {
      const matchText = !q || `${r.name} ${r.inn}`.toLowerCase().includes(q);
      const matchStatus = status === "all" || r.status === status;
      return matchText && matchStatus;
    });
    $("#registry-summary").textContent = `Показано: ${items.length} из ${state.registry.length} · действующих: ${state.registry.filter((r) => r.status === "active").length}`;
    const rows = items.map((r) => `<tr>
      <td><div class="table-name">${esc(r.name)}</div><div class="table-muted">${esc(r.products)}</div></td>
      <td>${esc(r.inn) || "<span class='table-muted'>—</span>"}</td>
      <td>${esc(r.settlement) || "<span class='table-muted'>—</span>"}</td>
      <td><span class="status-pill status-${esc(r.status)}">${r.status === "archived" ? "Архив" : "Действующий"}</span></td>
      <td><div class="table-actions">
        <button class="mini-btn" data-edit="${esc(r.id)}">Изменить</button>
        ${r.status === "active" ? `<button class="mini-btn" data-archive="${esc(r.id)}">В архив</button>` : `<button class="mini-btn" data-archive="${esc(r.id)}">Вернуть</button>`}
        <button class="mini-btn danger" data-delete="${esc(r.id)}">Удалить</button>
      </div></td>
    </tr>`).join("");
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Наименование / продукция</th><th>ИНН</th><th>Нас. пункт</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="table-muted">Записи не найдены.</td></tr>`}</tbody></table>`;

    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openRegistryDialog(state.registry.find((r) => r.id === b.dataset.edit))));
    wrap.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", async () => {
      const rec = state.registry.find((r) => r.id === b.dataset.archive);
      try { await window.fairData.saveRegistry({ ...rec, status: rec.status === "active" ? "archived" : "active" }); toast("Статус обновлён"); loadRegistry(); } catch (ex) { toast("Ошибка: " + (ex.message || ex), true); }
    }));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
      const rec = state.registry.find((r) => r.id === b.dataset.delete);
      if (!confirm(`Удалить запись «${rec?.name}»? Действие нельзя отменить.`)) return;
      try { await window.fairData.deleteRegistry(rec.id); toast("Запись удалена"); loadRegistry(); } catch (ex) { toast("Ошибка: " + (ex.message || ex), true); }
    }));
  };

  $("#registry-admin-search").addEventListener("input", renderRegistryTable);
  $("#registry-status-filter").addEventListener("change", renderRegistryTable);

  const openRegistryDialog = (rec) => {
    const form = $("#registry-form");
    form.reset();
    form.id.value = rec?.id || "new";
    $("#registry-dialog-title").textContent = rec?.id ? "Редактирование участника" : "Новый участник";
    $("#registry-form-error").hidden = true;
    if (rec) {
      form.name.value = rec.name || "";
      form.products.value = rec.products || "";
      form.inn.value = rec.inn || "";
      form.phone.value = rec.phone || "";
      form.settlement.value = rec.settlement || "";
      form.representative.value = rec.representative || "";
      form.status.value = rec.status || "active";
      form.notes.value = rec.notes || "";
    }
    $("#registry-dialog").showModal();
  };

  $("#new-registry-btn").addEventListener("click", () => openRegistryDialog());

  $("#registry-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $("#registry-form-error");
    err.hidden = true;
    if (!form.name.value.trim()) { err.textContent = "Укажите наименование участника."; err.hidden = false; return; }
    const rec = {
      id: form.id.value,
      name: form.name.value.trim(),
      products: form.products.value.trim(),
      inn: form.inn.value.trim(),
      phone: form.phone.value.trim(),
      settlement: form.settlement.value.trim(),
      representative: form.representative.value.trim(),
      status: form.status.value,
      notes: form.notes.value.trim()
    };
    try {
      await window.fairData.saveRegistry(rec);
      $("#registry-dialog").close();
      toast("Запись сохранена");
      loadRegistry();
    } catch (ex) {
      err.textContent = "Не удалось сохранить: " + (ex.message || ex);
      err.hidden = false;
    }
  });

  /* ---------- Импорт/экспорт Excel ---------- */
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const records = await window.fairExcel.parseFile(file);
      if (!records.length) { toast("Файл не содержит записей", true); return; }
      const res = await window.fairData.importRegistry(records);
      toast(`Импортировано записей: ${res?.imported ?? records.length}`);
      loadRegistry();
    } catch (ex) {
      toast("Ошибка импорта: " + (ex.message || ex), true);
    } finally {
      e.target.value = "";
    }
  });
  $("#export-btn").addEventListener("click", () => {
    const active = state.registry.filter((r) => r.status === "active");
    const all = state.registry;
    const records = all.length ? all : active;
    try {
      window.fairExcel.download(records, window.XLSX ? "xlsx" : "csv");
      toast("Экспорт подготовлен");
    } catch (ex) { toast("Ошибка экспорта: " + (ex.message || ex), true); }
  });

  /* ---------- Журнал изменений ---------- */
  const loadChangeLog = async () => {
    try {
      const log = await window.fairData.listChangeLog();
      $("#change-log").innerHTML = log.length ? log.slice(0, 100).map((l) => {
        const action = { insert: "Добавлено", update: "Изменено", delete: "Удалено" }[l.action] || l.action;
        const entity = l.entity === "registry" ? "Реестр" : "Мероприятие";
        return `<div class="log-row"><b>${esc(entity)} · ${esc(action)}</b> — ${esc((l.changed_at || "").slice(0, 16).replace("T", " "))}</div>`;
      }).join("") : `<p class="table-muted">Изменений пока нет.</p>`;
    } catch (_) {
      $("#change-log").innerHTML = `<p class="table-muted">Журнал недоступен.</p>`;
    }
  };

  /* ---------- Закрытие диалогов ---------- */
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.close)?.close()));

  /* ---------- Старт ---------- */
  updateBackendNote();
  (async () => {
    const session = await window.fairData.getSession().catch(() => null);
    if (session && session.user) showApp(session.user);
    else showLogin();
  })();
})();
