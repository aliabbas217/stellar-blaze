import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { QueryProvider, shouldRetryRead } from "@/providers/QueryProvider";

function Probe() {
  const defaults = useQueryClient().getDefaultOptions().queries;
  return <p>{`stale ${String(defaults?.staleTime)} retry ${defaults?.retry === shouldRetryRead ? "one, not after the BFF limit fired" : String(defaults?.retry)}`}</p>;
}

it("renders its children and adds no markup of its own", () => {
  const { container } = render(
    <QueryProvider>
      <main>content</main>
    </QueryProvider>,
  );

  expect(container.innerHTML).toBe("<main>content</main>");
});

it("gives descendants a QueryClient with a 60 s stale time and one retry (behaviour: query-retry.test.tsx)", () => {
  render(
    <QueryProvider>
      <Probe />
    </QueryProvider>,
  );

  expect(screen.getByText("stale 60000 retry one, not after the BFF limit fired")).toBeInTheDocument();
});

it("keeps one QueryClient across re-renders of the provider", () => {
  const seen: unknown[] = [];
  function Capture() {
    seen.push(useQueryClient());
    return null;
  }
  const { rerender } = render(
    <QueryProvider>
      <Capture />
    </QueryProvider>,
  );

  rerender(
    <QueryProvider>
      <Capture />
    </QueryProvider>,
  );

  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(new Set(seen).size).toBe(1);
});
