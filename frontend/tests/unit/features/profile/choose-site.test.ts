import { chooseDeviceSite } from "@/features/profile/choose-site";
import { readSitePin, resetSitePinForTests } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";

/*
 * F2 W2: the site choice loads the profile store with a dynamic import, so it can resolve LATE. A choice that began before the
 * worker took their data back must not pin the phone again after the revoke: the pin is data the revoke removed.
 */

beforeEach(() => {
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null, push: null, profile: null, revokeEpoch: 0 });
});

describe("chooseDeviceSite", () => {
  it("pins the phone to the site and its crew, and says it did", async () => {
    await expect(chooseDeviceSite("site-a", "crew-b")).resolves.toBe(true);
    expect(useProfile.getState().site).toMatchObject({ siteId: "site-a", crewId: "crew-b" });
    expect(readSitePin()).toMatchObject({ siteId: "site-a", crewId: "crew-b" });
  });

  it("a choice that began before a revoke does not bring the pin back after it", async () => {
    await chooseDeviceSite("site-a", "crew-b"); // the store is loaded now: the next call reads its revoke count when it begins
    const late = chooseDeviceSite("site-a", "crew-b");
    // The worker removes their data while the choice is still resolving (revoke() counts itself and clears the pin).
    useProfile.setState({ site: null, revokeEpoch: useProfile.getState().revokeEpoch + 1 });
    await expect(late).resolves.toBe(false);
    expect(useProfile.getState().site).toBeNull();
  });

  it("a choice that begins after a revoke is the worker's new choice and is kept", async () => {
    await chooseDeviceSite("site-a", null);
    useProfile.setState({ site: null, revokeEpoch: useProfile.getState().revokeEpoch + 1 });
    await expect(chooseDeviceSite("site-b", null)).resolves.toBe(true);
    expect(useProfile.getState().site).toMatchObject({ siteId: "site-b" });
  });
});
