'use strict';

const $ = selector => document.querySelector(selector);
const state = { user: null, mode: 'login', view: 'public', trace: [] };
const toastNode = $('#toast');
let toastTimeout;

function notify(message, isError = false) {
  toastNode.textContent = message;
  toastNode.classList.toggle('error-toast', isError);
  toastNode.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toastNode.hidden = true; }, 4400);
}

function logRequest(method, endpoint, status, detail) {
  const entry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), method, endpoint, status, detail };
  state.trace.unshift(entry);
  if (state.trace.length > 25) state.trace.pop();
  renderTrace();
}

function renderTrace() {
  const area = $('#trace-items');
  area.replaceChildren();
  if (!state.trace.length) {
    const message = document.createElement('div');
    message.className = 'trace-placeholder';
    message.textContent = 'Awaiting your first request. Run a test to populate this log.';
    area.append(message);
    return;
  }
  for (const item of state.trace) {
    const row = document.createElement('div');
    row.className = 'trace-entry';
    const pieces = [
      ['trace-time', item.time],
      ['trace-endpoint', `${item.method} ${item.endpoint}`],
      ['trace-result ' + (item.status >= 400 ? 'blocked' : 'ok'), `${item.status} ${statusText(item.status)}`],
      ['', item.detail]
    ];
    for (const [className, text] of pieces) {
      const element = document.createElement('span');
      element.className = className;
      element.textContent = text;
      row.append(element);
    }
    area.append(row);
  }
}

function statusText(status) {
  return ({ 200:'OK',201:'Created',204:'No Content',400:'Bad Request',401:'Unauthorized',403:'Forbidden',409:'Conflict',415:'Unsupported',429:'Rate Limited' })[status] || '';
}

async function request(endpoint, options = {}, detail = '') {
  const method = options.method || 'GET';
  let response;
  let payload = null;
  try {
    response = await fetch(endpoint, {
      credentials: 'same-origin',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options
    });
    if (response.status !== 204) payload = await response.json();
    logRequest(method, endpoint, response.status, detail || (response.ok ? 'Access granted' : payload?.error || 'Denied'));
    return { status: response.status, ok: response.ok, data: payload };
  } catch {
    logRequest(method, endpoint, 0, 'Network error');
    notify('Could not reach the server.', true);
    return { status: 0, ok: false, data: null };
  }
}

function updateUser(user) {
  state.user = user;
  const signedIn = Boolean(user);
  $('#auth-form-area').hidden = signedIn;
  $('#signed-in-area').hidden = !signedIn;
  $('#session-name').textContent = signedIn ? user.username : 'Not authenticated';
  $('#session-subtitle').textContent = signedIn ? 'Authenticated account' : 'No active identity';
  $('#session-pill').textContent = signedIn ? `${user.role.toUpperCase()} SESSION` : 'Guest session';
  $('#avatar').textContent = signedIn ? user.username[0].toUpperCase() : '?';
  $('#avatar').classList.toggle('verified', signedIn);
  $('#role-display').textContent = signedIn ? user.role.toUpperCase() : '—';
}

