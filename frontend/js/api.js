const ORDER_PATH = '/api/orders';

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) return response.json();
  const text = await response.text();
  return text ? {proxy_message: response.statusText || text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()} : null;
}

async function trackedOrderRequest(payload) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(ORDER_PATH, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Request-ID': requestId},
      body: JSON.stringify(payload),
    });
  } catch (error) {
    error.requestId = requestId;
    error.durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    throw error;
  }
  const completedAt = new Date();
  const body = await parseBody(response);
  return {
    id: `${completedAt.getTime()}-${requestId}`,
    scenario: 'normal',
    status: response.status,
    statusText: response.statusText || 'Unknown status',
    ok: response.ok,
    method: 'POST',
    path: ORDER_PATH,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    completedAt: completedAt.toISOString(),
    requestId: response.headers.get('X-Request-ID') || requestId,
    retryAfter: response.headers.get('Retry-After'),
    body,
  };
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await parseBody(response);
  if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || `HTTP ${response.status}`);
  return payload;
}

export const api = {
  health: () => jsonRequest('/api/health'),
  getIncidentMode: () => jsonRequest('/api/incidents/status'),
  setIncidentMode: mode => jsonRequest(`/api/incidents/${mode}`, {method: 'POST'}),
  resetIncident: () => jsonRequest('/api/incidents/reset', {method: 'POST'}),
  listOrders: () => jsonRequest(ORDER_PATH),
  createOrder: trackedOrderRequest,
  networkFailureResult(error, scenario) {
    const completedAt = new Date();
    return {
      id: `${completedAt.getTime()}-network`, scenario, status: 'NETWORK', statusText: 'Fetch failed', ok: false,
      method: 'POST', path: ORDER_PATH, durationMs: error.durationMs || 0, completedAt: completedAt.toISOString(),
      requestId: error.requestId || null, retryAfter: null, body: {detail: error.message},
    };
  },
};
