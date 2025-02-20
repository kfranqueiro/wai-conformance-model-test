import type { CollectionEntry } from "astro:content";
import { z } from "astro/zod";
import groupBy from "lodash-es/groupBy";
import sortBy from "lodash-es/sortBy";
import { useEffect, useRef, useState, type FormEvent } from "preact/compat";
import { museumBaseUrl } from "@/lib/constants";
import { wcag2SuccessCriteria } from "@/lib/wcag";

type BreakSectionsMap = Record<string, CollectionEntry<"breakSections">>;

interface BreaksListProps {
  breaks: CollectionEntry<"breaks">[];
  breakSectionsMap: BreakSectionsMap;
}

const formSchema = z.object({
  arrangement: z.enum(["failure", "area"]).default("failure"),
  query: z.string().default(""),
  version: z.enum(["2", "3"]).default("2"),
});

const getStateFromUrl = () => {
  const params = new URLSearchParams(
    typeof location !== "undefined" ? location.search : ""
  );
  return formSchema.parse({
    arrangement: params.get("a") || undefined,
    query: params.get("q") || undefined,
    version: params.get("v") || undefined,
  });
};

interface BreakAreaLinkProps {
  break: CollectionEntry<"breaks">;
  breakSectionsMap: BreakSectionsMap;
}

const BreakAreaLink = ({
  break: { data },
  breakSectionsMap,
}: BreakAreaLinkProps) => (
  <a href={museumBaseUrl + breakSectionsMap[data.location.id].data.path}>
    {data.location.id}
  </a>
);

interface BreakWcagLabelProps {
  break: CollectionEntry<"breaks">;
  version: z.infer<typeof formSchema.shape.version>;
}

const BreakWcagLabel = ({ break: { data }, version }: BreakWcagLabelProps) =>
  version === "2"
    ? `${data.wcag2SuccessCriterion}: ${wcag2SuccessCriteria[data.wcag2SuccessCriterion![0]]}`
    : data.wcag3Requirement![0];

export const BreaksList = ({ breaks, breakSectionsMap }: BreaksListProps) => {
  const [{ arrangement, query, version }, setValues] = useState(
    formSchema.parse({})
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  const wcagProp =
    version === "2" ? "wcag2SuccessCriterion" : "wcag3Requirement";
  const locationIteratee = ({ data }: CollectionEntry<"breaks">) =>
    data.location.id;
  const requirementIteratee = ({ data }: CollectionEntry<"breaks">) =>
    data[wcagProp]!;
  const sectionIteratee =
    arrangement === "area" ? locationIteratee : requirementIteratee;
  const dtIteratee =
    arrangement === "area" ? requirementIteratee : locationIteratee;

  const groupedBreaks = groupBy(
    sortBy(
      breaks.filter(({ data }) => {
        if (!data[wcagProp]) return false;
        // FIXME: This currently matches across WCAG 2 SC / WCAG 3 Requirement labels
        if (query) {
          return (
            data.description.find((d) => d.includes(query)) ||
            data.location.id.includes(query) ||
            (data.wcag2SuccessCriterion &&
              data.wcag2SuccessCriterion.find(
                (c) =>
                  c.includes(query) ||
                  wcag2SuccessCriteria[c]
                    .toLowerCase()
                    .includes(query.toLowerCase())
              )) ||
            (data.wcag3Requirement &&
              data.wcag3Requirement.find((r) =>
                r.toLowerCase().includes(query.toLowerCase())
              ))
          );
        }
        return true;
      }),
      // FIXME: this probably won't sort section numbers correctly (e.g. 2.4.1, 2.4.11, 2.4.2)
      [sectionIteratee, dtIteratee]
    )
      .reduce((breaks, nextBreak) => {
        if (!breaks.length) return [nextBreak];
        const previousBreak = breaks[breaks.length - 1];

        // Merge descriptions of neighboring breaks for same section and subsection
        if (
          sectionIteratee(nextBreak) === sectionIteratee(previousBreak) &&
          dtIteratee(nextBreak) === dtIteratee(previousBreak)
        ) {
          previousBreak.data.description = [
            ...previousBreak.data.description,
            ...nextBreak.data.description,
          ];
        } else {
          breaks.push(nextBreak);
        }
        return breaks;
      }, [] as CollectionEntry<"breaks">[])
      .reduce((breaks, nextBreak) => {
        // Split breaks associated with multiple SCs/requirements
        const wcagValues = requirementIteratee(nextBreak);
        if (Array.isArray(wcagValues) && wcagValues.length > 1) {
          for (const value of wcagValues) {
            breaks.push({
              ...nextBreak,
              data: {
                ...nextBreak.data,
                [wcagProp]: [value], // preserve array-of-one-or-more type, but always 1 element
              },
            });
          }
        } else {
          breaks.push(nextBreak);
        }
        return breaks;
      }, [] as CollectionEntry<"breaks">[]),
    sectionIteratee
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    setValues(
      formSchema.parse({
        arrangement: formData.get("a"),
        query: formData.get("q"),
        version: formData.get("v"),
      })
    );
    const newUrl = new URL(location.href);
    for (const name of ["a", "q", "v"]) {
      newUrl.searchParams.set(name, formData.get(name) as string);
    }
    history.pushState(null, "", newUrl);
    listRef.current?.focus();
  };

  useEffect(() => {
    const updateValues = () => setValues(getStateFromUrl());

    // Intentionally recall value after first render, to avoid skew from initial server response
    if (location.search) updateValues();

    addEventListener("popstate", updateValues);
    return () => removeEventListener("popstate", updateValues);
  }, []);

  return (
    <>
      <form onSubmit={onSubmit}>
        <div>
          <label for="version">WCAG version:</label>
          <select id="version" name="v" defaultValue={version}>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>
        <div>
          <label for="arrangement">Arrange by:</label>
          <select id="arrangement" name="a" defaultValue={arrangement}>
            <option value="failure">Failure</option>
            <option value="area">Site area</option>
          </select>
        </div>
        <div>
          <label for="query">Filter:</label>
          <input id="query" name="q" defaultValue={query} />
        </div>
        <div>
          <button>Refresh</button>
        </div>
      </form>

      <div ref={listRef} tabindex={-1}>
        {Object.entries(groupedBreaks).map(([name, breaks]) => (
          <section key={name}>
            <h3>
              {arrangement === "area" ? (
                <BreakAreaLink
                  break={breaks[0]}
                  breakSectionsMap={breakSectionsMap}
                />
              ) : (
                <BreakWcagLabel break={breaks[0]} version={version} />
              )}
            </h3>
            <dl>
              {breaks.map((b) => (
                <>
                  <dt>
                    {arrangement === "area" ? (
                      <BreakWcagLabel break={b} version={version} />
                    ) : (
                      <BreakAreaLink
                        break={b}
                        breakSectionsMap={breakSectionsMap}
                      />
                    )}
                  </dt>
                  {[b.data.description].flat().map((description) => (
                    <dd>{description}</dd>
                  ))}
                </>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
};
