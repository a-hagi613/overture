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

const designSystemSchema = z.tuple([
  z.object({
    allowBrandFiles: z.array(z.string().min(1)).optional(),
    enforceStrictPaths: z.array(z.string().min(1)).optional(),
  }),
]);

const FORBIDDEN_STYLE_PROPS = new Set([
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "gap",
  "borderRadius",
  "boxShadow",
]);

const COLOR_ATTR_NAMES = new Set([
  "fill",
  "stroke",
  "color",
  "stopColor",
  "gradientStartColor",
  "gradientStopColor",
]);

const RAW_COLOR_PATTERN = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/u;
const RAW_COLOR_TW_PATTERN = /\b(?:bg|text|border|ring|stroke|fill)-\[(?:#|rgba?\(|hsla?\()/u;

const OFF_SCALE_TW_PATTERN =
  /\b(?:(?:text|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-\[\d+(?:\.\d+)?px\]|text-(?:lg|[2-9]?xl))\b/u;

const stringSchema = z.string();

function matchesAnyPrefix(filename: string, prefixes: string[]) {
  const normalized = filename.replaceAll("\\", "/");

  return prefixes.some(
    (prefix) => normalized.endsWith(`/${prefix}`) || normalized.includes(`/${prefix}`),
  );
}

const noRawDesignStyles = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allowBrandFiles: { type: "array", items: { type: "string", minLength: 1 } },
          enforceStrictPaths: { type: "array", items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Enforce Tailwind CSS and Ember design-system tokens across src/web; disallow raw CSS file imports, hardcoded colors, inline design styles, and off-scale arbitrary typography/spacing.",
    },
    messages: {
      rawCssImport:
        "Do not import extra raw CSS files ({{source}}). Style with Tailwind CSS and @theme tokens in src/web/styles.css.",
      hardcodedColor:
        "Use Ember design-system tokens (e.g. bg-card, text-signal, border-border) instead of hardcoded colors.",
      inlineDesignStyle:
        "Move inline style property '{{prop}}' to Tailwind CSS design-system utilities.",
      offScaleArbitrary:
        "Replace off-scale arbitrary Tailwind token '{{token}}' with the 4px spacing scale or @theme typography tokens from DESIGN.md.",
    },
  },
  create(context) {
    const [options] = designSystemSchema.parse(context.options);
    const allowBrandFiles = options.allowBrandFiles ?? [];
    const enforceStrictPaths = options.enforceStrictPaths ?? [];
    const filename = context.physicalFilename.replaceAll("\\", "/");

    if (!filename.includes("/src/web/")) {
      return {};
    }

    const isBrandFile = matchesAnyPath(filename, allowBrandFiles);
    const isStrict = matchesAnyPrefix(filename, enforceStrictPaths);

    const checkClassText = (
      node: NonNullable<Parameters<typeof context.report>[0]["node"]>,
      text: string,
    ) => {
      if (!isBrandFile && RAW_COLOR_TW_PATTERN.test(text)) {
        context.report({ node, messageId: "hardcodedColor" });
      }

      if (isStrict) {
        const offScale = OFF_SCALE_TW_PATTERN.exec(text);

        if (offScale !== null) {
          context.report({
            node,
            messageId: "offScaleArbitrary",
            data: { token: offScale[0] },
          });
        }
      }
    };

    return {
      ImportDeclaration(node) {
        const src = stringSchema.safeParse(node.source.value);

        if (!src.success || !src.data.endsWith(".css")) {
          return;
        }

        const isMainStyles = filename.endsWith("/src/web/main.tsx") && src.data === "./styles.css";

        if (!isMainStyles) {
          context.report({ node, messageId: "rawCssImport", data: { source: src.data } });
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") {
          return;
        }

        const attrName = node.name.name;

        if (attrName === "className") {
          if (node.value?.type === "Literal") {
            const literalClass = stringSchema.safeParse(node.value.value);

            if (literalClass.success) {
              checkClassText(node, literalClass.data);
            }
          } else if (
            node.value?.type === "JSXExpressionContainer" &&
            node.value.expression.type === "TemplateLiteral"
          ) {
            for (const quasi of node.value.expression.quasis) {
              checkClassText(quasi, quasi.value.raw);
            }
          }

          return;
        }

        if (!isBrandFile && COLOR_ATTR_NAMES.has(attrName) && node.value?.type === "Literal") {
          const literalColor = stringSchema.safeParse(node.value.value);

          if (literalColor.success && RAW_COLOR_PATTERN.test(literalColor.data)) {
            context.report({ node, messageId: "hardcodedColor" });
          }

          return;
        }

        if (
          attrName === "style" &&
          node.value?.type === "JSXExpressionContainer" &&
          node.value.expression.type === "ObjectExpression"
        ) {
          for (const prop of node.value.expression.properties) {
            if (prop.type !== "Property" || prop.key.type !== "Identifier") {
              continue;
            }

            if (!isBrandFile && prop.value.type === "Literal") {
              const styleLiteral = stringSchema.safeParse(prop.value.value);

              if (styleLiteral.success && RAW_COLOR_PATTERN.test(styleLiteral.data)) {
                context.report({ node: prop, messageId: "hardcodedColor" });
              }
            }

            if (isStrict && !isBrandFile && FORBIDDEN_STYLE_PROPS.has(prop.key.name)) {
              context.report({
                node: prop,
                messageId: "inlineDesignStyle",
                data: { prop: prop.key.name },
              });
            }
          }
        }
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
    "no-raw-design-styles": noRawDesignStyles,
    "no-unlisted-unit-test": noUnlistedUnitTest,
  },
});
