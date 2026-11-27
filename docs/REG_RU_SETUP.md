# Подключение REG.RU (PHP + SQLite) — изолированный `/fair-api/` на mozgikomlab.ru

Сайт ярмарки остаётся статическим (GitHub Pages → iframe Tilda), а бэкенд — PHP на
**уже оплаченном** REG.RU (`mozgikomlab.ru`), без расширения тарифа и без отдельного
поддомена: API смонтирован по изолированному пути `/fair-api/`, данные — в отдельном
SQLite **вне webroot**. MOZGIKOM LAB и «Межгород Онлайн» не затрагиваются.

## Архитектура

- GitHub Pages публикует `main` (интерфейс, `/admin/`, JSON-фолбэк).
- Tilda-блок T123 загружает Pages в iframe и передаёт параметры бэкенда.
- REG.RU отдаёт REST API по `https://mozgikomlab.ru/fair-api/*` (PHP 8.1+ с
  `pdo_sqlite`, `mbstring`, `openssl`; `sodium` не требуется).
- Данные и конфиг лежат **вне webroot**, в `yarmarka-private` (0700, файлы 0600),
  изолированно от LAB/Межгорода. Квота диска видна в `/fair-api/health`
  (`disk_free_bytes`/`disk_total_bytes`); база и файлы занимают единицы МБ
  (изображение ≤10 МБ, документ ≤20 МБ).

Маршруты API относительны точке монтирования (`/fair-api`): `/health`,
`/public/events`, `/public/registry`, `/auth/login`, `/auth/logout`, `/auth/session`,
`/upload`, `/uploads/{file}`, `/events`, `/events/{id}`,
`/events/{id}/{photos|documents}`, `/registry`, `/registry/import`,
`/registry/{id}`, `/change-log`. Точка монтирования определяется автоматически по
`SCRIPT_FILENAME`/`DOCUMENT_ROOT` (для локального теста — `YARMARKA_API_MOUNT`).

## Раскладка на сервере (рекомендуемая)

```
<webroot>/                      ← сайт LAB (не трогать) + каталоги ярмарки
  fair-api/index.php            ← из php/public/index.php
  fair-api/.htaccess            ← из php/public/.htaccess
  lib/bootstrap.php             ← из php/lib/ (сосед fair-api, т.к. index.php требует ../lib)
  lib/store.php
  cli/install.php               ← из php/cli/
  cli/backup.php
  cli/restore.php
  schema.sql                    ← из php/schema.sql
<родитель webroot>/yarmarka-private/   ← вне webroot, 0700
  config.json                   ← 0600 (secret + разрешённые Origin)
  fair.sqlite                   ← 0600
  uploads/                      ← 0700 (файлы мероприятий)
  backups/                      ← снимки
<родитель webroot>/data/        ← вне webroot: participants-public.json, events.json
```

Пути по умолчанию: `yarmarka-private` = `dirname(webroot)/yarmarka-private`,
seed-данные = `dirname(webroot)/data`. Обе переопределяются переменными окружения
(`YARMARKA_PRIVATE_DIR`, `YARMARKA_DATA_DIR`) — при SSH-доступе рекомендуется явно
указать отдельный каталог, например `YARMARKA_PRIVATE_DIR=<home>/yarmarka-private`.

## 1. Разместить файлы (webroot — FTPS)

В webroot копируются только файлы без секретов (исходники и так в публичном
репозитории). Через FTPS over TLS (lftp, `set ftp:ssl-force yes`):

```sh
lftp -u "$FTP_USERNAME","$FTP_PASSWORD" "$FTP_HOST" -e "
  set ftp:ssl-force yes; set ftp:ssl-protect-data yes; set ssl:verify-certificate yes;
  mkdir -fp /fair-api /lib /cli;
  put php/public/index.php -o /fair-api/index.php;
  put php/public/.htaccess -o /fair-api/.htaccess;
  put php/lib/bootstrap.php -o /lib/bootstrap.php;
  put php/lib/store.php -o /lib/store.php;
  put php/cli/install.php -o /cli/install.php;
  put php/cli/backup.php -o /cli/backup.php;
  put php/cli/restore.php -o /cli/restore.php;
  put php/schema.sql -o /schema.sql;
  bye"
```

