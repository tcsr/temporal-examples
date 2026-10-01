// v1 - in production today
import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type { CheckoutActivities } from './activities';

const a = proxyActivities<CheckoutActivities>({ startToCloseTimeout: '1 minute' });

export const confirmPayment = defineSignal('confirmPayment'); // 3-D Secure completed

export async function checkoutWorkflow(orderId: string): Promise<string> {
  let confirmed = false;
  setHandler(confirmPayment, () => {
    confirmed = true;
  });

  await a.reserveStock(orderId);
  await condition(() => confirmed); // can take minutes: customer is in their bank app
  return a.chargeCard(orderId);
}
