import { defineCollection, reference, z } from "astro:content";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import { file, glob } from "astro/loaders";
import type { ZodType, ZodTypeDef } from "astro/zod";
import fg from "fast-glob";

import { readFile } from "fs/promises";
import { join } from "path";

import { regExpMatchGenerator } from "./lib/util";
import { wcag2SuccessCriteria, type Wcag2SuccessCriterion } from "./lib/wcag";

/** Fields in common between our schemas that use Astro's image() */
const baseImageSchema = z.object({
  title: z.string().min(1),
  imageDescription: z.string().min(1),
  imagePosition: z.string().optional(),
  skipAlt: z.boolean().optional(),
});

/** Returns a union of the given schema with a non-empty array containing the same type. */
const singleOrArray = <O, D extends ZodTypeDef, I>(schema: ZodType<O, D, I>) =>
  schema.or(z.array(schema).nonempty());

/** Transforms a singleOrArray schema to always return an array for easier processing. */
const transformToArray = <T>(value: T | [T, ...T[]]): [T, ...T[]] =>
  Array.isArray(value) ? value : [value];

/** Like transformToArray, but for use specifically with .optional() schemas. */
const transformToOptionalArray = <T>(
  value: T | [T, ...T[]] | undefined
): [T, ...T[]] | undefined =>
  typeof value === "undefined" || Array.isArray(value) ? value : [value];

export const collections = {
  breakSections: defineCollection({
    loader: file("src/content/sections.json"),
    schema: z.object({
      description: z.string().optional(),
      id: z.string(),
      // Allow empty path for Home but otherwise require trailing slash
      path: z
        .string()
        .regex(/^$|\/$/, "Non-empty path should end with a slash"),
    }),
  }),
  breaks: defineCollection({
    loader: async () => {
      const paths = await fg(["**/*.astro", "content/**/[^_]*.md"], {
        cwd: "src",
      });
      const breaks: any[] = []; // Type will be validated later by schema
      for (const path of paths) {
        const content = await readFile(join("src", path), "utf8");
        if (path.endsWith(".astro")) {
          const locationMatch = /\/\*[\s\*]*@breaklocation([\s\S]*?)\*\//.exec(
            content
          );
          const location = locationMatch?.[1].trim() || undefined;
          // Support /** @break ... */ blocks in astro templates
          for (const match of regExpMatchGenerator(
            /\/\*[\s\*]*@break\b([\s\S]*?)\*\//g,
            content
          )) {
            const id = `${path}-${match.index}`;
            // Remove leading '* ' from multiline comment blocks
            const yaml = match[1].replace(/^\s+\* /gm, "");
            const { frontmatter } = parseFrontmatter(`---\n${yaml}\n---`);
            breaks.push({
              location,
              ...frontmatter,
              id,
            });
          }
        } else {
          // Support breaks property in markdown frontmatter
          const { frontmatter } = parseFrontmatter(content);
          ((frontmatter.breaks || []) as any[]).forEach((brk, i) => {
            breaks.push({
              location: frontmatter.breaklocation,
              ...brk,
              id: `${path}-${i}`,
            });
          });
        }
      }
      return breaks;
    },
    schema: z
      .object({
        description: singleOrArray(z.string()).transform(transformToArray),
        discussionItems: z.array(z.string()).optional(),
        location: reference("breakSections"),
        photosensitivity: z.boolean().optional(),
        wcag2: singleOrArray(
          z.enum(Object.keys(wcag2SuccessCriteria) as [Wcag2SuccessCriterion])
        )
          .optional()
          .transform(transformToOptionalArray),
        // TODO: validate against WCAG 3 requirements present in ED?
        wcag3: singleOrArray(z.string())
          .optional()
          .transform(transformToOptionalArray),
      })
      .refine((value) => value.wcag2 || value.wcag3, {
        message: "One or both of wcag2 and/or wcag3 must be set.",
      }),
  }),

  blog: defineCollection({
    loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
    schema: ({ image }) =>
      baseImageSchema.extend({
        brokenUrl: z.boolean().default(false),
        category: z.union([z.literal("Events"), z.literal("In the News")]),
        date: z.date().or(z.literal("now")),
        image: image(),
        video: z.string().optional(),
        videoCover: z.string().optional(),
      }),
  }),

  exhibits: defineCollection({
    loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/exhibits" }),
    schema: ({ image }) =>
      baseImageSchema.extend({
        image: image(),
      }),
  }),

  "exhibit-categories": defineCollection({
    loader: glob({
      pattern: "**/[^_]*.md",
      base: "./src/content/exhibit-categories",
    }),
    schema: z.object({
      dangerous: z.boolean().default(false),
      topDescription: z.string().optional(),
      topImageItem: reference("exhibits").optional(),
      title: z.string().min(1),
    }),
  }),

  products: defineCollection({
    loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/products" }),
    schema: ({ image }) =>
      baseImageSchema.extend({
        image: image(),
        price: z.number().positive(),
      }),
  }),
};
