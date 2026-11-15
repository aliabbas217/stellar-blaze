import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cameraMatrix,
  heightOf,
  MESH,
  meshFor,
  projectToScreen,
  vertexCount,
  FpsMonitor,
  FPS_FLOOR,
  FPS_WINDOW_MS,
} from "@/features/judge/landing/terrain-math";
import { isothermEach, isothermSegments } from "@/features/judge/landing/field-data";
import { canUpgrade } from "@/features/judge/landing/webgl-support";

/*
 * The terrain scene's pure parts: the vertex budget (ADR 0037: at most 6,000 on a desktop, 1,500 on a phone), the camera, the
 * relief, the frame-rate monitor that gives the scene up for the 2D field, and that the worker is a same-origin module worker.
 */

const SRC = path.resolve(import.meta.dirname, "../../../../../src/features/judge/landing");

describe("the vertex budget", () => {
  it("test_vertex_budget_phone_and_desktop: at most 6,000 vertices on a desktop and 1,500 on a phone", () => {
    expect(vertexCount(meshFor(false))).toBeLessThanOrEqual(6000);
    expect(vertexCount(meshFor(true))).toBeLessThanOrEqual(1500);
    // non-vacuous: the meshes are real (more than a 10 by 10 patch) and the phone one is the smaller
    expect(vertexCount(meshFor(false))).toBeGreaterThan(4000);
    expect(vertexCount(meshFor(true))).toBeGreaterThan(1000);
    expect(vertexCount(MESH.phone)).toBeLessThan(vertexCount(MESH.desktop));
  });

  it("indexes with 16-bit indices (a mesh over 65,535 vertices would need a 32-bit index buffer)", () => {
    expect(vertexCount(MESH.desktop)).toBeLessThan(65_535);
  });
});

describe("the camera and the relief", () => {
  it("raises the surface with the temperature, linearly, 20 degrees at the ground", () => {
    expect(heightOf(20)).toBe(0);
    expect(heightOf(40)).toBeGreaterThan(heightOf(30));
    expect(heightOf(30) - heightOf(20)).toBeCloseTo(heightOf(40) - heightOf(30), 10);
  });

  it("projects the target of the camera inside the screen, and a point to its side to a different place", () => {
    const m = cameraMatrix({ mobile: false, azimuth: 0, aspect: 1.6 });
    const centre = projectToScreen(m, 0, 0.55, 0.1, 1440, 900);
    const side = projectToScreen(m, 1.5, 0.55, 0.1, 1440, 900);
    expect(centre[0]).toBeGreaterThan(0);
    expect(centre[0]).toBeLessThan(1440);
    expect(centre[1]).toBeGreaterThan(0);
    expect(centre[1]).toBeLessThan(900);
    expect(Math.abs(side[0] - centre[0])).toBeGreaterThan(50);
    // the desktop framing puts the scene right of the middle (the copy is on the start side), the phone's is centred
    const phone = cameraMatrix({ mobile: true, azimuth: 0, aspect: 0.46 });
    expect(projectToScreen(phone, 0, 0.55, 0.1, 390, 360)[0]).toBeGreaterThan(100);
    expect(projectToScreen(phone, 0, 0.55, 0.1, 390, 360)[0]).toBeLessThan(290);
  });

  it("is a 4 by 4 column-major matrix of finite numbers for any azimuth", () => {
    for (const azimuth of [0, 0.4, 3]) {
      const m = cameraMatrix({ mobile: false, azimuth, aspect: 1.6 });
      expect(m).toHaveLength(16);
      expect([...m].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("isotherms on the mesh", () => {
  it("reports the level of each segment, so the line sits at the height of its own temperature", () => {
    const nx = 4;
    const nz = 3;
    const values = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = 25.5 + i; // 25.5, 26.5, 27.5, 28.5
    const levels: number[] = [];
    isothermEach(values, nx, nz, 1, (_x1, _y1, _x2, _y2, level) => {
      levels.push(level);
    });
    expect([...new Set(levels)].sort()).toEqual([26, 27, 28]);
    expect(isothermSegments(values, nx, nz, 1).length / 4).toBe(levels.length);
  });
});

describe("the frame-rate monitor", () => {
  it("test_falls_back_when_fps_below_30_for_2s: gives the scene up after 2 s of frames slower than 30 per second (fake clock)", () => {
    expect(FPS_FLOOR).toBe(30);
    expect(FPS_WINDOW_MS).toBe(2000);
    const monitor = new FpsMonitor();
    let now = 1000;
    monitor.tick(now); // first frame: nothing to measure yet
    let gaveUp = false;
    let elapsed = 0;
    while (elapsed < 1900) {
      now += 40; // 25 frames per second
      elapsed += 40;
      gaveUp = monitor.tick(now);
    }
    expect(gaveUp).toBe(false); // 1.9 s is not enough
    for (let i = 0; i < 4 && !gaveUp; i++) {
      now += 40;
      gaveUp = monitor.tick(now);
    }
    expect(gaveUp).toBe(true);
  });

  it("never gives up at 40 frames per second, and a fast frame resets the count", () => {
    const monitor = new FpsMonitor();
    let now = 0;
    monitor.tick(now);
    for (let i = 0; i < 400; i++) {
      now += 25;
      expect(monitor.tick(now)).toBe(false);
    }
    // 1.5 s slow, one fast frame, 1.5 s slow again: never 2 s in a row
    const slow = new FpsMonitor();
    let t = 0;
    slow.tick(t);
    for (let i = 0; i < 37; i++) {
      t += 40;
      expect(slow.tick(t)).toBe(false);
    }
    t += 10;
    expect(slow.tick(t)).toBe(false);
    for (let i = 0; i < 37; i++) {
      t += 40;
      expect(slow.tick(t)).toBe(false);
    }
  });

  it("does not count a pause (a gap of a quarter second or more is not a slow frame)", () => {
    const monitor = new FpsMonitor();
    monitor.tick(0);
    for (const at of [5000, 10_000, 15_000]) expect(monitor.tick(at)).toBe(false);
  });
});

describe("the worker", () => {
  const component = readFileSync(path.join(SRC, "FieldCanvasGL.tsx"), "utf8");

  it("test_worker_is_same_origin_module: started from a URL relative to this module, as a module worker, never from a blob", () => {
    expect(component).toContain('new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" })');
    expect(component).not.toMatch(/blob:|createObjectURL/);
    // the worker file exists and is a module (it imports, and it answers messages)
    const worker = readFileSync(path.join(SRC, "terrain.worker.ts"), "utf8");
    expect(worker).toMatch(/^import /m);
    expect(worker).toContain("onmessage");
  });

  it("test_falls_back_to_2d_without_offscreencanvas: the upgrade is attempted only where OffscreenCanvas, canvas transfer and workers exist, and never with ?static", () => {
    const all = { search: "", hasOffscreenCanvas: true, canTransfer: true, hasWorker: true };
    expect(canUpgrade(all)).toBe(true);
    expect(canUpgrade({ ...all, hasOffscreenCanvas: false })).toBe(false);
    expect(canUpgrade({ ...all, canTransfer: false })).toBe(false);
    expect(canUpgrade({ ...all, hasWorker: false })).toBe(false);
    expect(canUpgrade({ ...all, search: "?static" })).toBe(false);
    expect(canUpgrade({ ...all, search: "?a=1&static" })).toBe(false);
    expect(canUpgrade({ ...all, search: "?staticfoo=1" })).toBe(true);
    // the island asks before it imports the scene, so a browser without them never downloads it
    expect(readFileSync(path.join(SRC, "FieldIsland.tsx"), "utf8")).toContain("canUpgrade(");
  });
});
