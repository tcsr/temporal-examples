import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { createReviewActivities } from '../src/document-review/activities';
import {
  onReviewSubmitted,
  onReviewImpossible,
} from '../src/document-review/webhook';
import { documentReviewWorkflow } from '../src/document-review/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

const tasks = new Map<string, string>(); // documentId -> callback token
const archived: string[] = [];

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createReviewActivities(
    {
      createTask: async (doc, token) => {
        tasks.set(doc, token);
      },
    },
    {
      store: async (doc, status) => {
        archived.push(`${doc}:${status}`);
      },
    },
  );
  worker = await startWorker(
    env,
    'review',
    require.resolve('../src/document-review/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

async function tokenFor(doc: string) {
  // wait until the review task exists
  for (let i = 0; i < 100 && !tasks.has(doc); i++)
    await new Promise((r) => setTimeout(r, 50));
  return tasks.get(doc)!;
}

test('reviewer approves via webhook: the waiting activity completes', async () => {
  const doc = uid('doc');
  const handle = await env.client.workflow.start(documentReviewWorkflow, {
    taskQueue: 'review',
    workflowId: doc,
    args: [doc],
  });
  await onReviewSubmitted(env.client, await tokenFor(doc), {
    approved: true,
    reviewer: 'priya',
    notes: 'All good',
  });
  assert.equal(await handle.result(), 'APPROVED');
  assert.ok(archived.includes(`${doc}:APPROVED`));
});

test('the reviewer reports the document as unreadable', async () => {
  const doc = uid('doc');
  const handle = await env.client.workflow.start(documentReviewWorkflow, {
    taskQueue: 'review',
    workflowId: doc,
    args: [doc],
  });
  await onReviewImpossible(env.client, await tokenFor(doc), 'Scan is blurry');
  assert.equal(await handle.result(), 'UNREADABLE');
});
