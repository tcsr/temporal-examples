import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import {
  createLoanActivities,
  LoanApplication,
} from '../src/loan-application/activities';
import { loanApplicationWorkflow } from '../src/loan-application/workflows';
import { startWorker, uid, rootCause, RunningWorker } from './helpers';

const SCORES: Record<string, number> = {
  prime: 780,
  subprime: 540,
  fraudster: 700,
};

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createLoanActivities(
    {
      score: async (id) => {
        if (id === 'slow') await delay(3_000); // bureau hangs past its 2 s SLA
        return SCORES[id] ?? 650;
      },
    },
    { risk: async (app) => (app.applicantId === 'fraudster' ? 'HIGH' : 'LOW') },
    { send: async () => {} },
  );
  worker = await startWorker(
    env,
    'loans',
    require.resolve('../src/loan-application/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const apply = (applicantId: string, over: Partial<LoanApplication> = {}) =>
  env.client.workflow.execute(loanApplicationWorkflow, {
    taskQueue: 'loans',
    workflowId: uid('loan'),
    args: [
      {
        applicationId: uid('app'),
        applicantId,
        amount: 20_000,
        annualIncome: 60_000,
        ...over,
      },
    ],
  });

test('good credit is approved at the best rate', async () => {
  assert.deepEqual(await apply('prime'), { decision: 'APPROVED', ratePct: 8.5 });
});

test('low credit is a rejection (a result, not an error)', async () => {
  assert.deepEqual(await apply('subprime'), {
    decision: 'REJECTED',
    reason: 'Credit score 540 below 600',
  });
});

test('high fraud risk goes to manual review', async () => {
  assert.equal((await apply('fraudster')).decision, 'MANUAL_REVIEW');
});

test('a bureau timeout degrades to manual review instead of failing', async () => {
  assert.deepEqual(await apply('slow'), {
    decision: 'MANUAL_REVIEW',
    reason: 'Credit bureau did not respond in time',
  });
});

test('invalid input fails the workflow with a typed error', async () => {
  await assert.rejects(apply('prime', { amount: 900_000 }), (err: unknown) => {
    assert.ok(err instanceof WorkflowFailedError);
    const cause = rootCause(err);
    assert.ok(cause instanceof ApplicationFailure);
    assert.equal(cause.type, 'InvalidApplication');
    return true;
  });
});
