import { act, renderHook, waitFor } from "@testing-library/react";
import { PROFILE_STORAGE_KEY, readSitePin, resetSitePinForTests, sameContacts, toE164, toSiteContacts, toSitePin } from "@/features/profile/site-pin";
import { createProfileStore, useProfile, type ProfileEffects } from "@/features/profile/store";
import { clearRevokeIncomplete, endRevokeActivity, readRevokeActive } from "@/features/profile/revoke-marker";
import { useDeviceSite } from "@/features/profile/useDeviceSite";
import * as chooseSite from "@/features/profile/choose-site";
import { contactsOf, useSiteContactsSync } from "@/features/profile/useSiteContactsSync";
import { forgetPendingDelete, readPendingDeletes } from "@/features/push/pending-delete";

/*
 * The site's call numbers on the phone (F2 Task 18): copied to the pin from the site record so the unwell sheet can ring
 * offline after one visit, validated as E.164 (a garbage string never reaches a `tel:` link), and taken back with the pin.
 * The numbers are the SITE's (synthetic on the demo), not personal data.
 */

interface SiteRecord {
  id: string;
  supervisor_phone: string | null;
  first_aider_phone: string | null;
}

const SUPERVISOR = "+12025550143";
const FIRST_AIDER = "+12025550144";
const CONTACTS = { supervisorPhone: SUPERVISOR, firstAiderPhone: FIRST_AIDER };

function fakeEffects(): ProfileEffects {
  return {
    unsubscribe: vi.fn(() => Promise.resolve()),
    deleteRegistration: vi.fn(() => Promise.resolve(true)),
    clearCaches: vi.fn(() => Promise.resolve()),
    clearCacheMetadata: vi.fn(() => Promise.resolve("cleared" as const)),
    deviceDataRemains: vi.fn(() => Promise.resolve(false)),
  };
}

function settle(): void {
  vi.restoreAllMocks();
  for (const id of readPendingDeletes()) forgetPendingDelete(id);
  clearRevokeIncomplete();
  while (readRevokeActive()) endRevokeActivity();
}

beforeEach(() => {
  settle();
  localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null });
});

afterEach(() => {
  settle();
  resetSitePinForTests();
});

describe("toE164", () => {
  it.each([SUPERVISOR, "+971501234567", "+9715012"])("accepts %s", (value) => {
    expect(toE164(value)).toBe(value);
  });

  it.each(["", "tel:+12025550143", "12025550143", "+0123456789", "+1 202 555 0143", "+1202555014x", "+123456", "+1234567890123456", null, undefined, 12025550143])(
    "rejects %j (never offered to tel:)",
    (value) => {
      expect(toE164(value)).toBeNull();
    },
  );
});

describe("toSiteContacts", () => {
  it("accepts both numbers, or null for a number the site has not given", () => {
    expect(toSiteContacts(CONTACTS)).toEqual(CONTACTS);
    expect(toSiteContacts({ supervisorPhone: null, firstAiderPhone: FIRST_AIDER })).toEqual({ supervisorPhone: null, firstAiderPhone: FIRST_AIDER });
    expect(toSiteContacts({ supervisorPhone: null, firstAiderPhone: null })).toEqual({ supervisorPhone: null, firstAiderPhone: null });
  });

  it("reads a number that is not E.164 as null for that field", () => {
    expect(toSiteContacts({ supervisorPhone: "call me", firstAiderPhone: FIRST_AIDER })).toEqual({ supervisorPhone: null, firstAiderPhone: FIRST_AIDER });
  });

  it.each([null, undefined, "x", 4, {}, { supervisorPhone: SUPERVISOR }, { supervisorPhone: 1, firstAiderPhone: null }])(
    "treats %j as never learned (undefined), not as a site with no numbers",
    (value) => {
      expect(toSiteContacts(value)).toBeUndefined();
    },
  );

  it("compares by number", () => {
    expect(sameContacts(CONTACTS, { ...CONTACTS })).toBe(true);
    expect(sameContacts(CONTACTS, { ...CONTACTS, firstAiderPhone: null })).toBe(false);
    expect(sameContacts(undefined, undefined)).toBe(true);
    expect(sameContacts(undefined, CONTACTS)).toBe(false);
  });
});

describe("the pin with contacts", () => {
  it("toSitePin keeps valid contacts and drops contacts of the wrong shape without losing the pin", () => {
    expect(toSitePin({ siteId: "s", crewId: null, contacts: CONTACTS })).toEqual({ siteId: "s", crewId: null, contacts: CONTACTS });
    expect(toSitePin({ siteId: "s", crewId: null, contacts: "no" })).toEqual({ siteId: "s", crewId: null });
  });

  it("chooseSite stores the contacts under sb-profile-v1 and a reload restores them", () => {
    createProfileStore({ effects: fakeEffects() })
      .getState()
      .chooseSite({ siteId: "site-demo-mussafah", crewId: "crew-b", contacts: CONTACTS });
    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}")).toMatchObject({
      state: { site: { siteId: "site-demo-mussafah", crewId: "crew-b", contacts: CONTACTS } },
    });
    expect(createProfileStore({ effects: fakeEffects() }).getState().site?.contacts).toEqual(CONTACTS);
  });

  it("the header-side reader (no store) sees the contacts the store published", () => {
    createProfileStore({ effects: fakeEffects() }).getState().chooseSite({ siteId: "s", crewId: null, contacts: CONTACTS });
    expect(readSitePin()?.contacts).toEqual(CONTACTS);
  });

  it("revoke takes the numbers back with the pin: no digit of either is left in storage", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: "crew-b", contacts: CONTACTS });
    const outcome = await store.getState().revoke();
    expect(outcome.failed).toEqual([]);
    expect(store.getState().site).toBeNull();
    expect(readSitePin()).toBeNull();
    const everything = JSON.stringify(Object.entries(localStorage));
    expect(everything).not.toContain("2025550143");
    expect(everything).not.toContain("2025550144");
  });
});

