// Records every step so tests can see which code path an order took
export function createCheckoutActivities(journal: string[]) {
  return {
    async reserveStock(orderId: string) {
      journal.push(`${orderId}:reserve`);
    },
    async runFraudCheck(orderId: string) {
      journal.push(`${orderId}:fraud-check`);
    },
    async chargeCard(orderId: string) {
      journal.push(`${orderId}:charge`);
      return `ch_${orderId}`;
    },
  };
}

export type CheckoutActivities = ReturnType<typeof createCheckoutActivities>;
