import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { createOnboardingActivities, Employee } from '../src/onboarding/activities';
import { onboardEmployeeWorkflow } from '../src/onboarding/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const hrMessages: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createOnboardingActivities({
    createEmail: async (e) => `${e.id}@corp.example`,
    inviteToSlack: async (e) => `slack:${e.id}`,
    addToGitHub: async (e) => `github:${e.id}`,
    orderLaptop: async (id, model) => `PO-${id}-${model.replace(/ /g, '')}`,
    registerPayroll: async (id) => `payroll:${id}`,
    notifyHr: async (_id, msg) => {
      hrMessages.push(msg);
    },
    archiveRecords: async () => {},
  });
  worker = await startWorker(
    env,
    'onboarding',
    require.resolve('../src/onboarding/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const onboard = (emp: Employee, workflowId = uid('onboard')) =>
  env.client.workflow.execute(onboardEmployeeWorkflow, {
    taskQueue: 'onboarding',
    workflowId,
    args: [emp],
  });

test('departments run as child workflows; the parent combines results', async () => {
  const workflowId = uid('onboard');
  const summary = await onboard(
    { id: 'e42', name: 'Ann', role: 'engineer', bankAccount: 'DE89...' },
    workflowId,
  );
  assert.deepEqual(summary, {
    employeeId: 'e42',
    accounts: ['e42@corp.example', 'slack:e42', 'github:e42'],
    laptopOrder: 'PO-e42-MacBookPro16',
    payroll: 'payroll:e42',
  });
  // Each child is a real, separately visible execution
  const it = await env.client.workflow.getHandle(`${workflowId}-it`).describe();
  assert.equal(it.status.name, 'COMPLETED');
  // The retention child outlives its parent
  const retention = await env.client.workflow
    .getHandle(`${workflowId}-retention`)
    .describe();
  assert.equal(retention.status.name, 'RUNNING');
});

test('a failing child is handled by the parent, onboarding continues', async () => {
  const summary = await onboard({ id: 'e43', name: 'Bob', role: 'sales' }); // no bank
  assert.equal(summary.payroll, 'PENDING_HR');
  assert.equal(summary.laptopOrder, 'PO-e43-MacBookAir13');
  assert.deepEqual(hrMessages, ['Payroll setup failed: Missing bank details']);
});
