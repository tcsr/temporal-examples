import { activityInfo, heartbeat, cancelled, log } from '@temporalio/activity';

export interface TranscodeJob {
  videoId: string;
  chunks: number;
  resolution: string;
}

export interface Storage {
  allocate(videoId: string): Promise<string>; // scratch dir / bucket prefix
  release(workDir: string): Promise<void>;
  publish(videoId: string, workDir: string): Promise<string>;
}
export interface Encoder {
  encodeChunk(workDir: string, chunk: number, resolution: string): Promise<void>;
}

export function createVideoActivities(storage: Storage, encoder: Encoder) {
  return {
    async allocateWorkspace(videoId: string) {
      return storage.allocate(videoId);
    },
    async releaseWorkspace(workDir: string) {
      await storage.release(workDir);
    },
    async publish(videoId: string, workDir: string) {
      return storage.publish(videoId, workDir);
    },

    // Long-running: reports progress with heartbeats and resumes after a retry
    async transcode(job: TranscodeJob, workDir: string): Promise<number> {
      const resumeFrom: number = activityInfo().heartbeatDetails ?? 0;
      if (resumeFrom > 0) log.info('Resuming transcode', { resumeFrom });

      for (let chunk = resumeFrom; chunk < job.chunks; chunk++) {
        // Stop promptly if the workflow (or a user) cancels the job
        await Promise.race([
          encoder.encodeChunk(workDir, chunk, job.resolution),
          cancelled(),
        ]);
        heartbeat(chunk + 1); // "alive" + checkpoint for retries
      }
      return job.chunks;
    },
  };
}

export type VideoActivities = ReturnType<typeof createVideoActivities>;
