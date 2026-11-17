import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { publishSitePin, resetSitePinForTests, type SiteContacts } from "@/features/profile/site-pin";
import { UnwellView } from "@/features/unwell/UnwellView";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The "I feel unwell" call sheet (F2 Task 18, safety). Every state is rendered through the real components with the phone's
 * pin published the way the profile store does: the three calls, 998 first; the demo that never dials; the designed rows for
 * a number that is missing; ADOSH's steps word for word; the review label; and that nothing on the sheet reaches the network
 * or any storage but the timer's own key in sessionStorage.
 */

const SUPERVISOR = "+12025550143";
const FIRST_AIDER = "+12025550144";
const BOTH: SiteContacts = { supervisorPhone: SUPERVISOR, firstAiderPhone: FIRST_AIDER };

/** The exact words of ADOSH-SF Technical Guideline, Safety in the Heat v4.0, section 4.5(c): unedited. */
const ADOSH_STEPS = [
  "Call emergency contact number and notify supervisor",
  "Move the sick employee to a cool shaded area",
  "Cool the employee using methods such as: soaking their clothes with water; spraying, sponging, or showering them with water; and fanning their body.",
] as const;

function pin(contacts: SiteContacts | undefined): void {
  publishSitePin(contacts === undefined ? { siteId: "site-demo-mussafah", crewId: "crew-b" } : { siteId: "site-demo-mussafah", crewId: "crew-b", contacts });
}

function realDeployment(): void {
  vi.stubEnv("NEXT_PUBLIC_SB_DEMO", "0");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSitePinForTests();
  sessionStorage.clear();
});

type StateName = "ideal" | "no first-aider number" | "no supervisor number" | "numbers not learned yet" | "reviewed" | "offline";

function openIn(state: StateName) {
  if (state === "ideal" || state === "reviewed" || state === "offline") pin(BOTH);
  if (state === "no first-aider number") pin({ ...BOTH, firstAiderPhone: null });
  if (state === "no supervisor number") pin({ ...BOTH, supervisorPhone: null });
  if (state === "numbers not learned yet") pin(undefined);
  if (state === "offline") vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  return renderWithIntl(<UnwellView clinicalReview={state === "reviewed" ? "2026-12-01" : null} />);
}

const STATES: readonly StateName[] = ["ideal", "no first-aider number", "no supervisor number", "numbers not learned yet", "reviewed", "offline"];

