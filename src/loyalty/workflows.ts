import {
  proxyActivities,
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  condition,
  continueAsNew,
  workflowInfo,
  allHandlersFinished,
} from '@temporalio/workflow';
import type { LoyaltyActivities, Tier } from './activities';

const { sendTierChangeEmail } = proxyActivities<LoyaltyActivities>({
  startToCloseTimeout: '1 minute',
});

export interface LoyaltyState {
  customerId: string;
  points: number;
  tier: Tier;
  recentOrders: string[]; // de-duplication window for redelivered events
  maxEventsPerRun?: number; // continue-as-new threshold (default 500)
}

export const earnPoints =
  defineSignal<[{ orderId: string; amountCents: number }]>('earn');
export const redeemPoints = defineUpdate<number, [number]>('redeem');
export const getAccount = defineQuery<{
  points: number;
  tier: Tier;
  eventsThisRun: number;
}>('getAccount');

const tierFor = (points: number): Tier =>
  points >= 1000 ? 'GOLD' : points >= 100 ? 'SILVER' : 'BRONZE';

// "Entity workflow": one long-lived workflow per customer account (Workflow ID
// loyalty-<customerId>). It never completes; it continues-as-new to stay small.
export async function loyaltyAccountWorkflow(state: LoyaltyState): Promise<void> {
  const maxEvents = state.maxEventsPerRun ?? 500;
  let events = 0;

  setHandler(earnPoints, ({ orderId, amountCents }) => {
    if (state.recentOrders.includes(orderId)) return; // duplicate delivery: ignore
    state.points += Math.floor(amountCents / 100); // 1 point per dollar
    state.recentOrders = [...state.recentOrders, orderId].slice(-200);
    events++;
  });

  setHandler(
    redeemPoints,
    (points) => {
      state.points -= points;
      events++;
      return state.points;
    },
    {
      validator: (points) => {
        if (points <= 0 || points > state.points) {
          throw new Error(
            `Cannot redeem ${points} points (balance ${state.points})`,
          );
        }
      },
    },
  );

  setHandler(getAccount, () => ({
    points: state.points,
    tier: state.tier,
    eventsThisRun: events,
  }));

  for (;;) {
    await condition(
      () =>
        tierFor(state.points) !== state.tier ||
        events >= maxEvents ||
        workflowInfo().continueAsNewSuggested,
    );

    const tier = tierFor(state.points);
    if (tier !== state.tier) {
      const previous = state.tier;
      state.tier = tier;
      await sendTierChangeEmail(state.customerId, previous, tier);
    }

    if (events >= maxEvents || workflowInfo().continueAsNewSuggested) {
      await condition(allHandlersFinished); // don't drop in-flight updates
      await continueAsNew<typeof loyaltyAccountWorkflow>(state); // fresh history
    }
  }
}
