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
