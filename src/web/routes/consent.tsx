import { copy } from "../../shared/copy.ts";
import { LegalPage } from "../components/legal-page.tsx";

export function ConsentPage() {
  return <LegalPage sections={copy.legal.consent.sections} title={copy.legal.consent.title} />;
}
