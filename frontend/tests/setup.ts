import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/*
 * `waitFor` and the `find*` queries give up after 1000 ms by default. That is a resource assumption, not something these tests
 * assert: on a shared CI runner (jsdom is created once per file, 175 times) one screen test hit 1037 ms and failed for being slow,
 * not for being wrong; the same test passes on a developer machine. A longer ceiling costs nothing when the screen is fast (the
 * wait returns as soon as the condition holds) and a screen that never settles still fails, 5 s later. Latency budgets are the
 * Lighthouse matrix's job (ADR 0069), not these waits. vitest.config.mts raises the test timeout above this so a failing wait
 * reports its own error and not a bare timeout.
 */
configure({ asyncUtilTimeout: 5000 });
