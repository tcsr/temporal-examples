export interface SalesSummary {
  region: string;
  day: string;
  orders: number;
  revenueCents: number;
}

export interface Warehouse {
  salesFor(region: string, day: string): Promise<SalesSummary>;
}
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

export function createReportActivities(warehouse: Warehouse, mailer: Mailer) {
  return {
    async aggregateSales(region: string, day: string) {
      return warehouse.salesFor(region, day);
    },
    async emailReport(to: string, s: SalesSummary) {
      await mailer.send(
        to,
        `Sales ${s.region} ${s.day}`,
        `${s.orders} orders, revenue ${(s.revenueCents / 100).toFixed(2)}`,
      );
    },
  };
}

export type ReportActivities = ReturnType<typeof createReportActivities>;
