import { readFileSync } from "node:fs";
import path from "node:path";
import { boxOf, clipCoast, parseCoast, parseField } from "@/features/judge/landing/field-data";
import { STATIONS } from "@/features/judge/landing/field-draw";
import { MAX_VERTICES } from "@/features/judge/landing/terrain-math";
import type { DrawMessage, InitMessage, WorkerOut } from "@/features/judge/landing/terrain.worker";

/*
 * The worker module itself, against a fake OffscreenCanvas and a recording fake of the WebGL context (neither exists in jsdom). It
 * proves what a component test with a fake Worker cannot: that the worker REPORTS each way the scene can fail (no context, a
 * program that did not link, a lost context, a thrown error), that it passes the page's right-to-left flag on to the camera, and
 * how many vertices it really sends to the GPU per frame (ADR 0037). It does not prove that a GPU draws a picture: the e2e does.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as unknown;
const grid = parseField(json("public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json"));
const coast = clipCoast(parseCoast(json("public/data/static/coast.json")), boxOf(grid));

const out: WorkerOut[] = [];
Object.defineProperty(self, "postMessage", { value: (message: WorkerOut) => out.push(message), configurable: true, writable: true });
await import("@/features/judge/landing/terrain.worker");
const deliver = (data: InitMessage | DrawMessage): void => {
  (self as unknown as { onmessage: (event: { data: unknown }) => void }).onmessage({ data });
};

const ARRAY = 1;
const ELEMENT = 2;

interface Uploads {
  /** Vertices of each ARRAY_BUFFER upload (3 floats a vertex), in call order. */
  arrays: number[];
  elements: number[];
  draws: number[];
}

function fakeGl(options: { link?: boolean; throwOnClear?: boolean } = {}): { gl: unknown; uploads: Uploads } {
  const uploads: Uploads = { arrays: [], elements: [], draws: [] };
  const bound: Record<number, object | null> = {};
  const impl: Record<string | symbol, unknown> = {
    ARRAY_BUFFER: ARRAY,
    ELEMENT_ARRAY_BUFFER: ELEMENT,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    getProgramParameter: () => options.link ?? true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    bindBuffer: (target: number, buffer: object) => {
      bound[target] = buffer;
    },
    bufferData: (target: number, data: ArrayLike<number>) => {
      if (target === ARRAY) uploads.arrays.push(data.length / 3);
      else uploads.elements.push(data.length);
    },
    drawElements: (_mode: number, count: number) => {
      uploads.draws.push(count);
    },
    clear: () => {
      if (options.throwOnClear === true) throw new Error("GPU process crashed");
    },
  };
  let next = 100;
  const constants = new Map<string, number>();
  const gl = new Proxy(impl, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "string" && /^[A-Z][A-Z0-9_]+$/.test(prop)) {
        if (!constants.has(prop)) constants.set(prop, next++);
        return constants.get(prop);
      }
      return () => undefined;
    },
  });
  return { gl, uploads };
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext: (kind: string) => unknown;
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
}

function fakeCanvas(gl: unknown): FakeCanvas {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    width: 0,
    height: 0,
    getContext: () => gl,
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    fire: (type) => {
      for (const listener of listeners[type] ?? []) listener();
    },
  };
}

const init = (canvas: FakeCanvas, mobile: boolean, rtl: boolean): InitMessage => ({
  type: "init",
  canvas: canvas as unknown as OffscreenCanvas,
  lat: grid.lat,
  lon: grid.lon,
  values: grid.values,
  coast: coast.map((line) => line.map(([lon, lat]) => [lon, lat] as const)),
  mobile,
  rtl,
  stations: [STATIONS.OMAA, STATIONS.OMDB, STATIONS.OMFJ],
});

const draw = (hour: number, width: number, height: number): DrawMessage => ({ type: "draw", hour, azimuth: 0, width, height, dpr: 1, force: true });

beforeEach(() => {
  out.length = 0;
});

