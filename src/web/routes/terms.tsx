import { copy } from "../../shared/copy.ts";
import { LegalPage } from "../components/legal-page.tsx";

export function TermsPage() {
  return <LegalPage sections={copy.legal.terms.sections} title={copy.legal.terms.title} />;
}
