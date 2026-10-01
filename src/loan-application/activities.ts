import { ApplicationFailure } from '@temporalio/activity';

export interface LoanApplication {
  applicationId: string;
  applicantId: string;
  amount: number;
  annualIncome: number;
}

export interface CreditBureau {
  score(applicantId: string): Promise<number>;
}
export interface FraudService {
  risk(app: LoanApplication): Promise<'LOW' | 'HIGH'>;
}
export interface Notifier {
  send(applicantId: string, message: string): Promise<void>;
}

export function createLoanActivities(
  bureau: CreditBureau,
  fraud: FraudService,
  notifier: Notifier,
) {
  return {
    // Business-rule validation: never worth retrying
    async validateApplication(app: LoanApplication): Promise<void> {
      if (app.amount <= 0 || app.annualIncome <= 0) {
        throw ApplicationFailure.nonRetryable(
          'Amount and income must be positive',
          'InvalidApplication',
        );
      }
      if (app.amount > app.annualIncome * 5) {
        throw ApplicationFailure.nonRetryable(
          'Loan exceeds 5x annual income',
          'InvalidApplication',
        );
      }
    },
    async getCreditScore(applicantId: string) {
      return bureau.score(applicantId);
    },
    async runFraudCheck(app: LoanApplication) {
      return fraud.risk(app);
    },
    async notifyApplicant(applicantId: string, message: string) {
      await notifier.send(applicantId, message);
    },
  };
}

export type LoanActivities = ReturnType<typeof createLoanActivities>;
