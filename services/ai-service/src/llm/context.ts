import type { ChatTurn } from './provider';

export const SYSTEM_PROMPT =
  'You are a helpful, concise AI career assistant. Help users with career planning, job search, ' +
  'resumes, interviews, skill development and workplace questions. Give practical, specific advice. ' +
  'If a question is outside careers, answer briefly and steer back. Do not invent facts about the user.';

/**
 * Builds the LLM request: system prompt + as many of the most recent turns as fit in the budget.
 * `history` is oldest -> newest and already includes the new user message as its last item.
 * Budget is measured in characters (~4 chars per token) so we need no tokenizer dependency.
 * The newest message is always kept.
 */
export function buildContext(history: ChatTurn[], maxChars: number): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (kept.length > 0 && used + turn.content.length > maxChars) break;
    kept.unshift(turn);
    used += turn.content.length;
  }
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...kept];
}
