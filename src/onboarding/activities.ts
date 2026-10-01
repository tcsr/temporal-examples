export interface Employee {
  id: string;
  name: string;
  role: 'engineer' | 'sales' | 'ops';
  bankAccount?: string;
}

// Each SaaS / internal system a new hire must be set up in
export interface Systems {
  createEmail(emp: Employee): Promise<string>;
  inviteToSlack(emp: Employee): Promise<string>;
  addToGitHub(emp: Employee): Promise<string>;
  orderLaptop(employeeId: string, model: string): Promise<string>;
  registerPayroll(employeeId: string, bankAccount: string): Promise<string>;
  notifyHr(employeeId: string, message: string): Promise<void>;
  archiveRecords(employeeId: string): Promise<void>;
}

export function createOnboardingActivities(s: Systems) {
  return {
    createEmailAccount: (emp: Employee) => s.createEmail(emp),
    inviteToSlack: (emp: Employee) => s.inviteToSlack(emp),
    addToGitHub: (emp: Employee) => s.addToGitHub(emp),
    orderLaptop: (employeeId: string, model: string) =>
      s.orderLaptop(employeeId, model),
    registerPayroll: (employeeId: string, bank: string) =>
      s.registerPayroll(employeeId, bank),
    notifyHr: (employeeId: string, message: string) =>
      s.notifyHr(employeeId, message),
    archiveOnboardingRecords: (employeeId: string) => s.archiveRecords(employeeId),
  };
}

export type OnboardingActivities = ReturnType<typeof createOnboardingActivities>;
