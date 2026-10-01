import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import {
  createPaymentActivities,
  GatewayError,
  ChargeRequest,
} from '../src/payments/activities';
import { paymentWorkflow } from '../src/payments/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

// Fake payment provider: fails with 503 a few times, declines some customers
class FakeGateway {
  calls = 0;
  constructor(
    private transientFailures = 0,
    private declined = new Set<string>(),
  ) {}
  async charge(req: ChargeRequest, key: string) {
    this.calls++;
    if (this.calls <= this.transientFailures) {
      throw new GatewayError('503 Service Unavailable', 503);
    }
    if (this.declined.has(req.customerId)) {
      throw new GatewayError('card_declined', 402, 'insufficient_funds');
    }
    return { id: `ch_${key}` };
  }
}

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
let gateway = new FakeGateway();
const messages: string[] = [];

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createPaymentActivities(
    { charge: (req, key) => gateway.charge(req, key) }, // swap per test
    {
      send: async (_c, msg) => {
        messages.push(msg);
      },
    },
  );
  worker = await startWorker(
    env,
    'payments',
    require.resolve('../src/payments/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const pay = (over: Partial<ChargeRequest> = {}) =>
  env.client.workflow.execute(paymentWorkflow, {
    taskQueue: 'payments',
    workflowId: uid('pay'),
    args: [
      {
        paymentId: uid('p'),
        customerId: 'cus_1',
        amountCents: 4999,
        currency: 'USD',
        ...over,
      },
    ],
  });

test('transient gateway errors are retried until the charge succeeds', async () => {
  gateway = new FakeGateway(2); // two 503s, then success
  const result = await pay();
  assert.equal(result.status, 'PAID');
  assert.equal(gateway.calls, 3);
  assert.match(messages.at(-1)!, /Payment received/);
});

test('a declined card is a business outcome, not a failure', async () => {
  gateway = new FakeGateway(0, new Set(['cus_broke']));
  const result = await pay({ customerId: 'cus_broke' });
  assert.deepEqual(result, {
    status: 'DECLINED',
    reason: 'Card declined: insufficient_funds',
  });
  assert.equal(gateway.calls, 1); // non-retryable: no retries
});

test('an invalid amount fails the workflow without calling the gateway', async () => {
  gateway = new FakeGateway();
  await assert.rejects(pay({ amountCents: 0 }), (err: unknown) => {
    assert.ok(err instanceof WorkflowFailedError);
    const cause = (err.cause as Error).cause;
    assert.ok(cause instanceof ApplicationFailure);
    assert.equal(cause.type, 'InvalidAmount');
    return true;
  });
  assert.equal(gateway.calls, 0);
});
