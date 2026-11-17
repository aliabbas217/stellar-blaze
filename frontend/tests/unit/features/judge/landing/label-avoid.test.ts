import { collectObstacles, hidesUnder, obstaclesOf, reapplyAvoidance, refreshAvoidance, type Rect } from "@/features/judge/landing/label-avoid";

/*
 * A station name is never drawn under other text: not under the readout card (it covers up to 90 percent of the map's end side
 * on a short screen) and not under a line of the copy (in right-to-left the map's east side, where Dubai and Fujairah are, faces the
 * copy). The rule is geometric, so it is tested on rectangles; the e2e measures it on the real page.
 */

const card: Rect = { x: 740, y: 195, w: 320, h: 405 };

describe("hidesUnder", () => {
  // a name is centred on its point and sits above it (translate -50% -100%): the box is [x - w/2, y - h] .. [x + w/2, y]
  it("hides a name whose box meets the card, and keeps one clear of it", () => {
    expect(hidesUnder({ x: 900, y: 230, w: 60, h: 24 }, [card])).toBe(true);
    expect(hidesUnder({ x: 705, y: 330, w: 70, h: 24 }, [card])).toBe(true); // half under: still hidden, never half a name
    expect(hidesUnder({ x: 600, y: 330, w: 70, h: 24 }, [card])).toBe(false);
    expect(hidesUnder({ x: 900, y: 150, w: 60, h: 24 }, [card])).toBe(false); // above the card
  });

  it("keeps a small gap: a name that only touches an edge is hidden too", () => {
    expect(hidesUnder({ x: 700, y: 330, w: 70, h: 24 }, [card])).toBe(true); // right edge 735, 5 px short of the card: inside the 8 px margin
    expect(hidesUnder({ x: 690, y: 330, w: 70, h: 24 }, [card])).toBe(false);
  });

  it("hides under any of several obstacles, and keeps all names with none", () => {
    const line: Rect = { x: 515, y: 260, w: 470, h: 50 };
    expect(hidesUnder({ x: 610, y: 300, w: 60, h: 24 }, [card, line])).toBe(true);
    expect(hidesUnder({ x: 610, y: 300, w: 60, h: 24 }, [])).toBe(false);
  });
});

describe("obstaclesOf", () => {
  it("turns page rectangles into stage coordinates and drops empty ones", () => {
    const stage = { left: 100, top: 50 };
    const out = obstaclesOf(stage, [
      { left: 840, top: 245, width: 320, height: 405 },
      { left: 0, top: 0, width: 0, height: 10 },
    ]);
    expect(out).toEqual([{ x: 740, y: 195, w: 320, h: 405 }]);
  });
});

/*
 * Fix round 3, minor 1: the names move with the scene, about 60 times a second. A frame must not read layout (offsetWidth and
 * offsetHeight force one after the `left` and `top` writes) and must not write `visibility` when it has not changed.
 */
describe("a frame of the WebGL scene reads no layout", () => {
  const reads = { w: 0, h: 0 };
  let restore: (() => void)[] = [];

  beforeEach(() => {
    reads.w = 0;
    reads.h = 0;
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        reads.w++;
        return 60;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        reads.h++;
        return 24;
      },
    });
    restore = [
      () => (w === undefined ? Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth") : Object.defineProperty(HTMLElement.prototype, "offsetWidth", w)),
      () => (h === undefined ? Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight") : Object.defineProperty(HTMLElement.prototype, "offsetHeight", h)),
    ];
  });
  afterEach(() => {
    for (const undo of restore) undo();
    document.body.innerHTML = "";
  });

  /** A stage with a hero, a readout card (stubbed rect) and two names; returns the names' container. */
  function page(): { container: HTMLElement; names: HTMLElement[]; visibilityWrites: () => number } {
    document.body.innerHTML = `<section data-landing-hero><div data-field-stage><div data-names></div></div><div data-avoid></div></section>`;
    const stage = document.querySelector("[data-field-stage]") as HTMLElement;
    const card = document.querySelector("[data-avoid]") as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    card.getBoundingClientRect = () => ({ left: 700, top: 200, width: 300, height: 300, right: 1000, bottom: 500, x: 700, y: 200, toJSON: () => ({}) });
    const container = document.querySelector("[data-names]") as HTMLElement;
    const names = [0, 1].map(() => {
      const span = document.createElement("span");
      container.append(span);
      return span;
    });
    let writes = 0;
    for (const span of names) {
      let value = "";
      Object.defineProperty(span.style, "visibility", {
        configurable: true,
        get: () => value,
        set: (v: string) => {
          writes++;
          value = v;
        },
      });
    }
    return { container, names, visibilityWrites: () => writes };
  }

  it("test_frame_reads_no_layout: after one refresh, moving the names 120 times reads no offsetWidth or offsetHeight", () => {
    const { container, names } = page();
    names.forEach((n, i) => {
      n.style.left = `${String(100 + i * 50)}px`;
      n.style.top = "300px";
    });
    refreshAvoidance(container); // the one place layout may be read (the obstacles and the names' sizes)
    expect(reads.w + reads.h).toBeGreaterThan(0);
    reads.w = 0;
    reads.h = 0;
    for (let frame = 0; frame < 120; frame++) {
      names.forEach((n, i) => {
        n.style.left = `${String(100 + i * 50 + frame)}px`;
        n.style.top = "300px";
      });
      reapplyAvoidance(container);
    }
    expect(reads).toEqual({ w: 0, h: 0 });
  });

  it("test_frame_writes_visibility_only_on_a_change: a name that stays clear is never written, one that crosses under the card is hidden once and shown once", () => {
    const { container, names, visibilityWrites } = page();
    const first = names[0] as HTMLElement;
    first.style.top = "300px";
    first.style.left = "100px";
    refreshAvoidance(container);
    const afterRefresh = visibilityWrites();
    for (let frame = 0; frame < 60; frame++) {
      first.style.left = `${String(100 + frame)}px`; // 100 to 159: clear of the card (left edge 700 minus the margin)
      reapplyAvoidance(container);
    }
    expect(visibilityWrites() - afterRefresh).toBe(0);
    first.style.left = "800px";
    reapplyAvoidance(container);
    expect(first.style.visibility).toBe("hidden");
    reapplyAvoidance(container);
    reapplyAvoidance(container);
    first.style.left = "300px";
    reapplyAvoidance(container);
    expect(first.style.visibility).toBe("");
    expect(visibilityWrites() - afterRefresh).toBe(2);
  });
});

