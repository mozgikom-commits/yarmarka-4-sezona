<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/store.php';

/*
 * Ярмарка «4 сезона» — front controller API (REG.RU / PHP / SQLite).
 *
 * Реализует REST-контракт, совместимый с js/fair-data.js (режим backend=php):
 *   GET  /api/public/events, /api/public/registry
 *   POST /api/auth/login, /api/auth/logout, GET /api/auth/session
 *   POST /api/upload, GET /api/uploads/{file}
 *   GET|POST /api/events, PUT|DELETE /api/events/{id}
 *   POST /api/events/{id}/photos, POST /api/events/{id}/documents
 *   GET|POST /api/registry, POST /api/registry/import, PUT|DELETE /api/registry/{id}
 *   GET  /api/change-log, GET /api/health
 */

$config = fairConfig();
if ($config === [] || !fairPrivateDirValid() || !file_exists(fairPrivatePath('fair.sqlite'))) {
    fairJsonHeaders();
    fairRespond(503, ['ok' => false, 'error' => 'backend-not-configured']);
}

fairJsonHeaders();
fairApplyCors($config);

$method = fairRequestMethod();
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = fairRequestPath();
$query = [];
parse_str(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_QUERY) ?? '', $query);

// Изменяющие методы: дополнительная проверка Origin (CSRF-защита уровня HTTP).
if ($method !== 'GET') {
    fairRequireOrigin($config);
}

