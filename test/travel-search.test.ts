import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowFailedError } from '@temporalio/client';
import {
  createSearchActivities,
  FlightProvider,
  SearchQuery,
} from '../src/travel-search/activities';
import { flightSearchWorkflow } from '../src/travel-search/workflows';
import { startWorker, uid, rootCause, RunningWorker } from './helpers';

// Each fake provider takes 500 ms; one of them is down
const provider = (
  name: string,
  prices: number[],
  down = false,
): FlightProvider => ({
  name,
  async search(q: SearchQuery) {
    await delay(500);
    if (down) throw new Error(`${name}: 502 Bad Gateway`);
    return prices.map((p, i) => ({
      provider: name,
      flight: `${name}-${q.from}${q.to}-${i}`,
      priceCents: p,
    }));
  },
});

let env: TestWorkflowEnvironment;
let worker: RunningWorker;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createSearchActivities([
    provider('skyair', [32900, 28900]),
    provider('jetnow', [25900]),
    provider('budgetfly', [9900], true), // cheapest, but currently down
  ]);
  worker = await startWorker(
    env,
    'search',
    require.resolve('../src/travel-search/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const search = (query: SearchQuery) =>
  env.client.workflow.execute(flightSearchWorkflow, {
    taskQueue: 'search',
    workflowId: uid('search'),
    args: [{ query, providers: ['skyair', 'jetnow', 'budgetfly'] }],
  });

test('searches providers in parallel and returns the cheapest offer', async () => {
  const started = Date.now();
  const result = await search({
    from: 'blr',
    to: 'del',
    date: '2026-12-20',
    passengers: 2,
  });
  assert.equal(result.cheapest.provider, 'jetnow');
  assert.equal(result.cheapest.priceCents, 25900);
  assert.equal(result.offersFound, 3);
  assert.deepEqual(result.failedProviders, ['budgetfly']);
  // 3 providers x 500 ms in sequence would take >= 1.5 s (plus budgetfly's retry)
  assert.ok(Date.now() - started < 1500, 'providers must run concurrently');
});

test('an invalid query is rejected by the local activity', async () => {
  await assert.rejects(
    search({ from: 'BLR', to: 'blr', date: '2026-12-20', passengers: 1 }),
    (err: unknown) =>
      err instanceof WorkflowFailedError &&
      rootCause(err)?.message === 'Origin and destination are the same',
  );
});
