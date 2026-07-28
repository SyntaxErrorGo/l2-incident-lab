from prometheus_client import Counter, Gauge, Histogram

from .incidents import INCIDENT_MODES


HTTP_REQUESTS = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "path", "status_code"],
)
HTTP_ERRORS = Counter(
    "http_errors_total",
    "Total number of HTTP responses with status code 4xx or 5xx",
    ["method", "path", "status_code"],
)
HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 3, 5, 8, 10),
)
ORDERS_CREATED = Counter(
    "orders_created_total",
    "Total number of orders created",
    ["status"],
)
INCIDENT_MODE = Gauge(
    "incident_mode",
    "Current incident mode represented as a one-hot gauge",
    ["mode"],
)


def set_incident_mode(active_mode: str) -> None:
    for mode in INCIDENT_MODES:
        INCIDENT_MODE.labels(mode=mode).set(1 if mode == active_mode else 0)


set_incident_mode("normal")

