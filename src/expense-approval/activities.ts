export interface Expense {
  expenseId: string;
  employee: string;
  amount: number;
  description: string;
  managerEmail: string;
  directorEmail: string;
}

export interface Inbox {
  notify(email: string, message: string): Promise<void>;
}
export interface Payouts {
  reimburse(employee: string, amount: number): Promise<string>;
}

export function createExpenseActivities(inbox: Inbox, payouts: Payouts) {
  return {
    async requestApproval(approverEmail: string, expense: Expense) {
      await inbox.notify(
        approverEmail,
        `Approve ${expense.amount} for ${expense.employee}: ${expense.description}`,
      );
    },
    async reimburse(employee: string, amount: number) {
      return payouts.reimburse(employee, amount);
    },
    async notifyEmployee(employee: string, message: string) {
      await inbox.notify(employee, message);
    },
  };
}

export type ExpenseActivities = ReturnType<typeof createExpenseActivities>;
