export const mailColumnLayout =
  "md:grid-cols-[minmax(0,1.5fr)_76px_76px_80px_104px_minmax(132px,auto)]";

export function mailPanelId(companyId: string) {
  return `mail-employer-${companyId}`;
}
