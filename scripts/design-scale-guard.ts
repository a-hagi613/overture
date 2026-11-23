const OFF_SCALE_DESIGN_TOKEN =
  /\b(?:(?:text|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-\[\d+(?:\.\d+)?(?:px|rem)\](?![\w-])|text-(?:lg|[2-9]?xl)\b)/u;

export function findOffScaleDesignToken(text: string) {
  return OFF_SCALE_DESIGN_TOKEN.exec(text)?.[0] ?? null;
}
