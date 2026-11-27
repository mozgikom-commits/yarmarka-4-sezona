/* E2E API для бэкенда REG.RU (PHP + SQLite) — Ярмарка «4 сезона».
 *
 * Проверяет серверный контракт без браузера (Node 24 global fetch):
 * health, публичные данные (реестр только name/products), авторизация, CSRF,
 * CRUD мероприятий/реестра, журнал, загрузка файлов и ограничение входа.
 *
 * Запуск:
 *   FAIR_API_URL=http://127.0.0.1:4180 \
 *   FAIR_API_MOUNT=/fair-api \
 *   FAIR_ADMIN_EMAIL=admin@4sezona.ru FAIR_ADMIN_PASSWORD=... \
 *   node tools/qa/php-api-e2e.cjs
 *
 * Используются только синтетические данные; реальные секреты не передаются в git.
 */

const base = (process.env.FAIR_API_URL || 'http://127.0.0.1:4180').replace(/\/+$/, '');
const mount = (process.env.FAIR_API_MOUNT || '/fair-api').replace(/^\/+|\/+$/g, '');
const apiBase = base + (mount ? '/' + mount : '');
const email = process.env.FAIR_ADMIN_EMAIL || 'admin@4sezona.ru';
const password = process.env.FAIR_ADMIN_PASSWORD || 'local-demo-1234';

let token = '';
let csrf = '';

const api = (p) => apiBase + p;

