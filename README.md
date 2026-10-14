# AI Career & Consultation Platform

A full-stack career platform built with Next.js, TypeScript, Express microservices, and MongoDB. It supports account and profile management, AI-assisted chat and resume generation, resume editing and version history, consultant booking, and payment-to-calendar/email fulfillment.

## Project status
- [x] API gateway, authentication, user profile, and refresh-token rotation
- [x] AI chat, LLM integration, streaming, retries, and usage tracking
- [x] Structured resume CRUD, two templates, HTML preview/export, editing, and version history
- [x] Consultant availability, booking, Stripe Checkout/webhooks, calendar, and email workflow
- [x] Per-user dashboard aggregation and server-side listing filters
- [x] Docker Compose local stack, API documentation, and service tests
- [x] Next.js frontend

## Layout
```
services/
  api-gateway/   # only public entry point: CORS, rate limit, JWT verification, routing
  auth-service/  # users, login, refresh-token rotation
  ai-service/    # chat sessions/messages, LLM integration (own database: ai_db)
  resume-service/ # structured resumes, templates, versions, AI generation (own database: resume_db)
  booking-service/ # consultant availability, bookings, Stripe, Calendar, email (own database: booking_db)
docker-compose.yml
```

### Architecture and service boundaries

```text
Next.js browser client
        |
        v
API gateway :4000 (CORS, rate limits, JWT verification, routing)
        |
        +--> Auth service    --> auth_db
        +--> AI service      --> ai_db --> OpenAI-compatible LLM (optional)
        +--> Resume service  --> resume_db --> AI service for generation
        +--> Booking service--> booking_db --> Stripe / Google Calendar / SMTP
```

The gateway is the only public backend entry point. It authenticates user requests once, strips client-supplied identity headers, and sends a shared internal secret to downstream services. Each service owns its MongoDB database so chat history, resumes, identity, and payment state can evolve independently. Within a domain, bounded resume content is embedded while growing chat messages and resume snapshots are referenced. The dashboard aggregates service-owned counts through authenticated internal requests; it does not duplicate domain data.

## Quick start (Docker)
```powershell
Copy-Item .env.example .env # PowerShell; set both secrets to random values of at least 16 characters
docker compose up --build -d
```

The local stack uses Docker Desktop's free local engine and the bundled MongoDB container. Keep Docker Desktop running. The AI service starts without an LLM key so the rest of the application remains usable; AI generation and replies return an explicit `LLM_NOT_CONFIGURED` error until `OPENAI_API_KEY` is set. Stripe Checkout, Google Calendar event creation, and email fulfillment likewise require the corresponding provider configuration in `.env`.

Start the Next.js client in another terminal:
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The gateway health endpoint is `http://localhost:4000/health`. The browser client talks only to the gateway; backend service ports are not published.

### Environment and integrations

Copy `.env.example` to `.env`. `JWT_ACCESS_SECRET` and `INTERNAL_SERVICE_SECRET` are required for the stack. Configure `OPENAI_API_KEY` for LLM chat and resume generation. Configure Stripe keys and webhook secret, a Google Calendar service account, and SMTP credentials to enable live booking fulfillment. Never commit `.env` or provider credentials. Provider-specific functionality reports a clear configuration error when its credentials are absent; no paid provider is silently emulated.

### API documentation

The complete public gateway contract is in [docs/openapi.yaml](./docs/openapi.yaml) (OpenAPI 3.0.3). It documents authentication, user profile, dashboard, chat, resumes, consultant availability, bookings, and Stripe webhook operations. The architecture and workflow notes below explain key choices and state transitions.

## Tests

Each service has an isolated test suite using an in-memory MongoDB:
```powershell
npm --prefix services/auth-service ci
npm --prefix services/auth-service test
npm --prefix services/ai-service ci
npm --prefix services/ai-service test
npm --prefix services/resume-service ci
npm --prefix services/resume-service test
npm --prefix services/booking-service ci
npm --prefix services/booking-service test
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run build
```

Tests cover the authentication lifecycle and profile, chat/session ownership and provider failures, resume validation/versioning/rendering, booking concurrency and state transitions, and duplicate/failed Stripe webhook fulfillment.

## Dashboard

