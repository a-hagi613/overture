export function AdminPageHeading({
  lead,
  plain,
  italic,
}: {
  lead: string;
  plain: string;
  italic: string;
}) {
  return (
    <div className="mt-6">
      <p className="font-serif text-[15px] italic text-muted-foreground">{lead}</p>
      <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
        {plain} <span className="italic">{italic}</span>
      </h1>
    </div>
  );
}
