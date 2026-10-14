import mongoose from 'mongoose';
import { HttpAiClient } from './ai.client';
import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';

async function main() {
  await mongoose.connect(config.MONGO_URI);
  const ai = new HttpAiClient({
    baseUrl: config.AI_SERVICE_URL,
    secret: config.INTERNAL_SERVICE_SECRET,
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
  });
  const server = createApp({ ai }).listen(config.PORT, () => logger.info(`resume-service listening on :${config.PORT}`));
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
