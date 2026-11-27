export const DRY_SUBMIT_ENV = "OVERTURE_DRY_SUBMIT";

export const DRY_SUBMIT_PRODUCTION_REFUSAL =
  "OVERTURE_DRY_SUBMIT is local-only and must not be enabled when NODE_ENV is production.";

const DRY_SUBMIT_ON = new Set(["1", "true"]);

const DRY_SUBMIT_VALUES = new Set(["0", "1", "false", "true"]);

/** The two parsed config values the switch reads. */
export type DrySubmitConfig = { NODE_ENV: string } & Record<typeof DRY_SUBMIT_ENV, boolean>;

/** Raised when a process asks for a dry submit where it is never allowed (production). */
export class DrySubmitRefusedError extends Error {
  constructor(message: string = DRY_SUBMIT_PRODUCTION_REFUSAL) {
    super(message);
    this.name = "DrySubmitRefusedError";
  }
}

/** Raised inside `onWillSubmit` after the evidence shot: every ATS flow stops before it clicks Submit. */
export class DrySubmitStoppedError extends Error {
  constructor(message = "dry submit stopped before the Submit click") {
    super(message);
    this.name = "DrySubmitStoppedError";
  }
}

/**
 * Reads the raw flag the way an operator writes it.
 * @param raw The raw environment value, if any.
 * @returns True only for `1` or `true`, case-insensitive.
 */
export function parseDrySubmitFlag(raw: string | undefined) {
  return raw !== undefined && DRY_SUBMIT_ON.has(raw.trim().toLowerCase());
}

/**
 * Checks a raw value against the four accepted spellings.
 * @param raw The raw environment value.
 * @returns True when the value is one of `1`, `0`, `true` or `false`.
 */
export function isDrySubmitValue(raw: string) {
  return DRY_SUBMIT_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Reads the production refusal from a parsed config.
 * @param config The parsed config carrying `NODE_ENV`.
 * @returns The refusal message in production, or null everywhere else.
 */
export function drySubmitRefusal(config: { NODE_ENV: string }) {
  return config.NODE_ENV === "production" ? DRY_SUBMIT_PRODUCTION_REFUSAL : null;
}

/**
 * Resolves the parsed config into the switch. It fails loudly in production rather than quietly disabling the flag,
 * so a misconfigured production process cannot send anything at all.
 * @param config The parsed config: `NODE_ENV` and the dry-submit flag.
 * @returns True when this process stops before the Submit click.
 * @throws {DrySubmitRefusedError} When the flag is on while `NODE_ENV` is `production`.
 */
export function drySubmitActive(config: DrySubmitConfig) {
  if (!config.OVERTURE_DRY_SUBMIT) {
    return false;
  }

  const refusal = drySubmitRefusal(config);

  if (refusal !== null) {
    throw new DrySubmitRefusedError(refusal);
  }

  return true;
}

/**
 * The one pre-Submit step every ATS sender runs through `hooks.onWillSubmit`: keep the evidence shot first, then either
 * mark the click (a normal send) or throw {DrySubmitStoppedError} so no flow reaches its click.
 * @param input The evidence capture, the resolved switch, and the normal-send marker.
 * @returns Nothing when the send continues; a dry submit throws `DrySubmitStoppedError` instead of returning.
 */
export async function beforeSubmitStep(input: {
  captureEvidence: () => Promise<void> | void;
  drySubmit: boolean;
  markSubmitClicked: () => void;
}) {
  await input.captureEvidence();

  if (input.drySubmit) {
    throw new DrySubmitStoppedError();
  }

  input.markSubmitClicked();
}
