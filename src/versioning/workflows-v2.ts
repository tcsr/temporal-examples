// v2 done RIGHT - the new step is guarded by a patch marker
import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  patched,
} from '@temporalio/workflow';
import type { CheckoutActivities } from './activities';

const a = proxyActivities<CheckoutActivities>({ startToCloseTimeout: '1 minute' });

export const confirmPayment = defineSignal('confirmPayment');

export async function checkoutWorkflow(orderId: string): Promise<string> {
  let confirmed = false;
  setHandler(confirmPayment, () => {
    confirmed = true;
  });

  await a.reserveStock(orderId);
  await condition(() => confirmed);
  if (patched('fraud-check')) {
    // true when this line runs for the FIRST time (new orders, and in-flight
    // orders reaching it after the deploy); false when replaying a history
    // that already passed this point without the patch
    await a.runFraudCheck(orderId);
  }
  return a.chargeCard(orderId);
}
