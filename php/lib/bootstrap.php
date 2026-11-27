<?php
declare(strict_types=1);

/*
 * Ярмарка «4 сезона» — backend REG.RU (PHP 8.1+ / PDO SQLite).
 *
 * Общая инфраструктура: приватный каталог вне webroot, конфигурация, SQLite,
 * HTTP-ответы с заголовками безопасности, CORS, серверные сессии (токен в
 * заголовке Authorization, хеш в БД), CSRF, ограничение входа и загрузка файлов.
 *
 * Секреты (конфиг, БД, загрузки, бэкапы) хранятся ТОЛЬКО в приватном каталоге
 * yarmarka-private (вне корня сайта). В браузер секреты не передаются.
 */

// ---------------------------------------------------------------------------
// Пути и приватный каталог
// ---------------------------------------------------------------------------

function fairPrivateDir(): string
{
    $override = getenv('YARMARKA_PRIVATE_DIR');
    if (is_string($override) && trim($override) !== '') {
        return rtrim(trim($override), '/');
    }
    // __DIR__ = .../php/lib → dirname(...,2) = каталог, содержащий php/
    return dirname(__DIR__, 2) . '/yarmarka-private';
}

function fairPrivatePath(string $name): string
{
    return fairPrivateDir() . '/' . $name;
}

function fairIsPrivateFile(string $path): bool
{
    return !is_link($path) && is_file($path) && (fileperms($path) & 0077) === 0;
}

/** Проверяет, что приватный каталог существует, не является ссылкой, имеет 0700
 *  и расположен вне webroot. Для CLI DOCUMENT_ROOT отсутствует — используется
 *  запасной корень (каталог сайта). */
function fairPrivateDirValid(): bool
{
    $directory = fairPrivateDir();
    if (is_link($directory) || !is_dir($directory) || (fileperms($directory) & 0077) !== 0) {
        return false;
    }
    $root = realpath(($_SERVER['DOCUMENT_ROOT'] ?? '') ?: (dirname(__DIR__, 2) . '/public'));
    $private = realpath($directory);
    if ($root === false || $private === false || str_starts_with($private . '/', $root . '/')) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

function fairConfig(): array
{
    $path = fairPrivatePath('config.json');
    if (!fairPrivateDirValid() || !fairIsPrivateFile($path)) {
        return [];
    }
    $raw = json_decode((string) file_get_contents($path), true);
    if (!is_array($raw)) {
        return [];
    }
    $origins = $raw['allowedOrigins'] ?? null;
    if (!is_array($origins) || !array_is_list($origins)) {
        return [];
    }
    $origins = array_values(array_filter($origins, static fn ($o): bool => is_string($o) && $o !== ''));
    $secret = $raw['secret'] ?? null;
    if (!is_string($secret) || preg_match('/^[a-f0-9]{64}$/D', $secret) !== 1) {
        return [];
    }
    return [
        'allowedOrigins' => $origins,
        'secret' => $secret,
        'sessionTtlSeconds' => is_int($raw['sessionTtlSeconds'] ?? null) ? $raw['sessionTtlSeconds'] : 28800,
        'loginMaxAttempts' => is_int($raw['loginMaxAttempts'] ?? null) ? $raw['loginMaxAttempts'] : 5,
        'loginWindowSeconds' => is_int($raw['loginWindowSeconds'] ?? null) ? $raw['loginWindowSeconds'] : 900,
        'maxImageBytes' => is_int($raw['maxImageBytes'] ?? null) ? $raw['maxImageBytes'] : 10485760,
        'maxDocBytes' => is_int($raw['maxDocBytes'] ?? null) ? $raw['maxDocBytes'] : 20971520,
    ];
}

// ---------------------------------------------------------------------------
// База данных
// ---------------------------------------------------------------------------

function fairDb(): PDO
{
    $path = fairPrivatePath('fair.sqlite');
    if (is_link($path) || (file_exists($path) && !fairIsPrivateFile($path))) {
        throw new RuntimeException('invalid-private-db');
    }
    if (!file_exists($path)) {
        throw new RuntimeException('db-not-initialized');
    }
    $mask = umask(0077);
    try {
        $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA busy_timeout = 5000');
        $db->exec('PRAGMA foreign_keys = ON');
        $db->exec('PRAGMA secure_delete = ON');
        return $db;
    } finally {
        umask($mask);
    }
}

// ---------------------------------------------------------------------------
// HTTP-ответы и CORS
// ---------------------------------------------------------------------------

function fairRequestMethod(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function fairRequestPath(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        $path = '/';
    }
    $path = rawurldecode($path);
    return $path;
}

function fairOriginAllowed(array $config): bool
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (!is_string($origin) || $origin === '') {
        // Нет Origin (curl/серверный клиент) — разрешаем; браузерные запросы
        // всегда шлют Origin, и защита ниже проверяет его для изменяющих методов.
        return true;
    }
    return in_array($origin, $config['allowedOrigins'], true);
}

