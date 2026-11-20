import { copy } from "../../shared/copy.ts";
import { PlaceholderPage } from "./placeholder.tsx";

export function ProfilePage() {
  return <PlaceholderPage note={copy.placeholder.profileNote} title={copy.placeholder.profile} />;
}
