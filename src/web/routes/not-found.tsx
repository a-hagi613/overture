import { copy } from "../../shared/copy.ts";

export function NotFoundPage() {
  return (
    <div>
      <h1 className="font-display text-[32px] leading-[1.05] md:text-[42px]">
        {copy.notFound.title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.notFound.body}</p>
    </div>
  );
}
