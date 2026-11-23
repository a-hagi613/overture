import type { Header } from "postal-mime";

import { byteLength, truncateBytes } from "./text.ts";

export const FORWARD_HEADER_ALLOW_LIST = [
  "in-reply-to",
  "references",
  "thread-index",
  "thread-topic",
] as const;

export const MAX_FORWARD_CUSTOM_HEADERS = 20;
export const MAX_FORWARD_HEADER_VALUE_BYTES = 2048;
export const MAX_FORWARD_HEADER_BYTES = 16_384;

const ALLOWED = new Set<string>(FORWARD_HEADER_ALLOW_LIST);
const CUSTOM_HEADER = /^x-[a-z0-9_-]{1,100}$/u;

function headerValue(value: string) {
  return truncateBytes(value.replaceAll(/[\r\n]+/gu, " ").trim(), MAX_FORWARD_HEADER_VALUE_BYTES);
}

export function forwardedHeaders(headers: readonly Header[]) {
  const kept: Record<string, string> = {};
  const seen = new Set<string>();
  let named = 0;
  let totalBytes = 0;

  for (const header of headers) {
    const name = header.originalKey.trim();
    const key = name.toLowerCase();
    const custom = CUSTOM_HEADER.test(key);
    const allowed = ALLOWED.has(key);

    if (!custom && !allowed) {
      continue;
    }

    if (seen.has(key) || (!custom && named >= MAX_FORWARD_CUSTOM_HEADERS)) {
      continue;
    }

    const value = headerValue(header.value);

    if (value === "") {
      continue;
    }

    const cost = byteLength(name) + byteLength(value) + 4;

    if (totalBytes + cost > MAX_FORWARD_HEADER_BYTES) {
      continue;
    }

    kept[name] = value;
    seen.add(key);
    totalBytes += cost;

    if (!custom) {
      named += 1;
    }
  }

  return kept;
}
