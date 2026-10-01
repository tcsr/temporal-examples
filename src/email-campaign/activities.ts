import { ApplicationFailure } from '@temporalio/activity';

export interface Recipient {
  email: string;
  name: string;
}

export interface AudienceStore {
  // CRM / database holding the mailing list
  page(listId: string, offset: number, limit: number): Promise<Recipient[]>;
}
export interface EmailProvider {
  // SendGrid, SES, Postmark, ...
  send(to: Recipient, template: string): Promise<void>;
}

export function createCampaignActivities(
  audience: AudienceStore,
  provider: EmailProvider,
) {
  return {
    // Workflows fetch recipients page by page: never put 100k addresses in an input
    async loadRecipients(listId: string, offset: number, limit: number) {
      return audience.page(listId, offset, limit);
    },
    async sendCampaignEmail(to: Recipient, template: string) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.email)) {
        throw ApplicationFailure.nonRetryable(
          `Invalid address ${to.email}`,
          'InvalidRecipient',
        );
      }
      await provider.send(to, template);
    },
  };
}

export type CampaignActivities = ReturnType<typeof createCampaignActivities>;
