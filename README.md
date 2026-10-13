# AI Career & Consultation Platform

MERN microservice-oriented career platform (work in progress, built step by step).

## Status
- [x] Step 1: Monorepo, Docker Compose, API gateway, auth service (+ tests)
- [x] Step 2: AI chat + LLM integration
- [ ] Step 3: Resumes, templates, Tiptap
- [ ] Step 4: Booking, Stripe webhook, Calendar, Email
- [ ] Step 5: Dashboard, listings, more tests
- [ ] Step 6: Next.js frontend
- [ ] Step 7: Swagger docs and final README

## Layout
```
services/
  api-gateway/   # only public entry point: CORS, rate limit, JWT verification, routing
  auth-service/  # users, login, refresh-token rotation
  ai-service/    # chat sessions/messages, LLM integration (own database: ai_db)
docker-compose.yml
```

## Quick start (Docker)
```bash
cp .env.example .env        # then set JWT_ACCESS_SECRET to a long random value
docker compose up --build
curl -X POST localhost:4000/api/auth/register -H 'content-type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"Passw0rd123"}'
```

## Run auth-service tests
```bash
cd services/auth-service
npm install
npm test        # uses an in-memory MongoDB; first run downloads a mongod binary
```

## Auth design (so far)
- Passwords: bcrypt (cost 12). Max 72 chars because bcrypt truncates beyond that.
- Access token: JWT HS256, 15 min. Refresh token: random 384-bit value, stored only as SHA-256 hash, 7 days, TTL index cleanup.
- Refresh rotation with reuse detection: a replayed refresh token revokes all of that user's sessions. The rotation step is an atomic conditional update, so concurrent refreshes cannot both succeed.
- Gateway verifies the JWT once and forwards `x-user-id` / `x-user-role`; it strips those headers if a client sends them.
- Login returns the same error for unknown email and wrong password, and compares against a dummy hash to equalise timing.
- Role is never accepted from client input (register or profile update).

## Known limitations / trade-offs (step 1)
- Refresh token is returned in the JSON body. An httpOnly cookie is safer against XSS; to be revisited with the frontend.
- Register returns 409 for an existing email (user enumeration trade-off, chosen for usability).
- Downstream services currently trust gateway headers on the internal network. Service-to-service auth (signed internal token) comes with later services.

## Step 2: AI service

### Endpoints (all require a bearer token via the gateway)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat/sessions` | create session (`{title?}`) |
| GET | `/api/chat/sessions?page&limit&search` | list my sessions (paginated, searchable) |
| GET | `/api/chat/sessions/:id?limit` | open a session with its latest messages |
| PATCH | `/api/chat/sessions/:id` | rename |
| DELETE | `/api/chat/sessions/:id` | delete session and messages |
| POST | `/api/chat/sessions/:id/messages` | send a message, get the assistant reply |
| POST | `/api/chat/sessions/:id/messages/stream` | same, as Server-Sent Events (`delta`, `done`, `error`) |

### LLM architecture
`route -> load last 40 messages -> buildContext (system prompt + newest turns within a char budget) -> LLMProvider -> persist both messages -> respond`.
- `LLMProvider` is an interface; `OpenAIProvider` speaks the OpenAI chat-completions protocol, so any compatible provider works by changing `OPENAI_BASE_URL` and `LLM_MODEL`. The API key exists only in the ai-service environment.
- Each attempt has its own timeout (`LLM_TIMEOUT_MS`). Timeouts, 429s, 5xx and network errors are retried with exponential backoff and jitter (`LLM_MAX_RETRIES`). Auth failures and malformed responses are not retried.
- Provider failures are mapped to clean API errors: `LLM_TIMEOUT` 504, `LLM_RATE_LIMITED` 503, `LLM_UNAVAILABLE` 502, `LLM_BAD_RESPONSE` 502. Provider details and keys never reach the client.
- Messages are saved only after the LLM succeeds; a failed call leaves the conversation unchanged and the client can retry.
- Token usage is stored on each assistant message and summed on the session (`totalTokens`).
- AI rate limit: `AI_RATE_LIMIT_PER_MIN` per user (not per IP) on the two message endpoints.
- If the client disconnects, the upstream LLM request is aborted.

### Data model
- `ChatSession {userId, title, messageCount, totalTokens, lastMessageAt}`, index `{userId, updatedAt:-1}`.
- `ChatMessage {sessionId, userId, role, content, model, usage}`, index `{sessionId, createdAt, _id}`.
- Messages are referenced, not embedded: conversations are unbounded and are appended constantly, so embedding would grow one document without limit.
- Ownership: every query filters by `userId`; another user's session returns 404, not 403.

### Service-to-service auth
The gateway verifies the JWT, then calls internal services with `x-internal-key` (shared secret) and `x-user-id`. Services compare the key in constant time. Limitation: a shared secret is weaker than per-service signed tokens or mTLS; see "scaling" notes later.

### Streaming (Q7) and a slow LLM (Q6)
SSE over a POST. Headers are sent lazily on the first token, so a failure before any token is still a normal JSON error with a real status code. Once tokens flow, retries are impossible (we cannot unsend text), so errors arrive as an `error` event and the timeout becomes an idle timeout. A 30 s LLM is covered by the 30 s timeout, retries, and a gateway proxy timeout of 120 s.

### Known limitations (step 2)
- Context is trimmed by characters (about 4 per token), not a real tokenizer.
- No conversation summarisation: older turns are simply dropped.
- A client that disconnects mid-request loses that exchange (not saved).
- Rate-limit counters are in process memory; with several ai-service replicas they need Redis.
