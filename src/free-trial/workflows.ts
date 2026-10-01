import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type { TrialActivities } from './activities';

const { sendEmail, activatePlan, downgradeToFree } =
  proxyActivities<TrialActivities>({
    startToCloseTimeout: '1 minute',
  });

const DAY = 24 * 60 * 60 * 1000;

export const upgraded = defineSignal<[string]>('upgraded'); // from the billing page
export const trialStatus = defineQuery<string>('trialStatus');

export interface TrialInput {
  userId: string;
  email: string;
  trialDays?: number;
}

// One workflow per sign-up: runs for 14 days, costs nothing while it waits
export async function freeTrialWorkflow({
  userId,
  email,
  trialDays = 14,
}: TrialInput): Promise<'CONVERTED' | 'EXPIRED'> {
  let plan: string | undefined;
  let status = 'TRIAL_ACTIVE';
  setHandler(upgraded, (p) => {
    plan = p;
  });
  setHandler(trialStatus, () => status);

  const convert = async () => {
    status = `CONVERTED:${plan}`;
    await activatePlan(userId, plan!);
    await sendEmail(email, 'thanks-for-upgrading');
    return 'CONVERTED' as const;
  };

  await sendEmail(email, 'welcome');

  // Durable timer + early exit: wake up after 11 days OR as soon as they upgrade
  if (await condition(() => plan !== undefined, (trialDays - 3) * DAY))
    return convert();

  status = 'ENDING_SOON';
  await sendEmail(email, 'trial-ends-in-3-days');
  if (await condition(() => plan !== undefined, 3 * DAY)) return convert();

  status = 'EXPIRED';
  await downgradeToFree(userId);
  await sendEmail(email, 'trial-expired');
  return 'EXPIRED';
}
