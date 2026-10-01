import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, WorkerOptions } from '@temporalio/worker';

export interface RunningWorker {
  stop(): Promise<void>;
}

// Runs a worker in the background for the duration of a test file
export async function startWorker(
  env: TestWorkflowEnvironment,
  taskQueue: string,
  workflowsPath: string,
  activities: object,
  extra: Partial<WorkerOptions> = {},
): Promise<RunningWorker> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities,
    ...extra,
  });
  const running = worker.run();
  return {
    async stop() {
      worker.shutdown();
      await running;
    },
  };
}

let seq = 0;
export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${seq++}`;

// Walks ActivityFailure -> ApplicationFailure -> ... to the original error
export function rootCause(err: unknown): Error | undefined {
  let e = err instanceof Error ? err : undefined;
  while (e?.cause instanceof Error) e = e.cause;
  return e;
}
