let currentUser = null;
let isRegisterMode = false;
let users = [];
let tickets = [];

const $ = (id) => document.getElementById(id);

// ---- Auth screen logic ----

$('auth-toggle').addEventListener('click', () => {
  isRegisterMode = !isRegisterMode;
  $('name-field').classList.toggle('hidden', !isRegisterMode);
  $('auth-subtitle').textContent = isRegisterMode ? 'Create an account to get started.' : 'Sign in to continue.';
  $('auth-submit').textContent = isRegisterMode ? 'Register' : 'Sign in';
  $('auth-toggle').textContent = isRegisterMode ? 'Already have an account? Sign in' : 'Need an account? Register';
  $('auth-error').classList.add('hidden');
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').classList.add('hidden');
  const email = $('email').value.trim();
  const password = $('password').value;
  const name = $('name').value.trim();

  const url = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
  const payload = isRegisterMode ? { name, email, password } : { email, password };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      $('auth-error').textContent = data.error || 'Something went wrong.';
      $('auth-error').classList.remove('hidden');
      return;
    }
    currentUser = data.user;
    enterApp();
  } catch (err) {
    $('auth-error').textContent = 'Could not reach the server.';
    $('auth-error').classList.remove('hidden');
  }
});

$('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  location.reload();
});

// ---- App screen logic ----

async function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  $('me-name').textContent = `${currentUser.name} (${currentUser.role})`;
  await loadUsers();
  await loadTickets();
}

async function loadUsers() {
  const res = await fetch('/api/users');
  const data = await res.json();
  users = data.users || [];
  const select = $('t-assignee');
  select.innerHTML = '<option value="">Unassigned</option>' +
    users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

async function loadTickets() {
  const params = new URLSearchParams({
    status: $('filter-status').value,
    priority: $('filter-priority').value,
    q: $('search').value
  });
  const res = await fetch(`/api/tickets?${params.toString()}`);
  const data = await res.json();
  tickets = data.tickets || [];
  renderTickets();
}

function renderTickets() {
  $('stat-open').textContent = tickets.filter(t => t.status === 'open').length;
  $('stat-progress').textContent = tickets.filter(t => t.status === 'in_progress').length;
  $('stat-closed').textContent = tickets.filter(t => t.status === 'closed').length;

  const list = $('ticket-list');
  list.innerHTML = '';
  $('empty-msg').classList.toggle('hidden', tickets.length > 0);

  tickets.forEach(t => {
    const days = Math.floor((Date.now() - t.created_at) / 86400000);
    const div = document.createElement('div');
    div.className = 'ticket';
    div.innerHTML = `
      <div class="ticket-main">
        <div class="ticket-title-row">
          <span class="ticket-title">#${t.id} ${escapeHtml(t.title)}</span>
          <span class="badge badge-${t.priority}">${t.priority}</span>
        </div>
        ${t.description ? `<p class="ticket-desc">${escapeHtml(t.description)}</p>` : ''}
        <p class="ticket-meta">${t.assignee_name || 'Unassigned'} &middot; opened by ${t.creator_name} &middot; ${days === 0 ? 'today' : days + 'd ago'}</p>
      </div>
      <div class="ticket-actions">
        <select data-id="${t.id}" class="status-select">
          <option value="open" ${t.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
        <button data-id="${t.id}" class="del-btn" aria-label="Delete ticket">&times;</button>
      </div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      await fetch(`/api/tickets/${e.target.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: e.target.value })
      });
      loadTickets();
    });
  });

  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!confirm('Delete this ticket?')) return;
      await fetch(`/api/tickets/${e.currentTarget.dataset.id}`, { method: 'DELETE' });
      loadTickets();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

$('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: $('t-title').value.trim(),
    description: $('t-desc').value.trim(),
    priority: $('t-priority').value,
    assignee_id: $('t-assignee').value || null
  };
  if (!payload.title) return;
  await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  $('t-title').value = '';
  $('t-desc').value = '';
  $('t-assignee').value = '';
  loadTickets();
});

['filter-status', 'filter-priority'].forEach(id => $(id).addEventListener('change', loadTickets));
$('search').addEventListener('input', debounce(loadTickets, 300));

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---- Boot ----

(async function init() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (data.user) {
    currentUser = data.user;
    enterApp();
  }
})();
