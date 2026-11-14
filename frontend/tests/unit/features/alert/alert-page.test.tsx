import type { ReactNode } from "react";
import AlertPage from "@/app/[locale]/(worker)/worker/alert/page";

/*
 * The alert page is the gate of the card: the notification's query is input from outside the app, and anything that is not a
 * warning this app could have sent opens Today (F2 Task 17, test_invalid_params_redirect_to_today).
 */

const redirect = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/worker/alert",
}));
vi.mock("next-intl/server", () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock("@/features/alert/AlertView", () => ({
  AlertView: ({ params }: { params: { level: string } }) => <p data-testid="card">{params.level}</p>,
  AlertSkeleton: () => null,
}));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: ReactNode }) => children }));

function props(locale: string, search: Record<string, string | undefined>) {
  return { params: Promise.resolve({ locale }), searchParams: Promise.resolve(search) } as unknown as Parameters<typeof AlertPage>[0];
}

const valid = { audience: "site", target: "site-demo-mussafah", level: "orange", valid_from: "2026-09-03T06:00:00Z" };

beforeEach(() => {
  redirect.mockClear();
});

describe("the alert page", () => {
  it.each([
    ["an unknown level", { ...valid, level: "purple" }],
    ["a missing level", { ...valid, level: undefined }],
    ["no query at all", {}],
    ["a time that is not a time", { ...valid, valid_from: "soon" }],
    ["an audience nobody sends to", { ...valid, audience: "everyone" }],
  ])("test_invalid_params_redirect_to_today: %s opens Today in the same language", async (_name, search) => {
    await expect(AlertPage(props("ur", search))).rejects.toThrow("NEXT_REDIRECT /ur/worker");
    expect(redirect).toHaveBeenCalledWith("/ur/worker");
  });

  it("a warning this app could have sent renders the card and redirects nowhere", async () => {
    const page = await AlertPage(props("en", valid));
    expect(page).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
