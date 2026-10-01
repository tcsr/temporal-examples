import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  createCampaignActivities,
  Recipient,
} from '../src/email-campaign/activities';
import { emailCampaignWorkflow, progress } from '../src/email-campaign/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

// 120 subscribers, 3 of them with broken addresses
const LIST: Recipient[] = Array.from({ length: 120 }, (_, i) => ({
  name: `User ${i}`,
  email: [7, 42, 99].includes(i)
    ? `user${i}-at-example.com`
    : `user${i}@example.com`,
}));

let inFlight = 0;
let maxInFlight = 0;
const delivered: string[] = [];

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createCampaignActivities(
    { page: async (_list, offset, limit) => LIST.slice(offset, offset + limit) },
    {
      send: async (to) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight--;
        delivered.push(to.email);
      },
    },
  );
  worker = await startWorker(
    env,
    'campaigns',
    require.resolve('../src/email-campaign/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

test('sends to every valid address in bounded batches, skips bad ones', async () => {
  const handle = await env.client.workflow.start(emailCampaignWorkflow, {
    taskQueue: 'campaigns',
    workflowId: uid('campaign'),
    args: [
      {
        campaignId: 'black-friday',
        listId: 'newsletter',
        template: 'bf-2026',
        batchSize: 10,
        pageSize: 50,
      },
    ],
  });
  const result = await handle.result();
  assert.equal(result.sent, 117);
  assert.deepEqual(result.failed, [
    'user7-at-example.com',
    'user42-at-example.com',
    'user99-at-example.com',
  ]);
  assert.equal(new Set(delivered).size, 117, 'nobody received the email twice');
  assert.ok(
    maxInFlight <= 10,
    `never more than one batch in flight (max ${maxInFlight})`,
  );
  assert.deepEqual(await handle.query(progress), {
    sent: 117,
    failed: 3,
    offset: 120,
  });
});
