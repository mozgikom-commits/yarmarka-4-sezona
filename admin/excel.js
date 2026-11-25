/* Работа с Excel/CSV: импорт и экспорт реестра. */
(function () {
  "use strict";

  const csvEscape = (v) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const parseCSV = (text) => {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === "," || c === ";") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.some((x) => x.trim() !== "")) rows.push(row); }
    return rows;
  };

  const normalizeHeader = (h) => {
    const map = {
      "наименование": "name", "название": "name", "name": "name", "участник": "name",
      "продукция": "products", "products": "products", "ассортимент": "products",
      "инн": "inn", "inn": "inn",
      "телефон": "phone", "phone": "phone",
      "населённый пункт": "settlement", "settlement": "settlement", "город": "settlement",
      "фио": "representative", "представитель": "representative", "representative": "representative",
      "статус": "status", "status": "status",
      "примечания": "notes", "notes": "notes", "примечание": "notes"
    };
    const key = String(h).trim().toLowerCase();
    return map[key] || null;
  };

  const rowsToRecords = (rows) => {
    if (!rows.length) return [];
    const header = rows[0].map(normalizeHeader);
    const recs = [];
    for (let i = 1; i < rows.length; i++) {
      const rec = { name: "", products: "", inn: "", phone: "", settlement: "", representative: "", status: "active", notes: "" };
      let hasAny = false;
      rows[i].forEach((cell, j) => {
        const key = header[j];
        if (!key) return;
        const v = String(cell ?? "").trim();
        if (key === "status") { rec.status = /архив/i.test(v) ? "archived" : "active"; return; }
        rec[key] = v;
        if (v) hasAny = true;
      });
      if (hasAny && rec.name) recs.push(rec);
    }
    return recs;
  };

  window.fairExcel = {
    async parseFile(file) {
      const text = await file.text();
      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        return rowsToRecords(parseCSV(text));
      }
      // XLS/XLSX через SheetJS, если библиотека загружена.
      if (window.XLSX) {
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        return rowsToRecords(rows.map((r) => r.map((c) => String(c ?? ""))));
      }
      throw new Error("Для импорта Excel-файла нужна библиотека SheetJS (не загружена). Используйте CSV.");
    },
    toCSV(records) {
      const header = ["Наименование", "Продукция", "ИНН", "Телефон", "Населённый пункт", "ФИО представителя", "Статус", "Примечания"];
      const lines = [header.join(",")];
      records.forEach((r) => {
        lines.push([r.name, r.products, r.inn, r.phone, r.settlement, r.representative, r.status === "archived" ? "Архив" : "Действующий", r.notes].map(csvEscape).join(","));
      });
      return "\uFEFF" + lines.join("\r\n");
    },
    download(records, format) {
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "xlsx" && window.XLSX) {
        const rows = [["Наименование", "Продукция", "ИНН", "Телефон", "Населённый пункт", "ФИО представителя", "Статус", "Примечания"]]
          .concat(records.map((r) => [r.name, r.products, r.inn, r.phone, r.settlement, r.representative, r.status === "archived" ? "Архив" : "Действующий", r.notes]));
        const ws = window.XLSX.utils.aoa_to_sheet(rows);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Реестр");
        window.XLSX.writeFile(wb, `registry-${stamp}.xlsx`);
        return;
      }
      const csv = this.toCSV(records);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `registry-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };
})();
