import { copy } from "../../shared/copy.ts";
import { PlaceholderPage } from "./placeholder.tsx";

export function InboxPage() {
  return <PlaceholderPage note={copy.placeholder.inboxNote} title={copy.placeholder.inbox} />;
}
