export function InboxSteps(props: { steps: readonly string[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {props.steps.map((step, index) => (
        <li className="flex items-start gap-3" key={step}>
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-input bg-muted text-xs leading-[1.5] font-bold tabular-nums">
            {String(index + 1)}
          </span>
          <span className="text-sm leading-[1.5]">{step}</span>
        </li>
      ))}
    </ol>
  );
}
