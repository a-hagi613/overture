import type { HomeReviewRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HomeSection } from "./home-section.tsx";
import { HomeSectionRow } from "./home-section-row.tsx";

const MAX_ROWS = 3;

function companyLine(review: HomeReviewRow) {
  const names = review.companies.join(", ");
  const more = review.companyCount - review.companies.length;

  return more > 0 ? `${names} +${String(more)}` : names;
}

export function HomeNeedsYou(props: { reviews: readonly HomeReviewRow[]; total: number }) {
  const { reviews, total } = props;
  const preview = reviews.slice(0, MAX_ROWS);
  const text = copy.home.sections.needsAnswer;

  return (
    <HomeSection
      count={total}
      countLabel={text.count(total)}
      href="/review"
      subtitle={text.subtitle}
      title={text.title}
      titleId="home-needs-you"
      variant="need"
      viewAll={text.viewAll}
    >
      {preview.map((review) => (
        <HomeSectionRow
          key={review.id}
          meta={text.askedBy(companyLine(review))}
          title={review.prompt}
          to={`/review?question=${encodeURIComponent(review.id)}`}
        />
      ))}
    </HomeSection>
  );
}
