-- Поиск заказа по ID. Применяется, когда пользователь сообщает конкретный order_id.
-- В psql задайте: \set order_id 14
SELECT id, customer_name, product, quantity, status, request_id, created_at
FROM orders
WHERE id = :order_id;

-- Поиск заказа по request_id. Связывает обращение пользователя, backend-лог и запись в БД.
-- В psql задайте: \set request_id '''ch-order-ok-001'''
SELECT id, customer_name, product, quantity, status, request_id, created_at
FROM orders
WHERE request_id = :request_id
ORDER BY created_at DESC;

-- Поиск некорректных статусов. Применяется при инциденте invalid_status.
SELECT id, status, request_id, created_at
FROM orders
WHERE status NOT IN ('created', 'processing', 'completed', 'cancelled')
ORDER BY created_at DESC;

-- Распределение заказов по статусам. Показывает масштаб статусного инцидента.
SELECT status, count(*) AS order_count
FROM orders
GROUP BY status
ORDER BY order_count DESC, status;

-- Последние десять заказов. Быстрая проверка свежих операций и их request_id.
SELECT id, customer_name, product, quantity, status, request_id, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;

-- JOIN с историей статусов. Применяется для восстановления последовательности изменений заказа.
-- В psql задайте: \set order_id 14
SELECT
    o.id AS order_id,
    o.status AS current_status,
    h.old_status,
    h.new_status,
    h.request_id,
    h.changed_at
FROM orders AS o
LEFT JOIN order_status_history AS h ON h.order_id = o.id
WHERE o.id = :order_id
ORDER BY h.changed_at, h.id;

-- Безопасное исправление UNKNOWN: транзакция блокирует строку, проверяет ожидаемый статус
-- и пишет аудит. Применяется после подтверждения инцидента invalid_status.
-- В psql задайте: \set order_id 14; \set fix_request_id '''manual-fix-14'''
BEGIN;

SELECT id, status
FROM orders
WHERE id = :order_id
FOR UPDATE;

WITH fixed AS (
    UPDATE orders
    SET status = 'created'
    WHERE id = :order_id
      AND status = 'UNKNOWN'
    RETURNING id
)
INSERT INTO order_status_history (order_id, old_status, new_status, request_id)
SELECT id, 'UNKNOWN', 'created', :fix_request_id
FROM fixed;

-- Должна вернуться строка со status = created. Выполните COMMIT только после проверки.
SELECT id, status, request_id, created_at
FROM orders
WHERE id = :order_id;

COMMIT;
-- Для отмены во время ручной диагностики замените COMMIT на ROLLBACK.

-- Активные соединения и блокировки. Применяется при зависаниях, росте latency и таймаутах.
SELECT
    a.pid,
    a.usename,
    a.application_name,
    a.client_addr,
    a.state,
    a.wait_event_type,
    a.wait_event,
    now() - a.query_start AS query_age,
    pg_blocking_pids(a.pid) AS blocking_pids,
    left(a.query, 200) AS query
FROM pg_stat_activity AS a
WHERE a.datname = current_database()
  AND a.pid <> pg_backend_pid()
ORDER BY cardinality(pg_blocking_pids(a.pid)) DESC, a.query_start;
