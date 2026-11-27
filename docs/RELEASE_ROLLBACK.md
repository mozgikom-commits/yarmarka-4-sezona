# План релиза и отката — Ярмарка «4 сезона» (PR #6, backend REG.RU `/fair-api/`)

Статус: **разрешение владельца на публикацию получено (26–27.11.2026)**. Supabase
отменён; backend/auth/storage — REG.RU (PHP 8.1+ / PDO SQLite) на **уже оплаченном**
`mozgikomlab.ru`, изолированный путь `/fair-api/`, отдельный SQLite **вне webroot**.
Без отдельного поддомена и без расширения тарифа; LAB и «Межгород Онлайн» не меняются.

## Предусловия (до релиза)

- API активен на `https://mozgikomlab.ru/fair-api/` (фронт-контроллер `index.php` +
  `.htaccess` в `webroot/fair-api/`, `lib/`/`cli/`/`schema.sql` — соседние каталоги webroot).
- Создан `yarmarka-private` **вне webroot** (0700), выполнен `php/cli/install.php`
  (схема, seed 102 + демо-мероприятия, администратор с `password_hash`); `allowedOrigins`
  — только `https://mozgikom-commits.github.io` и `https://xn--4-8sboi4afs.online`.
- Локальные проверки пройдены: API E2E `tools/qa/php-api-e2e.cjs` — **26/26**,
  браузерный E2E `tools/qa/php-frontend-e2e.cjs` — **15/15**, оба при монтировании
  `/fair-api` (включая кросс-доменный CORS).
- Live E2E `tools/qa/php-api-e2e.cjs` пройден против `https://mozgikomlab.ru` с
  `FAIR_API_MOUNT=/fair-api`.

## Шаг владельца (точное действие, блокер релиза)

Без этого выпуск в production невозможен. Доступы передаются только через локальный
файл `.env.regru` в корне рабочей папки (в `.gitignore`, в git не попадает), **не в чат**.

1. Предоставить доступ к каталогу **выше webroot** `mozgikomlab.ru` (SSH или SFTP с
   домашним каталогом). Ограниченный FTPS-аккаунт LAB туда не достаёт, а SQLite обязан
   лежать вне webroot — поэтому нужен SSH/SFTP (или отдельный FTP/SSH-аккаунт с домом
   = каталог выше webroot). Без платных услуг и без отдельного поддомена.
2. Передать способ развёртывания в `.env.regru`: `FTP_HOST`/`FTP_USERNAME`/`FTP_PASSWORD`
   (для webroot) и `SSH_HOST`/`SSH_USERNAME` + ключ (для каталога выше webroot), либо
   один SSH-доступ, покрывающий оба.
3. Подтвердить публичный URL API: `https://mozgikomlab.ru/fair-api`.

Дальше исполнитель: размещает `fair-api/` + `lib/` + `cli/` + `schema.sql` (FTPS/SSH),
создаёт `yarmarka-private` вне webroot, выполняет `install.php` (администратор с
надёжным паролем — передать владельцу безопасно), прогоняет live E2E, затем релиз ниже.

## Релиз (только после разрешения владельца и успешных тестов)

1. **Backend:** API активен на `/fair-api/`; аноним видит только опубликованные
   мероприятия и реестр `id`/`name`/`products`; служебные поля, запись и журнал — только
   по ролям (`admin` — всё, `editor` — только мероприятия).
2. **Код:** открыть Draft PR #6 из `feature/fair-admin-events` в `main` и выполнить merge.
   GitHub Pages публикует `main`; `/admin/` появится на Pages. Блоки Tilda не меняются.
3. **Переключение бэкенда:** в блоке Tilda T123 задать `backend = 'php'` и
   `apiBase = 'https://mozgikomlab.ru/fair-api'`; `js/fair-config.js` подхватит параметры
   и сохранит в `localStorage` (см. `docs/REG_RU_SETUP.md`).
4. **Проверка на live:** афиша `/events.html`, реестр (только name/products публично),
   вход в `/admin/`, создание/публикация мероприятия, загрузка документа, приказ №54-од
   и формы без авторизации.

## Откат (при проблеме после релиза)

1. **Код:** revert merge-коммита в `main` — Pages вернёт предыдущую версию. Запасной
   вариант — восстановить предыдущий `main` из резервной копии блока T123 (`backup/`).
2. **Бэкенд:** вернуть `backend: "static"` в блоке Tilda — сайт снова читает локальные
   JSON без бэкенда (мгновенный откат зависимости). PHP-API при необходимости
   приостановить (удалить/переименовать `webroot/fair-api/`).
3. **Данные:** `php/cli/restore.php --from=<снимок>` восстанавливает
   SQLite/config/uploads из резервной копии; журнал `change_log` фиксирует изменения.

## Проверки (сводка)

- API E2E: `tools/qa/php-api-e2e.cjs` — health, публичные данные (реестр только
  name/products), авторизация, CSRF, CRUD, журнал, загрузка, ограничение входа,
  абсолютный URL загрузки. Монтирование: `FAIR_API_MOUNT=/fair-api`.
- Браузерный E2E: `tools/qa/php-frontend-e2e.cjs` — афиша, реестр 102, документы без
  авторизации, вход, цикл создание→публикация→показ, поиск по ИНН, мобильная 390px
  (кросс-доменный CORS от `127.0.0.1:4173` к API).
- Живой E2E: тот же `php-api-e2e.cjs` против `https://mozgikomlab.ru` с
  `FAIR_API_MOUNT=/fair-api` после появления доступа.