`GET /api/dashboard` returns `totalResumes`, `totalChats`, `upcomingConsultations`, and `completedConsultations` for the authenticated user. The gateway requests only paginated totals from the owning services in parallel, using internal identity headers; if a dependency is unavailable, it returns `503 DASHBOARD_UNAVAILABLE` rather than presenting incomplete counts as successful data.

## Authentication design
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

## Step 3: Resume service

### Endpoints (bearer token via the gateway)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/resumes/templates` | available templates |
| POST | `/api/resumes/generate` | create a resume from a profile; AI writes the prose |
| POST | `/api/resumes` | create manually |
| GET | `/api/resumes?page&limit&search&templateId&sort` | list (server-side pagination/search/filter/sort) |
| GET / PATCH / DELETE | `/api/resumes/:id` | read / update (title, templateId, data, baseVersion) / delete |
| POST | `/api/resumes/:id/duplicate` | copy |
| GET | `/api/resumes/:id/versions`, `/versions/:n` | history |
| POST | `/api/resumes/:id/versions/:n/restore` | restore (creates a new version) |
| GET | `/api/resumes/:id/preview?template=` | HTML preview; try another template without saving |
| GET | `/api/resumes/:id/export` | download the HTML file |

### Structured data, not stored HTML
A resume is `{personalInfo, summary, education[], experience[], skills[], projects[], certifications[], achievements[]}` plus `templateId`. Templates are only stylesheets over one shared semantic markup (`render.ts`), so the same data renders with any template and adding a template touches no business logic. Rich-text fields (summary, descriptions) hold a small sanitised HTML subset (`p, br, ul, ol, li, strong, em, u, a`) so the Tiptap editor can read and write them directly.

### AI generation flow
`profile (facts from the user) -> resume-service -> ai-service /api/ai/generate -> JSON -> validate -> merge -> save`.
- The AI only writes prose (summary, bullets, skill grouping). Every fact (companies, titles, dates, schools, links) is copied from the user's input, so hallucinations and prompt injection cannot alter them. Invented skills are dropped; forgotten skills are appended.
- Output must be valid JSON of the expected shape with matching entry counts; otherwise one retry with feedback, then `502 AI_BAD_OUTPUT`. Nothing is saved unless generation fully succeeds.
- The LLM key lives only in ai-service. `/api/ai/*` is not routed by the gateway, so only services holding the internal secret can call it.
- If ai-service is down or the LLM provider is not configured, resume generation returns an explicit 503/504 while manual resume features keep working (Q12).
- 100 concurrent generations (Q11): a per-process `Gate` runs `MAX_CONCURRENT_GENERATIONS` at once, queues `GENERATION_QUEUE_LIMIT` more, and returns `503 GENERATION_BUSY` beyond that, plus a per-user rate limit. At larger scale the next step is a job queue with 202 + polling.

### ATS-friendly output (how it is supported)
Single-column semantic HTML (`header`, `main`, `section`, `article`), one `h1`, `h2` per standard section name (Professional Summary, Experience, Education, Skills, Projects, Certifications, Achievements) in a conventional order, `h3` per entry, real `ul` lists, plain-text contact line and dates (`Mar 2021 – Present`), no tables, images, columns, icons or inline scripts, web-safe fonts, empty sections omitted. The Modern template only changes colour and spacing; it keeps the same markup.

### Versioning and editing safety
Every save creates a snapshot in `resumeversions` (newest `MAX_VERSIONS_PER_RESUME` kept). Restore creates a new version, never rewriting history. `PATCH` accepts `baseVersion` for compare-and-set so autosave from two tabs cannot silently overwrite each other (`409 VERSION_CONFLICT`).

### Data model and indexes
- `Resume {userId, title, templateId, version, data{...}}`: content embedded (always read and written as one bounded unit). Index `{userId, updatedAt:-1}`.
- `ResumeVersion {resumeId, userId, version, title, templateId, reason, data}`: separate collection. Unique index `{resumeId, version:-1}`.

### Known limitations (step 3)
- Export is HTML only. PDF would need a headless browser; users can print the preview to PDF (print styles included).
- Snapshots store the full document per save; heavy autosave should be debounced client-side or snapshot on an interval.
- The `Gate` and rate limits are per process; use Redis / a queue when running several replicas.