async function req(method, path, { body, headers = {}, sendCsrf = true } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (sendCsrf && csrf && method !== 'GET' && method !== 'OPTIONS') h['X-CSRF-Token'] = csrf;
  const opts = { method, headers: h };
  if (body !== undefined) {
    if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
      opts.body = body;
    } else {
      opts.body = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(api(path), opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const imgPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fakesyntheticpngdata'),
]);

(async () => {
  console.log(`API: ${base}`);

  // health
  const health = await req('GET', '/health');
  check('health 200 + sqlite + php8', health.status === 200 && health.data.sqlite === true && health.data.php_version_id >= 80100,
    `status=${health.status} sqlite=${health.data.sqlite} php=${health.data.php_version_id}`);

  // публичные данные
  const pubEvents = await req('GET', '/public/events');
  check('public events: 200 + массив + только published', pubEvents.status === 200
    && Array.isArray(pubEvents.data) && pubEvents.data.length >= 1
    && pubEvents.data.every((e) => e.status === 'published'), `status=${pubEvents.status} n=${Array.isArray(pubEvents.data) ? pubEvents.data.length : 'n/a'}`);

  const pubReg = await req('GET', '/public/registry');
  const regClean = Array.isArray(pubReg.data) && pubReg.data.every((r) => {
    const keys = Object.keys(r).sort();
    return keys.every((k) => ['id', 'name', 'products'].includes(k)) && r.name && r.products !== undefined;
  });
  check('public registry: 102 + только name/products', pubReg.status === 200 && Array.isArray(pubReg.data)
    && pubReg.data.length === 102 && regClean, `status=${pubReg.status} n=${Array.isArray(pubReg.data) ? pubReg.data.length : 'n/a'}`);

  // без авторизации
  const unauth = await req('GET', '/events');
  check('GET /events без токена → 401', unauth.status === 401, `status=${unauth.status}`);

  // вход неверный
  const badLogin = await req('POST', '/auth/login', { body: { email, password: 'wrong-password-123' }, sendCsrf: false });
  check('login с неверным паролем → 401', badLogin.status === 401, `status=${badLogin.status}`);

  // вход верный
  const goodLogin = await req('POST', '/auth/login', { body: { email, password }, sendCsrf: false });
  check('login верный → 200 token+csrf+role', goodLogin.status === 200 && typeof goodLogin.data.token === 'string'
    && typeof goodLogin.data.csrf === 'string' && goodLogin.data.user?.role === 'admin',
    `status=${goodLogin.status} role=${goodLogin.data?.user?.role}`);
  token = goodLogin.data?.token || '';
  csrf = goodLogin.data?.csrf || '';

  const session = await req('GET', '/auth/session');
  check('session → 200 email', session.status === 200 && session.data.user?.email === email, `status=${session.status}`);

  // CSRF отсутствует
  const noCsrf = await req('POST', '/events', { body: { title: 'x', event_date: '2026-12-01' }, sendCsrf: false });
  check('POST /events без CSRF → 403', noCsrf.status === 403, `status=${noCsrf.status}`);

  // CRUD мероприятий
  const created = await req('POST', '/events', { body: { title: 'Синтетическое мероприятие', description: 'E2E', event_date: '2026-12-20', start_time: '10:00', place: 'Площадка', status: 'draft' } });
  check('создание мероприятия → 201', created.status === 201 && typeof created.data.id === 'string', `status=${created.status}`);
  const eventId = created.data?.id;

  const publish = await req('PUT', `/events/${eventId}`, { body: { status: 'published' } });
  check('публикация (status-only PUT) → 200 published', publish.status === 200 && publish.data.status === 'published', `status=${publish.status}`);

  const pubAfter = await req('GET', '/public/events');
  check('мероприятие видно публично после публикации', Array.isArray(pubAfter.data) && pubAfter.data.some((e) => e.id === eventId));

  const photo = await req('POST', `/events/${eventId}/photos`, { body: { url: '/uploads/none.png', caption: '' } });
  const doc = await req('POST', `/events/${eventId}/documents`, { body: { url: '/uploads/none.pdf', name: 'Документ' } });
  check('фото и документ прикрепляются → 201', photo.status === 201 && doc.status === 201, `photo=${photo.status} doc=${doc.status}`);

  const listEvents = await req('GET', '/events');
  const ev = Array.isArray(listEvents.data) ? listEvents.data.find((e) => e.id === eventId) : null;
  check('событие содержит фото и документ', !!ev && ev.photos?.length === 1 && ev.documents?.length === 1);

  const delEvent = await req('DELETE', `/events/${eventId}`);
  check('удаление мероприятия → 200', delEvent.status === 200, `status=${delEvent.status}`);

  // реестр (admin)
  const regList = await req('GET', '/registry');
  check('реестр admin → 200 + 102 + поле inn', regList.status === 200 && Array.isArray(regList.data)
    && regList.data.length === 102 && regList.data[0] && 'inn' in regList.data[0], `status=${regList.status} n=${Array.isArray(regList.data) ? regList.data.length : 'n/a'}`);

  const regCreate = await req('POST', '/registry', { body: { name: 'Синтетический участник E2E', products: 'Овощи', inn: '1234567890', status: 'active' } });
  check('создание записи реестра → 201', regCreate.status === 201 && typeof regCreate.data.id === 'string', `status=${regCreate.status}`);
  const regId = regCreate.data?.id;

  const regUpdate = await req('PUT', `/registry/${regId}`, { body: { name: 'Синтетический участник E2E', products: 'Овощи, фрукты', inn: '1234567890', status: 'archived' } });
  check('обновление записи реестра → 200 archived', regUpdate.status === 200 && regUpdate.data.status === 'archived', `status=${regUpdate.status}`);

  const regImport = await req('POST', '/registry/import', { body: { rows: [{ name: 'Синтетический импорт E2E', products: 'Мёд', inn: '0987654321' }] } });
  check('импорт реестра → 200 imported=1', regImport.status === 200 && regImport.data.imported === 1, `status=${regImport.status} imported=${regImport.data?.imported}`);

  const regDel = await req('DELETE', `/registry/${regId}`);
  check('удаление записи реестра → 200', regDel.status === 200, `status=${regDel.status}`);

  // журнал
  const log = await req('GET', '/change-log');
  check('журнал изменений → 200 + массив', log.status === 200 && Array.isArray(log.data) && log.data.length >= 1, `status=${log.status} n=${Array.isArray(log.data) ? log.data.length : 'n/a'}`);

  // загрузка файла
  const upload = await req('POST', '/upload?bucket=event-covers&name=test.png', { body: imgPng, headers: { 'Content-Type': 'image/png' } });
  check('загрузка изображения → 200 url', upload.status === 200 && typeof upload.data.url === 'string', `status=${upload.status}`);
  const uploadUrl = upload.data?.url || '';
  const served = uploadUrl ? await fetch(uploadUrl) : { status: 0, headers: new Map() };
  check('отдача загруженного файла → 200 image/png', served.status === 200 && String(served.headers.get('content-type') || '').includes('image/png'), `status=${served.status}`);

  const badUpload = await req('POST', '/upload?bucket=event-covers&name=evil.svg', { body: Buffer.from('<svg onload=alert(1)>'), headers: { 'Content-Type': 'image/svg+xml' } });
  check('загрузка SVG в image-раздел отклонена → 400', badUpload.status === 400, `status=${badUpload.status}`);

  // выход
  const logout = await req('POST', '/auth/logout', { body: {} });
  check('logout → 200', logout.status === 200, `status=${logout.status}`);
  token = '';
  const sessionAfter = await req('GET', '/auth/session');
  check('session после logout → 401', sessionAfter.status === 401, `status=${sessionAfter.status}`);

  // ограничение входа (в конце — не влияет на остальные проверки)
  let rateLimited = false;
  for (let i = 0; i < 8 && !rateLimited; i++) {
    const r = await req('POST', '/auth/login', { body: { email, password: 'wrong-' + i }, sendCsrf: false });
    if (r.status === 429) rateLimited = true;
  }
  check('ограничение входа → 429 после лимита', rateLimited);

  console.log(`\nИтог: ${pass} PASS, ${fail} FAIL`);
  if (fail) {
    console.log('Провалено: ' + failures.join(', '));
    process.exit(1);
  }
})();
