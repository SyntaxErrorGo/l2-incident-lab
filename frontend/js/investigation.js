export const scenarioDefinitions = {
  normal: {
    label: 'Normal',
    description: 'Запрос успешно проходит через Nginx и backend, заказ сохраняется в PostgreSQL.',
    cause: 'No incident. The full request path should be healthy.',
    where: 'Nginx access log, backend completion log, PostgreSQL and ClickHouse.',
    check: 'Correlate HTTP 201, request_id, the order row and analytics events.',
    expected: 'One created order with status created and matching request_id.',
    risk: 'Low. A retry can still create a duplicate because POST is not idempotent.',
  },
  bad_gateway: {
    label: '502 Bad Gateway',
    description: 'Nginx не может корректно обратиться к upstream. Основной POST-запрос не доходит до backend.',
    cause: 'Nginx selected an unavailable upstream and the connection was refused.',
    where: 'Nginx access/error logs and upstream routing. Do not start with application exceptions.',
    check: 'Confirm status 502, upstream_addr and absence of backend POST /api/orders.',
    expected: 'Nginx 502; no PostgreSQL order; no backend order handler event.',
    risk: 'Low for this lab: the POST never reached backend. Confirm before retrying in production.',
  },
  slow_api: {
    label: '504 Gateway Timeout',
    description: 'Backend получает запрос, но Nginx прекращает ожидание раньше завершения обработки. Операция могла сохраниться в PostgreSQL.',
    cause: 'Backend takes 8 seconds while Nginx proxy_read_timeout is 3 seconds.',
    where: 'Nginx timeout log, backend duration, PostgreSQL and ClickHouse timeline.',
    check: 'Compare Nginx 504 at ~3s with backend completion at ~8s and query the order.',
    expected: 'Client sees 504 while the backend may later return 201 and persist the order.',
    risk: 'High. Never repeat POST before checking PostgreSQL for the original request.',
  },
  rate_limited: {
    label: '429 Too Many Requests',
    description: 'Запрос отклоняется ограничителем частоты. Нужно учитывать Retry-After.',
    cause: 'The application rate-limit mode rejects order creation before the transaction.',
    where: 'Backend WARNING, response headers, Prometheus HTTP 429 series and Nginx access log.',
    check: 'Confirm Retry-After: 30, warning reason and absence of a PostgreSQL row.',
    expected: 'JSON HTTP 429; order_failed analytics event; no order created.',
    risk: 'Medium. Respect Retry-After and avoid a retry storm.',
  },
  api_error: {
    label: '500 Internal Server Error',
    description: 'Запрос доходит до приложения, но backend завершает его внутренней ошибкой.',
    cause: 'FastAPI raises the simulated application error before writing to PostgreSQL.',
    where: 'Backend ERROR/exception, Nginx upstream status and Prometheus HTTP 500 series.',
    check: 'Find the backend event by request_id and confirm the order is absent.',
    expected: 'JSON HTTP 500, backend ERROR, order_failed event and no order row.',
    risk: 'Medium. Diagnose the exception before retrying; production POST may not be idempotent.',
  },
  invalid_status: {
    label: 'Invalid Status',
    description: 'HTTP-запрос завершается успешно, но в базе сохраняются некорректные бизнес-данные.',
    cause: 'The application deliberately persists UNKNOWN instead of the allowed initial status.',
    where: 'HTTP response body, backend WARNING, orders and order_status_history.',
    check: 'Do not stop at HTTP 201: verify the persisted business status.',
    expected: 'HTTP 201 and a PostgreSQL order with status UNKNOWN.',
    risk: 'High business risk. A retry creates another order and does not repair the first one.',
  },
};

function quote(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll("'", "''");
}

export function buildInvestigation(result, activeMode) {
  const mode = result?.scenario || activeMode || 'normal';
  const definition = scenarioDefinitions[mode] || scenarioDefinitions.normal;
  const requestId = result?.requestId;
  const noId = 'No request_id available. Create an order first.';
  const kql = requestId
    ? `request_id : "${quote(requestId)}"\nand method : "POST"\nand path : "/api/orders"`
    : noId;
  const sql = requestId
    ? `SELECT id, customer_name, product, quantity, status, request_id, created_at\nFROM orders\nWHERE request_id = '${quote(requestId)}'\nORDER BY created_at DESC;`
    : noId;
  const secondary = [];

  if (mode === 'bad_gateway') {
    secondary.push({
      title: 'Nginx 502 evidence',
      code: 'service : "nginx"\nand method : "POST"\nand path : "/api/orders"\nand status_code : 502',
    });
    secondary.push({
      title: 'Backend absence check',
      code: requestId
        ? `service : "backend"\nand method : "POST"\nand path : "/api/orders"\nand request_id : "${quote(requestId)}"`
        : noId,
      note: 'GET /api/incidents/proxy-route is a service subrequest. Do not confuse it with the missing POST /api/orders.',
    });
  }
  if (mode === 'slow_api') {
    secondary.push({title: 'Nginx timeout', code: requestId ? `service : "nginx" and request_id : "${quote(requestId)}"\nand method : "POST" and path : "/api/orders"` : noId});
    secondary.push({title: 'Backend completion', code: requestId ? `service : "backend" and request_id : "${quote(requestId)}"\nand method : "POST" and path : "/api/orders"` : noId});
  }

  return {...definition, mode, kql, sql, secondary};
}
