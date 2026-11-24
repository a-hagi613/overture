import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { z } from "zod";

const dispatchInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  type: z.string().optional(),
  options: z.array(z.string()).optional(),
  default: z.unknown(),
});

const stepSchema = z.object({
  name: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  run: z.string().optional(),
});

const workflowSchema = z.object({
  on: z.object({
    workflow_dispatch: z.object({
      inputs: z.object({ stripe_env: dispatchInputSchema }),
    }),
  }),
  jobs: z.object({
    ops: z.object({
      steps: z.array(stepSchema),
    }),
  }),
});

type WorkflowStep = z.infer<typeof stepSchema>;

const workflow = workflowSchema.parse(
  Bun.YAML.parse(readFileSync(".github/workflows/ops-live.yml", "utf8")),
);

function step(name: string) {
  const found = workflow.jobs.ops.steps.find((entry) => entry.name === name);

  if (!found) {
    throw new Error(`ops-live.yml has no step named "${name}"`);
  }

  return found;
}

const setupStripe = step("Create the plans, webhook and portal and set the Fly secrets");
const syncOpsSecrets = step("Sync the ops secrets and flags to overture-web");

function runOf(target: WorkflowStep) {
  if (!target.run) {
    throw new Error(`step "${target.name}" has no run block`);
  }

  return target.run;
}

test("ops-live exposes a stripe_env choice defaulting to sandbox", () => {
  const input = workflow.on.workflow_dispatch.inputs.stripe_env;

  expect(input.type).toBe("choice");
  expect(input.options).toStrictEqual(["sandbox", "production"]);
  expect(input.default).toBe("sandbox");
  expect(input.required).toBe(false);
  expect(input.description).toBe("Stripe environment to configure on overture-web");
});

function secretRef(name: string) {
  return ["$", "{{ secrets.", name, " }}"].join("");
}

test("setup-stripe binds the sandbox key, the production key and the legacy fallback", () => {
  const env = setupStripe.env ?? {};

  expect(env.STRIPE_ENV).toContain("inputs.stripe_env");
  expect(env.STRIPE_SANDBOX_SECRET_KEY).toBe(secretRef("STRIPE_SANDBOX_SECRET_KEY"));
  expect(env.STRIPE_PROD_SECRET_KEY).toBe(secretRef("STRIPE_PROD_SECRET_KEY"));
  expect(env.STRIPE_SECRET_KEY_LEGACY).toBe(secretRef("STRIPE_SECRET_KEY"));
});

test("setup-stripe selects the key from stripe_env and rejects a missing or unknown one", () => {
  const run = runOf(setupStripe);

  expect(run).toMatch(/STRIPE_PROD_SECRET_KEY:-\$\{STRIPE_SECRET_KEY_LEGACY:-\}/u);
  expect(run).toMatch(/::error::[^\n]*STRIPE_SANDBOX_SECRET_KEY/u);
  expect(run).toMatch(/::error::[^\n]*STRIPE_PROD_SECRET_KEY/u);
  expect(run).toMatch(/::error::Unknown stripe_env/u);
});

test("setup-stripe masks and exports the selected key before the script runs", () => {
  const run = runOf(setupStripe);
  const mask = run.indexOf('echo "::add-mask::$STRIPE_SECRET_KEY"');
  const exported = run.indexOf("export STRIPE_SECRET_KEY");
  const script = run.indexOf("bun run scripts/setup-stripe.ts");

  expect(mask).toBeGreaterThanOrEqual(0);
  expect(exported).toBeGreaterThan(mask);
  expect(script).toBeGreaterThan(exported);
});

test("setup-stripe summarizes the configured environment and variable names only", () => {
  const run = runOf(setupStripe);

  expect(run).toContain("$GITHUB_STEP_SUMMARY");
  expect(run).toMatch(/echo "### Stripe environment configured/u);
  expect(run).toMatch(/Configured \\`stripe_env\\`: \\`\$\{stripe_env\}\\`\./u);
  expect(run).toMatch(/printf -- '- `%s`\\n' "\$\{set_names\[@\]\}"/u);
  expect(run).not.toMatch(/echo\s+"?\$\{?STRIPE_SECRET_KEY\}?"?/u);
});

test("sync-ops-secrets binds the signup allowlist", () => {
  const env = syncOpsSecrets.env ?? {};

  expect(env.ALLOWED_SIGNUP_EMAILS).toBe(secretRef("ALLOWED_SIGNUP_EMAILS"));
});

test("sync-ops-secrets imports the allowlist by name without printing its value", () => {
  const run = runOf(syncOpsSecrets);

  expect(run).toContain('set_args+=("ALLOWED_SIGNUP_EMAILS=$ALLOWED_SIGNUP_EMAILS")');
  expect(run).toContain('key_names+=("ALLOWED_SIGNUP_EMAILS")');
  expect(run).toContain('echo "::add-mask::$ALLOWED_SIGNUP_EMAILS"');
  expect(run.indexOf('set_args+=("ALLOWED_SIGNUP_EMAILS=$ALLOWED_SIGNUP_EMAILS")')).toBeLessThan(
    run.indexOf("flyctl secrets import -a overture-web"),
  );

  expect(run).not.toMatch(/echo\s+"?\$\{?ALLOWED_SIGNUP_EMAILS\}?"?/u);
});
