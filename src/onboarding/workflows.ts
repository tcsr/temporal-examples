import {
  proxyActivities,
  executeChild,
  startChild,
  workflowInfo,
  sleep,
  ApplicationFailure,
  ChildWorkflowFailure,
  ParentClosePolicy,
} from '@temporalio/workflow';
import type { OnboardingActivities, Employee } from './activities';

const a = proxyActivities<OnboardingActivities>({
  startToCloseTimeout: '1 minute',
});

export interface OnboardingSummary {
  employeeId: string;
  accounts: string[];
  laptopOrder: string;
  payroll: string;
}

// Parent: coordinates one child workflow per department
export async function onboardEmployeeWorkflow(
  emp: Employee,
): Promise<OnboardingSummary> {
  const base = workflowInfo().workflowId; // e.g. onboard-emp-42

  const [accounts, laptopOrder] = await Promise.all([
    executeChild(provisionAccountsWorkflow, {
      workflowId: `${base}-it`,
      args: [emp],
    }),
    executeChild(shipLaptopWorkflow, { workflowId: `${base}-laptop`, args: [emp] }),
  ]);

  let payroll: string;
  try {
    payroll = await executeChild(setupPayrollWorkflow, {
      workflowId: `${base}-payroll`,
      args: [emp],
    });
  } catch (err) {
    if (!(err instanceof ChildWorkflowFailure)) throw err;
    // One department failing must not undo the rest: hand it to a human
    await a.notifyHr(emp.id, `Payroll setup failed: ${err.cause?.message}`);
    payroll = 'PENDING_HR';
  }

  // Fire-and-forget child that outlives the parent (runs for 30 days)
  await startChild(retentionWorkflow, {
    workflowId: `${base}-retention`,
    args: [emp.id],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  });

  return { employeeId: emp.id, accounts, laptopOrder, payroll };
}

// IT: three systems in parallel
export async function provisionAccountsWorkflow(emp: Employee): Promise<string[]> {
  return Promise.all([
    a.createEmailAccount(emp),
    a.inviteToSlack(emp),
    a.addToGitHub(emp),
  ]);
}

// Facilities
export async function shipLaptopWorkflow(emp: Employee): Promise<string> {
  return a.orderLaptop(
    emp.id,
    emp.role === 'engineer' ? 'MacBook Pro 16' : 'MacBook Air 13',
  );
}

// Finance
export async function setupPayrollWorkflow(emp: Employee): Promise<string> {
  if (!emp.bankAccount) {
    throw ApplicationFailure.nonRetryable(
      'Missing bank details',
      'MissingBankDetails',
    );
  }
  return a.registerPayroll(emp.id, emp.bankAccount);
}

// Compliance: archive onboarding records after the probation check-in
export async function retentionWorkflow(employeeId: string): Promise<void> {
  await sleep('30 days');
  await a.archiveOnboardingRecords(employeeId);
}
