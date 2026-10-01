import { ApplicationFailure, activityInfo } from '@temporalio/activity';

export type KycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

// Third-party identity verification provider (Onfido, Jumio, Persona, ...)
export interface KycProvider {
  // returns the provider's case ID
  submit(customerId: string, documents: string[]): Promise<string>;
  status(caseId: string): Promise<KycStatus>;
}

export function createKycActivities(provider: KycProvider) {
  return {
    async submitDocuments(customerId: string, documents: string[]) {
      return provider.submit(customerId, documents);
    },

    // Polling via retries: throw while the result isn't ready; the retry policy
    // decides how often to ask and when to give up
    async waitForVerdict(caseId: string): Promise<'VERIFIED' | 'REJECTED'> {
      const status = await provider.status(caseId);
      if (status === 'PENDING') {
        throw ApplicationFailure.retryable(
          `Case ${caseId} still pending (poll #${activityInfo().attempt})`,
          'StillPending',
        );
      }
      return status;
    },
  };
}

export type KycActivities = ReturnType<typeof createKycActivities>;
