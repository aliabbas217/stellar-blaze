import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import en from "../../../../messages/en.json";
import { DEMO_CREW_ID } from "@/features/demo/constants";
import { JoinView } from "@/features/join/JoinView";
import * as chooseSite from "@/features/profile/choose-site";
import { resetSitePinForTests } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";
import { listCrews, SITE_DEMO, SITE_EMPTY } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The join page against the mock API (redesign S6a), through the real hooks, the real store and MSW's answers: a valid crew link, an
 * unknown site, a crew that is not at that site, a garbled code, the API offline or slow, the picker, and the demo yard. What the page
 * must never do is checked as hard as what it does: nothing is pinned until the tap, and the tap sends nothing.
 */

const j = en.worker.join;

let search = "";
const replace = vi.fn();
const router = { replace };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/worker/join",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker/join",
  useRouter: () => router,
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; replace?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "replace"))}>
      {children}
    </a>
  ),
}));

function renderJoin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <JoinView />
    </QueryClientProvider>,
  );
}

/** Every request the mock API saw while a test ran, so "nothing is sent" is a measurement. */
let seen: { method: string; path: string }[] = [];
const onRequest = ({ request }: { request: Request }) => {
  seen.push({ method: request.method, path: new URL(request.url).pathname });
};

beforeEach(() => {
  replace.mockClear();
  search = "";
  seen = [];
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null, push: null, profile: null });
  server.events.on("request:start", onRequest);
});

afterEach(() => {
  server.events.removeListener("request:start", onRequest);
  vi.restoreAllMocks();
});

const crewLink = (siteId: string, crewId: string) => `?s=${siteId}&c=${crewId}`;

