# Great Vote backend: the contract between the frontend and the server

Two deploy modes share one frontend build (`demo/dist`):

- **static**: no API. Content is read from the static `content/` files, logs stay in the player's localStorage (researcher page export), rooms live in localStorage. This is today's behaviour and the Cloudflare Pages deploy.
- **server**: an API is present. Content, questionnaire, rooms and logs go through it. The player's browser still keeps a local copy of the log as a buffer.

The mode is decided at runtime, not build time: the frontend fetches `config.json` next to `index.html` at boot (`appUrl('config.json')`, 2 s timeout). `{"api": "/api"}` (any base path or absolute URL) switches to server mode; a missing or invalid file means static. The same `dist/` therefore works on both hosts; the server deploy writes its own `config.json` beside the files it serves.

## Identity

- **Participant session.** `POST {api}/session` with JSON `{ "room": "7K3F", "password": "..." }`. Reply `200 { "token": "<opaque, >= 32 random bytes, base64url>", "room": "7K3F", "config": <RoomConfig>, "session": "<session id>" }` or `401 { "error": "bad room or password" }`. The room's `config` is the same shape the researcher page stores today (`RoomConfig` in `demo/src/types.ts`), so the frontend builds the game state from it exactly as it does from localStorage. The client stores the token with the room's state and sends `Authorization: Bearer <token>` on every other call. Tokens expire after 30 days; `401` on any call means "sign in again" (the client shows the room form).
- **Staff.** Endpoints under `{api}/staff/*` require HTTP basic auth with `STAFF_USER` / `STAFF_PASS` from the server environment (v1). The server exposes a hook (one function, `staffIdentity(request)`) so that a Cloudflare Access identity header or a university SSO can replace basic auth later without touching the handlers.

## Logs

- The frontend already appends one JSON line per event to localStorage. In server mode each line also carries `seq` (monotonic per session, starting at 1) and `session` (the session id from `/session`). The client keeps an "acked" cursor per session in localStorage and flushes everything above it: on boot, after every append (debounced 2 s), and on `pagehide` with `keepalive: true`.
- `POST {api}/log` with bearer, JSON `{ "session": "<id>", "lines": [ { "seq": 12, "line": { ...the log line as stored... } }, ... ] }` (at most 500 lines per call). Reply `200 { "acked": <highest seq stored for this session> }`. Storage is idempotent on `(session, seq)`: resending is harmless, and lines may arrive out of order.
- `GET {api}/staff/logs?room=7K3F[&session=<id>]` returns `application/x-ndjson`: one JSON line per stored line in `(session, seq)` order, each with `session` and `seq` fields added. `GET {api}/staff/export?room=7K3F` returns the same as a download (`content-disposition: attachment`). The log viewer's "Open .jsonl" path consumes that file unchanged.

## Questionnaire and content

- `GET {api}/questionnaire?day=N` with bearer: the room's questionnaire JSON for that day (`200`), or `404` when the room has none, in which case the client falls through to its existing chain (room config, bundled `eod.json`). This replaces today's unauthenticated `api/questionnaire?room=&day=` call.
- `GET {api}/content/<path>` with bearer, e.g. `{api}/content/dialogue/us_leader_int.csv`, `{api}/content/npcs.yaml`, `{api}/content/questionnaire/eod.json`, `{api}/content/assets/manifest.json` (the manifest is the one exception that does not live under `content/` in the static layout; the server maps `assets/manifest.json` to it). Body is the file as the static deploy would serve it, which may be obscured (`GVZ1` header; the client's `decodeMaybe` handles both). `404` for unknown paths; no directory listing. v1 serves the files of the deployed `dist/` itself (`CONTENT_DIR`, default `../demo/dist`), so the server and the static site ship identical content; per-room content versions are a later step and need no contract change (the room's token already tells the server which room asks).
- In server mode the frontend's content `Source` reads every content path through this endpoint and nothing from the static `content/` folder. (The server does not serve `content/` statically at all: without a token there is no content.)

## Rooms (researcher page, server mode)

- `GET {api}/staff/rooms` → `[ { "code", "createdAt", "config": <RoomConfig>, "sessions": <count>, "lastActivity": <ISO or null> } ]`.
- `POST {api}/staff/rooms` with `{ "code", "password", "config", "questionnaire"?: <Questionnaire or per-day map> }` → `201` the room; `409` if the code exists. Passwords are stored hashed (scrypt or bcrypt); the researcher page never gets them back.
- `DELETE {api}/staff/rooms/<code>` → `204` (logs are kept; the room can no longer be entered).
- In server mode the researcher page lists and creates rooms through these calls instead of localStorage; the "Export everything / Restore from file" backup block stays for static mode only.

## Visits

- `POST {api}/visit` with bearer, `{ "ua": navigator.userAgent, "lang": navigator.language, "screen": "1440x900", "ref": document.referrer }` once per page load after a session exists. The server stores it with the session id and a timestamp and never stores IP addresses. Staff see visit counts in `GET {api}/staff/rooms`.

## Errors and offline

- Every failure is non-fatal for the player: a failed `/log` flush is retried on the next trigger; a failed `/content` read is an error only where the static file would have been missing too; a `5xx` or network error on `/session` shows "The study server is not reachable" on the room form.
- Responses are JSON with `content-type: application/json` unless stated; errors are `{ "error": "<message>" }`.

## Storage (server)

SQL that both SQLite and Postgres accept:

```sql
CREATE TABLE rooms (code TEXT PRIMARY KEY, password_hash TEXT NOT NULL, config TEXT NOT NULL, questionnaire TEXT, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(code), token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT);
CREATE TABLE log_lines (session TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, line TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY (session, seq));
CREATE TABLE visits (id INTEGER PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), at TEXT NOT NULL, ua TEXT, lang TEXT, screen TEXT, ref TEXT);
```

Tokens are stored hashed (SHA-256); the plain token exists only in the reply and the player's browser.

## Ownership

- `demo/` (frontend): the mode switch, the API `Source`, the session form, log `seq` + flush, the researcher page's server mode, the visit ping. Static mode must behave exactly as before; the fuzz walker and the checker stay green.
- `server/` (backend): a Hono app on Node 20+ with SQLite (`better-sqlite3`) behind a small query adapter so Postgres can replace it; serves `demo/dist` as static files (except `content/`), writes `config.json`, the endpoints above, a Dockerfile, `npm start`, a README with a Caddy snippet for TLS and the environment variables (`PORT`, `DB_PATH`, `CONTENT_DIR`, `STATIC_DIR`, `STAFF_USER`, `STAFF_PASS`, `TOKEN_TTL_DAYS`).
- Both sides ship a test that exercises the contract against the other side's stand-in (the frontend against a 60-line stub of these endpoints, the server against curl/fetch calls), so that integration after the merge is a check, not a debugging session.
