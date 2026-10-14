import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { Booking } from './models/booking.model';
import { Consultant } from './models/consultant.model';
import { SlotLock } from './models/slot-lock.model';
import { StripeEvent } from './models/stripe-event.model';
import { GoogleCalendarAdapter } from './providers/calendar.provider';
import { NodemailerAdapter } from './providers/email.provider';
import { StripeAdapter } from './providers/stripe.provider';

async function main() {
  await mongoose.connect(config.MONGO_URI);
  await Promise.all([Booking.init(), Consultant.init(), SlotLock.init(), StripeEvent.init()]);
  const server = createApp({
    stripe: new StripeAdapter(),
    calendar: new GoogleCalendarAdapter(),
    email: new NodemailerAdapter(),
  }).listen(config.PORT, () => logger.info(`booking-service listening on :${config.PORT}`));

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
