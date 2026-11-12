const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
export const SESSION_KEY = 'ledgerline.session';

export function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { sessionStorage.removeItem(SESSION_KEY); return null; }
}

export function saveSession(value) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
export function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

export function httpMessage(status, apiError) {
  if (status === 400) return apiError || 'Please check the information and try again.';
  if (status === 401) return 'Your session has expired or your credentials are incorrect. Please sign in again.';
  if (status === 403) return 'Your account does not have permission to do that.';
  if (status === 404) return 'We could not find that account or resource.';
  if (status === 409) return apiError || 'This request conflicts with the current account state. Refresh and try again.';
  if (status === 429) return 'Too many attempts. Wait a little and try again.';
  if (status >= 500) return 'LedgerLine could not complete the request. Please try again.';
  return apiError || 'Something went wrong. Please try again.';
}

export async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new Error('Could not reach LedgerLine. Check that the backend is running and try again.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) window.dispatchEvent(new CustomEvent('ledgerline:unauthorized', { detail: httpMessage(response.status, payload.error) }));
    const error = new Error(httpMessage(response.status, payload.error));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function paiseFromRupees(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter an amount with up to two decimal places.');
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
  if (paise < 1n || paise > 100_000_000n) throw new Error('Amount must be between ₹0.01 and ₹10,00,000.00.');
  return Number(paise);
}

export function formatPaise(value) {
  if (value === null || value === undefined) return '—';
  try {
    const paise = BigInt(value);
    const whole = new Intl.NumberFormat('en-IN').format(paise / 100n);
    const fraction = String(paise % 100n).padStart(2, '0');
    return `₹${whole}.${fraction}`;
  } catch { return '—'; }
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