describe("a valid crew link", () => {
  it("asks 'Is this your crew?' with the site and the crew read from the API, tagged Demo, and pins nothing yet", async () => {
    search = crewLink(SITE_DEMO, "crew-c");
    renderJoin();

    expect(await screen.findByRole("heading", { level: 1, name: j.confirmTitle })).toBeInTheDocument();
    const card = document.querySelector("[data-join-card]") as HTMLElement;
    expect(within(card).getByText("Mussafah M-14 yard")).toBeInTheDocument();
    // "(synthetic)" is taken out of the name and the Demo tag says it instead (the same rule as the header).
    expect(card).not.toHaveTextContent("(synthetic)");
    expect(card).toHaveTextContent("Demo");
    expect(within(card).getByText("Crew C")).toBeInTheDocument();
    expect(within(card).getByText("Formwork")).toBeInTheDocument();
    expect(screen.getByText(j.note)).toBeInTheDocument();
    expect(useProfile.getState().site).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    // Exactly one primary action, 'Yes', and the way out is a link.
    expect(document.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: j.other })).toHaveAttribute("href", "/en/worker/join");
  });

  it("'Yes, this is my crew' pins the site and the crew on the device, opens Today, and sends nothing", async () => {
    search = crewLink(SITE_DEMO, "crew-c");
    renderJoin();
    await userEvent.setup().click(await screen.findByRole("button", { name: j.confirm }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/worker");
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: "crew-c" });
    // Only the two public reads were made: no write of any kind, and no read of a crew's timeline or forecast (that is Today's).
    expect(seen.every((request) => request.method === "GET")).toBe(true);
    expect(seen.map((request) => request.path).sort()).toEqual(["/api/v1/sites", `/api/v1/sites/${SITE_DEMO}/crews`]);
    // No profile was made: the join holds no name, no number, no health data.
    expect(useProfile.getState().profile).toBeNull();
  });

  it("a pin that cannot be saved is said, the page does not move, and the same button works when the chunk loads", async () => {
    const chunk = vi.spyOn(chooseSite, "chooseDeviceSite").mockRejectedValueOnce(new Error("Loading chunk failed"));
    search = crewLink(SITE_DEMO, "crew-a");
    renderJoin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: j.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(j.saveFailed);
    expect(replace).not.toHaveBeenCalled();
    expect(useProfile.getState().site).toBeNull();

    chunk.mockRestore();
    await user.click(screen.getByRole("button", { name: j.confirm }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/worker");
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: "crew-a" });
  });

  it("a pin overtaken by a removal of the phone's data is not written and not claimed", async () => {
    vi.spyOn(chooseSite, "chooseDeviceSite").mockResolvedValue(false);
    search = crewLink(SITE_DEMO, "crew-a");
    renderJoin();
    await userEvent.setup().click(await screen.findByRole("button", { name: j.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(j.saveFailed);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("a code that does not point at a crew", () => {
  it("a site the API does not list: says so, and shows the workplaces to pick from", async () => {
    search = crewLink("site-gone", "crew-a");
    renderJoin();

    expect(await screen.findByText(j.unknownSite)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: j.pageTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mussafah M-14 yard/ })).toHaveAttribute("href", `/en/worker/join?s=${SITE_DEMO}`);
    expect(screen.queryByRole("button", { name: j.confirm })).toBeNull();
    // The crews of a site that does not exist are never asked for.
    expect(seen.map((request) => request.path)).not.toContain("/api/v1/sites/site-gone/crews");
  });

  it("a crew the site does not have: says so with the site's name, and lists that site's crews", async () => {
    search = crewLink(SITE_DEMO, "crew-zzz");
    renderJoin();

    expect(await screen.findByText(j.unknownCrew.replace("{site}", "Mussafah M-14 yard"))).toBeInTheDocument();
    const rows = await within(await screen.findByRole("region", { name: new RegExp(j.crews) })).findAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["a", "b", "c", "d"].map((id) => `/en/worker/join?s=${SITE_DEMO}&c=crew-${id}`));
    expect(screen.queryByRole("button", { name: j.confirm })).toBeNull();
  });

  it("a crew of ANOTHER site (the API's own record says so) is refused, not pinned", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/crews", () => {
        const crews = listCrews(SITE_DEMO) ?? [];
        return HttpResponse.json(crews.map((crew) => (crew.id === "crew-b" ? { ...crew, site_id: SITE_EMPTY } : crew)));
      }),
    );
    search = crewLink(SITE_DEMO, "crew-b");
    renderJoin();

    expect(await screen.findByText(j.unknownCrew.replace("{site}", "Mussafah M-14 yard"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: j.confirm })).toBeNull();
    expect(useProfile.getState().site).toBeNull();
  });

  it.each([
    ["a crew with no site", "?c=crew-b"],
    ["an empty site", "?s=&c=crew-b"],
    ["an id with a slash", "?s=site-demo-mussafah&c=..%2Fx"],
    ["a script", "?s=%3Cscript%3E&c=x"],
    ["an id of 65 characters", `?s=${"a".repeat(65)}&c=crew-b`],
  ])("a garbled code (%s): says it did not work, shows the picker, and makes no request for it", async (_name, query) => {
    search = query;
    renderJoin();

    expect(await screen.findByText(j.badCode)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Mussafah M-14 yard/ })).toBeInTheDocument();
    expect(seen.map((request) => request.path).filter((path) => path !== "/api/v1/sites")).toEqual([]);
  });
});

