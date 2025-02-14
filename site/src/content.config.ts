import { parseFrontmatter } from "@astrojs/markdown-remark";
import { glob } from "astro/loaders";
import { defineCollection, reference, z } from "astro:content";
import fg from "fast-glob";

import { readFile } from "fs/promises";
import { join } from "path";
import { regExpMatchGenerator } from "./lib/util";
import { wcag2SuccessCriteria } from "./lib/wcag";

/** Fields in common between our schemas that use Astro's image() */
const baseImageSchema = z.object({
  title: z.string().min(1),
  imageDescription: z.string().min(1),
  imagePosition: z.string().optional(),
  skipAlt: z.boolean().optional(),
});

export const collections = {
  breaks: defineCollection({
    loader: async () => {
      const paths = await fg(["**/*.astro", "content/**/[^_]*.md"], {
        cwd: "src",
      });
      const breaks: any[] = []; // Type will be validated later by schema
      for (const path of paths) {
        const content = await readFile(join("src", path), "utf8");
        if (path.endsWith(".astro")) {
          // Support /** @break ... */ blocks in astro templates
          // TODO: relocate this to a programmatic API,
          // so that it can be used to populate "what's wrong with this page?"
          // (Maybe the programmatic API can actually be useful for the collection?...)
          for (const match of regExpMatchGenerator(
            /\/\*[\s\*]*@break([\s\S]*?)\*\//g,
            content
          )) {
            const id = `${path}-${match.index}`;
            // Remove leading '* ' from multiline comment blocks
            const yaml = match[1].replace(/^\s+\* /gm, "");
            const { frontmatter } = parseFrontmatter(`---\n${yaml}\n---`);
            breaks.push({
              ...frontmatter,
              id,
            });
          }
        } else {
          // Support breaks property in markdown frontmatter
          const { frontmatter } = parseFrontmatter(content);
          ((frontmatter.breaks || []) as any[]).forEach((brk, i) => {
            breaks.push({
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
        description: z.string(),
        locationName: z.string(),
        // locationPath: true = use current page's path (for non-dynamic src/pages routes only)
        locationPath: z.string(),
        wcag2SuccessCriterion: z
          .enum(
            Object.keys(wcag2SuccessCriteria) as [
              keyof typeof wcag2SuccessCriteria,
            ]
          )
          .optional(),
        // TODO: validate against WCAG 3 requirements present in ED?
        wcag3Requirement: z.string().optional(),
      })
      .refine(
        (value) => value.wcag2SuccessCriterion || value.wcag3Requirement,
        {
          message:
            "One or both of wcag2SuccessCriterion or wcag3Requirement must be set.",
        }
      ),
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
