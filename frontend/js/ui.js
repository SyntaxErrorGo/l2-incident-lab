import {scenarioDefinitions} from './investigation.js';

const $ = selector => document.querySelector(selector);
const statusNames = {201: 'Created', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 504: 'Gateway Timeout'};

function setText(selector, value) { $(selector).textContent = value ?? '—'; }
function formatTime(iso) { return new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(iso)); }
function severity(result) {
  if (result.scenario === 'invalid_status' && Number(result.status) >= 200 && Number(result.status) < 300) return 'warning';
  if (result.status === 429) return 'warning';
  if (Number(result.status) >= 500 || result.status === 'NETWORK') return 'critical';
  if (Number(result.status) >= 200 && Number(result.status) < 300) return 'success';
  return 'warning';
}
function responseMessage(result) {
  if (result.scenario === 'invalid_status' && result.body?.status === 'UNKNOWN') return `Order #${result.body.id} was created with invalid business status UNKNOWN.`;
  if (result.body?.detail) return typeof result.body.detail === 'string' ? result.body.detail : JSON.stringify(result.body.detail);
  if (result.body?.proxy_message) return result.body.proxy_message;
  if (result.body?.id) return `Order #${result.body.id} created with status ${result.body.status}.`;
  return result.ok ? 'Operation completed successfully.' : result.statusText;
}
function riskMessage(result) {
  if (result.status === 504) return 'Backend мог продолжить обработку после ответа Nginx. Перед повторным POST проверьте PostgreSQL, чтобы исключить создание дубликата.';
  if (result.status === 502) return 'Основной запрос не дошёл до backend. Проверьте upstream, состояние сервиса и конфигурацию proxy_pass.';
  if (result.status === 429) return `Повторите запрос после периода, указанного в Retry-After${result.retryAfter ? ` (${result.retryAfter} сек.)` : ''}. Проверьте источник нагрузки и настройки rate limit.`;
  if (result.status === 500) return 'Найдите backend-событие по request_id и проверьте исключение приложения.';
  if (result.scenario === 'invalid_status') return 'HTTP 2xx не гарантирует корректность бизнес-операции. Проверьте сохранённые данные в PostgreSQL.';
  return '';
}

