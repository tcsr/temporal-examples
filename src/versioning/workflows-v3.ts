// v3 - cleanup, deployed once NO v1 order is still running
import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  deprecatePatch,
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
  deprecatePatch('fraud-check'); // still accepts v2 histories (with the marker)
  await a.runFraudCheck(orderId); // the new path is now unconditional
  return a.chargeCard(orderId);
}
// v4 (later, when no v2 order is running): delete the deprecatePatch() line
