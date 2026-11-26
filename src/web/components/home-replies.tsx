import type { HomeInboxRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { HomeSection } from "./home-section.tsx";
import { HomeSectionRow } from "./home-section-row.tsx";

const MAX_ROWS = 3;

function metaOf(row: HomeInboxRow) {
  return row.detail === null ? row.text : `${row.text} · ${row.detail}`;
}

export function HomeReplies(props: { items: readonly HomeInboxRow[]; total: number }) {
  const { items, total } = props;
  const text = copy.home.sections.replies;
  const preview = items.slice(0, MAX_ROWS);

  return (
    <HomeSection
      count={total}
      countLabel={text.count(total)}
      href="/inbox"
      subtitle={text.subtitle}
      title={text.title}
      titleId="home-replies"
      viewAll={text.viewAll}
    >
      {preview.map((row) => (
        <HomeSectionRow
          key={row.id}
          meta={metaOf(row)}
          title={row.company}
          to={`/inbox/${encodeURIComponent(row.threadId)}`}
          trailing={
            row.unread ? (
              <Badge className="shrink-0" variant="signal">
                {text.unread}
              </Badge>
            ) : undefined
          }
        />
      ))}
    </HomeSection>
  );
}
