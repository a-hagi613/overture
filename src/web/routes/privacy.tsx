import { copy } from "../../shared/copy.ts";
import { LegalPage } from "../components/legal-page.tsx";

export function PrivacyPage() {
  return <LegalPage sections={copy.legal.privacy.sections} title={copy.legal.privacy.title} />;
}