describe("the three calls on a real deployment", () => {
  beforeEach(realDeployment);

  it("offers 998, then the supervisor, then the first-aider, each a tel: link to the right number", () => {
    openIn("ideal");
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["tel:998", `tel:${SUPERVISOR}`, `tel:${FIRST_AIDER}`]);
    expect(links[0]).toHaveTextContent("Call 998");
    expect(links[0]).toHaveTextContent("Ambulance");
    expect(links[1]).toHaveTextContent("Call your supervisor");
    expect(links[2]).toHaveTextContent("Call the site first-aider");
  });

  it("test_call_998_link_present_in_every_state: tel:998 is first, enabled and outside any form, in every state", () => {
    for (const state of STATES) {
      const { container, unmount } = openIn(state);
      const emergency = container.querySelector('a[href="tel:998"]');
      expect(emergency, state).not.toBeNull();
      expect(container.querySelector("a[href^='tel:']"), state).toBe(emergency);
      expect(emergency?.closest("form"), state).toBeNull();
      expect(container.querySelectorAll("[disabled], [aria-disabled]"), state).toHaveLength(0);
      unmount();
      resetSitePinForTests();
    }
  });

  it("never renders an empty tel: link: a missing number is a designed row, which is not a link", () => {
    for (const state of ["no first-aider number", "no supervisor number", "numbers not learned yet"] as const) {
      const { container, unmount } = openIn(state);
      for (const link of container.querySelectorAll("a[href^='tel:']")) {
        expect(link.getAttribute("href"), state).toMatch(/^tel:(998|\+\d{7,15})$/);
      }
      unmount();
      resetSitePinForTests();
    }
  });

  it("a site with no first-aider number: a designed row, the 998 and supervisor calls stay", () => {
    openIn("no first-aider number");
    expect(screen.getByText("Your site's first-aider number appears here once your site adds it")).toBeVisible();
    expect(screen.getByText("Ask the nearest person to call your first aider.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /first-aider/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("a site with no supervisor number: a designed row, the 998 and first-aider calls stay", () => {
    openIn("no supervisor number");
    expect(screen.getByText("Your site's supervisor number appears here once your site adds it")).toBeVisible();
    expect(screen.queryByRole("link", { name: /supervisor/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("a phone that has not learned the site's numbers says how it will, and still offers 998", () => {
    openIn("numbers not learned yet");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Call 998/ })).toHaveAttribute("href", "tel:998");
    expect(screen.getByText(/supervisor number is saved on this phone once you open Today with a connection/)).toBeVisible();
    expect(screen.getByText(/first-aider number is saved on this phone once you open Today with a connection/)).toBeVisible();
  });

  it("offline: says calling still works, and every call is still there", () => {
    openIn("offline");
    expect(screen.getByText("Offline")).toBeVisible();
    expect(screen.getByText("Calling still works. It does not need internet.")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  describe("when the phone saved the numbers (F2 W1)", () => {
    const SAVED = { ...BOTH, savedAt: "2026-11-12T08:00:00.000Z" };

    it("offline: says on which day this phone saved them, because a number that may be old should look old", () => {
      pin(SAVED);
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      renderWithIntl(<UnwellView />);
      expect(screen.getByText(/^Numbers saved on /)).toBeVisible();
      // Western digits and a short month, whatever the order the locale writes them in.
      expect(screen.getByText(/^Numbers saved on /).textContent).toMatch(/12/);
      expect(screen.getByText(/^Numbers saved on /).textContent).toMatch(/Nov/);
    });

    it("online: says nothing about it", () => {
      pin(SAVED);
      renderWithIntl(<UnwellView />);
      expect(screen.queryByText(/Numbers saved on/)).toBeNull();
    });

    it("offline with a pin that has no save date (written before the date existed): says nothing rather than guess one", () => {
      pin(BOTH);
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      renderWithIntl(<UnwellView />);
      expect(screen.queryByText(/Numbers saved on/)).toBeNull();
    });
  });

  it("says calling needs no internet but does need a signal", () => {
    openIn("ideal");
    expect(screen.getByText("Calling works without internet. It needs a phone signal.")).toBeVisible();
  });

  it("the 998 call is the hero: inside [data-hero], 104 px or taller by construction", () => {
    const { container } = openIn("ideal");
    const hero = container.querySelector("[data-hero]");
    const emergency = screen.getByRole("link", { name: /Call 998/ });
    expect(hero).not.toBeNull();
    expect(hero).toContainElement(emergency);
    expect(emergency.className).toContain("min-h-26");
  });
});

describe("test_demo_mode_never_dials", () => {
  it("is the default: a build with no switch is a demo", () => {
    expect(process.env.NEXT_PUBLIC_SB_DEMO).not.toBe("0");
  });

  it("renders no tel: link anywhere, in any state, and each action is an enabled button", () => {
    for (const state of STATES) {
      const { container, unmount } = openIn(state);
      expect(container.querySelectorAll("a[href^='tel:']"), state).toHaveLength(0);
      expect(container.querySelectorAll("a[href]"), state).toHaveLength(0);
      const emergency = screen.getByRole("button", { name: /Call 998/ });
      expect(emergency, state).toBeEnabled();
      expect(emergency.closest("form"), state).toBeNull();
      unmount();
      resetSitePinForTests();
    }
  });

  it("shows the number and a confirmation instead of dialling, for the supervisor, the first-aider and 998", async () => {
    const user = userEvent.setup();
    openIn("ideal");

    const supervisor = screen.getByRole("button", { name: /Call your supervisor/ });
    expect(supervisor).toHaveTextContent(SUPERVISOR);
    expect(supervisor).toHaveTextContent("Synthetic number");
    await user.click(supervisor);
    expect(screen.getByText("Demo: this would call your supervisor")).toBeVisible();
    expect(screen.getByText("No call is made in the demo.")).toBeVisible();

    const firstAider = screen.getByRole("button", { name: /Call the site first-aider/ });
    expect(firstAider).toHaveTextContent(FIRST_AIDER);
    await user.click(firstAider);
    expect(screen.getByText("Demo: this would call the site first-aider")).toBeVisible();
    // One confirmation at a time: the last tap's.
    expect(screen.queryByText("Demo: this would call your supervisor")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Call 998/ }));
    expect(screen.getByText("Demo: this would call 998 (ambulance)")).toBeVisible();
    expect(screen.queryByText("Demo: this would call the site first-aider")).not.toBeInTheDocument();
  });

  it("announces the confirmation in a live region", async () => {
    const user = userEvent.setup();
    openIn("ideal");
    await user.click(screen.getByRole("button", { name: /Call your supervisor/ }));
    const status = screen.getAllByRole("status").find((region) => region.textContent.includes("Demo: this would call your supervisor"));
    expect(status).toBeDefined();
  });

  it("a missing number is still a designed row on the demo, not a button", () => {
    openIn("no first-aider number");
    expect(screen.queryByRole("button", { name: /first-aider/ })).not.toBeInTheDocument();
    expect(screen.getByText("Your site's first-aider number appears here once your site adds it")).toBeVisible();
  });
});

describe("test_steps_are_the_exact_adosh_text", () => {
  it("lists the three steps in ADOSH's own words and nothing else", () => {
    realDeployment();
    openIn("ideal");
    const section = screen.getByRole("region", { name: "Heat-stroke first aid, in ADOSH's words" });
    const items = within(section).getAllByRole("listitem");
    expect(items.map((item) => item.textContent.replace(/^\d/, ""))).toEqual([...ADOSH_STEPS]);
  });

  it("cites the Technical Guideline, not the Code of Practice, and adds no other clinical wording", () => {
    const { container } = openIn("ideal");
    const text = container.textContent;
    expect(text).toContain("ADOSH-SF Technical Guideline, Safety in the Heat v4.0, section 4.5(c)");
    expect(text).not.toContain("CoP 11.0");
    expect(text).not.toMatch(/sip|drink|litre|liter|ml\b|clothing off|remove .* clothes|stay with/i);
  });

  it("English is the exact ADOSH text; the other five are machine drafts of it that keep the citation verbatim in English and say they are translated", () => {
    for (const locale of ["en", "ur", "hi", "bn", "ne", "ar"]) {
      const messages = JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../../messages/${locale}.json`), "utf8")) as {
        worker: { unwell: { steps: Record<string, string> } };
      };
      const steps = messages.worker.unwell.steps;
      const written = [steps["one"], steps["two"], steps["three"]];
      if (locale === "en") expect(written, locale).toEqual([...ADOSH_STEPS]);
      else {
        // Task 22 (native review pending, shown with the draft line and "Not clinically reviewed"): a translation, never the English left in place.
        expect(written, locale).not.toEqual([...ADOSH_STEPS]);
        for (const step of written) expect(step, locale).not.toBe("");
        // The source line is not "Exact text of ..." over translated words: it names the English original and says this is a translation.
        expect(steps["source"], locale).not.toMatch(/^Exact text/);
      }
      // The architect's citation, word for word, in every language (a reviewer or a worker's supervisor can look it up).
      expect(steps["source"], locale).toContain("ADOSH-SF Technical Guideline, Safety in the Heat v4.0, section 4.5(c)");
    }
  });
});

/*
 * Task 22 fix round 1 (independent review, Important 2 and 3): the machine drafts of the three steps keep every concept of the
 * English, so a shorter or softer draft cannot ship; the heading above them says "according to ADOSH", never "in ADOSH's words",
 * because the steps under it are a translation (the line below them says so).
 */
const catalogue = (locale: string): { worker: { unwell: { steps: Record<string, string>; calls: { demo: Record<string, string> } } } } =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../../messages/${locale}.json`), "utf8")) as ReturnType<typeof catalogue>;

/** Per language and step, one pattern per concept of the English step (call / contact / supervisor / notify; move / shade / cool; ...). */
const STEP_CONCEPTS: Readonly<Record<string, readonly (readonly RegExp[])[]>> = {
  ar: [
    [/اتصل/u, /الاتصال/u, /الطوارئ/u, /المشرف/u, /أبلغ/u],
    [/انقل/u, /المريض/u, /بارد/u, /مظلل/u],
    [/بَرِّد/u, /بلّ/u, /بالماء/u, /رشّ/u, /الإسفنج/u, /يستحم/u, /تهوية/u],
  ],
  ur: [
    [/کال/u, /رابطہ/u, /ایمرجنسی/u, /سپروائزر/u, /اطلاع/u],
    [/لے جائیں/u, /بیمار/u, /ٹھنڈی/u, /سایہ دار/u],
    [/ٹھنڈا/u, /بھگو/u, /پانی/u, /چھڑک/u, /سپنج/u, /نہلا/u, /پنکھا/u],
  ],
  hi: [
    [/कॉल/u, /संपर्क/u, /आपातकालीन/u, /सुपरवाइज़र/u, /सूचित/u],
    [/ले जाएँ/u, /बीमार/u, /ठंडी/u, /छायादार/u],
    [/ठंडा/u, /भिगो/u, /पानी/u, /छिड़क/u, /स्पंज/u, /नहला/u, /पंखा/u],
  ],
  bn: [
    [/কল/u, /যোগাযোগ/u, /জরুরি/u, /সুপারভাইজার/u, /জানান/u],
    [/নিয়ে যান/u, /অসুস্থ/u, /ঠান্ডা/u, /ছায়া/u],
    [/ঠান্ডা/u, /ভিজিয়ে/u, /পানি/u, /ছিটিয়ে/u, /স্পঞ্জ/u, /গোসল/u, /বাতাস/u],
  ],
  ne: [
    [/कल/u, /सम्पर्क/u, /आपत्कालीन/u, /सुपरभाइजर/u, /जानकारी/u],
    [/लैजानुहोस्/u, /बिरामी/u, /चिसो/u, /छायादार/u],
    [/चिसो/u, /भिजाएर/u, /पानी/u, /छर्केर/u, /स्पन्ज/u, /नुहाएर/u, /हावा/u],
  ],
};

/** The word each heading used to say for "words"; none may be in a non-English heading now. */
const WORDS_WORD: Readonly<Record<string, RegExp>> = { ar: /بكلمات|كلمات/u, ur: /الفاظ|لفظ/u, hi: /शब्दों|शब्द/u, bn: /ভাষায়|শব্দ/u, ne: /शब्दमा|शब्द/u };

/** What each language says for "would call" in the demo rows (a conditional: nothing is dialled in the demo). */
const WOULD_CALL: Readonly<Record<string, RegExp>> = { ar: /كان .*سيتصل/u, ur: /ہو جاتی/u, hi: /हो जाती/u, bn: /দিত/u, ne: /थियो/u };

describe("test_steps_keep_the_meaning_and_the_heading_says_according_to_adosh", () => {
  it("every machine draft keeps every concept of its English step (step one keeps the emergency CONTACT number)", () => {
    for (const [locale, steps] of Object.entries(STEP_CONCEPTS)) {
      const written = catalogue(locale).worker.unwell.steps;
      for (const [index, key] of ["one", "two", "three"].entries())
        for (const concept of (steps[index] ?? [])) expect(written[key], `${locale}.${key} ${concept.source}`).toMatch(concept);
    }
  });

  it("the English heading is exactly the architect's; no other language claims to give ADOSH's words", () => {
    expect(catalogue("en").worker.unwell.steps["heading"]).toBe("Heat-stroke first aid, in ADOSH's words");
    for (const [locale, wordsWord] of Object.entries(WORDS_WORD)) {
      const heading = catalogue(locale).worker.unwell.steps["heading"] ?? "";
      expect(heading, locale).not.toMatch(wordsWord);
      expect(heading, locale).toContain("ADOSH");
    }
  });

  it("the demo call rows are conditional in every language (nothing is dialled), never a future 'will call'", () => {
    for (const [locale, would] of Object.entries(WOULD_CALL)) {
      const demo = catalogue(locale).worker.unwell.calls.demo;
      for (const key of ["emergency", "supervisor", "firstAider"]) expect(demo[key], `${locale}.${key}`).toMatch(would);
    }
    for (const key of ["emergency", "supervisor", "firstAider"]) expect(catalogue("ar").worker.unwell.calls.demo[key]).not.toContain("سيتصل هذا");
  });
});

describe("the clinical review label (ADR 0035)", () => {
  it("says Not clinically reviewed while nobody has reviewed it, and never claims a review", () => {
    openIn("ideal");
    expect(screen.getByText("Not clinically reviewed")).toBeVisible();
    expect(screen.queryByText(/Reviewed by/)).not.toBeInTheDocument();
  });

  it("the page itself passes no review: the constant decides (null today)", () => {
    pin(BOTH);
    renderWithIntl(<UnwellView />);
    expect(screen.getByText("Not clinically reviewed")).toBeVisible();
  });

  it("shows the reviewer and date only when a review is recorded, and then drops the not-reviewed label", () => {
    openIn("reviewed");
    // The date sits in a <bdi> (it must not flip inside right-to-left text), so the sentence spans two nodes.
    const label = screen.getByText(/Reviewed by an independent clinical consultant,/);
    expect(label).toHaveTextContent("Reviewed by an independent clinical consultant, 2026-12-01");
    expect(label).toBeVisible();
    expect(screen.queryByText("Not clinically reviewed")).not.toBeInTheDocument();
  });
});

describe("the privacy line", () => {
  it("replaces the old line and tells the worker to call the supervisor", () => {
    openIn("ideal");
    expect(screen.getByText("Nothing you do on this screen is sent to your employer. Call your supervisor now.")).toBeVisible();
    expect(screen.queryByText(/does not see this screen/)).not.toBeInTheDocument();
  });
});

describe("copy rules", () => {
  it("has no em or en dash and no ADR, HANDOFF or B-number jargon in any state", () => {
    for (const state of STATES) {
      const { container, unmount } = openIn(state);
      expect(container.textContent, state).not.toMatch(/[–—]/);
      expect(container.textContent, state).not.toMatch(/ADR \d|HANDOFF|\bB[123]\b/);
      unmount();
      resetSitePinForTests();
    }
  });
});

describe("test_timer_state_never_leaves_the_device", () => {
  /** Every storage write, cookie write, beacon and request the sheet makes while it is open and counting. */
  function watch() {
    const fetchCalls: unknown[] = [];
    vi.stubGlobal("fetch", (...args: unknown[]) => {
      fetchCalls.push(args);
      return Promise.reject(new Error("the unwell sheet must not call fetch"));
    });
    const beacons: unknown[] = [];
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (...args: unknown[]) => beacons.push(args) });
    const requests: unknown[] = [];
    vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation((...args: unknown[]) => {
      requests.push(args);
    });
    const indexedDbOpens: unknown[] = [];
    vi.stubGlobal("indexedDB", { open: (...args: unknown[]) => indexedDbOpens.push(args) });

    const writes: { store: string; key: string }[] = [];
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")?.value as (this: Storage, key: string, value: string) => void;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      writes.push({ store: this === window.sessionStorage ? "session" : this === window.localStorage ? "local" : "other", key });
      original.call(this, key, value);
    });
    const cookies: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => descriptor?.get?.call(document) as string,
      set: (value: string) => {
        cookies.push(value);
      },
    });
    return { fetchCalls, beacons, requests, indexedDbOpens, writes, cookies };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "sendBeacon");
    Reflect.deleteProperty(document, "cookie");
  });

  it("counts, taps through the calls, and makes no request, no cookie, and no write but its own sessionStorage key", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    pin(BOTH);
    const seen = watch();
    renderWithIntl(<UnwellView />);

    await act(async () => {
      vi.advanceTimersByTime(65_000);
      await Promise.resolve();
    });
    expect(screen.getByRole("timer")).toHaveTextContent("1:05");
    // The tap is shown as the clock time, in the site's zone (07:10 UTC is 11:10 in Dubai).
    expect(screen.getByText(/You tapped at/)).toHaveTextContent("You tapped at 11:10");

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /Call your supervisor/ }));
    await user.click(screen.getByRole("button", { name: /Call 998/ }));

    expect(seen.fetchCalls).toEqual([]);
    expect(seen.beacons).toEqual([]);
    expect(seen.requests).toEqual([]);
    expect(seen.indexedDbOpens).toEqual([]);
    expect(seen.cookies).toEqual([]);
    expect(seen.writes.length).toBeGreaterThan(0);
    expect(seen.writes.every((write) => write.store === "session" && write.key === "sb-unwell-t0")).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
    expect(Number(sessionStorage.getItem("sb-unwell-t0"))).toBe(new Date("2026-09-03T07:10:00Z").getTime());
  });

  it("a reload keeps counting from the same tap", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    pin(BOTH);
    const first = renderWithIntl(<UnwellView />);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    first.unmount();

    vi.setSystemTime(new Date("2026-09-03T07:13:00Z"));
    renderWithIntl(<UnwellView />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(screen.getByRole("timer")).toHaveTextContent("3:01");
  });

  it("has no way to send anything: the feature's source has no network, beacon or persistent-storage call", () => {
    const dir = path.resolve(import.meta.dirname, "../../../../src/features/unwell");
    for (const file of ["CallActions.tsx", "ElapsedTimer.tsx", "UnwellView.tsx", "elapsed.ts", "clinical-review.ts"]) {
      const code = readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
        .join("\n");
      expect(code, file).not.toMatch(/\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource|localStorage|indexedDB|document\.cookie|apiClient|useQuery|useMutation|console\./);
    }
  });
});
