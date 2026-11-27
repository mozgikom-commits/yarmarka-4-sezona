<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/bootstrap.php';

/*
 * Ярмарка «4 сезона» — установка бэкенда (CLI, запускается на сервере REG.RU).
 *
 * Создаёт приватный каталог yarmarka-private (вне webroot, 0700), config.json,
 * SQLite-базу со схемой, наполняет реестр (102) и демо-мероприятия, создаёт
 * администратора с password_hash().
 *
 * Использование:
 *   php cli/install.php --email=admin@example.ru [--password=...] [--role=admin] [--origin=...]
 *   php cli/install.php --email=admin@example.ru   # пароль будет сгенерирован и показан
 *   # --origin=<https://...> (можно несколько) — доп. разрешённые Origin поверх умолчаний.
 */

function fairArg(string $name, ?string $default = null): ?string
{
    global $argv;
    foreach ($argv as $i => $a) {
        if ($a === '--' . $name) {
            return isset($argv[$i + 1]) ? (string) $argv[$i + 1] : '';
        }
        if (str_starts_with($a, '--' . $name . '=')) {
            return substr($a, strlen('--' . $name . '='));
        }
    }
    return $default;
}

function fairDefaultConfig(): array
{
    return [
        'allowedOrigins' => [
            // Только домены фронтенда ярмарки: GitHub Pages и боевой домен
            // (Origin браузер всегда передаёт в punycode-виде).
            'https://mozgikom-commits.github.io',
            'https://xn--4-8sboi4afs.online',
        ],
        'secret' => bin2hex(random_bytes(32)),
        'sessionTtlSeconds' => 28800,
        'loginMaxAttempts' => 5,
        'loginWindowSeconds' => 900,
        'maxImageBytes' => 10485760,
        'maxDocBytes' => 20971520,
    ];
}

/** Собирает повторяемые аргументы --origin=... (доп. разрешённые Origin, например
 *  для локального E2E: --origin=http://127.0.0.1:4173). */
function fairOriginArgs(): array
{
    global $argv;
    $out = [];
    foreach ($argv as $a) {
        if (str_starts_with($a, '--origin=')) {
            $v = substr($a, strlen('--origin='));
            if ($v !== '' && !in_array($v, $out, true)) {
                $out[] = $v;
            }
        }
    }
    return $out;
}

function fairInstallSchema(PDO $db): void
{
    $schema = file_get_contents(__DIR__ . '/../schema.sql');
    if ($schema === false) {
        throw new RuntimeException('schema.sql missing');
    }
    $db->exec($schema);
}