/*
 * Fix round 3, minors 2 and 4: what counts as an obstacle. The copy's text lines, the readout card, and every control marked
 * `data-avoid` (the two buttons of the hero and the hook's Proof chip); and Arabic-script lines are taller than the box
 * `Range.getClientRects` reports (the font's content box), because Urdu and Arabic marks and ascenders overshoot it.
 */
describe("collectObstacles", () => {
  const box = (x: number, y: number, w: number, h: number): DOMRect => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) });
  let originalRects: unknown;

  /** `data-rect="x,y,w,h"` is the rectangle jsdom cannot compute; one line per element. */
  function rectOf(el: Element): DOMRect {
    const [x = 0, y = 0, w = 0, h = 0] = (el.getAttribute("data-rect") ?? "0,0,0,0").split(",").map(Number);
    return box(x, y, w, h);
  }

  beforeEach(() => {
    originalRects = Reflect.get(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      writable: true,
      value(this: Range) {
        const owner = this.commonAncestorContainer instanceof Element ? this.commonAncestorContainer : this.commonAncestorContainer.parentElement;
        return owner === null ? [] : [rectOf(owner)];
      },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return rectOf(this);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalRects === undefined) Reflect.deleteProperty(Range.prototype, "getClientRects");
    else Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, writable: true, value: originalRects });
    document.body.innerHTML = "";
  });

  function stage(html: string): HTMLElement {
    document.body.innerHTML = `<section data-landing-hero><div data-field-stage data-rect="0,0,1000,600"></div>${html}</section>`;
    return document.querySelector("[data-field-stage]") as HTMLElement;
  }

  it("test_ctas_and_proof_chip_are_obstacles: a control marked data-avoid is kept clear of, like the card and the copy", () => {
    const hero = stage(`
      <a data-avoid data-rect="40,500,200,48">See the scoreboard</a>
      <a data-avoid data-rect="252,500,180,48">Walk me through it</a>
      <span data-avoid data-rect="300,560,80,28"><button>Proof</button></span>
      <p data-contrast="body" data-rect="40,100,300,24">kicker</p>
      <a data-rect="900,900,10,10">not an obstacle: no data-avoid</a>`);
    const out = collectObstacles(hero);
    expect(out).toContainEqual({ x: 40, y: 500, w: 200, h: 48 });
    expect(out).toContainEqual({ x: 252, y: 500, w: 180, h: 48 });
    expect(out).toContainEqual({ x: 300, y: 560, w: 80, h: 28 });
    expect(out.some((r) => r.y === 900)).toBe(false);
    // a name under the first button is hidden, one clear of everything is not
    expect(hidesUnder({ x: 100, y: 515, w: 60, h: 24 }, out)).toBe(true);
    expect(hidesUnder({ x: 700, y: 300, w: 60, h: 24 }, out)).toBe(false);
  });

  it("test_urdu_ink_overshoot_is_allowed_for: an Arabic-script line is inflated above and below its font box, a Latin line is not", () => {
    const hero = stage(`
      <h1 data-contrast="large" data-rect="515,230,470,50" style="font-size:36px">تقریباً 24 گھنٹے پہلے کی پیش</h1>
      <p data-contrast="body" data-rect="40,300,470,50" style="font-size:36px">Roughly 24 hours ahead</p>`);
    const out = collectObstacles(hero);
    const urdu = out.find((r) => r.x === 515) as Rect;
    const latin = out.find((r) => r.x === 40) as Rect;
    expect(latin).toEqual({ x: 40, y: 300, w: 470, h: 50 });
    expect(urdu.y).toBeLessThan(230);
    expect(urdu.y + urdu.h).toBeGreaterThan(280);
    expect(urdu.y + urdu.h - (230 + 50)).toBeCloseTo(230 - urdu.y, 5); // the same above and below
    expect(230 - urdu.y).toBeGreaterThan(0.1 * 36); // a real allowance (the e2e measures the ink and fails if a line overshoots it)
    expect(230 - urdu.y).toBeLessThan(0.7 * 36); // and not a blanket
    expect(urdu.x).toBe(515); // the overshoot is vertical: the line's width is its own
    expect(urdu.w).toBe(470);
  });

  it("test_no_name_over_the_urdu_h1_ink_band: Urdu heading geometry at 1024 px, a name just above a line's font box is hidden", () => {
    const hero = stage(`<h1 data-contrast="large" data-rect="515,255,470,50" style="font-size:36px">تقریباً 24 گھنٹے پہلے کی پیش</h1>`);
    const out = collectObstacles(hero);
    // a name 12 px above the font box (clear of the 8 px margin the old rule used) sits in the ascender and mark band
    expect(hidesUnder({ x: 610, y: 243, w: 40, h: 22 }, [{ x: 515, y: 255, w: 470, h: 50 }])).toBe(false); // the old rule: the name was kept
    expect(hidesUnder({ x: 610, y: 243, w: 40, h: 22 }, out)).toBe(true); // now it is hidden
  });
});
