import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import { createLoyaltyActivities } from '../src/loyalty/activities';
import {
  loyaltyAccountWorkflow,
  earnPoints,
  redeemPoints,
  getAccount,
} from '../src/loyalty/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const mails: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await startWorker(
    env,
    'loyalty',
    require.resolve('../src/loyalty/workflows'),
    createLoyaltyActivities({
      send: async (c, t) => {
        mails.push(`${c}:${t}`);
      },
    }),
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

test('one workflow per customer, continued-as-new to stay small', async () => {
  const workflowId = `loyalty-${uid('cus')}`;
  const handle = await env.client.workflow.start(loyaltyAccountWorkflow, {
    taskQueue: 'loyalty',
    workflowId,
    args: [
      {
        customerId: 'cus_7',
        points: 0,
        tier: 'BRONZE',
        recentOrders: [],
        maxEventsPerRun: 5,
      },
    ], // tiny threshold for the test
  });
  const firstRunId = (await handle.describe()).runId;

  for (let i = 1; i <= 12; i++) {
    // $10 order = +10 points
    await handle.signal(earnPoints, { orderId: `ord_${i}`, amountCents: 1000 });
  }
  // the same order event delivered twice
  await handle.signal(earnPoints, { orderId: 'ord_3', amountCents: 1000 });

  // Continue-as-new is asynchronous (after the tier e-mail): wait for the new run
  for (let i = 0; i < 50 && (await handle.describe()).runId === firstRunId; i++) {
    await env.sleep(100);
  }
  assert.notEqual((await handle.describe()).runId, firstRunId, 'continued as new');

  // Queries and updates on the same handle follow the latest run automatically
  const account = await handle.query(getAccount);
  assert.equal(account.points, 120); // state carried over, duplicate ignored
  assert.equal(account.tier, 'SILVER');
  assert.equal(account.eventsThisRun, 0, 'the new run starts with a fresh history');
  assert.deepEqual(mails, ['cus_7:tier-bronze-to-silver']);

  await assert.rejects(
    handle.executeUpdate(redeemPoints, { args: [500] }),
    WorkflowUpdateFailedError,
  );
  assert.equal(await handle.executeUpdate(redeemPoints, { args: [50] }), 70);
  await handle.terminate('test done');
});
