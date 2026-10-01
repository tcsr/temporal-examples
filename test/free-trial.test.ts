import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { createTrialActivities } from '../src/free-trial/activities';
import {
  freeTrialWorkflow,
  upgraded,
  trialStatus,
} from '../src/free-trial/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const log: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createTrialActivities(
    {
      activatePlan: async (u, plan) => {
        log.push(`${u}:activate:${plan}`);
      },
      downgradeToFree: async (u) => {
        log.push(`${u}:downgrade`);
      },
    },
    {
      send: async (email, template) => {
        log.push(`${email}:${template}`);
      },
    },
  );
  worker = await startWorker(
    env,
    'trial',
    require.resolve('../src/free-trial/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

test('14 silent days: reminder on day 11, downgrade on day 14', async () => {
  const started = Date.now();
  const result = await env.client.workflow.execute(freeTrialWorkflow, {
    taskQueue: 'trial',
    workflowId: uid('trial'),
    args: [{ userId: 'u1', email: 'ann@x.com' }],
  });
  assert.equal(result, 'EXPIRED');
  assert.deepEqual(
    log.filter((l) => l.startsWith('ann') || l.startsWith('u1')),
    [
      'ann@x.com:welcome',
      'ann@x.com:trial-ends-in-3-days',
      'u1:downgrade',
      'ann@x.com:trial-expired',
    ],
  );
  assert.ok(Date.now() - started < 10_000, '14 days of timers are skipped');
});

test('upgrading on day 5 converts immediately, no reminder', async () => {
  const handle = await env.client.workflow.start(freeTrialWorkflow, {
    taskQueue: 'trial',
    workflowId: uid('trial'),
    args: [{ userId: 'u2', email: 'bob@x.com' }],
  });
  await env.sleep('5 days'); // advance the test clock
  assert.equal(await handle.query(trialStatus), 'TRIAL_ACTIVE');
  await handle.signal(upgraded, 'pro');
  assert.equal(await handle.result(), 'CONVERTED');
  assert.deepEqual(
    log.filter((l) => l.startsWith('bob') || l.startsWith('u2')),
    ['bob@x.com:welcome', 'u2:activate:pro', 'bob@x.com:thanks-for-upgrading'],
  );
});
