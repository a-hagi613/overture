import { copy } from "../../shared/copy.ts";
import { PlaceholderPage } from "./placeholder.tsx";

export function ReviewPage() {
  return <PlaceholderPage note={copy.placeholder.reviewNote} title={copy.placeholder.review} />;
}
