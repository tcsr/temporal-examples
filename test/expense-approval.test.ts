import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  createExpenseActivities,
  Expense,
} from '../src/expense-approval/activities';
import {
  expenseApprovalWorkflow,
  decide,
  approvalState,
} from '../src/expense-approval/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const inbox: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createExpenseActivities(
    {
      notify: async (to) => {
        inbox.push(to);
      },
    },
    { reimburse: async (emp, amount) => `payout-${emp}-${amount}` },
  );
  worker = await startWorker(
    env,
    'expenses',
    require.resolve('../src/expense-approval/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const expense = (amount: number): Expense => ({
  expenseId: uid('exp'),
  employee: 'ann',
  amount,
  description: 'Client dinner',
  managerEmail: 'mgr@corp',
  directorEmail: 'dir@corp',
});
const submit = (e: Expense) =>
  env.client.workflow.start(expenseApprovalWorkflow, {
    taskQueue: 'expenses',
    workflowId: e.expenseId,
    args: [e],
  });

test('small expenses are approved by policy without bothering anyone', async () => {
  const h = await submit(expense(35));
  assert.deepEqual(await h.result(), {
    status: 'PAID',
    payoutId: 'payout-ann-35',
    approvedBy: 'policy',
  });
});

test('the manager approves within 2 days', async () => {
  const h = await submit(expense(420));
  await env.sleep('1 day');
  assert.equal(await h.query(approvalState), 'WAITING_FOR_MANAGER');
  await h.signal(decide, { approved: true, by: 'mgr@corp' });
  assert.equal((await h.result()).status, 'PAID');
});

test('a silent manager escalates to the director, who rejects', async () => {
  inbox.length = 0;
  const h = await submit(expense(1800));
  await env.sleep('49 hours'); // manager deadline passed
  assert.equal(await h.query(approvalState), 'ESCALATED_TO_DIRECTOR');
  await h.signal(decide, {
    approved: false,
    by: 'dir@corp',
    comment: 'Over budget',
  });
  assert.deepEqual(await h.result(), {
    status: 'REJECTED',
    by: 'dir@corp',
    comment: 'Over budget',
  });
  assert.deepEqual(inbox, ['mgr@corp', 'dir@corp', 'ann']);
});

test('nobody decides within 5 days: auto-rejected', async () => {
  const h = await submit(expense(999));
  assert.deepEqual(await h.result(), { status: 'AUTO_REJECTED' }); // 5 days skipped
});
