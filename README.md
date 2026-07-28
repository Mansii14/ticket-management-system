# Ticket management system

A simple internal ticket tracker: Node/Express backend, SQLite database, session-based login, plain HTML/JS frontend (no build step).

## Features

- Email/password accounts with sessions (cookies, bcrypt-hashed passwords). The first person to register becomes admin; everyone after that is a member.
- Create, view, update status, assign, and delete tickets.
- Filter by status/priority, search by title or description.
- Comments per ticket (API ready; not yet wired into the UI — see "Extending" below).
- Everything is stored in a local `tickets.db` SQLite file — no external database to set up.

## Setup

Requires Node.js 18+.

```bash
cd ticket-system
npm install
npm start
```

Then open `http://localhost:3000`. Register the first account (it becomes admin), then sign in.

To use a different port: `PORT=4000 npm start`.

## Project structure

```
ticket-system/
  server.js        Express app, auth routes, ticket/comment API
  db.js             SQLite schema + connection (better-sqlite3)
  package.json
  public/
    index.html      Login/register screen + main app shell
    app.js           Frontend logic (fetch calls, rendering)
    styles.css
  tickets.db         Created automatically on first run
```

## API summary

| Method | Path                         | Description                  |
|--------|------------------------------|-------------------------------|
| POST   | /api/auth/register           | Create account, starts session |
| POST   | /api/auth/login              | Sign in                       |
| POST   | /api/auth/logout             | End session                   |
| GET    | /api/auth/me                 | Current session user          |
| GET    | /api/users                   | List users (for assignment)   |
| GET    | /api/tickets                 | List tickets (query: status, priority, assignee_id, q) |
| POST   | /api/tickets                 | Create ticket                 |
| GET    | /api/tickets/:id             | Ticket detail + comments      |
| PATCH  | /api/tickets/:id             | Update title/description/priority/status/assignee |
| DELETE | /api/tickets/:id             | Delete ticket                 |
| POST   | /api/tickets/:id/comments    | Add a comment                 |

All ticket/user routes require a logged-in session.

## Notes on security for production use

This is built for a small internal team, not public internet exposure. Before deploying beyond your local network:

- Set `SESSION_SECRET` to a long random string via environment variable (`server.js` falls back to a dev default otherwise).
- Run behind HTTPS and set `cookie.secure = true` in the session config in `server.js`.
- Consider rate-limiting `/api/auth/login` to slow down password guessing.
- Back up `tickets.db` periodically (it's a single file, easy to copy).

## Extending

- Wire the existing comments API into the ticket detail view (click a ticket to open it, list/add comments).
- Add a "my tickets" filter using `created_by` or `assignee_id = currentUser.id`.
- Add role checks (e.g. only admins can delete tickets) using the `role` column already on `users`.
- Add email notifications when a ticket is assigned (would need an email service/API key).
