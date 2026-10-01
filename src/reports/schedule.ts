import { Client, ScheduleOverlapPolicy } from '@temporalio/client';
import { dailySalesReportWorkflow } from './workflows';

// Run once at deploy time (idempotent: delete + recreate, or catch "already exists")
export async function createNightlySalesSchedule(client: Client, region: string) {
  return client.schedule.create({
    scheduleId: `nightly-sales-${region}`,
    spec: {
      calendars: [{ hour: 2, minute: 30 }], // 02:30 every day...
      timezone: 'Asia/Kolkata', // ...in the business's time zone
    },
    action: {
      type: 'startWorkflow',
      workflowType: dailySalesReportWorkflow,
      taskQueue: 'reports',
      args: [
        { region, recipients: ['cfo@corp.example', 'sales-leads@corp.example'] },
      ],
    },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP, // yesterday's run still going? skip
      catchupWindow: '6 hours', // server was down at 02:30? run late
    },
  });
}
