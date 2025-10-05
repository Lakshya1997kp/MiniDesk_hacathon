## HelpDesk Mini

Run: `npm install` then `npm start` and open `http://localhost:3000`.

### Test Users
- user: user@example.com / userpass
- agent: agent@example.com / agentpass
- admin: admin@example.com / adminpass

### API Summary
- POST `/api/register` { email, password, role } → 201
- POST `/api/login` { email, password } → { token, user }
- POST `/api/tickets` (Auth, Idempotency-Key) { title, description, priority }
- GET `/api/tickets?search=&limit=&offset=` → { items, next_offset }
- GET `/api/tickets/:id` → { ticket, comments, timeline }
- PATCH `/api/tickets/:id` (Auth, If-Match: <version>) { status, assigned_to }
- POST `/api/tickets/:id/comments` (Auth, Idempotency-Key) { message, parent_comment_id? }

Uniform error: `{ "error": { "code": "FIELD_REQUIRED", "field": "email", "message": "Email is required" } }`

Rate limit: 60 req/min/user, else `429 { "error": { "code": "RATE_LIMIT" } }`.

Idempotency: All POST require `Idempotency-Key`. Retries return identical response.

SLA: High 24h, Medium 48h, Low 72h. Field `sla_deadline` and `sla_breached` boolean.

Optimistic locking: PATCH requires header `If-Match: <version>`. Stale → `409 VERSION_CONFLICT`.

### Example Requests

Register:

```bash
curl -X POST http://localhost:3000/api/register \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc' \
  -d '{"email":"a@b.com","password":"secret","role":"user"}'
```

Login:

```bash
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: def' \
  -d '{"email":"user@example.com","password":"userpass"}'
```

Create Ticket:

```bash
curl -X POST http://localhost:3000/api/tickets \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Idempotency-Key: xyz' \
  -d '{"title":"Printer Broken","description":"It is jammed","priority":"High"}'
```

List Tickets:

```bash
curl 'http://localhost:3000/api/tickets?limit=10&offset=0&search=printer' \
  -H 'Authorization: Bearer TOKEN'
```

Get Ticket:

```bash
curl http://localhost:3000/api/tickets/1 -H 'Authorization: Bearer TOKEN'
```

Update Ticket:

```bash
curl -X PATCH http://localhost:3000/api/tickets/1 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -H 'If-Match: 1' \
  -d '{"status":"pending","assigned_to":2}'
```

Add Comment:

```bash
curl -X POST http://localhost:3000/api/tickets/1/comments \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Idempotency-Key: qqq' \
  -d '{"message":"Looking into it"}'
```

