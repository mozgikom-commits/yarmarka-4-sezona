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
  const status = document.querySelector('#registry-status');
  const count = document.querySelector('#registry-count');
  const grid = document.querySelector('#registry-grid');
  const normalize = (value) => String(value ?? '').toLocaleLowerCase('ru').trim();
  const categoryRules = [
    { name: 'Овощи и зелень', test: /овощ|корнеплод|ягод|фрукт|бахч|зелень/ },
    { name: 'Молочная продукция', test: /молок|молоч|сыр/ },
    { name: 'Мясные изделия', test: /мяс|колбас|птиц/ },
    { name: 'Рыба и рыбная продукция', test: /рыб|морепродукт/ },
    { name: 'Выпечка и сладости', test: /хлеб|булоч|кондитер|слад|выпеч/ },
    { name: 'Заготовки, мёд и дикоросы', test: /консерв|солен|квашен|м[её]д|пчел|заготов|дикорос|сухофрукт|пряност|приправ/ },
    { name: 'Напитки', test: /квас|вода/ },
    { name: 'Яйца', test: /яйц/ }
  ];
  const categoriesFor = (products) => {
    const value = normalize(products);
    // Fish preserves belong to fish, not to vegetable/home preserves.
    const preservesValue = value.replace(/рыбн(?:ые|ых|ая|ой|ую|ое|ого|ыми)?\s+консерв\w*/g, '');
    return categoryRules.filter((item) => item.test.test(item.name === 'Заготовки, мёд и дикоросы' ? preservesValue : value)).map((item) => item.name);
  };

  categoryRules.forEach((item) => category?.add(new Option(item.name, item.name)));
  const chips = document.querySelector('#registry-chips');
  if (chips && category) {
    const choices = [{ name: 'Все продукты', value: '' }, ...categoryRules.map(({ name }) => ({ name, value: name }))];
    choices.forEach(({ name, value }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'registry-chip';
      button.textContent = name;
      button.dataset.category = value;
      button.addEventListener('click', () => {
        category.value = value;
        category.dispatchEvent(new Event('change', { bubbles: true }));
      });
      chips.append(button);
    });
    const syncChips = () => chips.querySelectorAll('.registry-chip').forEach((button) => {
      const active = button.dataset.category === category.value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    category.addEventListener('change', syncChips);
    syncChips();
  }

  const renderRegistry = (records) => {
    const query = normalize(search?.value);
    const selectedCategory = category?.value ?? '';
    const isPreview = grid?.dataset.registryMode === 'preview';
    const filtered = records.filter((item) => {
      const matchesText = !query || normalize(`${item.name ?? ''} ${item.products ?? ''}`).includes(query);
      const matchesCategory = !selectedCategory || categoriesFor(item.products).includes(selectedCategory);
      return matchesText && matchesCategory;
    });
    const shown = isPreview ? filtered.slice(0, 4) : filtered;
    grid?.replaceChildren();
    if (count) count.textContent = `Опубликовано участников: ${records.length}`;
    if (status) status.textContent = isPreview
      ? `Первые ${shown.length} участника из ${records.length}. Полный список — в каталоге.`
      : (filtered.length ? `Найдено участников: ${filtered.length}` : (records.length ? 'По запросу и выбранной категории записей нет.' : 'В реестре пока нет записей.'));
    shown.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'registry-card';
      const title = document.createElement('h3');
      title.textContent = item.name;
      const details = document.createElement('p');
      details.className = 'registry-products';
      const label = document.createElement('strong');
      label.textContent = 'Продукция: ';
      const value = document.createElement('span');
      value.textContent = item.products;
      details.append(label, value);
      card.append(title, details);
      grid?.append(card);
    });
  };

  const loadRegistry = async () => {
    try {
      let records;
      if (window.fairData && window.fairData.backendType !== "static") {
        records = await window.fairData.getPublicRegistry();
      } else {
        const response = await fetch('./data/participants-public.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('registry_unavailable');
        const payload = await response.json();
        records = Array.isArray(payload) ? payload : payload.participants;
      }
      if (!Array.isArray(records)) throw new Error('registry_invalid');
      renderRegistry(records);
      [search, category].forEach((field) => field?.addEventListener(field === search ? 'input' : 'change', () => renderRegistry(records)));
    } catch (_) {
      count.textContent = 'Реестр временно недоступен';
      status.textContent = 'Не удалось загрузить открытый реестр. Попробуйте обновить страницу позже.';
    }
  };
  loadRegistry();

})();