function fairApplyCors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_string($origin) && in_array($origin, $config['allowedOrigins'], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-CSRF-Token');
        header('Access-Control-Max-Age: 600');
    }
}

function fairJsonHeaders(): void
{
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
}

function fairRespond(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fairApiBaseUrl(): string
{
    $https = (($_SERVER['HTTPS'] ?? '') === 'on')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return ($https ? 'https' : 'http') . '://' . $host;
}

// ---------------------------------------------------------------------------
// Тело запроса
// ---------------------------------------------------------------------------

function fairReadJsonBody(int $limit): array
{
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) {
        fairRespond(413, ['error' => 'payload-too-large']);
    }
    if (trim($raw) === '') {
        return [];
    }
    try {
        $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fairRespond(400, ['error' => 'invalid-json']);
    }
    if (!is_array($decoded)) {
        fairRespond(400, ['error' => 'invalid-json']);
    }
    return $decoded;
}

// ---------------------------------------------------------------------------
// Идентификаторы и время
// ---------------------------------------------------------------------------

function fairUuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $hex = bin2hex($b);
    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20, 12)
    );
}

function fairIsoNow(int $ts): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $ts);
}

// ---------------------------------------------------------------------------
// Сессии (защищённый вход)
// ---------------------------------------------------------------------------

function fairIssueSession(PDO $db, string $email, string $role, int $ttlSeconds): array
{
    $now = time();
    $token = bin2hex(random_bytes(32));
    $csrf = bin2hex(random_bytes(32));
    $stmt = $db->prepare(
        'INSERT INTO sessions (token_hash, email, role, csrf_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        hash('sha256', $token),
        $email,
        $role,
        hash('sha256', $csrf),
        $now,
        $now + $ttlSeconds,
    ]);
    // Удаляем протухшие сессии заодно.
    $db->prepare('DELETE FROM sessions WHERE expires_at <= ?')->execute([$now]);
    return ['token' => $token, 'csrf' => $csrf, 'user' => ['email' => $email, 'role' => $role]];
}

/** Возвращает данные текущей сессии или null. */
function fairCurrentSession(PDO $db, string $bearer): ?array
{
    if ($bearer === '') {
        return null;
    }
    $hash = hash('sha256', $bearer);
    $stmt = $db->prepare(
        'SELECT email, role, csrf_hash, expires_at FROM sessions WHERE token_hash = ?'
    );
    $stmt->execute([$hash]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row) || (int) $row['expires_at'] <= time()) {
        return null;
    }
    return $row;
}

function fairBearerToken(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    return str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
}

/** Возвращает сессию или отвечает 401. */
function fairRequireAuth(PDO $db): array
{
    $session = fairCurrentSession($db, fairBearerToken());
    if ($session === null) {
        fairRespond(401, ['error' => 'unauthorized']);
    }
    return $session;
}

function fairRequireRole(PDO $db, array $roles): array
{
    $session = fairRequireAuth($db);
    if (!in_array($session['role'], $roles, true)) {
        fairRespond(403, ['error' => 'forbidden']);
    }
    return $session;
}

function fairRevokeSession(PDO $db, string $bearer): void
{
    if ($bearer === '') {
        return;
    }
    $stmt = $db->prepare('DELETE FROM sessions WHERE token_hash = ?');
    $stmt->execute([hash('sha256', $bearer)]);
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

function fairRequireCsrf(array $session): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($provided)
        || $provided === ''
        || !hash_equals((string) $session['csrf_hash'], hash('sha256', $provided))) {
        fairRespond(403, ['error' => 'invalid-csrf-token']);
    }
}

/** Дополнительная защита изменяющих методов: Origin должен быть разрешён. */
function fairRequireOrigin(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_string($origin) && $origin !== '' && !in_array($origin, $config['allowedOrigins'], true)) {
        fairRespond(403, ['error' => 'invalid-origin']);
    }
}

