import {api} from './js/api.js';
import {clearHistory, getHistory, pushHistory} from './js/state.js';
import {buildInvestigation, scenarioDefinitions} from './js/investigation.js';
import {ui} from './js/ui.js';

const state = {
  mode: 'normal',
  submitting: false,
  selectedResult: null,
};

function configureToolLinks() {
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  document.querySelectorAll('[data-tool-port]').forEach(link => {
    link.href = `${protocol}//${window.location.hostname}:${link.dataset.toolPort}`;
  });
}

async function refreshEnvironment() {
  const [healthResult, modeResult] = await Promise.allSettled([api.health(), api.getIncidentMode()]);
  ui.renderHealth(healthResult.status === 'fulfilled' ? healthResult.value : null);
  if (modeResult.status === 'fulfilled') {
    setMode(modeResult.value.mode);
  } else {
    ui.renderEnvironmentError('Control API unavailable');
  }
}

function setMode(mode) {
  state.mode = mode;
  ui.renderMode(mode, scenarioDefinitions[mode]);
  renderInvestigation(state.selectedResult);
}

async function changeMode(mode) {
  ui.setScenarioControlsDisabled(true);
  try {
    const response = mode === 'normal' ? await api.resetIncident() : await api.setIncidentMode(mode);
    setMode(response.mode);
    ui.toast(`Environment mode changed to ${response.mode}`);
  } catch (error) {
    ui.toast(`Mode change failed: ${error.message}`, 'critical');
  } finally {
    ui.setScenarioControlsDisabled(false);
  }
}

function validateOrder(form) {
  const values = Object.fromEntries(new FormData(form));
  const errors = {};
  if (!values.customer_name?.trim()) errors.customer_name = 'Customer name is required.';
  if (!values.product?.trim()) errors.product = 'Product is required.';
  const quantity = Number(values.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) errors.quantity = 'Use an integer from 1 to 10000.';
  ui.renderValidation(errors);
  return Object.keys(errors).length ? null : {
    customer_name: values.customer_name.trim(),
    product: values.product.trim(),
    quantity,
  };
}

async function submitOrder(event) {
  event.preventDefault();
  if (state.submitting) return;
  const form = event.currentTarget;
  const payload = validateOrder(form);
  if (!payload) return;

  state.submitting = true;
  ui.setSubmitting(true);
  try {
    const result = await api.createOrder(payload);
    result.scenario = state.mode;
    state.selectedResult = result;
    pushHistory(result);
    ui.renderResult(result);
    ui.renderHistory(getHistory(), selectHistoryResult);
    renderInvestigation(result);
    if (result.ok) {
      form.reset();
      document.querySelector('#quantity').value = '1';
      await refreshOrders();
    }
  } catch (error) {
    const result = api.networkFailureResult(error, state.mode);
    state.selectedResult = result;
    pushHistory(result);
    ui.renderResult(result);
    ui.renderHistory(getHistory(), selectHistoryResult);
    renderInvestigation(result);
  } finally {
    state.submitting = false;
    ui.setSubmitting(false);
  }
}

function selectHistoryResult(result) {
  state.selectedResult = result;
  ui.renderResult(result);
  renderInvestigation(result);
  document.querySelector('#result-panel').scrollIntoView({behavior: 'smooth', block: 'center'});
}

function renderInvestigation(result) {
  ui.renderInvestigation(buildInvestigation(result, state.mode));
}

async function refreshOrders() {
  ui.renderOrdersLoading();
  try {
    ui.renderOrders(await api.listOrders());
  } catch (error) {
    ui.renderOrdersError(error.message);
  }
}

function bindEvents() {
  document.querySelector('#scenario-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (button) changeMode(button.dataset.mode);
  });
  document.querySelector('#reset-environment').addEventListener('click', () => changeMode('normal'));
  document.querySelector('#order-form').addEventListener('submit', submitOrder);
  document.querySelector('#refresh-orders').addEventListener('click', refreshOrders);
  document.querySelector('#clear-history').addEventListener('click', () => {
    clearHistory();
    ui.renderHistory([], selectHistoryResult);
    ui.toast('Local request history cleared');
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-source]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copySource);
    const value = source?.textContent?.trim();
    if (!value || value.startsWith('No request_id')) return ui.toast('No correlation value to copy', 'warning');
    try {
      await navigator.clipboard.writeText(value);
      ui.toast('Copied to clipboard');
    } catch (_) {
      ui.toast('Clipboard is unavailable in this browser context', 'warning');
    }
  });
}

async function init() {
  configureToolLinks();
  bindEvents();
  ui.renderHistory(getHistory(), selectHistoryResult);
  renderInvestigation(null);
  await Promise.allSettled([refreshEnvironment(), refreshOrders()]);
}

init();
