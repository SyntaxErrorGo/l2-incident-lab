CREATE DATABASE IF NOT EXISTS incident_lab;

CREATE TABLE IF NOT EXISTS incident_lab.analytics_events
(
    event_time DateTime64(3, 'UTC'),
    event_type LowCardinality(String),
    request_id String,
    order_id Nullable(UInt64),
    status_code UInt16,
    duration_ms Float64,
    incident_mode LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (event_type, event_time, request_id)
TTL toDateTime(event_time) + INTERVAL 90 DAY;