describe("the picker (no code)", () => {
  it("lists the workplaces and says honestly that only the demo yard is listed, then the crews of the one picked", async () => {
    renderJoin();

    expect(await screen.findByRole("heading", { level: 1, name: j.pageTitle })).toBeInTheDocument();
    expect(await screen.findByText(j.demoOnly)).toBeInTheDocument();
    const places = within(screen.getByRole("region", { name: j.workplaces })).getAllByRole("link");
    expect(places.map((place) => place.getAttribute("href"))).toEqual([`/en/worker/join?s=${SITE_DEMO}`, `/en/worker/join?s=${SITE_EMPTY}`]);
    expect(places[0]).toHaveTextContent("Mussafah M-14 yard");
    expect(places[0]).not.toHaveTextContent("(synthetic)");
  });

  it("with a site in the link, lists its crews by name and task; each row is a link to the confirm card", async () => {
    search = `?s=${SITE_DEMO}`;
    renderJoin();

    const crewRows = await within(await screen.findByRole("region", { name: new RegExp(j.crews) })).findAllByRole("link");
    expect(crewRows).toHaveLength(4);
    expect(crewRows[1]).toHaveTextContent("Crew B");
    expect(crewRows[1]).toHaveTextContent("Concrete pour");
    expect(crewRows[1]).toHaveAttribute("href", `/en/worker/join?s=${SITE_DEMO}&c=crew-b`);
    // Every row is a prefetch-free field link: following one writes nothing to the service worker's prefetch cache.
    expect(crewRows.every((row) => row.getAttribute("data-prefetch") === "false")).toBe(true);
    expect(screen.getByText(j.crewMissing)).toBeInTheDocument();
  });

  it("a site with no listed crews says who to ask, not an empty list", async () => {
    search = `?s=${SITE_EMPTY}`;
    renderJoin();

    expect(await screen.findByText(j.crewMissing)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("a site in the link that the API does not list says so", async () => {
    search = "?s=site-gone";
    renderJoin();
    expect(await screen.findByText(j.unknownSite)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mussafah M-14 yard/ })).toBeInTheDocument();
  });
});

describe("the demo yard", () => {
  it("'Just looking?' pins the demo site and its scored crew, with no profile, and opens Today", async () => {
    renderJoin();
    await userEvent.setup().click(await screen.findByRole("button", { name: j.demo }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/worker");
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: DEMO_CREW_ID });
    expect(useProfile.getState().profile).toBeNull();
    expect(seen.every((request) => request.method === "GET")).toBe(true);
  });

  it("is a quiet action, not a second primary", async () => {
    renderJoin();
    const demo = await screen.findByRole("button", { name: j.demo });
    expect(demo.hasAttribute("data-primary")).toBe(false);
    expect(document.querySelectorAll("[data-primary]")).toHaveLength(0);
  });

  it("a pin that cannot be saved says so", async () => {
    vi.spyOn(chooseSite, "chooseDeviceSite").mockRejectedValue(new Error("Loading chunk failed"));
    renderJoin();
    await userEvent.setup().click(await screen.findByRole("button", { name: j.demo }));
    expect(await screen.findByRole("alert")).toHaveTextContent(j.saveFailed);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("loading and failure", () => {
  it("while the reads are slow: a skeleton of the card (no 'Yes' to tap), then the card", async () => {
    server.use(
      http.get("*/api/v1/sites", async () => {
        await delay(60);
        return HttpResponse.json([
          { id: SITE_DEMO, name: "Mussafah M-14 yard (synthetic)", timezone: "Asia/Dubai", synthetic: true, epoch_id: 1, supervisor_phone: null, first_aider_phone: null },
        ]);
      }),
    );
    search = crewLink(SITE_DEMO, "crew-a");
    renderJoin();

    expect(document.querySelector("[data-join-skeleton]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: j.confirm })).toBeNull();
    expect(await screen.findByRole("button", { name: j.confirm })).toBeInTheDocument();
    expect(document.querySelector("[data-join-skeleton]")).toBeNull();
  });

  it("API offline: the error state with a retry that works, never a card for a crew nobody confirmed", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.error()));
    search = crewLink(SITE_DEMO, "crew-a");
    renderJoin();

    expect(await screen.findByText(en.states.error.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: j.confirm })).toBeNull();
    expect(useProfile.getState().site).toBeNull();

    server.resetHandlers();
    await userEvent.setup().click(screen.getByRole("button", { name: en.states.retry }));
    expect(await screen.findByRole("button", { name: j.confirm })).toBeInTheDocument();
  });

  it("the crews failing after the site list answered: the error state, and its retry reaches the card", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json({ type: "urn:x", title: "down", status: 503 }, { status: 503 })));
    search = crewLink(SITE_DEMO, "crew-a");
    renderJoin();

    expect(await screen.findByText(en.states.error.title)).toBeInTheDocument();
    server.resetHandlers();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole("button", { name: en.states.retry }));
    });
    expect(await screen.findByRole("button", { name: j.confirm })).toBeInTheDocument();
  });

  it("the picker with the site list down: the error state with a retry, and no demo button that cannot work", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.json({ type: "urn:x", title: "down", status: 503 }, { status: 503 })));
    renderJoin();

    expect(await screen.findByText(en.states.error.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.states.retry })).toBeEnabled();
    expect(screen.queryByRole("button", { name: j.demo })).toBeNull();
  });
});