## Step 4: Consultation booking and payment

### Endpoints (bearer token via the gateway unless noted)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/consultants` | list consultants |
| POST | `/api/consultants` | create/update a consultant profile and availability (consultant/admin only) |
| GET | `/api/consultants/:id/availability?from&to` | list unreserved future time slots |
| PUT | `/api/consultants/:id/availability` | replace availability (consultant/admin only) |
| POST | `/api/bookings` | reserve a slot and create a Stripe Checkout session |
| GET | `/api/bookings?page&limit&state&consultantId&from&to&search&sort&order` | list my bookings (server-side pagination, search, filtering, sorting) |
| GET | `/api/bookings/:id` | view my booking |
| POST | `/api/bookings/:id/cancel` | cancel an eligible booking |
| POST | `/api/bookings/:id/retry-fulfillment` | retry Calendar/email fulfillment after payment |
| POST | `/api/bookings/:id/complete` | mark a finished confirmed booking complete |
| POST | `/api/payments/webhook` | Stripe webhook (public route; verified with the Stripe signature) |

Create a consultant's profile using their authenticated user ID as `id` and an ISO-8601 availability window:
```json
{
  "id": "<consultant-user-id>",
  "name": "Career Consultant",
  "email": "consultant@example.com",
  "timeZone": "America/New_York",
  "availability": [
    { "startAt": "2030-01-15T14:00:00Z", "endAt": "2030-01-15T14:45:00Z" }
  ]
}
```

The user must have the `CONSULTANT` role to create or change their profile. An operator can promote a registered user with:
```bash
docker compose exec mongo mongosh auth_db --eval 'db.users.updateOne({email:"consultant@example.com"}, {$set:{role:"CONSULTANT"}})'
```
Then sign in as that user and `POST /api/consultants` with their user ID. Configure Stripe, Google Calendar service-account access, and SMTP in `.env` to enable live integrations. For local Stripe testing, forward events with `stripe listen --forward-to localhost:4000/api/payments/webhook` and set the printed signing secret as `STRIPE_WEBHOOK_SECRET`. Missing provider credentials fail explicitly when the corresponding operation is requested. Stripe's signed webhook—not the browser's checkout redirect—is the source of payment truth. Confirmed payments are fulfilled in an idempotent flow that creates the Calendar event before sending the confirmation email; failed fulfillment can be retried. Booking state follows `PENDING_PAYMENT -> PAID -> CONFIRMED -> COMPLETED`, with `PAYMENT_FAILED` and `CANCELLED` terminal alternatives.

## Dashboard and aggregation

`GET /api/dashboard` is protected by the gateway and returns per-user resume, chat, upcoming consultation, and completed consultation totals. The gateway asks the owning services for page-one counts in parallel, rather than copying data across service databases. An upstream timeout or service error returns `503 DASHBOARD_UNAVAILABLE`.

## Submission notes and scaling discussion

- There is no Redis cache in this implementation. Chat and resume listings are indexed and paginated; cache invalidation is therefore not needed. The AI and resume-generation concurrency/rate limits are process-local and must move to Redis or a queue before horizontally scaling.
- MongoDB is run as one local container for development. For production, use separately managed replica sets per service, backups, monitoring, and shard only after query/index measurements justify it.
- For a million users, run stateless gateway and service replicas behind a load balancer; move rate limits and generation concurrency to shared Redis, move payment fulfillment to a durable outbox/queue with retry/dead-letter handling, and add per-service database capacity based on measured workload. Use signed short-lived service tokens or mTLS instead of the shared internal secret, and add centralized tracing/metrics/log aggregation.
- Calendar and email fulfillment is idempotently claimed and can be retried through the booking API, but it currently runs synchronously from webhook processing rather than through a durable message broker. The local stack documents and surfaces provider errors; real external booking fulfillment requires valid Stripe, Google Calendar, and SMTP configuration.
- The platform is runnable without paid API credentials: the AI service stays online with an empty `OPENAI_API_KEY`, while AI requests return `503 LLM_NOT_CONFIGURED`. Add a provider key only if you choose to incur API usage charges.