function fairSeed(PDO $db): void
{
    $root = getenv('YARMARKA_DATA_DIR');
    if (!is_string($root) || trim($root) === '') {
        $root = dirname(__DIR__, 2) . '/data';
    }
    $root = rtrim($root, '/');

    $count = (int) $db->query('SELECT COUNT(*) FROM registry')->fetchColumn();
    if ($count === 0) {
        $raw = file_get_contents($root . '/participants-public.json');
        if ($raw === false) {
            throw new RuntimeException('participants-public.json missing');
        }
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        $list = $data['participants'] ?? $data ?? [];
        $ins = $db->prepare(
            'INSERT INTO registry (id, name, products, inn, phone, settlement, representative, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $now = time();
        $db->beginTransaction();
        foreach ($list as $row) {
            if (!is_array($row) || !isset($row['name'])) {
                continue;
            }
            $ins->execute([fairUuid(), (string) $row['name'], (string) ($row['products'] ?? ''), '', '', '', '', 'active', '', $now, $now]);
        }
        $db->commit();
    }

    $evCount = (int) $db->query('SELECT COUNT(*) FROM events')->fetchColumn();
    if ($evCount === 0) {
        $raw = file_get_contents($root . '/events.json');
        if ($raw === false) {
            throw new RuntimeException('events.json missing');
        }
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        $list = $data['events'] ?? [];
        $ins = $db->prepare(
            'INSERT INTO events (id, title, description, event_date, start_time, end_time, place, cover_url, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $now = time();
        $db->beginTransaction();
        foreach ($list as $row) {
            if (!is_array($row) || !isset($row['title'])) {
                continue;
            }
            $id = isset($row['id']) && is_string($row['id']) && $row['id'] !== '' ? $row['id'] : fairUuid();
            $ins->execute([$id, (string) $row['title'], (string) ($row['description'] ?? ''),
                (string) ($row['event_date'] ?? date('Y-m-d')), (string) ($row['start_time'] ?? '12:00'),
                ($row['end_time'] ?? null) !== '' && ($row['end_time'] ?? null) !== null ? (string) $row['end_time'] : null,
                (string) ($row['place'] ?? ''), (string) ($row['cover_url'] ?? ''),
                in_array($row['status'] ?? '', ['draft', 'published', 'archived'], true) ? $row['status'] : 'draft',
                $now, $now]);
        }
        $db->commit();
    }
}

function fairInstallAdmin(PDO $db, string $email, ?string $password, string $role): void
{
    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new InvalidArgumentException('Invalid email');
    }
    if (!in_array($role, ['admin', 'editor'], true)) {
        throw new InvalidArgumentException('Invalid role');
    }
    $exists = $db->prepare('SELECT COUNT(*) FROM admin_users WHERE email = ?');
    $exists->execute([$email]);
    $already = (int) $exists->fetchColumn() > 0;

    if ($password === null || $password === '') {
        if ($already) {
            fwrite(STDOUT, "Администратор $email уже существует; пароль не изменён.\n");
            return;
        }
        $password = bin2hex(random_bytes(12));
        fwrite(STDOUT, "Сгенерирован пароль администратора (сохраните его в менеджере паролей):\n");
        fwrite(STDOUT, "$password\n");
    } elseif (strlen($password) < 10) {
        throw new InvalidArgumentException('Password must be at least 10 characters');
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($already) {
        $stmt = $db->prepare('UPDATE admin_users SET password_hash = ?, role = ? WHERE email = ?');
        $stmt->execute([$hash, $role, $email]);
        fwrite(STDOUT, "Пароль и роль администратора $email обновлены.\n");
    } else {
        $stmt = $db->prepare('INSERT INTO admin_users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
        $stmt->execute([$email, $hash, $role, time()]);
        fwrite(STDOUT, "Администратор $email создан (роль: $role).\n");
    }
}

$email = fairArg('email');
if ($email === null || trim($email) === '') {
    fwrite(STDERR, "Укажите --email=admin@example.ru\n");
    exit(1);
}
$email = mb_strtolower(trim($email));
$password = fairArg('password');
$role = fairArg('role', 'admin') ?? 'admin';

$dir = fairPrivateDir();
if (!is_dir($dir)) {
    if (!mkdir($dir, 0700, true)) {
        fwrite(STDERR, "Не удалось создать приватный каталог $dir\n");
        exit(1);
    }
}
chmod($dir, 0700);

$configPath = fairPrivatePath('config.json');
if (!is_file($configPath)) {
    $config = fairDefaultConfig();
    foreach (fairOriginArgs() as $origin) {
        $config['allowedOrigins'][] = $origin;
    }
    $mask = umask(0077);
    file_put_contents($configPath, json_encode($config, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE));
    umask($mask);
    chmod($configPath, 0600);
    fwrite(STDOUT, "config.json создан (secret сгенерирован).\n");
} else {
    fwrite(STDOUT, "config.json уже существует; секреты не перезаписываются.\n");
}

$dbPath = fairPrivatePath('fair.sqlite');
$mask = umask(0077);
try {
    $db = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout = 5000');
    $db->exec('PRAGMA foreign_keys = ON');
    fairInstallSchema($db);
    fairSeed($db);
    fairInstallAdmin($db, $email, $password, $role);
} finally {
    umask($mask);
}
chmod($dbPath, 0600);

fwrite(STDOUT, "Готово. Приватный каталог: $dir\n");
fwrite(STDOUT, "БД: $dbPath\n");
exit(0);
