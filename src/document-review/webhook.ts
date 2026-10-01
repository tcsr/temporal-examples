import type { Client } from '@temporalio/client';
import type { ReviewResult } from './activities';

// Called by the review tool's webhook (e.g. a Fastify/Express route) when a
// reviewer clicks Approve / Reject. The token came from requestHumanReview().
export async function onReviewSubmitted(
  client: Client,
  token: string,
  result: ReviewResult,
) {
  await client.activity.complete(Buffer.from(token, 'base64url'), result);
}

// The reviewer tool can also report that the document is unreadable
export async function onReviewImpossible(
  client: Client,
  token: string,
  reason: string,
) {
  await client.activity.fail(Buffer.from(token, 'base64url'), new Error(reason));
}
