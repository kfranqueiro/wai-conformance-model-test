import type { CollectionEntry } from "astro:content";
import { z } from "astro/zod";
import omit from "lodash-es/omit";
import sortBy from "lodash-es/sortBy";
import { useEffect, useRef, useState, type FormEvent } from "preact/compat";

import wcag2SuccessCriteria from "@/lib/wcag2.json";
import isEqual from "lodash-es/isEqual";

type BreakProcessesMap = Record<string, CollectionEntry<"breakProcesses">>;

interface BreaksListProps {
  breaks: CollectionEntry<"breaks">[];
  breakProcessesMap: BreakProcessesMap;
}

const formSchema = z.object({
  query: z.string().default(""),
  version: z.enum(["2", "3"]).default("2"),
});

/** Simpler object format that entries are reduced to during processing */
interface SingleBreak
  extends Omit<
    CollectionEntry<"breaks">["data"],
    "location" | "process" | "wcag2" | "wcag3"
  > {
  id: CollectionEntry<"breaks">["id"];
  wcag2?: keyof typeof wcag2SuccessCriteria;
  wcag3?: string;
}

interface BreakWcagLabelProps {
  break: SingleBreak;
  version: z.infer<typeof formSchema.shape.version>;
}

const BreakWcagLabel = ({
  break: { photosensitivity, wcag2, wcag3 },
  version,
}: BreakWcagLabelProps) => {
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

export const BreaksList = ({ breaks, breakProcessesMap }: BreaksListProps) => {
  const [{ query, version }, setValues] = useState(formSchema.parse({}));
  const listRef = useRef<HTMLDivElement | null>(null);

  const wcagProp = version === "2" ? "wcag2" : "wcag3";
  const getSortableWcag =
    version === "2"
      ? ({ wcag2 }: SingleBreak) =>
          // Maps e.g. 1.2.1 to 10201, 2.4.11 to 20411, for sortability
          wcag2!
            .split(".")
            .reverse()
            .reduce((sum, n, i) => sum + +n * Math.pow(10, i * 2), 0)
      : ({ wcag3 }: SingleBreak) => wcag3!;

  const groupedBreaks: Record<string, SingleBreak[]> = {};
  for (const process of Object.keys(breakProcessesMap))
    groupedBreaks[process] = [];

  const filteredBreaks = breaks.filter(({ data }) => {
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
  });

  for (const brk of filteredBreaks) {
    // Split breaks associated with multiple processes or SCs/requirements, to be listed separately
    const breaks: SingleBreak[] = [];
    for (const value of brk.data[wcagProp]!) {
      breaks.push({
        ...omit(brk.data, "wcag2", "wcag3"),
        id: brk.id,
        [wcagProp]: value,
      });
    }

    // Add to each applicable process
    const processes = isEqual(brk.data.process, ["ALL"])
      ? Object.keys(breakProcessesMap)
      : brk.data.process;
    for (const process of processes) groupedBreaks[process].push(...breaks);
  }

  for (const process of Object.keys(breakProcessesMap)) {
    if (!groupedBreaks[process].length) delete groupedBreaks[process];
    else
      groupedBreaks[process] = sortBy(groupedBreaks[process], getSortableWcag);
  }

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
          <label for="query">Filter:</label>
          <input
            id="query"
            name="q"
            defaultValue={query}
            placeholder="e.g. focus, 1.4.10, link, ..."
          />
        </div>
        <div>
          <button>Apply</button>
        </div>
      </form>

      <div ref={listRef} tabindex={-1}>
        {Object.entries(groupedBreaks).map(([name, breaks]) => (
          <section key={name}>
            <h3>{breakProcessesMap[name].data.title}</h3>
            {breakProcessesMap[name].data.discussionItems && (
              <>
                <p>
                  <strong>Discussion items for this process:</strong>
                </p>
                <ul>
                  {breakProcessesMap[name].data.discussionItems?.map((item) => (
                    <li dangerouslySetInnerHTML={{ __html: item }} />
                  ))}
                </ul>
              </>
            )}

            <dl>
              {breaks.map((b, i) => (
                <>
                  {(i < 1 ||
                    getSortableWcag(breaks[i - 1]) !== getSortableWcag(b)) && (
                    <dt>
                      <BreakWcagLabel
                        break={b}
                        {...{ breakProcessesMap, version }}
                      />
                    </dt>
                  )}
                  {b.description.map((description) => (
                    <dd>
                      <span dangerouslySetInnerHTML={{ __html: description }} />
                      {b.discussionItems &&
                        (b.discussionItems.length === 1 ? (
                          <div>
                            <strong class="discussion-item">
                              Discussion item:
                            </strong>{" "}
                            <span
                              dangerouslySetInnerHTML={{
                                __html: b.discussionItems[0],
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <div>
                              <strong class="discussion-item">
                                Discussion items:
                              </strong>
                            </div>
                            <ul>
                              {b.discussionItems.map((item) => (
                                <li
                                  dangerouslySetInnerHTML={{ __html: item }}
                                />
                              ))}
                            </ul>
                          </>
                        ))}
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
