/**
 * Strings that may match a canvas-annotation pattern and still ship, each with the reason it is
 * product copy. Read by the copy walk (`src/shared/copy.test.ts`) and the built-bundle grep
 * (`scripts/check-copy-dist.ts`). Empty today: no shipping string needs an exception.
 */
export const ANNOTATION_ALLOWLIST: readonly { reason: string; text: string }[] = [];
