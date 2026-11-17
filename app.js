(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#primary-nav');
  const navLinks = [...document.querySelectorAll('.nav-link')];

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    nav?.classList.toggle('open', open);
  });

  nav?.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      nav.classList.remove('open');
      menuButton?.setAttribute('aria-expanded', 'false');
      menuButton?.setAttribute('aria-label', 'Открыть меню');
    }
  });

  const updateActiveLink = () => {
    const id = location.hash.slice(1) || 'home';
    navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  };
  window.addEventListener('hashchange', updateActiveLink);
  updateActiveLink();

  const search = document.querySelector('#registry-search');
  const category = document.querySelector('#registry-category');
  const locality = document.querySelector('#registry-locality');
  const status = document.querySelector('#registry-status');
  const grid = document.querySelector('#registry-grid');
  const normalize = (value) => String(value ?? '').toLocaleLowerCase('ru').trim();

  const renderRegistry = (records) => {
    const query = normalize(search?.value);
    const selectedCategory = category?.value ?? '';
    const selectedLocality = locality?.value ?? '';
    const filtered = records.filter((item) => {
      const haystack = normalize([item.name, item.products, item.assortment, item.locality].join(' '));
      return (!query || haystack.includes(query))
        && (!selectedCategory || item.category === selectedCategory)
        && (!selectedLocality || item.locality === selectedLocality);
    });
    grid.replaceChildren();
    if (!records.length) {
      status.textContent = 'Открытые сведения участников пока не опубликованы. Список появится после сверки разрешённых к размещению данных.';
      return;
    }
    status.textContent = filtered.length ? `Найдено участников: ${filtered.length}` : 'По вашему запросу ничего не найдено.';
    filtered.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'registry-card';
      const title = document.createElement('h3');
      title.textContent = item.name || 'Участник ярмарки';
      const details = document.createElement('p');
      details.textContent = [item.category, item.products || item.assortment, item.locality].filter(Boolean).join(' · ');
      card.append(title, details);
      grid.append(card);
    });
  };

  const loadRegistry = async () => {
    try {
      const response = await fetch('./data/participants-public.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('registry_unavailable');
      const payload = await response.json();
      const records = Array.isArray(payload) ? payload : payload.participants;
      if (!Array.isArray(records)) throw new Error('registry_invalid');
      const categories = [...new Set(records.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
      const localities = [...new Set(records.map((item) => item.locality).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
      categories.forEach((value) => category.add(new Option(value, value)));
      localities.forEach((value) => locality.add(new Option(value, value)));
      [search, category, locality].forEach((field) => field?.addEventListener(field === search ? 'input' : 'change', () => renderRegistry(records)));
      renderRegistry(records);
    } catch (_) {
      status.textContent = 'Не удалось загрузить открытый реестр. Попробуйте обновить страницу позже.';
    }
  };
  loadRegistry();

  // Height bridge for the reviewed Tilda T123 loader; the parent validates this page origin.
  const reportHeight = () => {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'yarmarka-height', height: Math.ceil(document.documentElement.scrollHeight) }, '*');
  };
  window.addEventListener('load', reportHeight);
  window.addEventListener('hashchange', () => requestAnimationFrame(reportHeight));
  if ('ResizeObserver' in window) new ResizeObserver(reportHeight).observe(document.documentElement);
  setTimeout(reportHeight, 200);
})();