function setMode(mode) {
  state.mode = mode;
  $('#tab-login').classList.toggle('selected', mode === 'login');
  $('#tab-register').classList.toggle('selected', mode === 'register');
  $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
  $('#tab-register').setAttribute('aria-selected', String(mode === 'register'));
  $('#submit-auth').firstChild.textContent = mode === 'login' ? 'Sign in ' : 'Create account ';
  $('#auth-helper').textContent = mode === 'login'
    ? 'Use a registered account to obtain a secure session.'
    : 'Registration always creates a User account. Admin roles are provisioned only from the server CLI.';
  $('#password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) return notify('Username and password are required.', true);
  const endpoint = state.mode === 'login' ? '/api/login' : '/api/register';
  const button = $('#submit-auth');
  button.disabled = true;
  const result = await request(endpoint, { method:'POST', body: JSON.stringify({ username, password }) }, state.mode === 'login' ? 'Authenticate identity' : 'Create least-privilege account');
  button.disabled = false;
  $('#password').value = '';
  if (result.ok) {
    if (state.mode === 'login') {
      updateUser(result.data.user);
      await showView('user');
    } else {
      setMode('login');
    }
    notify(result.data.message);
  } else if (result.status) {
    notify(result.data?.error || 'The request failed.', true);
  }
}

async function logout() {
  const result = await request('/api/logout', { method:'POST', body: '{}' }, 'Server-side session invalidation');
  if (result.ok) {
    updateUser(null);
    await showView('public');
    notify('Session revoked on the server.');
  }
}

function setStatus(id, status) {
  const node = $(id);
  node.textContent = `${status} ${statusText(status)}`;
  node.classList.toggle('success', status >= 200 && status < 300);
  node.classList.toggle('error', status >= 400);
}

function renderAccessState(containerSelector, { allowed, title, description, role = '' }) {
  const root = $(containerSelector);
  root.replaceChildren();
  root.className = 'access-state ' + (allowed ? 'state-success' : 'state-denied');
  const art = document.createElement('div');
  art.className = 'lock-illustration';
  art.textContent = allowed ? '✓' : '×';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = description;
  const chip = document.createElement('span');
  chip.className = 'status-marker ' + (allowed ? 'public-marker' : 'admin-marker');
  chip.textContent = role || (allowed ? 'ACCESS APPROVED' : 'ACCESS DENIED');
  root.append(art, heading, paragraph, chip);
}

async function checkUser() {
  const result = await request('/api/user/dashboard', {}, 'Session required');
  setStatus('#user-status', result.status);
  if (result.ok) renderAccessState('#user-content', { allowed: true, title: 'Identity verified.', description: result.data.message, role: `USER: ${result.data.user.username}` });
  else renderAccessState('#user-content', { allowed:false, title: '401 · Authentication required', description: 'Your browser has no valid session. The server rejected this request.' });
  return result;
}

function showAdminTable(data) {
  const root = $('#admin-content');
  root.className = '';
  root.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = 'Administrative access granted.';
  const description = document.createElement('p');
  description.className = 'admin-subtitle';
  description.textContent = `The backend confirmed your Admin role. ${data.count} registered account(s) are visible below.`;
  const table = document.createElement('table');
  table.className = 'admin-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['USERNAME', 'ROLE', 'CREATED']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const user of data.users) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = user.username;
    const role = document.createElement('td');
    const roleBadge = document.createElement('span');
    roleBadge.className = 'role-chip ' + (user.role === 'admin' ? 'admin' : '');
    roleBadge.textContent = user.role;
    role.append(roleBadge);
    const created = document.createElement('td');
    created.textContent = user.createdAt.slice(0,10);
    tr.append(name, role, created);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  root.append(heading, description, table);
}

async function checkAdmin() {
  const result = await request('/api/admin/users', {}, 'Server-side admin role guard');
  setStatus('#admin-status', result.status);
  if (result.ok) showAdminTable(result.data);
  else renderAccessState('#admin-content', {
    allowed: false,
    title: result.status === 403 ? '403 · Permission denied' : '401 · Authentication required',
    description: result.status === 403
      ? 'You are authenticated, but your User role is not authorized for this endpoint. The backend blocked the call.'
      : 'Sign in first. Both a valid session and an Admin role are required.'
  });
  return result;
}

async function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(section => {
    const active = section.id === `view-${view}`;
    section.classList.toggle('active', active);
    section.hidden = !active;
  });
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('selected', tab.dataset.view === view));
  if (view === 'user') await checkUser();
  if (view === 'admin') await checkAdmin();
}

async function runProbe(key) {
  let result;
  switch (key) {
    case 'public': result = await request('/api/public', {}, 'No authentication needed'); break;
    case 'user': result = await checkUser(); break;
    case 'admin': result = await checkAdmin(); break;
    case 'bad-login': result = await request('/api/login', { method:'POST', body: JSON.stringify({ username:'unknown_demo_account', password:'NotARealPassword123!' }) }, 'Invalid credentials must fail generically'); break;
    case 'bad-input': result = await request('/api/register', { method:'POST', body: JSON.stringify({ username:'', password:'' }) }, 'Server rejects empty fields'); break;
    case 'injection': result = await request('/api/login', { method:'POST', body: JSON.stringify({ username:'admin', password:"' OR '1'='1' --" }) }, 'SQL-like input treated as data'); break;
    default: return;
  }
  if (result.status) notify(`${result.status} ${statusText(result.status)} · Check the request in DevTools Network`, result.status >= 400);
}

$('#auth-form').addEventListener('submit', submitAuth);
$('#tab-login').addEventListener('click', () => setMode('login'));
$('#tab-register').addEventListener('click', () => setMode('register'));
$('#logout-button').addEventListener('click', logout);
$('#public-check').addEventListener('click', async () => {
  const result = await request('/api/public', {}, 'Public endpoint health');
  setStatus('#public-status', result.status);
  if (result.ok) notify('Public endpoint verified: 200 OK');
});
$('#user-check').addEventListener('click', checkUser);
$('#admin-check').addEventListener('click', checkAdmin);
$('#clear-trace').addEventListener('click', () => { state.trace = []; renderTrace(); });
for (const tab of document.querySelectorAll('.view-tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
for (const probe of document.querySelectorAll('[data-probe]')) probe.addEventListener('click', () => runProbe(probe.dataset.probe));

(async function initialize() {
  const response = await request('/api/me', {}, 'Restore current session if one exists');
  updateUser(response.ok ? response.data.user : null);
  // This first unauthenticated 401 is expected, not a browser exception.
})();
