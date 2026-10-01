import {
  proxyActivities,
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  condition,
  allHandlersFinished,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { CartActivities } from './activities';

const { createOrder, sendCartReminder } = proxyActivities<CartActivities>({
  startToCloseTimeout: '30 seconds',
});

export interface CartItem {
  sku: string;
  qty: number;
  priceCents: number;
}
export interface CartView {
  items: CartItem[];
  discountPct: number;
  totalCents: number;
  orderId?: string;
}
export type CartOutcome =
  | { status: 'ORDERED'; orderId: string; totalCents: number }
  | { status: 'EXPIRED'; itemsLeft: number };

// Signals: fire-and-forget changes. Query: read-only view.
// Updates: validated changes that send a reply.
export const addItem = defineSignal<[CartItem]>('addItem');
export const removeItem = defineSignal<[string]>('removeItem');
export const getCart = defineQuery<CartView>('getCart');
export const applyCoupon = defineUpdate<number, [string]>('applyCoupon');
export const checkout = defineUpdate<string, []>('checkout');

const COUPONS: Record<string, number> = { SAVE10: 10, WELCOME20: 20 };

export async function cartWorkflow({
  userId,
  idleTimeout = '24 hours',
}: {
  userId: string;
  idleTimeout?: Duration;
}): Promise<CartOutcome> {
  const items = new Map<string, CartItem>();
  let discountPct = 0;
  let orderId: string | undefined;
  let checkingOut = false;
  let version = 0; // bumps on every change: used for idle detection
  let reminded = false;

  const totalCents = () => {
    const gross = [...items.values()].reduce((s, i) => s + i.qty * i.priceCents, 0);
    return Math.round((gross * (100 - discountPct)) / 100);
  };

  setHandler(addItem, (item) => {
    const qty = (items.get(item.sku)?.qty ?? 0) + item.qty;
    items.set(item.sku, { ...item, qty });
    version++;
  });
  setHandler(removeItem, (sku) => {
    items.delete(sku);
    version++;
  });
  setHandler(getCart, () => ({
    items: [...items.values()],
    discountPct,
    totalCents: totalCents(),
    orderId,
  }));

  setHandler(
    applyCoupon,
    (code) => {
      discountPct = COUPONS[code];
      version++;
      return discountPct;
    },
    {
      validator: (code) => {
        // runs before anything is recorded
        if (!(code in COUPONS)) throw new Error(`Unknown coupon ${code}`);
      },
    },
  );

  setHandler(
    checkout,
    async () => {
      checkingOut = true;
      orderId = await createOrder(userId, [...items.values()], totalCents());
      return orderId;
    },
    {
      validator: () => {
        if (items.size === 0) throw new Error('Cart is empty');
        if (checkingOut) throw new Error('Checkout already in progress');
      },
    },
  );

  // Wait for activity; after one idle period send a reminder, after two expire
  while (orderId === undefined) {
    const seen = version;
    const active = await condition(
      () => orderId !== undefined || checkingOut || version !== seen,
      idleTimeout,
    );
    if (active) {
      if (checkingOut) await condition(() => orderId !== undefined);
      continue;
    }
    if (reminded || items.size === 0)
      return { status: 'EXPIRED', itemsLeft: items.size };
    await sendCartReminder(userId, items.size);
    reminded = true;
  }

  await condition(allHandlersFinished); // let the checkout update reply first
  return { status: 'ORDERED', orderId, totalCents: totalCents() };
}
