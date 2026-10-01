import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowFailedError } from '@temporalio/client';
import {
  createTripActivities,
  SoldOutError,
  Supplier,
  Trip,
} from '../src/trip-booking/activities';
import { bookTripWorkflow } from '../src/trip-booking/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

const journal: string[] = [];
let cancelFailuresLeft = 0; // hotel cancellation API flaky for N calls

const supplier = (kind: string, soldOutIn?: string): Supplier => ({
  async book(trip) {
    if (trip.to === soldOutIn)
      throw new SoldOutError(`No ${kind} available in ${trip.to}`);
    journal.push(`book:${kind}`);
    return `${kind.toUpperCase()}-${trip.tripId}`;
  },
  async cancel(code) {
    if (kind === 'hotel' && cancelFailuresLeft-- > 0)
      throw new Error('hotel API timeout');
    journal.push(`cancel:${kind}`);
    void code;
  },
});

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createTripActivities({
    flights: supplier('flight'),
    hotels: supplier('hotel'),
    cars: supplier('car', 'Leh'),
  });
  worker = await startWorker(
    env,
    'trips',
    require.resolve('../src/trip-booking/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const book = (to: string) => {
  const trip: Trip = {
    tripId: uid('t'),
    traveller: 'ann',
    from: 'BLR',
    to,
    nights: 3,
  };
  return env.client.workflow.execute(bookTripWorkflow, {
    taskQueue: 'trips',
    workflowId: trip.tripId,
    args: [trip],
  });
};

test('all three suppliers confirm: the trip is booked', async () => {
  journal.length = 0;
  const it = await book('Goa');
  assert.match(it.car, /^CAR-/);
  assert.deepEqual(journal, ['book:flight', 'book:hotel', 'book:car']);
});

test('car sold out: hotel and flight are cancelled in reverse order', async () => {
  journal.length = 0;
  cancelFailuresLeft = 2; // compensation itself is retried
  await assert.rejects(
    book('Leh'),
    (err: unknown) =>
      err instanceof WorkflowFailedError &&
      /rolled back/.test(String(err.cause?.message)),
  );
  assert.deepEqual(journal, [
    'book:flight',
    'book:hotel',
    'cancel:hotel',
    'cancel:flight',
  ]);
});