// ---------------------------------------------------------------------------
// Ограничение входа
// ---------------------------------------------------------------------------

function fairLoginBlocked(PDO $db, array $config): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $keys = [
        'login:ip:' . $ip,
        'login:total',
    ];
    $windowStart = intdiv(time(), $config['loginWindowSeconds']);
    foreach ($keys as $key) {
        $scoped = $windowStart . ':' . hash_hmac('sha256', $key, $config['secret']);
        $stmt = $db->prepare('SELECT hits FROM rate_limit WHERE key = ? AND window = ?');
        $stmt->execute([$scoped, $windowStart]);
        if ((int) $stmt->fetchColumn() >= $config['loginMaxAttempts']) {
            return true;
        }
    }
    return false;
}

function fairLoginRecord(PDO $db, array $config): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $keys = ['login:ip:' . $ip, 'login:total'];
    $windowStart = intdiv(time(), $config['loginWindowSeconds']);
    $stmt = $db->prepare(
        'INSERT INTO rate_limit (key, hits, window) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET hits = hits + 1'
    );
    foreach ($keys as $key) {
        $scoped = $windowStart . ':' . hash_hmac('sha256', $key, $config['secret']);
        $stmt->execute([$scoped, $windowStart]);
    }
    // Чистим старые окна.
    $db->prepare('DELETE FROM rate_limit WHERE window < ?')->execute([$windowStart - 1]);
}

// ---------------------------------------------------------------------------
// Загрузка файлов
// ---------------------------------------------------------------------------

function fairImageMime(string $mime): bool
{
    return in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true);
}

function fairDocMime(string $mime): bool
{
    return in_array($mime, [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ], true);
}

function fairDocExt(string $ext): bool
{
    return in_array($ext, ['pdf', 'doc', 'docx', 'xls', 'xlsx'], true);
}

function fairUploadMime(): string
{
    return strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
}

function fairContentTypeForExtension(string $ext): string
{
    return match ($ext) {
        'jpg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        default => 'application/octet-stream',
    };
}

function fairUploadDir(): string
{
    return fairPrivateDir() . '/uploads';
}

function fairEnsureUploadDir(): void
{
    $dir = fairUploadDir();
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    if ((fileperms($dir) & 0077) !== 0) {
        chmod($dir, 0700);
    }
}

/** Принимает загруженный файл (сырое тело), проверяет тип/размер и возвращает
 *  относительный URL вида /api/uploads/<file>. */
function fairAcceptUpload(array $config, string $bucket, string $name): string
{
    if (!in_array($bucket, ['event-covers', 'event-photos', 'event-documents'], true)) {
        fairRespond(400, ['error' => 'invalid-bucket']);
    }
    $mime = fairUploadMime();
    $rawName = (string) $name;
    $ext = strtolower((string) pathinfo($rawName, PATHINFO_EXTENSION));
    $isImageBucket = in_array($bucket, ['event-covers', 'event-photos'], true);
    $isDocBucket = $bucket === 'event-documents';

    if ($isImageBucket) {
        if (!fairImageMime($mime) || !in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true)) {
            fairRespond(400, ['error' => 'invalid-image-type']);
        }
        $limit = $config['maxImageBytes'];
    } elseif ($isDocBucket) {
        if ((!fairDocMime($mime) && !fairDocExt($ext)) || !fairDocExt($ext)) {
            fairRespond(400, ['error' => 'invalid-document-type']);
        }
        $limit = $config['maxDocBytes'];
    } else {
        fairRespond(400, ['error' => 'invalid-bucket']);
    }

    $body = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($body === false || strlen($body) > $limit) {
        fairRespond(413, ['error' => 'file-too-large']);
    }
    if ($body === '' || str_contains($body, "\0")) {
        fairRespond(400, ['error' => 'invalid-file']);
    }

    fairEnsureUploadDir();
    $fileName = gmdate('Ymd-His') . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
    $path = fairUploadDir() . '/' . $fileName;
    $mask = umask(0077);
    try {
        if (file_put_contents($path, $body) === false) {
            throw new RuntimeException('upload-write-failed');
        }
        chmod($path, 0600);
    } finally {
        umask($mask);
    }
    return '/api/uploads/' . $fileName;
}
