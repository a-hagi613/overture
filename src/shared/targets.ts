import { z } from "zod";

import { placeIdSchema } from "./places.ts";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "./tag-taxonomy.ts";

export const MAX_TARGET_ROLES = 20;
export const MAX_TARGET_LOCATIONS = 20;

export const targetRoleSchema = z.string().trim().min(1).max(80);

/** A saved location is a canonical place id; free text is never stored as one (issue #683). */
export const targetLocationSchema = placeIdSchema;

export const salaryCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u);

export const targetsInputSchema = z
  .object({
    roles: z.array(targetRoleSchema).max(MAX_TARGET_ROLES),
    seniorities: z.array(z.enum(SENIORITIES)).max(SENIORITIES.length),
    workplaces: z.array(z.enum(WORKPLACES)).max(WORKPLACES.length),
    locations: z.array(targetLocationSchema).max(MAX_TARGET_LOCATIONS),
    unresolvedLocations: z
      .array(z.string().trim().min(2).max(120))
      .max(MAX_TARGET_LOCATIONS)
      .default([]),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length),
    salaryFloorMinor: z.number().int().nonnegative().max(100_000_000_000).nullable(),
    salaryCurrency: salaryCurrencySchema.nullable(),
    salaryPeriod: z.enum(["year", "month", "hour"]).default("year"),
  })
  .superRefine((value, context) => {
    if (value.salaryFloorMinor === null && value.salaryCurrency !== null) {
      context.addIssue({
        code: "custom",
        message: "a currency needs a salary floor",
        path: ["salaryCurrency"],
      });
    }

    if (value.salaryFloorMinor !== null && value.salaryCurrency === null) {
      context.addIssue({
        code: "custom",
        message: "a salary floor needs a currency",
        path: ["salaryFloorMinor"],
      });
    }

    if (new Set(value.roles).size !== value.roles.length) {
      context.addIssue({ code: "custom", message: "roles must be unique", path: ["roles"] });
    }

    if (new Set(value.locations).size !== value.locations.length) {
      context.addIssue({
        code: "custom",
        message: "locations must be unique",
        path: ["locations"],
      });
    }

    if (new Set(value.unresolvedLocations).size !== value.unresolvedLocations.length) {
      context.addIssue({
        code: "custom",
        message: "unresolved locations must be unique",
        path: ["unresolvedLocations"],
      });
    }

    if (value.unresolvedLocations.some((location) => value.locations.includes(location))) {
      context.addIssue({
        code: "custom",
        message: "a location is either resolved or unresolved, not both",
        path: ["unresolvedLocations"],
      });
    }
  });

export type TargetsInput = z.infer<typeof targetsInputSchema>;

const languagesSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2}$/u),
  )
  .max(20);

export const languagesInputSchema = z.object({ languages: languagesSchema });

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/]+$/u);

export const profileSettingsInputSchema = z.object({
  languages: languagesSchema,
  timezone: timezoneSchema,
});

export const skipCompaniesInputSchema = z.object({
  companies: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        domain: z.string().trim().min(3).max(253).nullable().default(null),
      }),
    )
    .max(200),
});

export type Targets = TargetsInput;

export const emptyTargets: Targets = {
  roles: [],
  seniorities: [],
  workplaces: [],
  locations: [],
  unresolvedLocations: [],
  employmentTypes: [],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
};
