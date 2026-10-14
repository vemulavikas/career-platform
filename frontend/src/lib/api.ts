const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ACCESS_KEY = "career_access_token";
const REFRESH_KEY = "career_refresh_token";

export type Tokens = { accessToken: string; refreshToken: string };
export type ApiUser = {
  id?: string;
  _id?: string;
  name: string;
  email: string;
  role?: string;
  phone?: string;
  profile?: { headline?: string; bio?: string; location?: string; skills?: string[] };
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function saveTokens(tokens: Tokens) {
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event("career:auth-expired"));
}

export function hasTokens() {
  return Boolean(localStorage.getItem(ACCESS_KEY) || localStorage.getItem(REFRESH_KEY));
}

let refreshRequest: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshRequest) return refreshRequest;
  refreshRequest = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) throw new Error("Refresh token expired");
      const body = (await response.json()) as { tokens: Tokens };
      saveTokens(body.tokens);
      return body.tokens.accessToken;
    } catch {
      clearTokens();
      return null;
    }
  })().finally(() => { refreshRequest = null; });
  return refreshRequest;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let code: string | undefined;
  try {
    const body = await response.json();
    message = body?.error?.message ?? body?.message ?? message;
    code = body?.error?.code;
  } catch {
    // Some upstream failures are plain text or have no body.
  }
  return new ApiError(message, response.status, code);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: boolean; responseType?: "json" | "text" } = {},
): Promise<T> {
  const auth = options.auth ?? true;
  const makeRequest = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (auth && token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_URL}${path}`, { ...init, headers });
  };

  let token = auth ? localStorage.getItem(ACCESS_KEY) : null;
  let response = await makeRequest(token);
  if (auth && response.status === 401) {
    token = await refreshAccessToken();
    if (token) response = await makeRequest(token);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (options.responseType === "text" ? await response.text() : await response.json()) as T;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof ApiError) {
    if (error.code === "LLM_UNAVAILABLE" || error.code === "LLM_BAD_RESPONSE" || error.code === "LLM_TIMEOUT" || error.code === "AI_BAD_OUTPUT") {
      return `${error.message} AI features require a working provider configured by the platform operator.`;
    }
    if (error.code === "UPSTREAM_UNAVAILABLE" || error.code === "DASHBOARD_UNAVAILABLE") {
      return "The service is temporarily unavailable. Check that the local API gateway and required services are running.";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "This resume changed in another tab. Reload the latest version before saving your edits.";
    }
    return error.message;
  }
  if (error instanceof TypeError) {
    return "Can't reach the API gateway. Start the local services or set NEXT_PUBLIC_API_URL to your gateway URL.";
  }
  return fallback;
}
