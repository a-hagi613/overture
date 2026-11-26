import { Link } from "react-router";

import type { HomeNewMatchRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { scoreLabelOf } from "../lib/matches-api.ts";
import { Badge } from "./ui/badge.tsx";
import { HomeSection } from "./home-section.tsx";
import { HomeSectionRow } from "./home-section-row.tsx";

const MAX_ROWS = 3;

function metaOf(row: HomeNewMatchRow) {
  return row.location === null ? row.company : `${row.company} · ${row.location}`;
}

export function HomeMatches(props: { items: readonly HomeNewMatchRow[]; total: number }) {
  const { items, total } = props;
  const text = copy.home.sections.matches;
  const preview = items.slice(0, MAX_ROWS);

  return (
    <HomeSection
      count={total}
      countLabel={text.count(total)}
      dataTestId="home-matches"
      emptyAction={
        <Button asChild size="sm" variant="primary">
          <Link to="/profile/preferences">{text.emptyAction}</Link>
        </Button>
      }
      emptyBody={text.emptyBody}
      emptyTitle={text.empty}
      href="/matches"
      subtitle={text.subtitle}
      title={text.title}
      titleId="home-matches"
      viewAll={text.viewAll}
    >
      {preview.map((row) => (
        <HomeSectionRow
          key={row.id}
          meta={metaOf(row)}
          title={row.title}
          to="/matches"
          trailing={
            <Badge
              className="shrink-0 tabular-nums"
              variant={row.score === null ? "outline" : "signal"}
            >
              {scoreLabelOf(row.score)}
            </Badge>
          }
        />
      ))}
    </HomeSection>
  );
}
