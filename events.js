/* Мероприятия: календарь, предстоящие, архив, галерея, документы. */
(() => {
  "use strict";

  const state = { events: [], filter: "all", calYear: 0, calMonth: 0 };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
    return `${d} ${months[m - 1]} ${y}`;
  };
  const fmtTime = (t) => (t ? t.slice(0, 5) : "");

  const setStatus = (msg) => { const el = $("#events-status"); if (el) el.textContent = msg; };

  const renderCalendar = () => {
    const grid = $("#calendar-grid");
    const monthLabel = $("#cal-month");
    if (!grid || !monthLabel) return;
    const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    monthLabel.textContent = `${months[state.calMonth]} ${state.calYear}`;

    const eventDates = new Set(state.events.map((e) => e.date));
    const first = new Date(state.calYear, state.calMonth, 1);
    const startWeekday = (first.getDay() + 6) % 7; // понедельник = 0
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();

    grid.replaceChildren();
    for (let i = 0; i < startWeekday; i++) grid.append(document.createElement("span"));

    const now = today();
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${state.calYear}-${String(state.calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-day";
      cell.textContent = String(d);
      if (eventDates.has(iso)) cell.classList.add("has-event");
      if (iso === now) cell.classList.add("is-today");
      if (eventDates.has(iso)) {
        cell.setAttribute("aria-label", `${d} — есть мероприятие`);
        cell.addEventListener("click", () => {
          state.filter = "all";
          syncFilterButtons();
          renderList(iso);
        });
      }
      grid.append(cell);
    }
  };

  const shiftMonth = (delta) => {
    state.calMonth += delta;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  };

  const eventCover = (e) => {
    if (e.coverUrl) return `<img src="${esc(e.coverUrl)}" alt="" loading="lazy" decoding="async">`;
    const icons = ["🥕", "🌻", "🍯", "🎄", "🥬", "🍞"];
    let h = 0;
    for (const ch of e.title || "") h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return `<span aria-hidden="true">${icons[h % icons.length]}</span>`;
  };

  const renderCard = (e) => {
    const past = e.date < today();
    const timeParts = [fmtTime(e.time), e.endTime ? `– ${fmtTime(e.endTime)}` : ""].filter(Boolean).join(" ");
    const docs = (e.documents || []).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">📎 ${esc(d.name)}</a>`).join("");
    return `
      <article class="event-card" data-date="${esc(e.date)}">
        <div class="event-card-media">${eventCover(e)}</div>
        <div class="event-card-body">
          <div class="event-card-date">${fmtDate(e.date)}${timeParts ? " · " + esc(timeParts) : ""}</div>
          <h3>${esc(e.title)}</h3>
          <p>${esc(e.description)}</p>
          <div class="event-card-meta"><span>📍 ${esc(e.place || "Ярмарка «4 сезона»")}</span><span class="event-badge ${past ? "is-past" : ""}">${past ? "Прошло" : "Скоро"}</span></div>
          ${docs ? `<div class="event-documents"><h4>Документы</h4>${docs}</div>` : ""}
        </div>
      </article>`;
  };

  const renderList = (specificDate) => {
    const list = $("#events-list");
    if (!list) return;
    let items = state.events.slice();
    if (specificDate) items = items.filter((e) => e.date === specificDate);
    else if (state.filter === "upcoming") items = items.filter((e) => e.date >= today());
    else if (state.filter === "past") items = items.filter((e) => e.date < today());
    items.sort((a, b) => a.date.localeCompare(b.date));

    list.innerHTML = items.length
      ? items.map(renderCard).join("")
      : `<div class="empty-state">Пока нет мероприятий${specificDate ? " в выбранный день" : " в этой категории"}.</div>`;

    renderGallery();
  };

  const renderGallery = () => {
    const section = $("#gallery");
    const grid = $("#gallery-grid");
    if (!section || !grid) return;
    const photos = state.events.filter((e) => e.date < today()).flatMap((e) => (e.photos || []).map((p) => ({ ...p, eventTitle: e.title })));
    section.hidden = photos.length === 0;
    grid.innerHTML = photos.map((p) => `<figure class="gallery-item"><img src="${esc(p.url)}" alt="${esc(p.caption || p.eventTitle)}" loading="lazy" decoding="async"><figcaption>${esc(p.caption || p.eventTitle)}</figcaption></figure>`).join("");
  };

  const syncFilterButtons = () => {
    document.querySelectorAll(".events-filter").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === state.filter));
  };

  const init = async () => {
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();

    document.querySelectorAll(".events-filter").forEach((b) => b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      syncFilterButtons();
      renderList();
    }));
    $("#cal-prev")?.addEventListener("click", () => shiftMonth(-1));
    $("#cal-next")?.addEventListener("click", () => shiftMonth(1));

    try {
      state.events = await window.fairData.getPublicEvents();
      const upcoming = state.events.filter((e) => e.date >= today()).length;
      const past = state.events.length - upcoming;
      setStatus(`Опубликовано мероприятий: ${state.events.length} · предстоящих: ${upcoming} · в архиве: ${past}`);
    } catch (_) {
      setStatus("Не удалось загрузить афишу. Попробуйте обновить страницу позже.");
      state.events = [];
    }
    renderCalendar();
    renderList();
  };

  init();
})();
