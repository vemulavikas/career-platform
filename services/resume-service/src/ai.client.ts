import { AppError } from './errors';

export interface AiClient {
  generate(req: { system: string; prompt: string; userId: string }): Promise<string>;
}

/** Calls the ai-service over HTTP with the shared internal secret. The LLM key never lives in this service. */
export class HttpAiClient implements AiClient {
  constructor(private readonly o: { baseUrl: string; secret: string; timeoutMs: number }) {}

  async generate({ system, prompt, userId }: { system: string; prompt: string; userId: string }): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/api/ai/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': this.o.secret, 'x-user-id': userId },
        body: JSON.stringify({ system, prompt }),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') throw new AppError(504, 'AI_TIMEOUT', 'The AI service took too long to respond.');
      throw new AppError(503, 'AI_SERVICE_UNAVAILABLE', 'The AI service is currently unavailable.');
    }

    if (!res.ok) {
      const body: any = await res.json().catch(() => null);
      const status = [429, 502, 503, 504].includes(res.status) ? res.status : 502;
      throw new AppError(status, body?.error?.code ?? 'AI_SERVICE_ERROR', body?.error?.message ?? 'The AI service failed.');
    }
    const json: any = await res.json().catch(() => null);
    if (typeof json?.content !== 'string') throw new AppError(502, 'AI_BAD_OUTPUT', 'The AI service returned an unreadable response.');
    return json.content;
  }
}
