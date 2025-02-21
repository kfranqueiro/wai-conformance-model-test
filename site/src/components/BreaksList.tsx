import type { CollectionEntry } from "astro:content";
import { z } from "astro/zod";
import groupBy from "lodash-es/groupBy";
import omit from "lodash-es/omit";
import sortBy from "lodash-es/sortBy";
import { useEffect, useRef, useState, type FormEvent } from "preact/compat";

import { museumBaseUrl } from "@/lib/constants";
import { wcag2SuccessCriteria, type Wcag2SuccessCriterion } from "@/lib/wcag";

type BreakSectionsMap = Record<string, CollectionEntry<"breakSections">>;

interface BreaksListProps {
  breaks: CollectionEntry<"breaks">[];
  breakSectionsMap: BreakSectionsMap;
}

const formSchema = z.object({
  arrangement: z.enum(["area", "failure"]).default("area"),
  query: z.string().default(""),
  version: z.enum(["2", "3"]).default("2"),
});

/** Simpler object format that entries are reduced to during processing */
interface SingleBreak
  extends Omit<CollectionEntry<"breaks">["data"], "wcag2" | "wcag3"> {
  id: CollectionEntry<"breaks">["id"];
  wcag2?: Wcag2SuccessCriterion;
  wcag3?: string;
}

interface BreakLabelProps {
  break: SingleBreak;
  breakSectionsMap: BreakSectionsMap;
  version: z.infer<typeof formSchema.shape.version>;
}

const BreakAreaLink = ({
  break: { location },
  breakSectionsMap,
}: BreakLabelProps) => (
  <a href={museumBaseUrl + breakSectionsMap[location.id].data.path}>
    {location.id}
  </a>
);

const BreakWcagLabel = ({
  break: { photosensitivity, wcag2, wcag3 },
  version,
}: BreakLabelProps) => {
  const label =
    version === "2" ? `${wcag2}: ${wcag2SuccessCriteria[wcag2!]}` : wcag3!;
  return (
    <>
      {label}{" "}
      {photosensitivity && (
        <strong class="photosensitivity">(Photosensitivity warning)</strong>
      )}
    </>
  );
};

const caseInsensitiveIncludes = (a: string, b: string) =>
  a.toLowerCase().includes(b.toLowerCase());

export const BreaksList = ({ breaks, breakSectionsMap }: BreaksListProps) => {
  const [{ arrangement, query, version }, setValues] = useState(
    formSchema.parse({})
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  const wcagProp = version === "2" ? "wcag2" : "wcag3";
  const getLocation = ({ location }: SingleBreak) => location.id;
  const getWcag =
    version === "2"
      ? ({ wcag2 }: SingleBreak) =>
          // Maps e.g. 1.2.1 to 10201, 2.4.11 to 20411, for sortability
          wcag2!
            .split(".")
            .reverse()
            .reduce((sum, n, i) => sum + +n * Math.pow(10, i * 2), 0)
      : ({ wcag3 }: SingleBreak) => wcag3!;

  const getSection = arrangement === "area" ? getLocation : getWcag;
  const getDt = arrangement === "area" ? getWcag : getLocation;
  const SectionLabel = arrangement === "area" ? BreakAreaLink : BreakWcagLabel;
  const DtLabel = arrangement === "area" ? BreakWcagLabel : BreakAreaLink;

  const groupedBreaks = groupBy(
    sortBy(
      breaks
        .filter(({ data }) => {
          if (!data[wcagProp]) return false;
          if (!query) return true;

          if (caseInsensitiveIncludes(data.location.id, query)) return true;
          if (data.description.find((d) => caseInsensitiveIncludes(d, query)))
            return true;

          if (version === "2")
            return !!data.wcag2!.find(
              (c) =>
                c.includes(query) ||
                caseInsensitiveIncludes(wcag2SuccessCriteria[c], query)
            );
          return !!data.wcag3!.find((r) => caseInsensitiveIncludes(r, query));
        })
        .reduce((breaks, nextBreak) => {
          // Split breaks associated with multiple SCs/requirements
          for (const value of nextBreak.data[wcagProp]!) {
            breaks.push({
              ...omit(nextBreak.data, "wcag2", "wcag3"),
              id: nextBreak.id,
              [wcagProp]: value,
            });
          }
          return breaks;
        }, [] as SingleBreak[]),
      [getSection, getDt]
    ).reduce((breaks, nextBreak) => {
      if (!breaks.length) return [nextBreak];
      const previousBreak = breaks[breaks.length - 1];

      // Merge descriptions of neighboring breaks for same section and subsection
      if (
        getSection(nextBreak) === getSection(previousBreak) &&
        getDt(nextBreak) === getDt(previousBreak)
      ) {
        previousBreak.description = [
          ...previousBreak.description,
          ...nextBreak.description,
        ];
      } else {
        breaks.push(nextBreak);
      }
      return breaks;
    }, [] as SingleBreak[]),
    getSection
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
    const params = new URLSearchParams(location.search);
    const updateValues = () => {
      setValues(
        formSchema.parse({
          arrangement: params.get("a") || undefined,
          query: params.get("q") || undefined,
          version: params.get("v") || undefined,
        })
      );
    };

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
            <option value="area">Site area</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div>
          <label for="query">Filter:</label>
          <input id="query" name="q" defaultValue={query} />
        </div>
        <div>
          <button>Apply</button>
        </div>
      </form>

      <div ref={listRef} tabindex={-1}>
        {Object.entries(groupedBreaks).map(([name, breaks]) => (
          <section key={name}>
            <h3>
              <SectionLabel
                break={breaks[0]}
                {...{ breakSectionsMap, version }}
              />
            </h3>
            {arrangement === "area" &&
              breakSectionsMap[breaks[0].location.id].data.description && (
                <p>
                  {breakSectionsMap[breaks[0].location.id].data.description}
                </p>
              )}
            <dl>
              {breaks.map((b) => (
                <>
                  <dt>
                    <DtLabel break={b} {...{ breakSectionsMap, version }} />
                  </dt>
                  {b.description.map((description) => (
                    <dd>
                      {description}
                      {b.discussionItems && (
                        <>
                          <div>
                            <strong class="discussion-item">
                              Discussion items:
                            </strong>
                          </div>
                          <ul>
                            {b.discussionItems.map((item) => (
                              <li>{item}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </dd>
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