try {
    $db = fairDb();

    // ------------------------------------------------------------------ health
    if ($method === 'GET' && $path === '/api/health') {
        $diskFree = null;
        $diskTotal = null;
        try {
            $probeDir = fairPrivateDir();
            $df = @disk_free_space($probeDir);
            $dt = @disk_total_space($probeDir);
            $diskFree = ($df !== false && $df !== null) ? (int) $df : null;
            $diskTotal = ($dt !== false && $dt !== null) ? (int) $dt : null;
        } catch (Throwable) {
            // На отдельных хостингах disk_free_space недоступен — не блокируем health.
        }
        fairRespond(200, [
            'ok' => true,
            'php_version_id' => PHP_VERSION_ID,
            'sqlite' => class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true),
            'mbstring' => function_exists('mb_strlen'),
            'openssl' => extension_loaded('openssl'),
            'sodium' => extension_loaded('sodium'),
            'https' => (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
            'disk_free_bytes' => $diskFree,
            'disk_total_bytes' => $diskTotal,
        ]);
    }

    // ------------------------------------------------------- публичные данные
    if ($method === 'GET' && $path === '/api/public/events') {
        fairRespond(200, fairPublicEvents($db));
    }
    if ($method === 'GET' && $path === '/api/public/registry') {
        fairRespond(200, fairPublicRegistry($db));
    }

    // ------------------------------------------------------------- загрузка
    if ($method === 'GET' && str_starts_with($path, '/api/uploads/')) {
        fairServeUpload($path);
    }
    if ($method === 'POST' && $path === '/api/upload') {
        $session = fairRequireAuth($db);
        fairRequireCsrf($session);
        $bucket = is_string($query['bucket'] ?? null) ? $query['bucket'] : '';
        $name = is_string($query['name'] ?? null) ? $query['name'] : 'file';
        fairRespond(200, ['url' => fairAcceptUpload($config, $bucket, $name)]);
    }

    // ------------------------------------------------------------- авторизация
    if ($method === 'POST' && $path === '/api/auth/login') {
        fairHandleLogin($db, $config);
    }
    if ($method === 'POST' && $path === '/api/auth/logout') {
        fairRevokeSession($db, fairBearerToken());
        fairRespond(200, ['ok' => true]);
    }
    if ($method === 'GET' && $path === '/api/auth/session') {
        $session = fairRequireAuth($db);
        fairRespond(200, ['user' => ['email' => $session['email'], 'role' => $session['role']]]);
    }

    // ---------------------------------------------------------- мероприятия
    if ($path === '/api/events' && $method === 'GET') {
        fairRequireRole($db, ['admin', 'editor']);
        fairRespond(200, fairFetchEventRows($db));
    }
    if ($path === '/api/events' && $method === 'POST') {
        $session = fairRequireRole($db, ['admin', 'editor']);
        fairRequireCsrf($session);
        $body = fairReadJsonBody(1048576);
        $event = fairCleanEvent($body);
        $id = fairUuid();
        $now = time();
        $stmt = $db->prepare(
            'INSERT INTO events (id, title, description, event_date, start_time, end_time, place, cover_url, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$id, $event['title'], $event['description'], $event['event_date'], $event['start_time'],
            $event['end_time'], $event['place'], $event['cover_url'], $event['status'], $now, $now]);
        $after = fairNormalizeEvent(array_merge($event, ['id' => $id]));
        fairLog($db, 'event', $id, 'insert', null, $after, $session['email']);
        fairRespond(201, $after);
    }

    if (preg_match('#^/api/events/([^/]+)$#D', $path, $m) === 1) {
        $eventId = $m[1];
        if ($method === 'PUT') {
            $session = fairRequireRole($db, ['admin', 'editor']);
            fairRequireCsrf($session);
            $body = fairReadJsonBody(1048576);
            $stmt = $db->prepare('SELECT * FROM events WHERE id = ?');
            $stmt->execute([$eventId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($before)) {
                fairRespond(404, ['error' => 'not_found']);
            }
            $keys = array_keys($body);
            $onlyStatus = count($keys) === 1 && ($keys[0] ?? '') === 'status';
            if ($onlyStatus) {
                $status = in_array($body['status'], ['draft', 'published', 'archived'], true) ? $body['status'] : 'draft';
                $upd = $db->prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?');
                $upd->execute([$status, time(), $eventId]);
                $after = fairNormalizeEvent(array_merge($before, ['status' => $status]));
            } else {
                $event = fairCleanEvent($body);
                $upd = $db->prepare(
                    'UPDATE events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?,
                     place = ?, cover_url = ?, status = ?, updated_at = ? WHERE id = ?'
                );
                $upd->execute([$event['title'], $event['description'], $event['event_date'], $event['start_time'],
                    $event['end_time'], $event['place'], $event['cover_url'], $event['status'], time(), $eventId]);
                $after = fairNormalizeEvent(array_merge($before, $event, ['id' => $eventId]));
            }
            fairLog($db, 'event', $eventId, 'update', fairNormalizeEvent($before), $after, $session['email']);
            fairRespond(200, $after);
        }
        if ($method === 'DELETE') {
            $session = fairRequireRole($db, ['admin', 'editor']);
            fairRequireCsrf($session);
            $stmt = $db->prepare('SELECT * FROM events WHERE id = ?');
            $stmt->execute([$eventId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($before)) {
                fairRespond(404, ['error' => 'not_found']);
            }
            $del = $db->prepare('DELETE FROM events WHERE id = ?');
            $del->execute([$eventId]);
            fairLog($db, 'event', $eventId, 'delete', fairNormalizeEvent($before), null, $session['email']);
            fairRespond(200, ['ok' => true]);
        }
    }

    if (preg_match('#^/api/events/([^/]+)/(photos|documents)$#D', $path, $m) === 1) {
        $eventId = $m[1];
        $kind = $m[2];
        if ($method === 'POST') {
            $session = fairRequireRole($db, ['admin', 'editor']);
            fairRequireCsrf($session);
            $body = fairReadJsonBody(1048576);
            $stmt = $db->prepare('SELECT id FROM events WHERE id = ?');
            $stmt->execute([$eventId]);
            if ($stmt->fetchColumn() === false) {
                fairRespond(404, ['error' => 'not_found']);
            }
            $id = fairUuid();
            if ($kind === 'photos') {
                $url = fairCleanText($body['url'] ?? '', 2000);
                $caption = fairCleanText($body['caption'] ?? '', 500);
                $count = $db->prepare('SELECT COUNT(*) FROM event_photos WHERE event_id = ?');
                $count->execute([$eventId]);
                $position = (int) $count->fetchColumn();
                $ins = $db->prepare('INSERT INTO event_photos (id, event_id, url, caption, position) VALUES (?, ?, ?, ?, ?)');
                $ins->execute([$id, $eventId, $url, $caption, $position]);
            } else {
                $url = fairCleanText($body['url'] ?? '', 2000);
                $name = fairCleanText($body['name'] ?? 'Документ', 500);
                $count = $db->prepare('SELECT COUNT(*) FROM event_documents WHERE event_id = ?');
                $count->execute([$eventId]);
                $position = (int) $count->fetchColumn();
                $ins = $db->prepare('INSERT INTO event_documents (id, event_id, url, name, position) VALUES (?, ?, ?, ?, ?)');
                $ins->execute([$id, $eventId, $url, $name, $position]);
            }
            fairRespond(201, ['ok' => true]);
        }
    }

    // --------------------------------------------------------------- реестр
    if ($path === '/api/registry' && $method === 'GET') {
        fairRequireRole($db, ['admin']);
        fairRespond(200, fairListRegistry($db));
    }
    if ($path === '/api/registry' && $method === 'POST') {
        $session = fairRequireRole($db, ['admin']);
        fairRequireCsrf($session);
        $body = fairReadJsonBody(1048576);
        $rec = fairCleanRegistry($body);
        if ($rec['name'] === '') {
            fairRespond(422, ['error' => 'name-required']);
        }
        $id = fairUuid();
        $now = time();
        $stmt = $db->prepare(
            'INSERT INTO registry (id, name, products, inn, phone, settlement, representative, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$id, $rec['name'], $rec['products'], $rec['inn'], $rec['phone'], $rec['settlement'],
            $rec['representative'], $rec['status'], $rec['notes'], $now, $now]);
        $after = array_merge(['id' => $id], $rec);
        fairLog($db, 'registry', $id, 'insert', null, $after, $session['email']);
        fairRespond(201, $after);
    }
    if ($path === '/api/registry/import' && $method === 'POST') {
        $session = fairRequireRole($db, ['admin']);
        fairRequireCsrf($session);
        $body = fairReadJsonBody(10485760);
        $rows = $body['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows)) {
            fairRespond(422, ['error' => 'invalid-rows']);
        }
        $imported = 0;
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $rec = fairCleanRegistry($row);
            if ($rec['name'] === '') {
                continue;
            }
            $upsert = $db->prepare(
                'INSERT INTO registry (id, name, products, inn, phone, settlement, representative, status, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   products = excluded.products, inn = excluded.inn, phone = excluded.phone,
                   settlement = excluded.settlement, representative = excluded.representative,
                   status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at'
            );
            $now = time();
            $upsert->execute([fairUuid(), $rec['name'], $rec['products'], $rec['inn'], $rec['phone'], $rec['settlement'],
                $rec['representative'], $rec['status'], $rec['notes'], $now, $now]);
            $find = $db->prepare('SELECT id FROM registry WHERE name = ?');
            $find->execute([$rec['name']]);
            $entityId = (string) $find->fetchColumn();
            fairLog($db, 'registry', $entityId, $upsert->rowCount() >= 1 ? 'insert' : 'update', null,
                array_merge(['id' => $entityId], $rec), $session['email']);
            $imported++;
        }
        fairRespond(200, ['imported' => $imported, 'skipped' => 0]);
    }

    if (preg_match('#^/api/registry/([^/]+)$#D', $path, $m) === 1) {
        $registryId = $m[1];
        if ($method === 'PUT') {
            $session = fairRequireRole($db, ['admin']);
            fairRequireCsrf($session);
            $body = fairReadJsonBody(1048576);
            $stmt = $db->prepare('SELECT * FROM registry WHERE id = ?');
            $stmt->execute([$registryId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($before)) {
                fairRespond(404, ['error' => 'not_found']);
            }
            $rec = fairCleanRegistry($body);
            if ($rec['name'] === '') {
                fairRespond(422, ['error' => 'name-required']);
            }
            $upd = $db->prepare(
                'UPDATE registry SET name = ?, products = ?, inn = ?, phone = ?, settlement = ?,
                 representative = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?'
            );
            $upd->execute([$rec['name'], $rec['products'], $rec['inn'], $rec['phone'], $rec['settlement'],
                $rec['representative'], $rec['status'], $rec['notes'], time(), $registryId]);
            $after = array_merge(['id' => $registryId], $rec);
            fairLog($db, 'registry', $registryId, 'update', fairNormalizeRegistry($before), $after, $session['email']);
            fairRespond(200, $after);
        }
        if ($method === 'DELETE') {
            $session = fairRequireRole($db, ['admin']);
            fairRequireCsrf($session);
            $stmt = $db->prepare('SELECT * FROM registry WHERE id = ?');
            $stmt->execute([$registryId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($before)) {
                fairRespond(404, ['error' => 'not_found']);
            }
            $del = $db->prepare('DELETE FROM registry WHERE id = ?');
            $del->execute([$registryId]);
            fairLog($db, 'registry', $registryId, 'delete', fairNormalizeRegistry($before), null, $session['email']);
            fairRespond(200, ['ok' => true]);
        }
    }

    // ---------------------------------------------------------------- журнал
    if ($method === 'GET' && $path === '/api/change-log') {
        fairRequireRole($db, ['admin']);
        fairRespond(200, fairListChangeLog($db));
    }

    fairRespond(404, ['error' => 'not_found']);
} catch (Throwable $error) {
    error_log('yarmarka-4-sezona api: ' . get_class($error) . ': ' . $error->getMessage());
    fairRespond(500, ['error' => 'internal-error']);
}

// ---------------------------------------------------------------------------
// Обработчики
// ---------------------------------------------------------------------------

function fairHandleLogin(PDO $db, array $config): never
{
    if (fairLoginBlocked($db, $config)) {
        header('Retry-After: ' . $config['loginWindowSeconds']);
        fairRespond(429, ['error' => 'too-many-attempts']);
    }
    $body = fairReadJsonBody(1048576);
    $email = is_string($body['email'] ?? null) ? mb_strtolower(trim($body['email'])) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if ($email === '' || $password === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fairLoginRecord($db, $config);
        fairRespond(401, ['error' => 'unauthorized']);
    }
    $stmt = $db->prepare('SELECT email, password_hash, role FROM admin_users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($user) || !password_verify($password, (string) $user['password_hash'])) {
        fairLoginRecord($db, $config);
        fairRespond(401, ['error' => 'unauthorized']);
    }
    $session = fairIssueSession($db, (string) $user['email'], (string) $user['role'], $config['sessionTtlSeconds']);
    fairRespond(200, [
        'token' => $session['token'],
        'csrf' => $session['csrf'],
        'user' => $session['user'],
    ]);
}

function fairServeUpload(string $path): never
{
    $file = basename(substr($path, strlen('/api/uploads/')));
    if (preg_match('/^[A-Za-z0-9][A-Za-z0-9.-]*$/D', $file) !== 1) {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
    $ext = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
    if (!in_array($ext, $allowed, true)) {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
    $fullPath = fairUploadDir() . '/' . $file;
    if (!is_file($fullPath) || !fairIsPrivateFile($fullPath)) {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
    $isImage = in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true);
    header('Content-Type: ' . fairContentTypeForExtension($ext));
    header('Content-Length: ' . (string) filesize($fullPath));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=3600');
    header('Content-Disposition: ' . ($isImage ? 'inline' : 'attachment') . '; filename="' . $file . '"');
    header('Content-Security-Policy: sandbox');
    readfile($fullPath);
    exit;
}
