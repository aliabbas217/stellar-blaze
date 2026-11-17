/*
 * IndexedDB fault injection for the Stop outbox tests: wrappers over a REAL (fake-indexeddb) factory that make one thing go wrong
 * while everything else stays real, so a test exercises the outbox's own error handling, not a hand-written fake.
 */

type Factory = Pick<IDBFactory, "open">;

/** A proxy that answers `override` for the properties it names and forwards everything else, with functions bound to the real object. */
export function wrap<T extends object>(target: T, override: (prop: string | symbol, target: T) => unknown): T {
  return new Proxy(target, {
    get(inner, prop) {
      const replaced = override(prop, inner);
      if (replaced !== undefined) return replaced;
      const value: unknown = Reflect.get(inner, prop);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
    },
  });
}

/** A factory over a real one whose stores refuse `get` of the keys `refuse` names (a failed write: every row update reads the row first). */
export function refusingGet(real: IDBFactory, refuse: (key: unknown) => boolean): Factory {
  const store = (target: IDBObjectStore): IDBObjectStore =>
    wrap(target, (prop, inner) =>
      prop === "get"
        ? (key: IDBValidKey) => {
            if (refuse(key)) throw new DOMException("refused", "DataError");
            return inner.get(key);
          }
        : undefined,
    );
  const transaction = (target: IDBTransaction): IDBTransaction =>
    wrap(target, (prop, inner) => (prop === "objectStore" ? (name: string) => store(inner.objectStore(name)) : undefined));
  const database = (target: IDBDatabase): IDBDatabase =>
    wrap(target, (prop, inner) =>
      prop === "transaction" ? (...args: Parameters<IDBDatabase["transaction"]>) => transaction(inner.transaction(...args)) : undefined,
    );
  return { open: (name, version) => wrap(real.open(name, version), (prop, request) => (prop === "result" ? database(request.result) : undefined)) };
}

/** A factory over a real one whose stores refuse `delete` of the keys `refuse` names (a row that cannot be removed after its stop was sent). */
export function refusingDelete(real: IDBFactory, refuse: (key: unknown) => boolean): Factory {
  const store = (target: IDBObjectStore): IDBObjectStore =>
    wrap(target, (prop, inner) =>
      prop === "delete"
        ? (key: IDBValidKey) => {
            if (refuse(key)) throw new DOMException("refused", "DataError");
            return inner.delete(key);
          }
        : undefined,
    );
  const transaction = (target: IDBTransaction): IDBTransaction =>
    wrap(target, (prop, inner) => (prop === "objectStore" ? (name: string) => store(inner.objectStore(name)) : undefined));
  const database = (target: IDBDatabase): IDBDatabase =>
    wrap(target, (prop, inner) =>
      prop === "transaction" ? (...args: Parameters<IDBDatabase["transaction"]>) => transaction(inner.transaction(...args)) : undefined,
    );
  return { open: (name, version) => wrap(real.open(name, version), (prop, request) => (prop === "result" ? database(request.result) : undefined)) };
}

/**
 * A factory over a real one whose `open` succeeds only once `gate` resolves (a slow store): every operation waits for the gate, then runs
 * normally. The gate must open within the outbox's own deadline.
 */
export function gatedOpen(real: IDBFactory, gate: Promise<void>): Factory {
  return {
    open: (name, version) => {
      const request = real.open(name, version);
      return new Proxy(request, {
        set(target, prop, value: unknown) {
          if (prop === "onsuccess" && typeof value === "function") {
            const handler = value as (this: IDBOpenDBRequest, event: Event) => void;
            target.onsuccess = function (event: Event) {
              void gate.then(() => {
                handler.call(target, event);
              });
            };
            return true;
          }
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    },
  };
}

/** Writes a row exactly as given, bypassing `enqueueStop`: a row an earlier build, a damaged store or a changed clock could leave. */
export async function addRawRow(factory: IDBFactory, row: Record<string, unknown>): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("sb-stop-outbox-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("stops", { keyPath: "key", autoIncrement: true });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error("open failed"));
    };
  });
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("stops", "readwrite");
    transaction.objectStore("stops").add(row);
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

/**
 * A factory over a real one that can HOLD one chosen `open`: `hold(n)` arms it, and the n-th open after that waits until `release()` is
 * called (every other open is untouched); `reached` resolves when that open has been REQUESTED, so a test knows the code under test is
 * parked exactly there. It puts a race at a known point: for example "after the sweep read the rows, before it marks them".
 */
export function holdingOpen(real: IDBFactory): {
  readonly factory: Factory;
  readonly hold: (nth: number) => { readonly release: () => void; readonly reached: Promise<void> };
} {
  let remaining = 0;
  let gate: Promise<void> = Promise.resolve();
  let reachedNow: () => void = () => undefined;
  return {
    hold: (nth) => {
      remaining = nth;
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        reachedNow = resolve;
      });
      return { release, reached };
    },
    factory: {
      open: (name, version) => {
        const request = real.open(name, version);
        // Only the outbox's own opens count: anything else on the page that uses IndexedDB must not move the held one.
        if (name !== "sb-stop-outbox-v1") return request;
        remaining -= 1;
        if (remaining !== 0) return request;
        reachedNow();
        const held = gate;
        return new Proxy(request, {
          set(target, prop, value: unknown) {
            if (prop === "onsuccess" && typeof value === "function") {
              const handler = value as (this: IDBOpenDBRequest, event: Event) => void;
              target.onsuccess = function (event: Event) {
                void held.then(() => {
                  handler.call(target, event);
                });
              };
              return true;
            }
            return Reflect.set(target, prop, value);
          },
          get(target, prop) {
            const value: unknown = Reflect.get(target, prop);
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
      },
    },
  };
}
