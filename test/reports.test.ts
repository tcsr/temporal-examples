// Schedules need a full Temporal server: this test uses the local dev server
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { createReportActivities } from '../src/reports/activities';
import { createNightlySalesSchedule } from '../src/reports/schedule';
import { startWorker, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const mails: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createLocal();
  const activities = createReportActivities(
    {
      salesFor: async (region, day) => ({
        region,
        day,
        orders: 1284,
        revenueCents: 9_876_500,
      }),
    },
    {
      send: async (to, subject) => {
        mails.push(`${to}|${subject}`);
      },
    },
  );
  worker = await startWorker(
    env,
    'reports',
    require.resolve('../src/reports/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

test('nightly schedule: next run 02:30 IST, trigger, pause, delete', async () => {
  const schedule = await createNightlySalesSchedule(env.client, 'south');
  const before = await schedule.describe();
  const next = before.info.nextActionTimes[0];
  // 02:30 in Asia/Kolkata (UTC+5:30) is 21:00 UTC
  assert.equal(next.toISOString().slice(11, 16), '21:00');

  await schedule.trigger(); // run it right now
  for (let i = 0; i < 100 && mails.length < 2; i++) await delay(100);
  assert.equal(mails.length, 2);
  assert.match(mails[0], /\|Sales south \d{4}-\d{2}-\d{2}$/);

  await schedule.pause('Quarter-end freeze');
  assert.equal((await schedule.describe()).state.paused, true);
  await schedule.delete();
});
