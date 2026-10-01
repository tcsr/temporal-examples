import {
  proxyActivities,
  defineQuery,
  setHandler,
  continueAsNew,
  workflowInfo,
} from '@temporalio/workflow';
import type { CampaignActivities } from './activities';

const { loadRecipients } = proxyActivities<CampaignActivities>({
  startToCloseTimeout: '1 minute',
});
const { sendCampaignEmail } = proxyActivities<CampaignActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '5 seconds', maximumAttempts: 5 }, // provider rate limits
});

export interface CampaignInput {
  campaignId: string;
  listId: string;
  template: string;
  batchSize?: number; // emails in flight at once (protects the provider)
  pageSize?: number; // recipients loaded per page
  offset?: number; // cursor, carried across continue-as-new
  sent?: number;
  failed?: string[];
}

export interface CampaignProgress {
  sent: number;
  failed: number;
  offset: number;
}
export const progress = defineQuery<CampaignProgress>('progress');

export async function emailCampaignWorkflow(input: CampaignInput) {
  const { listId, template, batchSize = 50, pageSize = 500 } = input;
  let offset = input.offset ?? 0;
  let sent = input.sent ?? 0;
  const failed = input.failed ?? [];
  setHandler(progress, () => ({ sent, failed: failed.length, offset }));

  for (;;) {
    const page = await loadRecipients(listId, offset, pageSize);
    if (page.length === 0) break;

    // Bounded concurrency: one batch at a time, every email in the batch in parallel
    for (let i = 0; i < page.length; i += batchSize) {
      const batch = page.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((r) => sendCampaignEmail(r, template)),
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') sent++;
        else failed.push(batch[j].email); // bad address: record and move on
      });
    }
    offset += page.length;

    // Huge lists: start a fresh run (new history) with the cursor carried over
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof emailCampaignWorkflow>({
        ...input,
        offset,
        sent,
        failed,
      });
    }
  }
  return { campaignId: input.campaignId, sent, failed };
}
