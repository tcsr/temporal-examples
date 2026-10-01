import { ApplicationFailure, activityInfo, log } from '@temporalio/activity';

export interface ChargeRequest {
  paymentId: string; // our ID, also used as the gateway idempotency key
  customerId: string;
  amountCents: number;
  currency: string;
}

// The slice of a payment provider (Stripe, Adyen, Razorpay, ...) the activities need
export interface PaymentGateway {
  charge(req: ChargeRequest, idempotencyKey: string): Promise<{ id: string }>;
}
export interface Notifier {
  send(customerId: string, message: string): Promise<void>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly declineCode?: string,
  ) {
    super(message);
  }
}

// Dependencies are injected: production passes real clients, tests pass fakes
export function createPaymentActivities(
  gateway: PaymentGateway,
  notifier: Notifier,
) {
  return {
    async chargeCard(req: ChargeRequest): Promise<string> {
      if (req.amountCents <= 0) {
        throw ApplicationFailure.nonRetryable(
          `Invalid amount: ${req.amountCents}`,
          'InvalidAmount',
        );
      }
      try {
        const charge = await gateway.charge(req, req.paymentId);
        return charge.id;
      } catch (err) {
        if (err instanceof GatewayError && err.status === 402) {
          throw ApplicationFailure.create({
            message: `Card declined: ${err.declineCode}`,
            type: 'CardDeclined',
            nonRetryable: true,
            details: [err.declineCode],
          });
        }
        log.warn('Gateway call failed, Temporal will retry', {
          attempt: activityInfo().attempt,
          error: String(err),
        });
        throw err; // 5xx, timeouts: retried
      }
    },

    async sendReceipt(customerId: string, chargeId: string): Promise<void> {
      await notifier.send(customerId, `Payment received (${chargeId})`);
    },

    async notifyDeclined(customerId: string, reason: string): Promise<void> {
      await notifier.send(customerId, `Your payment was declined: ${reason}`);
    },
  };
}

export type PaymentActivities = ReturnType<typeof createPaymentActivities>;
