<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/bootstrap.php';

/*
 * Ярмарка «4 сезона» — восстановление из снимка (CLI).
 *
 * Перед заменой делает предохранительный снимок текущего состояния, затем
 * восстанавливает fair.sqlite, config.json и uploads/ из выбранного снимка.
 *
 * Использование:
 *   php cli/restore.php                 # показать доступные снимки
 *   php cli/restore.php --from=<dir>    # восстановить из снимка
 */

function fairRestoreArg(string $name, ?string $default = null): ?string
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

function fairRecursiveCopy(string $src, string $dst): void
{
    if (is_dir($src)) {
        if (!is_dir($dst)) {
            mkdir($dst, 0700, true);
        }
        foreach (scandir($src) as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            fairRecursiveCopy($src . '/' . $entry, $dst . '/' . $entry);
        }
    } else {
        copy($src, $dst);
        chmod($dst, 0600);
    }
}

$dir = fairPrivateDir();
if (!is_dir($dir)) {
    fwrite(STDERR, "Приватный каталог не найден: $dir\n");
    exit(1);
}

$backupsDir = $dir . '/backups';
$list = is_dir($backupsDir) ? (glob($backupsDir . '/*', GLOB_ONLYDIR) ?: []) : [];
sort($list);

$from = fairRestoreArg('from');
if ($from === null || $from === '') {
    if ($list === []) {
        fwrite(STDOUT, "Снимки не найдены.\n");
        exit(0);
    }
    fwrite(STDOUT, "Доступные снимки:\n");
    foreach ($list as $dir2) {
        fwrite(STDOUT, '  ' . $dir2 . "\n");
    }
    exit(0);
}

if (!is_dir($from) || !is_file($from . '/fair.sqlite')) {
    fwrite(STDERR, "Снимок не найден или не содержит fair.sqlite: $from\n");
    exit(1);
}

// Предохранительный снимок текущего состояния.
$safety = $backupsDir . '/pre-restore-' . gmdate('Ymd-His');
if (!is_dir($safety)) {
    mkdir($safety, 0700, true);
}
$dbPath = fairPrivatePath('fair.sqlite');
if (is_file($dbPath)) {
    copy($dbPath, $safety . '/fair.sqlite');
    chmod($safety . '/fair.sqlite', 0600);
}
$configPath = fairPrivatePath('config.json');
if (is_file($configPath)) {
    copy($configPath, $safety . '/config.json');
    chmod($safety . '/config.json', 0600);
}

$mask = umask(0077);
try {
    copy($from . '/fair.sqlite', $dbPath);
    chmod($dbPath, 0600);
    if (is_file($from . '/config.json')) {
        copy($from . '/config.json', $configPath);
        chmod($configPath, 0600);
    }
    // Загруженные файлы: копируем содержимое снимка поверх текущего.
    if (is_dir($from . '/uploads')) {
        fairRecursiveCopy($from . '/uploads', fairPrivateDir() . '/uploads');
    }
} finally {
    umask($mask);
}

fwrite(STDOUT, "Восстановлено из: $from\n");
fwrite(STDOUT, "Предохранительный снимок: $safety\n");
exit(0);
