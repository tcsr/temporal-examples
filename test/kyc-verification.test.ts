import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { createKycActivities, KycStatus } from '../src/kyc-verification/activities';
import { kycVerificationWorkflow } from '../src/kyc-verification/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

// Fake provider: a case becomes VERIFIED after N status checks (or never)
const readyAfter = new Map<string, number>();
const polls = new Map<string, number>();

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createKycActivities({
    submit: async (customerId) => `case-${customerId}`,
    status: async (caseId): Promise<KycStatus> => {
      const n = (polls.get(caseId) ?? 0) + 1;
      polls.set(caseId, n);
      const target = readyAfter.get(caseId) ?? Infinity;
      return n >= target ? 'VERIFIED' : 'PENDING';
    },
  });
  worker = await startWorker(
    env,
    'kyc',
    require.resolve('../src/kyc-verification/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const verify = (customerId: string, giveUpAfter = '1 hour') =>
  env.client.workflow.execute(kycVerificationWorkflow, {
    taskQueue: 'kyc',
    workflowId: uid('kyc'),
    args: [
      {
        customerId,
        documents: ['passport.jpg', 'selfie.jpg'],
        pollEvery: '1 minute',
        giveUpAfter,
      },
    ],
  });

test('polls the provider every minute until the verdict arrives', async () => {
  readyAfter.set('case-c1', 4);
  assert.equal(await verify('c1'), 'VERIFIED');
  assert.equal(polls.get('case-c1'), 4); // 3 x PENDING, then VERIFIED
});

test('no verdict before the deadline: falls back to manual review', async () => {
  assert.equal(await verify('c2', '10 minutes'), 'MANUAL_REVIEW');
  const n = polls.get('case-c2')!;
  assert.ok(
    n >= 9 && n <= 11,
    `about one poll per minute for 10 minutes (got ${n})`,
  );
});
