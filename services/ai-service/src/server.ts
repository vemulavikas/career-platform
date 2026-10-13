import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config';
import { OpenAIProvider } from './llm/openai.provider';
import { logger } from './logger';

async function main() {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  await mongoose.connect(config.MONGO_URI);

  const llm = new OpenAIProvider({
    apiKey: config.OPENAI_API_KEY, // never leaves the backend
    baseUrl: config.OPENAI_BASE_URL,
    model: config.LLM_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_MAX_RETRIES,
    maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
  });

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
