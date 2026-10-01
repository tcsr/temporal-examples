import { proxyActivities, ActivityFailure } from '@temporalio/workflow';
import type { ReviewActivities } from './activities';

const { requestHumanReview } = proxyActivities<ReviewActivities>({
  startToCloseTimeout: '7 days', // reviewers have one week
  retry: { maximumAttempts: 1 }, // never create duplicate review tasks
});
const { archiveDocument } = proxyActivities<ReviewActivities>({
  startToCloseTimeout: '1 minute',
});

export type ReviewOutcome = 'APPROVED' | 'REJECTED' | 'UNREADABLE';

export async function documentReviewWorkflow(
  documentId: string,
): Promise<ReviewOutcome> {
  let outcome: ReviewOutcome;
  try {
    const review = await requestHumanReview(documentId);
    outcome = review.approved ? 'APPROVED' : 'REJECTED';
  } catch (err) {
    if (!(err instanceof ActivityFailure)) throw err;
    outcome = 'UNREADABLE'; // the reviewer reported a failure
  }
  await archiveDocument(documentId, outcome);
  return outcome;
}
