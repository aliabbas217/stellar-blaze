import { joinHref, parseJoinLink } from "@/features/join/link";

/*
 * What a join link can be (redesign S6a). The query is read once, here; a value that is not an id never reaches a request path.
 */

const parse = (query: string) => parseJoinLink(new URLSearchParams(query));

describe("parseJoinLink", () => {
  it("no query is the picker", () => {
    expect(parse("")).toEqual({ kind: "none" });
    expect(parse("demo=live&at=11:10")).toEqual({ kind: "none" });
  });

  it("a site and a crew is a crew link", () => {
    expect(parse("s=site-demo-mussafah&c=crew-b")).toEqual({ kind: "crew", siteId: "site-demo-mussafah", crewId: "crew-b" });
  });

  it("a site alone is a site link (the picker, at that site's crews)", () => {
    expect(parse("s=site-demo-mussafah")).toEqual({ kind: "site", siteId: "site-demo-mussafah" });
  });

  it.each([
    ["a crew without a site", "c=crew-b"],
    ["an empty site", "s=&c=crew-b"],
    ["an empty crew", "s=site-demo-mussafah&c="],
    ["a site with a space", "s=site%20demo&c=crew-b"],
    ["a crew with a slash (a path, not an id)", "s=site-demo-mussafah&c=..%2Fcrew-b"],
    ["a control character", "s=site-demo-mussafah&c=crew%00b"],
    ["an id that starts with a dash", "s=-site&c=crew-b"],
    ["an id of 65 characters", `s=${"a".repeat(65)}&c=crew-b`],
    ["a script", "s=%3Cscript%3E&c=x"],
  ])("%s is invalid", (_name, query) => {
    expect(parse(query)).toEqual({ kind: "invalid" });
  });

  it("an id of 64 characters is still an id", () => {
    const id = "a".repeat(64);
    expect(parse(`s=${id}&c=${id}`)).toEqual({ kind: "crew", siteId: id, crewId: id });
  });
});

describe("joinHref", () => {
  it("builds the link the crew's QR code encodes (without the locale prefix), and round-trips through the parser", () => {
    expect(joinHref()).toBe("/worker/join");
    expect(joinHref("site-demo-mussafah")).toBe("/worker/join?s=site-demo-mussafah");
    const href = joinHref("site-demo-mussafah", "crew-b");
    expect(href).toBe("/worker/join?s=site-demo-mussafah&c=crew-b");
    expect(parse(href.split("?")[1] ?? "")).toEqual({ kind: "crew", siteId: "site-demo-mussafah", crewId: "crew-b" });
  });
});
