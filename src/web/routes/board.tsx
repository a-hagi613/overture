import { copy } from "../../shared/copy.ts";
import { PlaceholderPage } from "./placeholder.tsx";

export function BoardPage() {
  return <PlaceholderPage note={copy.placeholder.boardNote} title={copy.placeholder.board} />;
}
