export function Pill(props: { children: string }) {
  return (
    <span className="rounded-full bg-card px-3.5 py-2 text-[13px] font-semibold">
      {props.children}
    </span>
  );
}
