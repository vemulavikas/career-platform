import Stripe from 'stripe';
import { config } from '../config';
import { ConfigurationError } from '../errors';

export interface CheckoutRequest {
  bookingId: string;
  clientName: string;
  clientEmail: string;
  consultantName: string;
  startAt: Date;
  endAt: Date;
}

export interface CheckoutResult {
  id: string;
  url: string;
}

export interface VerifiedStripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  expireCheckout(sessionId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): VerifiedStripeEvent;
}

export class StripeAdapter implements StripeProvider {
  private client(): Stripe {
    if (!config.STRIPE_SECRET_KEY) throw new ConfigurationError('Stripe');
    return new Stripe(config.STRIPE_SECRET_KEY);
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const session = await this.client().checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: request.clientEmail,
        success_url: config.STRIPE_SUCCESS_URL,
        cancel_url: config.STRIPE_CANCEL_URL,
        client_reference_id: request.bookingId,
        metadata: { bookingId: request.bookingId },
        payment_intent_data: { metadata: { bookingId: request.bookingId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: config.CONSULTATION_CURRENCY,
              unit_amount: config.CONSULTATION_PRICE_CENTS,
              product_data: {
                name: `Consultation with ${request.consultantName}`,
                description: `${request.startAt.toISOString()} - ${request.endAt.toISOString()}`,
              },
            },
          },
        ],
      },
      { idempotencyKey: `booking-checkout-${request.bookingId}` },
    );
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    await this.client().checkout.sessions.expire(sessionId);
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedStripeEvent {
    if (!config.STRIPE_WEBHOOK_SECRET) throw new ConfigurationError('Stripe webhook');
    try {
      const event = this.client().webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
      return event as unknown as VerifiedStripeEvent;
    } catch {
      throw new Error('Invalid webhook signature');
    }
  }
}
