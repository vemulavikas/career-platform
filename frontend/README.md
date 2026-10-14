# Career Platform frontend

Authenticated Next.js workspace for career chat, structured resume editing, consultations, and account-profile management.

## Local development

```powershell
cd frontend
npm install
npm run dev
```

The frontend calls the API gateway at `http://localhost:4000` by default. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` to use another gateway URL. This is a public base URL, not a place for credentials or provider keys.

Sign-in and registration use the gateway auth endpoints. The browser stores only the access and refresh tokens in local storage; logout revokes the refresh token where possible and always clears local tokens. Authenticated routes verify the current account through the API before rendering workspace content.

AI chat and AI-assisted resume drafting depend on the AI provider configured on the server. Consultation checkout, calendar invites, and meeting links depend on the booking service's provider configuration. This frontend does not contain or collect provider secrets. A checkout redirect is not payment confirmation; only the booking service's verified Stripe webhook changes payment state.

## Main routes

- `/login`, `/register`, `/dashboard`, `/profile`
- `/chat`, `/chat/[sessionId]`
- `/resumes`, `/resumes/create`, `/resumes/[id]/edit`, `/resumes/[id]/preview`
- `/consultations`, `/consultations/book`
- `/bookings/success`, `/bookings/cancel`

## Validation

```powershell
npm run lint
npm run build
```
