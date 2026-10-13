import type { Types } from 'mongoose';
import { config } from './config';
import { AppError } from './errors';
import { buildContext } from './llm/context';
import type { ChatTurn, Completion } from './llm/provider';
import { ChatMessage } from './models/chatMessage.model';
import { ChatSession, DEFAULT_TITLE } from './models/chatSession.model';

const HISTORY_LIMIT = 40; // messages loaded per request; buildContext then trims to the char budget
const notFound = () => new AppError(404, 'SESSION_NOT_FOUND', 'Chat session not found');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every query filters by userId as well as _id: a user can never touch someone else's session,
// and a foreign id looks exactly like a missing one (404, not 403), so ids cannot be probed.
async function getOwnedSession(userId: string, sessionId: string) {
  const session = await ChatSession.findOne({ _id: sessionId, userId });
  if (!session) throw notFound();
  return session;
}

export async function createSession(userId: string, title?: string) {
  return ChatSession.create({ userId, ...(title ? { title } : {}) });
}

export async function listSessions(userId: string, q: { page: number; limit: number; search?: string }) {
  const filter: Record<string, unknown> = { userId };
  if (q.search) filter.title = { $regex: escapeRegex(q.search), $options: 'i' };
  const [items, total] = await Promise.all([
    ChatSession.find(filter)
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    ChatSession.countDocuments(filter),
  ]);
  return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export async function getSessionWithMessages(userId: string, sessionId: string, limit: number) {
  const session = await getOwnedSession(userId, sessionId);
  const latest = await ChatMessage.find({ sessionId: session._id }).sort({ createdAt: -1, _id: -1 }).limit(limit);
  return { session, messages: latest.reverse() };
}

export async function renameSession(userId: string, sessionId: string, title: string) {
  const session = await ChatSession.findOneAndUpdate(
    { _id: sessionId, userId },
    { $set: { title } },
    { new: true, runValidators: true },
  );
  if (!session) throw notFound();
  return session;
}

export async function deleteSession(userId: string, sessionId: string) {
  const session = await ChatSession.findOneAndDelete({ _id: sessionId, userId });
  if (!session) throw notFound();
  // Messages are only reachable through their session, so a crash between these two calls
  // leaves harmless unreachable rows rather than a broken session.
  await ChatMessage.deleteMany({ sessionId: session._id });
}

export async function prepareContext(userId: string, sessionId: string, content: string) {
  const session = await getOwnedSession(userId, sessionId);
  const recent = await ChatMessage.find({ sessionId: session._id })
    .sort({ createdAt: -1, _id: -1 })
    .limit(HISTORY_LIMIT)
    .lean();
  const history: ChatTurn[] = recent.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  history.push({ role: 'user', content });
  return { session, context: buildContext(history, config.CONTEXT_MAX_CHARS) };
}

interface SessionLike {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  messageCount?: number | null;
}

/**
 * Persists the user message and the assistant reply together, only AFTER the LLM succeeded.
 * Trade-off: if the LLM fails, nothing is stored and the client can simply resend. If the client
 * disconnects mid-request the exchange is not saved.
 */
export async function saveExchange(session: SessionLike, content: string, result: Completion) {
  const update: Record<string, any> = {
    $inc: { messageCount: 2, totalTokens: result.usage.totalTokens },
    $set: { lastMessageAt: new Date() },
  };
  if (session.title === DEFAULT_TITLE && !session.messageCount) {
    update.$set.title = content.slice(0, 60); // auto-title from the first message (no extra LLM call)
  }

  const [userMessage, assistantMessage] = await ChatMessage.insertMany([
    { sessionId: session._id, userId: session.userId, role: 'user', content },
    {
      sessionId: session._id,
      userId: session.userId,
      role: 'assistant',
      content: result.content,
      model: result.model,
      usage: result.usage,
    },
  ]);

  const updated = await ChatSession.findOneAndUpdate({ _id: session._id }, update, { new: true });
  if (!updated) {
    // Session was deleted while the LLM was thinking: do not leave orphans behind.
    await ChatMessage.deleteMany({ sessionId: session._id });
    throw notFound();
  }
  return { userMessage, assistantMessage, session: updated };
}
