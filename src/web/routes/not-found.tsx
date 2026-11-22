import { ButtonLink } from "../components/button-link.tsx";
import { MarketingPage } from "../components/marketing-page.tsx";
import { copy } from "../../shared/copy.ts";

/**
 * The 404 page, rendered outside the app shell so that any unknown path, signed in or not, gets
 * the same public chrome as the rest of the marketing site.
 *
 * @returns The not-found page element.
 */
export function NotFoundPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 text-center md:px-10 md:pb-36 md:pt-[124px]">
        <p
          aria-hidden="true"
          className="font-serif text-[120px] italic leading-[0.8] text-muted-foreground md:text-[220px]"
        >
          {copy.notFound.code}
        </p>
        <h1 className="mt-8 font-serif text-[42px] leading-none tracking-tight md:mt-8 md:text-[72px]">
          {copy.notFound.title} <span className="italic">{copy.notFound.titleEmphasis}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-[34ch] text-[17px] leading-[1.6] text-muted-foreground">
          {copy.notFound.body}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <ButtonLink href="/" variant="primary">
            {copy.notFound.home}
          </ButtonLink>
          <a
            className="inline-flex min-h-[44px] items-center border-b border-input text-[15px] font-semibold text-foreground underline-offset-4 hover:underline"
            href="/board"
          >
            {copy.notFound.board}
          </a>
        </div>
      </section>
    </MarketingPage>
  );
}
