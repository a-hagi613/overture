import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

export function HomeStrengthen({ missing }: { missing: number }) {
  return (
    <Card
      ariaLabelledBy="home-strengthen"
      className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5 p-5 md:p-6"
    >
      <div className="min-w-0">
        <p className={dsEyebrow}>{copy.home.strengthen.eyebrow}</p>
        <h2 className={`${dsCardTitle} mt-2`} id="home-strengthen">
          {copy.home.strengthen.title(missing)}
        </h2>
        <p className={`${dsBody} mt-1.5`}>{copy.home.strengthen.note}</p>
      </div>
      <Button asChild size="default" variant="primary">
        <Link to="/profile#profile-strengthen">{copy.home.strengthen.action}</Link>
      </Button>
    </Card>
  );
}