describe("useDeviceSite.choose", () => {
  it("keeps the stored contacts when the same site is chosen again, and drops them for another site", () => {
    const { result } = renderHook(() => useDeviceSite());
    act(() => {
      result.current.choose("site-a", "crew-b", CONTACTS);
    });
    act(() => {
      result.current.choose("site-a", null);
    });
    expect(result.current.contacts).toEqual(CONTACTS);
    act(() => {
      result.current.choose("site-b", null);
    });
    expect(result.current.contacts).toBeUndefined();
    expect(useProfile.getState().site).toEqual({ siteId: "site-b", crewId: null });
  });
});

describe("useSiteContactsSync", () => {
  const site: SiteRecord = { id: "site-demo-mussafah", supervisor_phone: SUPERVISOR, first_aider_phone: FIRST_AIDER };

  it("contactsOf never offers a value that is not E.164", () => {
    expect(contactsOf({ ...site, supervisor_phone: "javascript:alert(1)", first_aider_phone: null })).toEqual({
      supervisorPhone: null,
      firstAiderPhone: null,
    });
  });

  it("fills the pin's contacts from the site list, for the demo entry on Today (the pin is chosen first, the numbers follow)", async () => {
    useProfile.getState().chooseSite({ siteId: site.id, crewId: "crew-b" });
    renderHook(() => {
      useSiteContactsSync([site]);
    });
    // The profile store is loaded by the first write (choose-site.ts), so the pin follows a moment later.
    await waitFor(() => {
      expect(useProfile.getState().site?.contacts).toMatchObject(CONTACTS);
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: site.id, crewId: "crew-b" });
    expect(readSitePin()?.contacts).toMatchObject(CONTACTS);
    // Dated when written (the sheet says "Numbers saved on ..." when it is offline).
    const savedAt = useProfile.getState().site?.contacts?.savedAt ?? "";
    expect(Date.parse(savedAt)).not.toBeNaN();
    expect(Math.abs(Date.now() - Date.parse(savedAt))).toBeLessThan(60_000);
  });

  it("W2: a phone pinned before the date was recorded gets one (contacts with no savedAt, numbers unchanged), so the offline line can show", async () => {
    useProfile.getState().chooseSite({ siteId: site.id, crewId: "crew-b", contacts: CONTACTS });
    expect(useProfile.getState().site?.contacts?.savedAt).toBeUndefined();
    renderHook(() => {
      useSiteContactsSync([site]);
    });
    await waitFor(() => {
      expect(Date.parse(useProfile.getState().site?.contacts?.savedAt ?? "")).not.toBeNaN();
    });
    expect(useProfile.getState().site?.contacts).toMatchObject(CONTACTS);
    expect(useProfile.getState().site?.crewId).toBe("crew-b");
  });

  it("W2: a date that is there is kept: an unchanged number does not rewrite it on every visit", async () => {
    const savedAt = "2026-11-01T08:00:00.000Z";
    useProfile.getState().chooseSite({ siteId: site.id, crewId: null, contacts: { ...CONTACTS, savedAt } });
    renderHook(() => {
      useSiteContactsSync([site]);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useProfile.getState().site?.contacts?.savedAt).toBe(savedAt);
  });

  it("W2: a store chunk that cannot load does not throw from the background sync (the pin keeps what it had)", async () => {
    useProfile.getState().chooseSite({ siteId: site.id, crewId: null, contacts: CONTACTS });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    vi.spyOn(chooseSite, "chooseDeviceSite").mockRejectedValue(new Error("Loading chunk failed"));
    renderHook(() => {
      useSiteContactsSync([{ ...site, first_aider_phone: null }]);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(useProfile.getState().site?.contacts).toMatchObject(CONTACTS);
  });

  it("refreshes a number the site has changed, and records that a site has none as null (not as unknown)", async () => {
    useProfile.getState().chooseSite({ siteId: site.id, crewId: null, contacts: CONTACTS });
    const { rerender } = renderHook(
      ({ sites }: { sites: SiteRecord[] }) => {
        useSiteContactsSync(sites);
      },
      { initialProps: { sites: [site] } },
    );
    rerender({ sites: [{ ...site, first_aider_phone: null }] });
    await waitFor(() => {
      expect(useProfile.getState().site?.contacts).toMatchObject({ supervisorPhone: SUPERVISOR, firstAiderPhone: null });
    });
  });

  it("does nothing with no pin, with a site list that lacks the pinned site, or while the list is empty (offline keeps what the phone has)", () => {
    renderHook(() => {
      useSiteContactsSync([site]);
    });
    expect(useProfile.getState().site).toBeNull();

    useProfile.getState().chooseSite({ siteId: "site-other", crewId: null, contacts: CONTACTS });
    renderHook(() => {
      useSiteContactsSync([site]);
    });
    renderHook(() => {
      useSiteContactsSync([]);
    });
    expect(useProfile.getState().site).toEqual({ siteId: "site-other", crewId: null, contacts: CONTACTS });
  });
});
