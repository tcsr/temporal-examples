import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type { ExpenseActivities, Expense } from './activities';

const a = proxyActivities<ExpenseActivities>({ startToCloseTimeout: '1 minute' });

export interface Decision {
  approved: boolean;
  by: string;
  comment?: string;
}
export const decide = defineSignal<[Decision]>('decide'); // from the approval UI
export const approvalState = defineQuery<string>('approvalState');

export type ExpenseOutcome =
  | { status: 'PAID'; payoutId: string; approvedBy: string }
  | { status: 'REJECTED'; by: string; comment?: string }
  | { status: 'AUTO_REJECTED' };

const AUTO_APPROVE_LIMIT = 50;

export async function expenseApprovalWorkflow(
  expense: Expense,
): Promise<ExpenseOutcome> {
  let decision: Decision | undefined;
  let state = 'SUBMITTED';
  setHandler(decide, (d) => {
    decision ??= d;
  }); // first decision wins
  setHandler(approvalState, () => state);

  if (expense.amount <= AUTO_APPROVE_LIMIT) {
    // policy: small expenses auto-approved
    decision = { approved: true, by: 'policy' };
  } else {
    // Level 1: the manager has 2 days
    state = 'WAITING_FOR_MANAGER';
    await a.requestApproval(expense.managerEmail, expense);
    if (!(await condition(() => decision !== undefined, '2 days'))) {
      // Level 2: escalate to the director for 3 more days
      state = 'ESCALATED_TO_DIRECTOR';
      await a.requestApproval(expense.directorEmail, expense);
      if (!(await condition(() => decision !== undefined, '3 days'))) {
        state = 'AUTO_REJECTED';
        await a.notifyEmployee(
          expense.employee,
          'Expense auto-rejected: no decision in 5 days',
        );
        return { status: 'AUTO_REJECTED' };
      }
    }
  }

  if (!decision!.approved) {
    state = 'REJECTED';
    await a.notifyEmployee(
      expense.employee,
      `Expense rejected: ${decision!.comment ?? ''}`,
    );
    return { status: 'REJECTED', by: decision!.by, comment: decision!.comment };
  }
  state = 'APPROVED';
  const payoutId = await a.reimburse(expense.employee, expense.amount);
  state = 'PAID';
  return { status: 'PAID', payoutId, approvedBy: decision!.by };
}
