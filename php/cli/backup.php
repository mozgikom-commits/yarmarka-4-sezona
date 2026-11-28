<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/bootstrap.php';

/*
 * Ярмарка «4 сезона» — резервное копирование (CLI).
 *
 * Создаёт согласованный снимок SQLite (VACUUM INTO), копию config.json и
 * загрузок uploads/ в yarmarka-private/backups/<timestamp>/.
 *
 * Использование:
 *   php cli/backup.php            # снимок сейчас
 *   php cli/backup.php --keep=10  # оставить 10 последних снимков
 */

function fairBackupArg(string $name, ?string $default = null): ?string
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

function fairCopyDir(string $src, string $dst): void
{
    if (!is_dir($src)) {
        return;
    }
    if (!is_dir($dst) && !mkdir($dst, 0700, true)) {
        throw new RuntimeException("mkdir failed: $dst");
    }
    foreach (scandir($src) as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $from = $src . '/' . $entry;
        $to = $dst . '/' . $entry;
        if (is_dir($from)) {
            fairCopyDir($from, $to);
        } else {
            copy($from, $to);
            chmod($to, 0600);
        }
    }
}

$dir = fairPrivateDir();
if (!is_dir($dir)) {
    fwrite(STDERR, "Приватный каталог не найден: $dir\n");
    exit(1);
}

$dbPath = fairPrivatePath('fair.sqlite');
if (!is_file($dbPath)) {
    fwrite(STDERR, "БД не найдена: $dbPath\n");
    exit(1);
}

$stamp = gmdate('Ymd-His');
$snapshot = $dir . '/backups/' . $stamp;
if (is_dir($snapshot)) {
    $snapshot .= '-' . bin2hex(random_bytes(2));
}
if (!mkdir($snapshot, 0700, true)) {
    fwrite(STDERR, "Не удалось создать каталог снимка: $snapshot\n");
    exit(1);
}

$mask = umask(0077);
try {
    $target = $snapshot . '/fair.sqlite';
    if (class_exists('SQLite3')) {
        // Онлайн-бэкап через API SQLite3 — работает и на SQLite 3.26.0,
        // где VACUUM INTO отсутствует (требуется >= 3.27).
        $src = new SQLite3($dbPath);
        $src->busyTimeout(5000);
        $dst = new SQLite3($target);
        if (!$src->backup($dst)) {
            throw new RuntimeException('SQLite3 backup failed: ' . $src->lastErrorMsg());
        }
        $dst->close();
        $src->close();
    } else {
        // Fallback для серверов с SQLite >= 3.27 (VACUUM INTO).
        $db = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA busy_timeout = 5000');
        $db->exec("VACUUM INTO '" . str_replace("'", "''", $target) . "'");
    }
} catch (Throwable $e) {
    umask($mask);
    fwrite(STDERR, "Снимок БД не удался: " . get_class($e) . ': ' . $e->getMessage() . "\n");
    exit(1);
}
umask($mask);
chmod($snapshot . '/fair.sqlite', 0600);

$configPath = fairPrivatePath('config.json');
if (is_file($configPath)) {
    copy($configPath, $snapshot . '/config.json');
    chmod($snapshot . '/config.json', 0600);
}
fairCopyDir(fairPrivateDir() . '/uploads', $snapshot . '/uploads');

fwrite(STDOUT, "Снимок создан: $snapshot\n");

$keep = (int) (fairBackupArg('keep', '10') ?? '10');
if ($keep < 1) {
    $keep = 10;
}
$backupsDir = $dir . '/backups';
$list = glob($backupsDir . '/*', GLOB_ONLYDIR);
if (is_array($list)) {
    sort($list);
    $excess = count($list) - $keep;
    for ($i = 0; $i < $excess; $i++) {
        // Удаляем только каталоги снимков (содержат fair.sqlite), не трогаем посторонние.
        if (!is_file($list[$i] . '/fair.sqlite')) {
            continue;
        }
        array_map('unlink', glob($list[$i] . '/*') ?: []);
        foreach (glob($list[$i] . '/*', GLOB_ONLYDIR) ?: [] as $sub) {
            array_map('unlink', glob($sub . '/*') ?: []);
            rmdir($sub);
        }
        rmdir($list[$i]);
    }
}
exit(0);
