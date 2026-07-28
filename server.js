const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

// ---- Auth routes ----

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'That email is already registered.' });

  const hash = bcrypt.hashSync(password, 10);
  const isFirstUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email.toLowerCase(), hash, isFirstUser ? 'admin' : 'member', Date.now());

  req.session.userId = info.lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: publicUser(user) });
});

app.get('/api/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY name').all();
  res.json({ users });
});

// ---- Ticket routes ----

function ticketWithJoins(row) {
  return row;
}

const ticketSelect = `
  SELECT t.*, a.name AS assignee_name, c.name AS creator_name
  FROM tickets t
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by
`;

app.get('/api/tickets', requireAuth, (req, res) => {
  const { status, priority, assignee_id, q } = req.query;
  let sql = ticketSelect + ' WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { sql += ' AND t.status = ?'; params.push(status); }
  if (priority && priority !== 'all') { sql += ' AND t.priority = ?'; params.push(priority); }
  if (assignee_id && assignee_id !== 'all') { sql += ' AND t.assignee_id = ?'; params.push(assignee_id); }
  if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY t.created_at DESC';
  const tickets = db.prepare(sql).all(...params);
  res.json({ tickets });
});

app.get('/api/tickets/:id', requireAuth, (req, res) => {
  const ticket = db.prepare(ticketSelect + ' WHERE t.id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  const comments = db.prepare(`
    SELECT c.*, u.name AS author_name FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.ticket_id = ? ORDER BY c.created_at ASC
  `).all(req.params.id);
  res.json({ ticket, comments });
});

app.post('/api/tickets', requireAuth, (req, res) => {
  const { title, description, priority, assignee_id } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
  const validPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO tickets (title, description, priority, status, assignee_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(title.trim(), description || '', validPriority, assignee_id || null, req.session.userId, now, now);
  const ticket = db.prepare(ticketSelect + ' WHERE t.id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ticket });
});

app.patch('/api/tickets/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

  const fields = ['title', 'description', 'priority', 'status', 'assignee_id'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (req.body.status && !['open', 'in_progress', 'closed'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
  updates.push('updated_at = ?');
  params.push(Date.now(), req.params.id);

  db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const ticket = db.prepare(ticketSelect + ' WHERE t.id = ?').get(req.params.id);
  res.json({ ticket });
});

app.delete('/api/tickets/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ticket not found.' });
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tickets/:id/comments', requireAuth, (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required.' });
  const existing = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ticket not found.' });
  const info = db.prepare(
    'INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.session.userId, body.trim(), Date.now());
  const comment = db.prepare(`
    SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json({ comment });
});

app.listen(PORT, () => {
  console.log(`Ticket system running at http://localhost:${PORT}`);
});
