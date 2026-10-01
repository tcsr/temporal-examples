import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import { createCartActivities } from '../src/shopping-cart/activities';
import {
  cartWorkflow,
  addItem,
  removeItem,
  getCart,
  applyCoupon,
  checkout,
} from '../src/shopping-cart/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const mails: string[] = [];
let orders = 0;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createCartActivities(
    { create: async () => `ord_${++orders}` },
    {
      send: async (userId, template) => {
        mails.push(`${userId}:${template}`);
      },
    },
  );
  worker = await startWorker(
    env,
    'cart',
    require.resolve('../src/shopping-cart/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

test('signals change the cart, queries read it, updates reply', async () => {
  const handle = await env.client.workflow.start(cartWorkflow, {
    taskQueue: 'cart',
    workflowId: uid('cart'),
    args: [{ userId: 'u1' }],
  });
  await handle.signal(addItem, { sku: 'BOOK', qty: 1, priceCents: 1500 });
  await handle.signal(addItem, { sku: 'BOOK', qty: 1, priceCents: 1500 });
  await handle.signal(addItem, { sku: 'PEN', qty: 3, priceCents: 200 });
  await handle.signal(removeItem, 'PEN');
  assert.equal((await handle.query(getCart)).totalCents, 3000);

  await assert.rejects(
    handle.executeUpdate(applyCoupon, { args: ['FREE100'] }),
    WorkflowUpdateFailedError,
  ); // rejected by validator
  assert.equal(await handle.executeUpdate(applyCoupon, { args: ['SAVE10'] }), 10);

  const orderId = await handle.executeUpdate(checkout); // reply = new order ID
  assert.match(orderId, /^ord_/);
  assert.deepEqual(await handle.result(), {
    status: 'ORDERED',
    orderId,
    totalCents: 2700,
  });
});

test('an abandoned cart gets one reminder, then expires', async () => {
  const handle = await env.client.workflow.start(cartWorkflow, {
    taskQueue: 'cart',
    workflowId: uid('cart'),
    args: [{ userId: 'u2' }],
  });
  await handle.signal(addItem, { sku: 'SHOES', qty: 1, priceCents: 8900 });
  const result = await handle.result(); // 48 h skipped
  assert.deepEqual(result, { status: 'EXPIRED', itemsLeft: 1 });
  assert.deepEqual(
    mails.filter((m) => m.startsWith('u2')),
    ['u2:abandoned-cart'],
  );
});

test('checkout of an empty cart is rejected', async () => {
  const handle = await env.client.workflow.start(cartWorkflow, {
    taskQueue: 'cart',
    workflowId: uid('cart'),
    args: [{ userId: 'u3' }],
  });
  await assert.rejects(handle.executeUpdate(checkout), WorkflowUpdateFailedError);
  await handle.terminate('test done');
});
