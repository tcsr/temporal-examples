// v2 done WRONG - a new activity call inserted without versioning
import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
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
  await a.runFraudCheck(orderId); // breaks every order that started on v1
  return a.chargeCard(orderId);
}
