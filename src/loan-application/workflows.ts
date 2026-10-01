import {
  proxyActivities,
  proxyLocalActivities,
  ActivityFailure,
  TimeoutFailure,
} from '@temporalio/workflow';
import type { LoanActivities, LoanApplication } from './activities';

const { validateApplication } = proxyLocalActivities<LoanActivities>({
  startToCloseTimeout: '2 seconds',
});
const { getCreditScore } = proxyActivities<LoanActivities>({
  startToCloseTimeout: '2 seconds', // the bureau's SLA
  retry: { initialInterval: '1 second', maximumAttempts: 2 },
});
const { runFraudCheck, notifyApplicant } = proxyActivities<LoanActivities>({
  startToCloseTimeout: '30 seconds',
});

export type Decision =
  | { decision: 'APPROVED'; ratePct: number }
  | { decision: 'REJECTED'; reason: string }
  | { decision: 'MANUAL_REVIEW'; reason: string };

export async function loanApplicationWorkflow(
  app: LoanApplication,
): Promise<Decision> {
  await validateApplication(app); // invalid input: workflow FAILS (bad request)

  let score: number;
  try {
    score = await getCreditScore(app.applicantId);
  } catch (err) {
    // Infrastructure problem: degrade to a human instead of failing the application
    if (err instanceof ActivityFailure && err.cause instanceof TimeoutFailure) {
      return decide(app, {
        decision: 'MANUAL_REVIEW',
        reason: 'Credit bureau did not respond in time',
      });
    }
    throw err;
  }

  if ((await runFraudCheck(app)) === 'HIGH') {
    return decide(app, { decision: 'MANUAL_REVIEW', reason: 'High fraud risk' });
  }
  if (score < 600) {
    // business rule: a result, not an error
    return decide(app, {
      decision: 'REJECTED',
      reason: `Credit score ${score} below 600`,
    });
  }
  return decide(app, { decision: 'APPROVED', ratePct: score >= 750 ? 8.5 : 11.9 });
}

async function decide(app: LoanApplication, decision: Decision): Promise<Decision> {
  await notifyApplicant(app.applicantId, `Your application: ${decision.decision}`);
  return decision;
}
