import { proxyActivities, CancellationScope } from '@temporalio/workflow';
import type { VideoActivities, TranscodeJob } from './activities';

const { allocateWorkspace, releaseWorkspace, publish } =
  proxyActivities<VideoActivities>({
    startToCloseTimeout: '1 minute',
  });
const { transcode } = proxyActivities<VideoActivities>({
  startToCloseTimeout: '4 hours', // a feature film can take hours...
  heartbeatTimeout: '2 seconds', // ...but a dead worker is detected in seconds
  retry: { initialInterval: '1 second', maximumAttempts: 5 },
});

export async function transcodeVideoWorkflow(job: TranscodeJob): Promise<string> {
  const workDir = await allocateWorkspace(job.videoId);
  try {
    await transcode(job, workDir);
    return await publish(job.videoId, workDir);
  } finally {
    // Runs on success, failure AND cancellation: never leak scratch storage
    await CancellationScope.nonCancellable(() => releaseWorkspace(workDir));
  }
}
