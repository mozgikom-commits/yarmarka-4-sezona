<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/*
 * Ярмарка «4 сезона» — слой данных: мероприятия, реестр, журнал изменений.
 * Публика видит только разрешённые данные (мероприятия published; реестр —
 * только id/name/products у активных). Служебные поля реестра доступны только
 * администратору.
 */

function fairNormalizeEvent(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'title' => (string) ($row['title'] ?? ''),
        'description' => (string) ($row['description'] ?? ''),
        'event_date' => (string) ($row['event_date'] ?? ''),
        'start_time' => (string) ($row['start_time'] ?? ''),
        'end_time' => $row['end_time'] !== null ? (string) $row['end_time'] : null,
        'place' => (string) ($row['place'] ?? ''),
        'cover_url' => (string) ($row['cover_url'] ?? ''),
        'status' => (string) ($row['status'] ?? 'draft'),
        'photos' => [],
        'documents' => [],
    ];
}

function fairFetchEventRows(PDO $db): array
{
    $rows = $db->query(
        'SELECT id, title, description, event_date, start_time, end_time, place, cover_url, status
         FROM events ORDER BY event_date ASC, start_time ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC);

    $photos = $db->query('SELECT event_id, id, url, caption FROM event_photos ORDER BY position ASC, id ASC')
        ->fetchAll(PDO::FETCH_ASSOC);
    $documents = $db->query('SELECT event_id, id, url, name FROM event_documents ORDER BY position ASC, id ASC')
        ->fetchAll(PDO::FETCH_ASSOC);

    $photoMap = [];
    foreach ($photos as $p) {
        $photoMap[$p['event_id']][] = ['id' => (string) $p['id'], 'url' => (string) $p['url'], 'caption' => (string) $p['caption']];
    }
    $docMap = [];
    foreach ($documents as $d) {
        $docMap[$d['event_id']][] = ['id' => (string) $d['id'], 'url' => (string) $d['url'], 'name' => (string) $d['name']];
    }

    $out = [];
    foreach ($rows as $row) {
        $event = fairNormalizeEvent($row);
        $event['photos'] = $photoMap[$row['id']] ?? [];
        $event['documents'] = $docMap[$row['id']] ?? [];
        $out[] = $event;
    }
    return $out;
}

function fairPublicEvents(PDO $db): array
{
    $all = fairFetchEventRows($db);
    return array_values(array_filter($all, static fn (array $e): bool => $e['status'] === 'published'));
}

function fairPublicRegistry(PDO $db): array
{
    $rows = $db->query(
        "SELECT id, name, products FROM registry WHERE status = 'active' ORDER BY name COLLATE NOCASE ASC"
    )->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn (array $r): array => [
        'id' => (string) $r['id'],
        'name' => (string) $r['name'],
        'products' => (string) $r['products'],
    ], $rows);
}

function fairNormalizeRegistry(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'name' => (string) ($row['name'] ?? ''),
        'products' => (string) ($row['products'] ?? ''),
        'inn' => (string) ($row['inn'] ?? ''),
        'phone' => (string) ($row['phone'] ?? ''),
        'settlement' => (string) ($row['settlement'] ?? ''),
        'representative' => (string) ($row['representative'] ?? ''),
        'status' => (string) ($row['status'] ?? 'active'),
        'notes' => (string) ($row['notes'] ?? ''),
    ];
}

function fairListRegistry(PDO $db): array
{
    $rows = $db->query('SELECT * FROM registry ORDER BY name COLLATE NOCASE ASC')->fetchAll(PDO::FETCH_ASSOC);
    return array_map('fairNormalizeRegistry', $rows);
}

function fairLog(PDO $db, string $entity, ?string $entityId, string $action, ?array $before, ?array $after, string $changedBy): void
{
    $stmt = $db->prepare(
        'INSERT INTO change_log (entity, entity_id, action, changed_by, changed_at, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $entity,
        $entityId,
        $action,
        $changedBy,
        time(),
        $before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
        $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
    ]);
}

function fairListChangeLog(PDO $db, int $limit = 200): array
{
    $stmt = $db->prepare(
        'SELECT id, entity, entity_id, action, changed_by, changed_at, before_json, after_json
         FROM change_log ORDER BY id DESC LIMIT ?'
    );
    $stmt->bindValue(1, $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn (array $r): array => [
        'id' => (int) $r['id'],
        'entity' => (string) $r['entity'],
        'entity_id' => $r['entity_id'] !== null ? (string) $r['entity_id'] : null,
        'action' => (string) $r['action'],
        'changed_by' => $r['changed_by'] !== null ? (string) $r['changed_by'] : null,
        'changed_at' => fairIsoNow((int) $r['changed_at']),
        'before' => $r['before_json'] !== null ? json_decode($r['before_json'], true) : null,
        'after' => $r['after_json'] !== null ? json_decode($r['after_json'], true) : null,
    ], $rows);
}

// ---------------------------------------------------------------------------
// Валидация и очистка ввода
// ---------------------------------------------------------------------------

function fairCleanText(mixed $value, int $maxLength): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = trim($value);
    if (str_contains($value, "\0") || !mb_check_encoding($value, 'UTF-8')) {
        fairRespond(422, ['error' => 'invalid-text']);
    }
    if (mb_strlen($value) > $maxLength) {
        fairRespond(422, ['error' => 'text-too-long']);
    }
    return $value;
}

function fairCleanEvent(array $body): array
{
    $statuses = ['draft', 'published', 'archived'];
    $date = fairCleanText($body['event_date'] ?? $body['date'] ?? '', 10);
    $start = fairCleanText($body['start_time'] ?? $body['time'] ?? '12:00', 5);
    if ($date === '') {
        fairRespond(422, ['error' => 'event-date-required']);
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) !== 1) {
        fairRespond(422, ['error' => 'invalid-date']);
    }
    if ($start === '') {
        $start = '12:00';
    }
    if (preg_match('/^\d{2}:\d{2}$/D', $start) !== 1) {
        fairRespond(422, ['error' => 'invalid-time']);
    }
    $endRaw = $body['end_time'] ?? $body['endTime'] ?? '';
    $end = is_string($endRaw) && trim($endRaw) !== '' ? fairCleanText($endRaw, 5) : null;
    if ($end !== null && preg_match('/^\d{2}:\d{2}$/D', $end) !== 1) {
        fairRespond(422, ['error' => 'invalid-time']);
    }
    $status = is_string($body['status'] ?? null) && in_array($body['status'], $statuses, true)
        ? $body['status'] : 'draft';

    return [
        'title' => fairCleanText($body['title'] ?? '', 300),
        'description' => fairCleanText($body['description'] ?? '', 5000),
        'event_date' => $date,
        'start_time' => $start,
        'end_time' => $end,
        'place' => fairCleanText($body['place'] ?? '', 300),
        'cover_url' => fairCleanText($body['cover_url'] ?? $body['coverUrl'] ?? '', 2000),
        'status' => $status,
    ];
}

function fairCleanRegistry(array $body): array
{
    return [
        'name' => fairCleanText($body['name'] ?? '', 300),
        'products' => fairCleanText($body['products'] ?? '', 2000),
        'inn' => fairCleanText($body['inn'] ?? '', 32),
        'phone' => fairCleanText($body['phone'] ?? '', 64),
        'settlement' => fairCleanText($body['settlement'] ?? '', 300),
        'representative' => fairCleanText($body['representative'] ?? '', 300),
        'status' => ($body['status'] ?? '') === 'archived' ? 'archived' : 'active',
        'notes' => fairCleanText($body['notes'] ?? '', 2000),
    ];
}
