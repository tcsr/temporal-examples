export type Tier = 'BRONZE' | 'SILVER' | 'GOLD';

export interface Mailer {
  send(customerId: string, template: string): Promise<void>;
}

export function createLoyaltyActivities(mailer: Mailer) {
  return {
    async sendTierChangeEmail(customerId: string, from: Tier, to: Tier) {
      await mailer.send(customerId, `tier-${from}-to-${to}`.toLowerCase());
    },
  };
}

export type LoyaltyActivities = ReturnType<typeof createLoyaltyActivities>;
