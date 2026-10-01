import {
  proxyActivities,
  ActivityFailure,
  ApplicationFailure,
} from '@temporalio/workflow';
import type { PaymentActivities, ChargeRequest } from './activities';

const { chargeCard } = proxyActivities<PaymentActivities>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second', // 1s, 2s, 4s, 8s, 16s between attempts
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 6,
  },
});
const { sendReceipt, notifyDeclined } = proxyActivities<PaymentActivities>({
  startToCloseTimeout: '30 seconds',
});

export type PaymentResult =
  { status: 'PAID'; chargeId: string } | { status: 'DECLINED'; reason: string };

export async function paymentWorkflow(req: ChargeRequest): Promise<PaymentResult> {
  try {
    const chargeId = await chargeCard(req);
    await sendReceipt(req.customerId, chargeId);
    return { status: 'PAID', chargeId };
  } catch (err) {
    if (
      err instanceof ActivityFailure &&
      err.cause instanceof ApplicationFailure &&
      err.cause.type === 'CardDeclined'
    ) {
      await notifyDeclined(req.customerId, err.cause.message);
      return { status: 'DECLINED', reason: err.cause.message };
    }
    throw err; // InvalidAmount, or retries exhausted: workflow FAILED
  }
}
