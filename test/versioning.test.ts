import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { createCheckoutActivities } from '../src/versioning/activities';
import { checkoutWorkflow, confirmPayment } from '../src/versioning/workflows-v1';
import { startWorker, uid } from './helpers';

const journal: string[] = [];
const activities = createCheckoutActivities(journal);
const code = (version: string) =>
  require.resolve(`../src/versioning/workflows-${version}`);

let env: TestWorkflowEnvironment;
before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
after(async () => {
  await env.teardown();
});

const steps = (orderId: string) =>
  journal.filter((j) => j.startsWith(`${orderId}:`)).map((j) => j.split(':')[1]);

async function waitForStep(orderId: string, step: string) {
  for (let i = 0; i < 100 && !steps(orderId).includes(step); i++)
    await env.sleep(100);
}

// Runs one complete order on the given code version and returns its event history
async function historyOf(version: string) {
  const worker = await startWorker(
    env,
    `history-${version}`,
    code(version),
    activities,
  );
  const orderId = uid(`order-${version}`);
  const handle = await env.client.workflow.start(checkoutWorkflow, {
    taskQueue: `history-${version}`,
    workflowId: orderId,
    args: [orderId],
  });
  await handle.signal(confirmPayment);
  await handle.result();
  await worker.stop();
  return handle.fetchHistory();
}

test('replay tests catch an unsafe change before it reaches production', async () => {
  const v1History = await historyOf('v1');
  await Worker.runReplayHistory({ workflowsPath: code('v2') }, v1History); // safe
  await assert.rejects(
    Worker.runReplayHistory({ workflowsPath: code('unsafe') }, v1History),
    (err: Error) => err.name === 'DeterminismViolationError',
  );
});

test('deploy mid-order: the order takes the new path when it gets there', async () => {
  // No workflow cache: like a fresh deployment, every task replays the full history
  const fresh = { maxCachedWorkflows: 0 };
  // Order A starts on v1 and waits for the customer's bank confirmation
  let worker = await startWorker(env, 'checkout', code('v1'), activities, fresh);
  const a = await env.client.workflow.start(checkoutWorkflow, {
    taskQueue: 'checkout',
    workflowId: uid('order-A'),
    args: ['A'],
  });
  await waitForStep('A', 'reserve');
  await worker.stop(); // ...deploy...
  worker = await startWorker(env, 'checkout', code('v2'), activities, fresh);

  // A replays its v1 history (reserve) on v2, then runs patched() for the FIRST time:
  // the marker is recorded and the new step executes. No non-determinism.
  await a.signal(confirmPayment);
  assert.equal(await a.result(), 'ch_A');
  assert.deepEqual(steps('A'), ['reserve', 'fraud-check', 'charge']);

  const b = await env.client.workflow.start(checkoutWorkflow, {
    taskQueue: 'checkout',
    workflowId: uid('order-B'),
    args: ['B'],
  });
  await b.signal(confirmPayment);
  await b.result();
  assert.deepEqual(steps('B'), ['reserve', 'fraud-check', 'charge']); // new path
  await worker.stop();
});

test('deprecatePatch (v3) only after all pre-patch orders finished', async () => {
  const v2History = await historyOf('v2');
  await Worker.runReplayHistory({ workflowsPath: code('v3') }, v2History); // ok
  const v1History = await historyOf('v1');
  await assert.rejects(
    // too early
    Worker.runReplayHistory({ workflowsPath: code('v3') }, v1History),
    (err: Error) => err.name === 'DeterminismViolationError',
  );
});
