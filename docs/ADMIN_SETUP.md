# Подключение Supabase и запуск кабинета администратора

> [!NOTE]
> **Устарело (27.11.2026).** Владелец отменил Supabase и утвердил REG.RU
> (PHP + SQLite). Актуальная инструкция — [REG_RU_SETUP.md](./REG_RU_SETUP.md).
> Этот файл сохранён только как историческая справка по прежнему плану Supabase.

Сайт остаётся статическим (GitHub Pages → iframe Tilda), а бэкенд — Supabase
(Postgres + Auth + Storage), как в проекте «Межгород Онлайн».

## 1. Создать проект Supabase

1. Создать проект в Supabase (регион желательно ближе к Приморью).
2. В SQL Editor выполнить по порядку:
   - `supabase/migrations/20261125000000_init.sql` — схема, RLS, триггеры, хранилище.
   - `supabase/seed.sql` — 102 записи реестра (реальные name + products, служебные поля пустые) и демо-мероприятия.
3. Включить Auth → Email (Sign-In с email/password). Создать пользователя-администратора.
4. Добавить администратора в таблицу `admin_users`:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'admin@example.ru';
   ```
5. (Рекомендуется) Развернуть Edge Function для серверной проверки файлов:
   `supabase functions deploy upload-asset --no-verify-jwt`.

## 2. Указать доступы через загрузчик Tilda (ключи вне репозитория)

Ключи в репозиторий не помещаются. Публичный сайт переключается на Supabase
загрузчиком Tilda: блок T123 формирует URL iframe с параметрами, а
`js/fair-config.js` их подхватывает и сохраняет в `localStorage` (переживает
переходы между страницами внутри iframe на том же origin).

В блоке Tilda (не в репозитории) задать:

```js
var backend = 'supabase';
var supabaseUrl = 'https://<project-ref>.supabase.co';
var supabaseAnonKey = '<anon public key>'; // Project Settings → API
```

Загрузчик добавит к `src` iframe:
`?backend=supabase&supabaseUrl=…&supabaseAnonKey=…`.

- anon-ключ публичный и используется в браузере;
- секрет `service_role` в браузер/блок Tilda НЕ вставлять — он нужен только
  серверным скриптам (миграции, seed, создание администратора, E2E) из `.env.supabase`.

Прямое указание `window.FAIR_CONFIG` (сборка/хостинг) тоже поддерживается и имеет
приоритет над параметрами URL.

## 3. Публичный доступ

- `/events.html` и реестр читают публичные данные через Supabase:
  - мероприятия — таблица `events` (`status = 'published'`, политика RLS);
  - реестр — представление `public_registry` (только `name`, `products`, `status = 'active'`).
- Служебные поля реестра (ИНН, телефон, населённый пункт, ФИО, примечания) доступны
  только администратору (RLS `is_admin()`).

## 4. Локальное тестирование без Supabase

```sh
node tools/local-server/server.mjs
# http://127.0.0.1:4173/            — сайт
# http://127.0.0.1:4173/admin/      — кабинет (admin@4sezona.ru / demo1234)
```

Локальный сервер реализует те же сценарии (серверная авторизация, хранение, журнал,
проверка файлов) на локальных JSON-данных и используется только для приёмки.

## 5. Журнал изменений

Все изменения таблиц `registry` и `events` пишутся в `change_log` триггером
`log_change()`. Журнал доступен в кабинете (вкладка «Реестр» → «Журнал изменений»).