Проверить: `https://mozgikomlab.ru/fair-api/health` → `{"ok":true, ...}` (до установки
БД ответит `503 backend-not-configured` — это ожидаемо).

## 2. Вне webroot + установка (SSH/SFTP)

Требуется доступ к каталогу **выше webroot** (SSH или SFTP с домашним каталогом —
ограниченный FTPS-аккаунт LAB туда не достаёт). Это единственный шаг, который нельзя
сделать веб-доступом.

```sh
cd <каталог выше webroot>
mkdir -p yarmarka-private data
chmod 700 yarmarka-private
cp <репо>/data/participants-public.json <репо>/data/events.json data/

YARMARKA_PRIVATE_DIR="$(pwd)/yarmarka-private" \
YARMARKA_DATA_DIR="$(pwd)/data" \
php <webroot>/cli/install.php --email=admin@4sezona.ru --role=admin
```

- Без `--password` генерируется надёжный пароль (≥10 символов) и показывается один раз —
  сохранить в менеджере паролей; в БД хранится только `password_hash()`.
- Повторный запуск не перезаписывает `secret` в `config.json` и не дублирует seed
  (реестр 102 + демо-мероприятия).
- `allowedOrigins` по умолчанию — только фронтенд ярмарки:
  `https://mozgikom-commits.github.io`, `https://xn--4-8sboi4afs.online`
  (punycode для `4сезона.online`). Для локального E2E добавить `--origin=http://127.0.0.1:4173`.

## 3. Переключить загрузчик Tilda

В блоке Tilda T123 (не в репозитории) задать:

```js
var backend = 'php';
var apiBase = 'https://mozgikomlab.ru/fair-api';
```

Загрузчик добавит в `src` iframe `?backend=php&apiBase=…`, а `js/fair-config.js`
подхватит и сохранит в `localStorage`. `apiBase` — публичный URL (не секрет);
секреты в блок Tilda не помещаются.

## 4. Проверить на live (E2E)

```sh
FAIR_API_URL=https://mozgikomlab.ru FAIR_API_MOUNT=/fair-api \
FAIR_ADMIN_EMAIL=admin@4sezona.ru FAIR_ADMIN_PASSWORD=... \
node tools/qa/php-api-e2e.cjs
```

Проверки: health (PHP≥8.1, sqlite, https), публичный реестр (только `name`/`products`,
102), вход, CSRF, CRUD мероприятий/реестра, журнал, загрузка файлов, ограничение входа,
роли (`editor` без доступа к реестру).

## 5. Резервное копирование и откат (SSH)

```sh
YARMARKA_PRIVATE_DIR=... php <webroot>/cli/backup.php            # снимок (VACUUM INTO + config + uploads)
YARMARKA_PRIVATE_DIR=... php <webroot>/cli/backup.php --keep=10  # оставить 10 снимков
YARMARKA_PRIVATE_DIR=... php <webroot>/cli/restore.php           # список снимков
YARMARKA_PRIVATE_DIR=... php <webroot>/cli/restore.php --from=<dir>  # восстановить
```

Рекомендуется cron: `.../cli/backup.php --keep=10` ежедневно.

## Безопасность

- `password_hash` + `password_verify`; надёжный уникальный пароль администратора.
- Сессии: токен в `Authorization: Bearer …`, в БД только `hash('sha256', token)`,
  ограниченный срок жизни (`sessionTtlSeconds`).
- CSRF: `X-CSRF-Token` из входа на изменяющих запросах + проверка `Origin`.
- CORS: только разрешённые Origin фронтенда ярмарки (без wildcard); изменяющие методы
  с посторонним `Origin` → 403.
- Ограничение входа: 5 попыток за окно на IP и суммарно → 429.
- Загрузки: белый список MIME/расширений, лимиты, файлы вне webroot, отдача с `nosniff`
  и `Content-Disposition` (документы — attachment); URL загрузки — абсолютный
  (фронтенд на другом origin).
- Публичный реестр отдаёт только `id`/`name`/`products`; ИНН/контакты — только `admin`.
- Журнал `change_log` фиксирует все изменения мероприятий и реестра.
