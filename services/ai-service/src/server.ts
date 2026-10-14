import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config';
import { LLMError } from './errors';
import { OpenAIProvider } from './llm/openai.provider';
import type { ChatTurn, Completion, LLMProvider, StreamEvent } from './llm/provider';
import { logger } from './logger';

class UnconfiguredProvider implements LLMProvider {
  async complete(_messages: ChatTurn[], _signal?: AbortSignal): Promise<Completion> {
    throw new LLMError(503, 'LLM_NOT_CONFIGURED', 'AI features require an LLM provider API key.', false);
  }

  async *stream(_messages: ChatTurn[], _signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    throw new LLMError(503, 'LLM_NOT_CONFIGURED', 'AI features require an LLM provider API key.', false);
  }
}

async function main() {
  await mongoose.connect(config.MONGO_URI);

  const llm: LLMProvider = config.OPENAI_API_KEY
    ? new OpenAIProvider({
        apiKey: config.OPENAI_API_KEY,
        baseUrl: config.OPENAI_BASE_URL,
        model: config.LLM_MODEL,
        timeoutMs: config.LLM_TIMEOUT_MS,
        maxRetries: config.LLM_MAX_RETRIES,
        maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
      })
    : new UnconfiguredProvider();

  const server = createApp({ llm }).listen(config.PORT, () => logger.info(`ai-service listening on :${config.PORT}`));
  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
