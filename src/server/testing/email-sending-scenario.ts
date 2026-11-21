export const emailSendingScenarios = [
  "ready",
  "not-onboarded",
  "not-entitled",
  "records-incomplete",
] as const;

export type EmailSendingScenario = (typeof emailSendingScenarios)[number];

let current: EmailSendingScenario = "ready";

export function emailSendingScenario() {
  return current;
}

export function setEmailSendingScenario(next: EmailSendingScenario) {
  current = next;
}