describe("the worker reports each way the scene can fail", () => {
  it("test_worker_no_webgl: a canvas with no WebGL context", () => {
    deliver(init(fakeCanvas(null), false, false));
    expect(out).toEqual([{ type: "fail", why: "no WebGL" }]);
  });

  it("test_worker_link_failure: a program that did not link", () => {
    deliver(init(fakeCanvas(fakeGl({ link: false }).gl), false, false));
    expect(out).toEqual([{ type: "fail", why: "program" }]);
  });

  it("test_worker_context_lost: the context is lost after the scene was up", () => {
    const canvas = fakeCanvas(fakeGl().gl);
    deliver(init(canvas, false, false));
    expect(out).toEqual([{ type: "ready" }]);
    canvas.fire("webglcontextlost");
    expect(out.at(-1)).toEqual({ type: "fail", why: "context lost" });
  });

  it("an error while drawing is reported, not swallowed", () => {
    deliver(init(fakeCanvas(fakeGl({ throwOnClear: true }).gl), false, false));
    out.length = 0;
    deliver(draw(14, 1440, 900));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "fail" });
    expect((out[0] as { why: string }).why).toContain("GPU process crashed");
  });
});

describe("the worker draws the real field", () => {
  function frames(mobile: boolean, rtl: boolean, width: number, height: number): { totals: number[]; labels: (readonly [number, number])[][]; drawn: number } {
    const { gl, uploads } = fakeGl();
    deliver(init(fakeCanvas(gl), mobile, rtl));
    out.length = 0;
    uploads.arrays.length = 0;
    const totals: number[] = [];
    const labels: (readonly [number, number])[][] = [];
    for (let hour = 0; hour < 24; hour += 0.25) {
      uploads.arrays.length = 0;
      deliver({ ...draw(hour, width, height), force: true });
      // a frame uploads position, colour, isotherms and coast: the vertices are those of position, isotherms and coast (colour repeats position)
      const [position, , iso, coastVertices] = uploads.arrays;
      totals.push((position ?? 0) + (iso ?? 0) + (coastVertices ?? 0));
      const answer = out.at(-1);
      if (answer?.type === "drawn") labels.push([...answer.labels]);
    }
    return { totals, labels, drawn: out.filter((m) => m.type === "drawn").length };
  }

  it("test_worker_total_vertices_within_budget: terrain, isotherms and coast together, at every quarter hour, as the worker really uploads them", () => {
    const desktop = frames(false, false, 1440, 900);
    const phone = frames(true, false, 390, 360);
    expect(desktop.drawn).toBe(96);
    expect(Math.max(...desktop.totals)).toBeLessThanOrEqual(MAX_VERTICES.desktop);
    expect(Math.max(...phone.totals)).toBeLessThanOrEqual(MAX_VERTICES.phone);
    // non-vacuous: lines are really uploaded on top of the mesh
    expect(Math.max(...desktop.totals)).toBeGreaterThan(4000);
    expect(Math.max(...phone.totals)).toBeGreaterThan(1000);
    // the numbers the ADR 0037 evidence quotes: the worst frame of the day on each device
    process.stdout.write(`REAL VERTEX TOTALS desktop ${String(Math.max(...desktop.totals))} (limit ${String(MAX_VERTICES.desktop)}) phone ${String(Math.max(...phone.totals))} (limit ${String(MAX_VERTICES.phone)})\n`);
  });

  it("test_worker_rtl_mirrors: the airport's screen position is right of the middle left-to-right and left of it right-to-left, by the same distance", () => {
    const ltr = frames(false, false, 1440, 900).labels[0]?.[0];
    const rtl = frames(false, true, 1440, 900).labels[0]?.[0];
    expect(ltr).toBeDefined();
    expect(rtl).toBeDefined();
    expect((ltr?.[0] ?? 0) / 1440).toBeGreaterThan(0.5);
    expect((rtl?.[0] ?? 1440) / 1440).toBeLessThan(0.5);
    // the vertical position does not change with direction
    expect(rtl?.[1]).toBeCloseTo(ltr?.[1] ?? 0, 3);
  });
});
