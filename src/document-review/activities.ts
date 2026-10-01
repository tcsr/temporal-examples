import { activityInfo, CompleteAsyncError } from '@temporalio/activity';

export interface ReviewResult {
  approved: boolean;
  reviewer: string;
  notes?: string;
}

// External review tool (Zendesk, Jira, an internal back-office app, ...)
export interface ReviewQueue {
  createTask(documentId: string, callbackToken: string): Promise<void>;
}
export interface Archive {
  store(documentId: string, status: string): Promise<void>;
}

export function createReviewActivities(queue: ReviewQueue, archive: Archive) {
  return {
    // Hands the work to humans and returns WITHOUT a result: the review tool's
    // webhook completes this activity later (minutes or days) using the token
    async requestHumanReview(documentId: string): Promise<ReviewResult> {
      const token = Buffer.from(activityInfo().taskToken).toString('base64url');
      await queue.createTask(documentId, token);
      throw new CompleteAsyncError();
    },
    async archiveDocument(documentId: string, status: string) {
      await archive.store(documentId, status);
    },
  };
}

export type ReviewActivities = ReturnType<typeof createReviewActivities>;
