import { copy } from "../../../shared/copy.ts";

export const adminDestinations = [
  { end: true, glyph: "home", label: copy.admin.navOverview, to: "/admin" },
  {
    end: true,
    glyph: "check",
    label: copy.admin.navProviderReport,
    to: "/admin/provider-report",
  },
  { end: true, glyph: "clock", label: copy.admin.navAttempts, to: "/admin/attempts" },
  { end: true, glyph: "sliders", label: copy.admin.navLlmSpend, to: "/admin/llm" },
  { end: false, glyph: "users", label: copy.admin.navUsers, to: "/admin/users" },
  { end: false, glyph: "mail", label: copy.admin.navInvites, to: "/admin/invites" },
  { end: false, glyph: "tag", label: copy.admin.navGrants, to: "/admin/grants" },
  { end: false, glyph: "card", label: copy.admin.navBilling, to: "/admin/billing" },
  { end: false, glyph: "link", label: copy.admin.navSwitches, to: "/admin/settings" },
  { end: false, glyph: "grid", label: copy.admin.navCatalog, to: "/admin/catalog" },
  { end: false, glyph: "sliders", label: copy.admin.navSystem, to: "/admin/system" },
  { end: false, glyph: "send", label: copy.admin.navMailHealth, to: "/admin/mail-health" },
  { end: false, glyph: "doc", label: copy.admin.navAudit, to: "/admin/audit" },
] as const;