export const ui = {
  renderHealth(health) {
    const healthy = health?.status === 'ok' && health?.database === 'ok';
    const environment = $('#environment-state');
    environment.className = `environment-state ${healthy ? 'is-healthy' : 'is-critical'}`;
    environment.innerHTML = `<span class="status-dot"></span><span>${healthy ? 'Environment operational' : 'Health check failed'}</span>`;
    for (const name of ['backend', 'database']) {
      const status = document.querySelector(`[data-service="${name}"] .service-status`);
      status.textContent = healthy ? 'Healthy' : 'No data';
      status.className = `service-status ${healthy ? 'healthy' : 'neutral'}`;
    }
  },
  renderEnvironmentError(message) {
    const environment = $('#environment-state');
    environment.className = 'environment-state is-critical';
    environment.innerHTML = `<span class="status-dot"></span><span>${message}</span>`;
  },
  renderMode(mode, definition = scenarioDefinitions.normal) {
    setText('#current-mode', definition.label);
    setText('#form-mode', definition.label);
    setText('#scenario-description', definition.description);
    document.querySelectorAll('.scenario-card').forEach(card => {
      card.classList.toggle('active', card.dataset.mode === mode);
      card.setAttribute('aria-pressed', card.dataset.mode === mode ? 'true' : 'false');
    });
  },
  setScenarioControlsDisabled(disabled) {
    document.querySelectorAll('.scenario-card, #reset-environment').forEach(button => { button.disabled = disabled; });
  },
  setSubmitting(active) {
    const button = $('#submit-order');
    button.disabled = active;
    button.classList.toggle('is-loading', active);
    button.querySelector('.button-label').textContent = active ? 'Sending request…' : 'Create Order';
    document.querySelectorAll('#order-form input').forEach(input => { input.disabled = active; });
  },
  renderValidation(errors) {
    document.querySelectorAll('.field-error').forEach(node => { node.textContent = errors[node.dataset.errorFor] || ''; });
    document.querySelectorAll('#order-form input').forEach(input => input.classList.toggle('invalid', Boolean(errors[input.name])));
  },
  renderResult(result) {
    const panel = $('#result-panel');
    panel.className = `panel result-panel state-${severity(result)}`;
    $('#empty-result').hidden = true;
    $('#result-content').hidden = false;
    setText('#result-status', result.status);
    setText('#result-status-text', statusNames[result.status] || result.statusText);
    setText('#result-latency', result.durationMs ? `${result.durationMs} ms` : 'No timing');
    setText('#result-method', result.method);
    setText('#result-path', result.path);
    setText('#result-time', formatTime(result.completedAt));
    setText('#result-request-id', result.requestId || 'Not returned');
    setText('#result-message', responseMessage(result));
    const outcome = result.scenario === 'invalid_status' && result.body?.status === 'UNKNOWN' ? 'BUSINESS WARNING' : result.ok ? 'SUCCESS' : result.status === 429 ? 'THROTTLED' : 'FAILED';
    setText('#result-outcome', outcome);
    const notice = $('#risk-notice');
    const risk = riskMessage(result);
    notice.hidden = !risk;
    notice.textContent = risk;
  },
  renderInvestigation(guide) {
    setText('#guide-mode', scenarioDefinitions[guide.mode]?.label || guide.mode);
    setText('#guide-cause', guide.cause);
    setText('#guide-where', guide.where);
    setText('#guide-check', guide.check);
    setText('#guide-expected', guide.expected);
    setText('#guide-risk', guide.risk);
    setText('#kql-code', guide.kql);
    setText('#sql-code', guide.sql);
    const filters = $('#secondary-filters');
    filters.replaceChildren();
    filters.hidden = !guide.secondary.length;
    guide.secondary.forEach((filter, index) => {
      const article = document.createElement('article');
      article.className = 'code-card compact-code-card';
      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = filter.title;
      const button = document.createElement('button');
      const codeId = `secondary-code-${index}`;
      button.className = 'icon-button copy-button';
      button.type = 'button';
      button.dataset.copySource = codeId;
      button.textContent = 'COPY';
      header.append(title, button);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.id = codeId;
      code.textContent = filter.code;
      pre.append(code);
      article.append(header, pre);
      if (filter.note) {
        const note = document.createElement('p');
        note.className = 'code-note';
        note.textContent = filter.note;
        article.append(note);
      }
      filters.append(article);
    });
  },
  renderHistory(history, onSelect) {
    const list = $('#request-history');
    list.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = 'No local requests yet.'; list.append(empty); return;
    }
    history.forEach(result => {
      const button = document.createElement('button');
      button.className = `history-row ${severity(result)}`;
      button.type = 'button';
      const mode = scenarioDefinitions[result.scenario]?.label || result.scenario;
      button.innerHTML = `<time>${formatTime(result.completedAt)}</time><span>${mode}</span><strong>${result.status}</strong><code></code><b>${result.durationMs} ms</b>`;
      button.querySelector('code').textContent = result.requestId || 'no request_id';
      button.addEventListener('click', () => onSelect(result));
      list.append(button);
    });
  },
  renderOrdersLoading() { $('#orders-body').innerHTML = '<tr><td colspan="5" class="table-state">Loading orders…</td></tr>'; },
  renderOrdersError(message) { $('#orders-body').innerHTML = `<tr><td colspan="5" class="table-state critical-text"></td></tr>`; $('#orders-body td').textContent = `Orders unavailable: ${message}`; },
  renderOrders(orders) {
    const body = $('#orders-body'); body.replaceChildren();
    if (!orders.length) { body.innerHTML = '<tr><td colspan="5" class="table-state">No orders in PostgreSQL.</td></tr>'; return; }
    orders.slice(0, 10).forEach(order => {
      const row = document.createElement('tr');
      const values = [`#${order.id}`, order.customer_name, order.product, order.quantity];
      values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
      const status = document.createElement('td');
      const badge = document.createElement('span'); badge.className = `order-status ${order.status === 'UNKNOWN' ? 'invalid' : ''}`; badge.textContent = order.status;
      status.append(badge); row.append(status); body.append(row);
    });
  },
  toast(message, kind = 'success') {
    const toast = document.createElement('div'); toast.className = `toast ${kind}`; toast.textContent = message;
    $('#toast-region').append(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 180); }, 2600);
  },
};
