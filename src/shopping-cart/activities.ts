import type { CartItem } from './workflows';

export interface OrderService {
  create(userId: string, items: CartItem[], totalCents: number): Promise<string>;
}
export interface Mailer {
  send(
    userId: string,
    template: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

export function createCartActivities(orders: OrderService, mailer: Mailer) {
  return {
    async createOrder(userId: string, items: CartItem[], totalCents: number) {
      return orders.create(userId, items, totalCents);
    },
    async sendCartReminder(userId: string, itemCount: number) {
      await mailer.send(userId, 'abandoned-cart', { itemCount });
    },
  };
}

export type CartActivities = ReturnType<typeof createCartActivities>;
