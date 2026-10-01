export interface Billing {
  activatePlan(userId: string, plan: string): Promise<void>;
  downgradeToFree(userId: string): Promise<void>;
}
export interface Mailer {
  send(email: string, template: string): Promise<void>;
}

export function createTrialActivities(billing: Billing, mailer: Mailer) {
  return {
    async sendEmail(email: string, template: string) {
      await mailer.send(email, template);
    },
    async activatePlan(userId: string, plan: string) {
      await billing.activatePlan(userId, plan);
    },
    async downgradeToFree(userId: string) {
      await billing.downgradeToFree(userId);
    },
  };
}

export type TrialActivities = ReturnType<typeof createTrialActivities>;
