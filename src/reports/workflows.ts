import { proxyActivities } from '@temporalio/workflow';
import type { ReportActivities, SalesSummary } from './activities';

const { aggregateSales, emailReport } = proxyActivities<ReportActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '30 seconds', maximumAttempts: 10 },
});

// Started by a Schedule every night; reports on the previous calendar day
export async function dailySalesReportWorkflow({
  region,
  recipients,
}: {
  region: string;
  recipients: string[];
}): Promise<SalesSummary> {
  // Date.now() is deterministic in workflows: the time of the current workflow task
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const summary = await aggregateSales(region, day);
  await Promise.all(recipients.map((to) => emailReport(to, summary)));
  return summary;
}
