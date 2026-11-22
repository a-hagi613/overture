import { isSameHostOrSubdomain } from "./host-match.ts";

export const ATS_MAIL_DOMAINS = {
  greenhouse: ["greenhouse.io", "greenhouse-mail.io", "us.greenhouse-mail.io"],
  lever: ["lever.co", "hire.lever.co"],
  ashby: ["ashbyhq.com"],
  smartrecruiters: ["smartrecruiters.com"],
  recruitee: ["recruitee.com"],
  workable: ["workable.com", "workablemail.com"],
  personio: ["personio.de", "personio.com"],
} as const;

export function isAtsMailDomain(domain: string) {
  return atsForMailDomain(domain) !== null;
}

export function atsForMailDomain(domain: string) {
  for (const [ats, domains] of Object.entries(ATS_MAIL_DOMAINS)) {
    if (domains.some((known) => isSameHostOrSubdomain(domain, known))) {
      return ats;
    }
  }

  return null;
}
