# Подключение REG.RU (PHP + SQLite) и запуск кабинета администратора

Сайт остаётся статическим (GitHub Pages → iframe Tilda), а бэкенд — REG.RU
(PHP 8.1+ с `pdo_sqlite`, `mbstring`, `openssl`; `sodium` не требуется). Это
замена прежнего плана Supabase: интерфейс, Tilda и GitHub не меняются, адаптируется
только backend/auth/storage.

## Архитектура

- GitHub Pages публикует `main` (интерфейс, `/admin/`, JSON-фолбэк).
- Tilda-блок T123 загружает Pages в iframe и передаёт параметры бэкенда.
- REG.RU отдаёт REST API `/api/*` (PHP) и хранит данные в SQLite.
- Данные и конфиг лежат **вне webroot**, в отдельном каталоге `yarmarka-private`
  (изолированы от MOZGIKOM LAB и «Межгорода Онлайн»).

## Предусловия (до развёртывания)

REG.RU-хостинг для ярмарки, изолированный от LAB/Межгорода: отдельный сайт/
поддомен или отдельный каталог с отдельной FTP/SSH-учёткой. Требования PHP —
`pdo_sqlite`, `mbstring`, `openssl`; HTTPS. Доступы передаются только через
локальный файл `.env.regru` (в `.gitignore`, в git не попадает), не в чат.

## Раскладка на сервере

```
<webroot>/                 ← содержимое php/public/ (index.php, .htaccess)
<родитель webroot>/yarmarka-private/   ← вне webroot, права 0700
    config.json           ← 0600 (секрет, разрешённые Origin)
    fair.sqlite           ← 0600
    uploads/              ← 0700 (файлы мероприятий)
    backups/              ← снимки
```

## 1. Разместить файлы

1. Скопировать содержимое `php/public/` в webroot сайта ярмарки.
2. Создать каталог `yarmarka-private` на уровень выше webroot, права `0700`.
   Путь по умолчанию вычисляется как `dirname(__DIR__, 2) . '/yarmarka-private'`
   от `php/lib` (можно переопределить переменной окружения `YARMARKA_PRIVATE_DIR`).

## 2. Установить схему, seed и администратора

На сервере (или через SSH/SFTP-доступ к PHP CLI):

```sh
php /ПУТЬ_К_WEBROOT/../php/cli/install.php --email=admin@4sezona.ru --role=admin
```

Если `--password` не указан, будет сгенерирован надёжный пароль (≥10 символов) и
показан один раз — сохраните его в менеджере паролей. Пароль хранится в БД только
как `password_hash()` (bcrypt/argon2). Повторный запуск не перезаписывает секрет
в `config.json` и не дублирует seed (реестр 102, демо-мероприятия).

## 3. Переключить загрузчик Tilda

В блоке Tilda T123 (не в репозитории) задать:

```js
var backend = 'php';
var apiBase = 'https://<api-хост>/api';
```

Загрузчик добавит в `src` iframe `?backend=php&apiBase=…`, а `js/fair-config.js`
подхватит и сохранит в `localStorage`. `apiBase` — публичный URL API (не секрет);
секреты в блок Tilda не помещаются.

## 4. Проверить на live (E2E)

```sh
FAIR_API_URL=https://<api-хост> \
FAIR_ADMIN_EMAIL=admin@4sezona.ru FAIR_ADMIN_PASSWORD=... \
node tools/qa/php-api-e2e.cjs
```

Проверки: health (`/api/health` → PHP≥8.1, sqlite, https), публичный реестр
(только `name`/`products`, 102), вход, CSRF, CRUD мероприятий/реестра, журнал,
загрузка файлов, ограничение входа, роли (editor без доступа к реестру).

## 5. Резервное копирование и откат

```sh
php /ПУТЬ_К_WEBROOT/../php/cli/backup.php           # снимок (VACUUM INTO + config + uploads)
php /ПУТЬ_К_WEBROOT/../php/cli/backup.php --keep=10 # оставить 10 снимков
php /ПУТЬ_К_WEBROOT/../php/cli/restore.php          # список снимков
php /ПУТЬ_К_WEBROOT/../php/cli/restore.php --from=<dir>  # восстановить
```

Рекомендуется cron: `php .../php/cli/backup.php --keep=10` ежедневно.

## Безопасность

- `password_hash` + `password_verify`; надёжный уникальный пароль администратора.
- Сессии: токен в заголовке `Authorization: Bearer …`, в БД хранится только
  `hash('sha256', token)`, срок жизни сессии ограничен (`sessionTtlSeconds`).
- CSRF: токен из входа передаётся в `X-CSRF-Token` на изменяющих запросах +
  проверка `Origin`.
- Ограничение входа: 5 попыток за окно на IP и суммарно → 429.
- Загрузки: белый список MIME/расширений, лимиты размера, файлы вне webroot,
  отдача с `nosniff` и `Content-Disposition` (документы — attachment).
- Публичный реестр отдаёт только `id`/`name`/`products`; ИНН/контакты — только
  администратору (роль `admin`; `editor` работает только с мероприятиями).
- Журнал `change_log` фиксирует все изменения мероприятий и реестра.
