import { definePlugin, defineRule } from "@oxlint/plugins";
import { z } from "zod";

const disableDirectivePatterns = [
  /^oxlint-disable(?:-next-line|-line)?(?:\s|$)/u,
  /^oxlint-enable(?:\s|$)/u,
  /^eslint-disable(?:-next-line|-line)?(?:\s|$)/u,
  /^eslint-enable(?:\s|$)/u,
  /^@ts-ignore(?:\s|$)/u,
  /^@ts-nocheck(?:\s|$)/u,
];

function isDisableDirective(comment: { value: string }) {
  const value = comment.value
    .replace(/^!/u, "")
    .replaceAll(/^\s*\*\s?/gmu, "")
    .trim();

  return disableDirectivePatterns.some((pattern) => pattern.test(value));
}

function matchesAnyPath(filename: string, paths: string[]) {
  const normalized = filename.replaceAll("\\", "/");

  return paths.some((path) => normalized.endsWith(`/${path}`));
}

const allowPathsSchema = z
  .tuple([
    z.object({
      allow: z.array(z.string().min(1)).optional(),
    }),
  ])
  .or(z.tuple([]));

const unlistedUnitTestSchema = z.tuple([
  z.object({
    e2eRoot: z.string().min(1),
    allow: z.array(z.string().min(1)).optional(),
  }),
]);

const noDisableDirectives = defineRule({
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description:
        "Disallow oxlint-disable, eslint-disable, @ts-ignore and @ts-nocheck directives.",
    },
    messages: {
      forbidden:
        "Remove this disable directive. No rule may be silenced: fix the code, or propose a change to ADR 0023.",
    },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      "Program:exit"() {
        for (const comment of source.getAllComments()) {
          if (isDisableDirective(comment)) {
            context.report({ node: comment, messageId: "forbidden" });
          }
        }
      },
    };
  },
});

const noDateNow = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    ],
    docs: {
      description: "Disallow Date.now outside the clock port.",
    },
    messages: {
      forbidden: "Read time through the Clock port; Date.now belongs only in the clock adapter.",
    },
  },
  create(context) {
    const [options] = allowPathsSchema.parse(context.options);
    const allow = options?.allow ?? [];
    const filename = context.physicalFilename.replaceAll("\\", "/");

    if (matchesAnyPath(filename, allow)) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "Date" &&
          node.property.type === "Identifier" &&
          node.property.name === "now"
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
});

const noMathRandom = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    ],
    docs: {
      description: "Disallow Math.random outside the random port.",
    },
    messages: {
      forbidden:
        "Draw randomness through the Random port; Math.random belongs only in the random adapter.",
    },
  },
  create(context) {
    const [options] = allowPathsSchema.parse(context.options);
    const allow = options?.allow ?? [];
    const filename = context.physicalFilename.replaceAll("\\", "/");

    if (matchesAnyPath(filename, allow)) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "Math" &&
          node.property.type === "Identifier" &&
          node.property.name === "random"
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
});

const catalogWriteSchema = z.tuple([
  z.object({
    allow: z.array(z.string().min(1)).optional(),
    allowRoots: z.array(z.string().min(1)).optional(),
  }),
]);

const CATALOG_TABLE_NAMES = new Set(["companyBoards", "postings", "postingTags"]);
const WRITE_METHOD_NAMES = new Set(["insert", "update", "delete"]);

function matchesAnyRoot(filename: string, roots: string[]) {
  const normalized = filename.replaceAll("\\", "/");

  return roots.some((root) => normalized.includes(`/${root}/`));
}

const noMainThreadCatalogWrites = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string", minLength: 1 } },
          allowRoots: { type: "array", items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Allow catalog table writes only inside the catalog sweep worker and the narrow non-sweep paths.",
    },
    messages: {
      forbidden:
        "Catalog table {{table}} must be written by the catalog sweep worker. Move this write into sweep-worker.ts, or add a documented exception to ADR 0023.",
    },
  },
  create(context) {
    const [options] = catalogWriteSchema.parse(context.options);
    const allow = options.allow ?? [];
    const allowRoots = options.allowRoots ?? [];
    const filename = context.physicalFilename.replaceAll("\\", "/");

    if (matchesAnyPath(filename, allow) || matchesAnyRoot(filename, allowRoots)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || node.callee.computed) {
          return;
        }

        const method = node.callee.property;

        if (method.type !== "Identifier" || !WRITE_METHOD_NAMES.has(method.name)) {
          return;
        }

        const table = node.arguments.at(0);

        if (table?.type !== "Identifier" || !CATALOG_TABLE_NAMES.has(table.name)) {
          return;
        }

        context.report({ node, messageId: "forbidden", data: { table: table.name } });
      },
    };
  },
});

const noUnlistedUnitTest = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          e2eRoot: { type: "string", minLength: 1 },
          allow: { type: "array", items: { type: "string", minLength: 1 } },
        },
        required: ["e2eRoot"],
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Allow Vitest unit tests only beside the ADR 0013 invariants; everything else is a Playwright e2e test.",
    },
    messages: {
      forbidden:
        "Move this test into test/e2e as a Playwright test, or add it to the ADR 0013 invariants.",
    },
  },
  create(context) {
    const [options] = unlistedUnitTestSchema.parse(context.options);
    const allow = options.allow ?? [];
    const filename = context.physicalFilename.replaceAll("\\", "/");

    if (!/\.test\.(?:ts|tsx)$/u.test(filename)) {
      return {};
    }

    if (filename.includes(`/${options.e2eRoot}/`)) {
      return {};
    }

    if (matchesAnyPath(filename, allow)) {
      return {};
    }

    return {
      Program(node) {
        context.report({ node, messageId: "forbidden" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "overture" },
  rules: {
    "no-disable-directives": noDisableDirectives,
    "no-date-now": noDateNow,
    "no-main-thread-catalog-writes": noMainThreadCatalogWrites,
    "no-math-random": noMathRandom,
    "no-unlisted-unit-test": noUnlistedUnitTest,
  },
});
