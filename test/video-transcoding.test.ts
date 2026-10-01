import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowFailedError } from '@temporalio/client';
import { CancelledFailure } from '@temporalio/common';
import { createVideoActivities } from '../src/video-transcoding/activities';
import { transcodeVideoWorkflow } from '../src/video-transcoding/workflows';
import { startWorker, uid, RunningWorker } from './helpers';

let env: TestWorkflowEnvironment;
let worker: RunningWorker;
const encoded: string[] = []; // "videoId:chunk" for every encodeChunk call
const released: string[] = [];
let crashOnce = new Set<string>(); // "videoId:chunk" that fails the first time

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const activities = createVideoActivities(
    {
      allocate: async (id) => `/scratch/${id}`,
      release: async (dir) => {
        released.push(dir);
      },
      publish: async (id) => `https://cdn.example.com/${id}.m3u8`,
    },
    {
      encodeChunk: async (dir, chunk) => {
        const key = `${dir.split('/').pop()}:${chunk}`;
        await delay(100); // 100 ms of "encoding"
        if (crashOnce.delete(key)) throw new Error('ffmpeg: segmentation fault');
        encoded.push(key);
      },
    },
  );
  worker = await startWorker(
    env,
    'video',
    require.resolve('../src/video-transcoding/workflows'),
    activities,
  );
});
after(async () => {
  await worker.stop();
  await env.teardown();
});

const chunksOf = (id: string) =>
  encoded.filter((k) => k.startsWith(`${id}:`)).map((k) => Number(k.split(':')[1]));

test('a crash mid-job resumes from the last heartbeat, not from zero', async () => {
  const videoId = uid('vid');
  crashOnce = new Set([`${videoId}:6`]);
  const url = await env.client.workflow.execute(transcodeVideoWorkflow, {
    taskQueue: 'video',
    workflowId: videoId,
    args: [{ videoId, chunks: 10, resolution: '1080p' }],
  });
  assert.equal(url, `https://cdn.example.com/${videoId}.m3u8`);
  const chunks = chunksOf(videoId);
  assert.deepEqual(
    [...new Set(chunks)].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.ok(
    chunks.length < 20,
    `resumed from a checkpoint (encoded ${chunks.length} chunks)`,
  );
  assert.ok(released.includes(`/scratch/${videoId}`));
});

test('cancelling the job stops encoding and still frees the workspace', async () => {
  const videoId = uid('vid');
  const handle = await env.client.workflow.start(transcodeVideoWorkflow, {
    taskQueue: 'video',
    workflowId: videoId,
    args: [{ videoId, chunks: 100, resolution: '4k' }], // ~10 s of work
  });
  await delay(1_000);
  await handle.cancel(); // user hit "Cancel"
  await assert.rejects(
    handle.result(),
    (err: unknown) =>
      err instanceof WorkflowFailedError && err.cause instanceof CancelledFailure,
  );
  await delay(500);
  const done = chunksOf(videoId).length;
  assert.ok(done > 0 && done < 100, `stopped after ${done} of 100 chunks`);
  assert.ok(
    released.includes(`/scratch/${videoId}`),
    'cleanup ran despite cancellation',
  );
});
