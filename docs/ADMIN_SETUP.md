# Подключение Supabase и запуск кабинета администратора

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

## 2. Указать доступы в `js/fair-config.js`

```js
window.FAIR_CONFIG = {
  backend: "supabase",
  supabaseUrl: "https://<project>.supabase.co",
  supabaseAnonKey: "<anon public key>",
  localApi: "/api"
};
```

Ключи в репозиторий не помещать: переопределить `window.FAIR_CONFIG` на хостинге
или добавить значения при сборке. Анонимный ключ публичный; секрет `service_role` не используется в браузере.

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
