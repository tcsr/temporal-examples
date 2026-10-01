import {
  proxyActivities,
  ActivityFailure,
  TimeoutFailure,
} from '@temporalio/workflow';
import { RetryState, type Duration } from '@temporalio/common';
import type { KycActivities } from './activities';

const { submitDocuments } = proxyActivities<KycActivities>({
  startToCloseTimeout: '1 minute',
});

export interface KycInput {
  customerId: string;
  documents: string[];
  pollEvery?: Duration; // how often to ask the provider (default 1 minute)
  giveUpAfter?: Duration; // how long to wait for a verdict (default 2 days)
}

export type KycOutcome = 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW';

export async function kycVerificationWorkflow(
  input: KycInput,
): Promise<KycOutcome> {
  const caseId = await submitDocuments(input.customerId, input.documents);

  // Proxies can be created inside the workflow: options come from the input
  const { waitForVerdict } = proxyActivities<KycActivities>({
    startToCloseTimeout: '30 seconds', // one status call
    scheduleToCloseTimeout: input.giveUpAfter ?? '2 days', // all polls together
    retry: {
      initialInterval: input.pollEvery ?? '1 minute',
      backoffCoefficient: 1, // fixed interval: a steady poll
    },
  });

  try {
    return await waitForVerdict(caseId);
  } catch (err) {
    // Deadline hit between polls: the cause is the LAST attempt's error and
    // retryState says TIMEOUT. Deadline hit during a poll: cause is TimeoutFailure.
    if (
      err instanceof ActivityFailure &&
      (err.retryState === RetryState.TIMEOUT || err.cause instanceof TimeoutFailure)
    ) {
      return 'MANUAL_REVIEW'; // provider never answered
    }
    throw err;
  }
}
