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
  <a href={museumBaseUrl.slice(0, -1) + breakSectionsMap[data.location.id]}>
    {data.location.id}
  </a>
);

interface BreakWcagLabelProps {
  break: CollectionEntry<"breaks">;
  version: z.infer<typeof formSchema.shape.version>;
}

const BreakWcagLabel = ({ break: { data }, version }: BreakWcagLabelProps) =>
  version === "2"
    ? `${data.wcag2SuccessCriterion}: ${wcag2SuccessCriteria[data.wcag2SuccessCriterion!]}`
    : data.wcag3Requirement;

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
  const arrangementIteratee =
    arrangement === "area" ? locationIteratee : requirementIteratee;

  const groupedBreaks = groupBy(
    sortBy(
      breaks.filter(({ data }) => {
        if (!data[wcagProp]) return false;
        if (query)
          return (
            data.description.includes(query) ||
            data.location.id.includes(query) ||
            (data.wcag2SuccessCriterion &&
              (data.wcag2SuccessCriterion?.includes(query) ||
                wcag2SuccessCriteria[data.wcag2SuccessCriterion].includes(
                  query
                ))) ||
            data.wcag3Requirement?.includes(query)
          );
        return true;
      }),
      // FIXME: this probably won't sort section numbers correctly (e.g. 2.4.1, 2.4.11, 2.4.2)
      [
        arrangementIteratee,
        // In case of tie, sort by the other (subgrouped) property
        arrangement === "area" ? requirementIteratee : locationIteratee,
      ]
    ).reduce((breaks, nextBreak) => {
      if (!breaks.length) return [nextBreak];
      const previousBreak = breaks[breaks.length - 1];

      // Collate neighboring breaks
      if (
        (arrangement === "area" &&
          nextBreak.data[wcagProp] === previousBreak.data[wcagProp]) ||
        (arrangement === "failure" &&
          nextBreak.data.location === previousBreak.data.location)
      ) {
        previousBreak.data.description = ([] as string[]).concat(
          previousBreak.data.description,
          nextBreak.data.description
        );
      } else {
        breaks.push(nextBreak);
      }
      return breaks;
    }, [] as CollectionEntry<"breaks">[]),
    arrangementIteratee
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
        {Object.entries(groupedBreaks).map(([name, breaks]) =>
          arrangement === "area" ? (
            <section key={name}>
              <h3>
                <BreakAreaLink
                  break={breaks[0]}
                  breakSectionsMap={breakSectionsMap}
                />
              </h3>
              <dl>
                {breaks.map((b) => (
                  <>
                    <dt>
                      <BreakWcagLabel break={b} version={version} />
                    </dt>
                    {[b.data.description].flat().map((description) => (
                      <dd>{description}</dd>
                    ))}
                  </>
                ))}
              </dl>
            </section>
          ) : (
            <section key={name}>
              <h3>
                <BreakWcagLabel break={breaks[0]} version={version} />
              </h3>
              <dl>
                {breaks.map((b) => (
                  <>
                    <dt>
                      <BreakAreaLink
                        break={b}
                        breakSectionsMap={breakSectionsMap}
                      />
                    </dt>
                    {[b.data.description].flat().map((description) => (
                      <dd>{description}</dd>
                    ))}
                  </>
                ))}
              </dl>
            </section>
          )
        )}
      </div>
    </>
  );
};
