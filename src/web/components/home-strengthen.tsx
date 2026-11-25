import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { StatusStrip } from "./ui/status-strip.tsx";

export function HomeStrengthen({ missing }: { missing: number }) {
  return (
    <StatusStrip
      action={
        <Button asChild size="sm" variant="primary">
          <Link to="/profile/details#profile-strengthen">{copy.home.strengthen.action}</Link>
        </Button>
      }
      ariaLabelledBy="home-strengthen"
      className="mt-3"
      description={copy.home.strengthen.title(missing)}
      title={copy.home.strengthen.eyebrow}
      titleId="home-strengthen"
    />
  );
}
