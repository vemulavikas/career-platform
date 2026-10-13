import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';

async function main() {
  await mongoose.connect(config.MONGO_URI);
  const server = createApp().listen(config.PORT, () => logger.info(`auth-service listening on :${config.PORT}`));

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
