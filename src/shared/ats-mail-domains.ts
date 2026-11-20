export const ATS_MAIL_DOMAINS = {
  greenhouse: ["greenhouse.io", "greenhouse-mail.io", "us.greenhouse-mail.io"],
  lever: ["lever.co", "hire.lever.co"],
  ashby: ["ashbyhq.com"],
  smartrecruiters: ["smartrecruiters.com"],
  recruitee: ["recruitee.com"],
  workable: ["workable.com", "workablemail.com"],
  personio: ["personio.de", "personio.com"],
} as const;

const ALL_DOMAINS: readonly string[] = Object.values(ATS_MAIL_DOMAINS).flat();

export function isAtsMailDomain(domain: string) {
  const host = domain.trim().toLowerCase().replace(/\.$/u, "");

  return ALL_DOMAINS.some((known) => host === known || host.endsWith(`.${known}`));
}

export function atsForMailDomain(domain: string) {
  const host = domain.trim().toLowerCase().replace(/\.$/u, "");

  for (const [ats, domains] of Object.entries(ATS_MAIL_DOMAINS)) {
    if (domains.some((known) => host === known || host.endsWith(`.${known}`))) {
      return ats;
    }
  }

  return null;
}
