import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import AlertPage from "@/app/[locale]/(worker)/worker/(app)/alert/page";
import { AlertEntry } from "@/features/alert/AlertEntry";

/*
 * The alert page is the gate of the card: the notification's query is input from outside the app, and anything that is not a
 * warning this app could have sent opens Today (F2 Task 17, test_invalid_params_redirect_to_today). Since F2 W1 (I3) the page is
 * a static shell the service worker can precache, so the gate runs on the client: AlertEntry reads the query and replaces the
 * route; the page itself takes no request data at all.
 */

const replace = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/en/worker/alert",
}));
vi.mock("next-intl/server", () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock("@/features/alert/AlertView", () => ({
  AlertView: ({ params }: { params: { level: string } }) => <p data-testid="card">{params.level}</p>,
  AlertSkeleton: () => <p data-testid="skeleton" />,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace }), Link: () => null }));

const valid = { audience: "site", target: "site-demo-mussafah", level: "orange", valid_from: "2026-09-03T06:00:00Z" };

function query(values: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  return params;
}

beforeEach(() => {
  replace.mockClear();
  search = new URLSearchParams();
});

describe("the alert page", () => {
  it("is static: it takes no props, so it reads no search parameter on the server", () => {
    expect(AlertPage.length).toBe(0);
  });

  it("renders the shell with its own heading", async () => {
    render(await AlertPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("title");
  });
});

describe("AlertEntry", () => {
  it.each([
    ["an unknown level", { ...valid, level: "purple" }],
    ["a missing level", { ...valid, level: undefined }],
    ["no query at all", {}],
    ["a time that is not a time", { ...valid, valid_from: "soon" }],
    ["an audience nobody sends to", { ...valid, audience: "everyone" }],
  ])("test_invalid_params_redirect_to_today: %s opens Today and shows no card", (_name, values) => {
    search = query(values);
    render(
      <Suspense>
        <AlertEntry />
      </Suspense>,
    );
    expect(replace).toHaveBeenCalledWith("/worker");
    expect(screen.queryByTestId("card")).toBeNull();
    expect(screen.getByTestId("skeleton")).toBeTruthy();
  });

  it("a warning this app could have sent renders the card and redirects nowhere", () => {
    search = query(valid);
    render(
      <Suspense>
        <AlertEntry />
      </Suspense>,
    );
    expect(screen.getByTestId("card").textContent).toBe("orange");
    expect(replace).not.toHaveBeenCalled();
  });

  it("reads the query again when it changes (a second notification tapped while the card is open)", () => {
    search = query(valid);
    const { rerender } = render(<AlertEntry />);
    expect(screen.getByTestId("card").textContent).toBe("orange");
    search = query({ ...valid, level: "red" });
    rerender(<AlertEntry />);
    expect(screen.getByTestId("card").textContent).toBe("red");
  });
});
