-- Поиск событий по request_id. Связывает API-запрос с заказом, ошибкой и сменой режима.
-- В clickhouse-client задайте: --param_request_id='ch-order-fail-001'
SELECT event_time, event_type, request_id, order_id, status_code, duration_ms, incident_mode
FROM incident_lab.analytics_events
WHERE request_id = {request_id:String}
ORDER BY event_time;

-- Группировка HTTP 5xx по минутам. Применяется при api_error и всплеске ошибок.
SELECT toStartOfMinute(event_time) AS minute, count() AS errors
FROM incident_lab.analytics_events
WHERE status_code >= 500
GROUP BY minute
ORDER BY minute DESC;

-- p95 latency запросов. Применяется при slow_api и HTTP 504 от Nginx.
SELECT
    incident_mode,
    round(quantile(0.95)(duration_ms), 2) AS p95_duration_ms
FROM incident_lab.analytics_events
WHERE event_type = 'request_completed'
GROUP BY incident_mode
ORDER BY p95_duration_ms DESC;

-- Количество событий по типам. Показывает полноту аналитики и объём операций/ошибок.
SELECT event_type, count() AS events
FROM incident_lab.analytics_events
GROUP BY event_type
ORDER BY events DESC, event_type;

-- Сравнение normal и incident-режимов. Применяется для оценки влияния инцидента
-- на error rate и latency; normal сравнивается со всеми остальными режимами.
SELECT
    if(incident_mode = 'normal', 'normal', 'incident') AS mode_group,
    countIf(event_type = 'request_completed') AS requests,
    countIf(event_type = 'request_completed' AND status_code >= 500) AS errors,
    round(100 * errors / nullIf(requests, 0), 2) AS error_rate_percent,
    round(avgIf(duration_ms, event_type = 'request_completed'), 2) AS avg_duration_ms,
    round(quantileIf(0.95)(duration_ms, event_type = 'request_completed'), 2) AS p95_duration_ms
FROM incident_lab.analytics_events
GROUP BY mode_group
ORDER BY mode_group;
