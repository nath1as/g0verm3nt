import type { TypescriptRefactorTask } from "./typescript-refactor.ts";

type Mutation = Readonly<{ id: string; before: string; after: string }>;
export type RepairDiscoveryTask = Readonly<{
  task: TypescriptRefactorTask;
  referenceSource: string;
  hiddenFiles: Readonly<Record<string, string>>;
  mutants: readonly Readonly<{ id: string; source: string }>[];
  features: Readonly<{ asynchronous: boolean; transactional: boolean }>;
}>;

function fixture(input: {
  name: string;
  exported: string;
  spec: string;
  reference: string;
  mutations: readonly Mutation[];
  publicTests: string;
  hiddenTests: string;
  asynchronous: boolean;
  transactional: boolean;
}): RepairDiscoveryTask {
  const mutate = (source: string, mutation: Mutation) => {
    if (source.split(mutation.before).length !== 2)
      throw new Error(`mutation must match once: ${input.name}/${mutation.id}`);
    return source.replace(mutation.before, mutation.after);
  };
  const suite = (body: string) =>
    `import { expect, test } from "bun:test";\nimport { ${input.exported} } from "../src/repair.ts";\n${body}\n`;
  return {
    task: {
      ref: `repair-discovery/${input.name}@1`,
      split: "development",
      sourcePath: "src/repair.ts",
      editablePaths: ["src/repair.ts"],
      evaluatorRef: "m3/typescript-refactor-evaluator@1",
      profileRef: "m3/linux-bwrap-bun@1",
      prompt: `${input.spec} Preserve exported signatures. Edit only src/repair.ts. Return a restricted JSON patch artifact.`,
      files: {
        "package.json": '{"private":true,"type":"module"}',
        "src/repair.ts": input.mutations.reduce(mutate, input.reference),
        "test/public.test.ts": suite(input.publicTests),
      },
    },
    referenceSource: input.reference,
    hiddenFiles: { "test/hidden.test.ts": suite(input.hiddenTests) },
    mutants: input.mutations.map((mutation) => ({
      id: mutation.id,
      source: mutate(input.reference, mutation),
    })),
    features: {
      asynchronous: input.asynchronous,
      transactional: input.transactional,
    },
  };
}

const transactionReference = `type Change = { key: string; expected: number | null; value: number | null };
export class AtomicTable {
  private data = new Map<string, number>();
  private undo: Map<string, number>[] = [];
  begin(): void { this.undo.push(new Map(this.data)); }
  commit(): void {
    if (!this.undo.length) throw new Error("no transaction");
    this.undo.pop();
  }
  rollback(): void {
    if (!this.undo.length) throw new Error("no transaction");
    this.data = this.undo.pop()!;
  }
  get(key: string): number | null { return this.data.get(key) ?? null; }
  batch(changes: readonly Change[]): void {
    const next = new Map(this.data);
    for (const change of changes) {
      if (change.value !== null && !Number.isSafeInteger(change.value)) throw new Error("value");
      if ((next.get(change.key) ?? null) !== change.expected) throw new Error("conflict");
      if (change.value === null) next.delete(change.key);
      else next.set(change.key, change.value);
    }
    this.data = next;
  }
  snapshot(): [string, number][] {
    return [...this.data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  }
}
`;

const singleFlightReference = `type Flight<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
export class SingleFlight<T> {
  private flights = new Map<string, Flight<T>>();
  run(key: string, load: () => T | Promise<T>): Promise<T> {
    const existing = this.flights.get(key);
    if (existing) return existing.promise;
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const flight = { promise, resolve, reject };
    this.flights.set(key, flight);
    const settle = (ok: boolean, value: unknown) => {
      if (this.flights.get(key) === flight) this.flights.delete(key);
      if (ok) resolve(value as T); else reject(value);
    };
    try { Promise.resolve(load()).then(value => settle(true, value), error => settle(false, error)); }
    catch (error) { settle(false, error); }
    return promise;
  }
  invalidate(key: string): boolean { return this.flights.delete(key); }
  pending(): number { return this.flights.size; }
}
`;

const schedulerReference = `type Job = { id: string; due: number; order: number; work: () => void };
export class TurnScheduler {
  private jobs = new Map<string, Job>();
  private serial = 0;
  private running = false;
  schedule(id: string, due: number, work: () => void): void {
    if (!Number.isFinite(due)) throw new Error("invalid time");
    this.jobs.set(id, { id, due, order: this.serial++, work });
  }
  cancel(id: string): boolean { return this.jobs.delete(id); }
  size(): number { return this.jobs.size; }
  run(now: number): number {
    if (!Number.isFinite(now)) throw new Error("invalid time");
    if (this.running) throw new Error("reentrant run");
    this.running = true;
    let count = 0;
    const ready = [...this.jobs.values()].filter(job => job.due <= now)
      .sort((a, b) => a.due - b.due || a.order - b.order);
    try {
      for (const job of ready) {
        if (this.jobs.get(job.id) !== job) continue;
        this.jobs.delete(job.id);
        count++;
        job.work();
      }
      return count;
    } finally { this.running = false; }
  }
}
`;

const deferred = `function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
}
`;

export const repairDiscoveryTasks: readonly RepairDiscoveryTask[] = [
  fixture({
    name: "nested-atomic-table",
    exported: "AtomicTable",
    asynchronous: false,
    transactional: true,
    spec: "Repair AtomicTable. Keys are arbitrary strings; values are safe integers, null means absence/deletion. batch applies compare-and-set changes sequentially against a private working copy, so repeated keys see earlier writes in the same batch. A mismatched expected value or invalid new value throws and rolls back the whole batch. begin opens a nested savepoint. commit closes only the innermost savepoint and keeps its writes; rollback restores the innermost entry state. An inner commit must remain undoable by an outer rollback. commit/rollback without a savepoint throw. snapshot is a detached list sorted by raw string order. batches also work outside transactions. Inputs are typed as declared; expected is null or a safe integer.",
    reference: transactionReference,
    mutations: [
      {
        id: "partial-batch-leak",
        before: "const next = new Map(this.data);",
        after: "const next = this.data;",
      },
      {
        id: "inner-commit-loses-outer",
        before: "this.undo.pop();",
        after: "this.undo = [];",
      },
      {
        id: "stale-compare-view",
        before: "(next.get(change.key) ?? null)",
        after: "(this.data.get(change.key) ?? null)",
      },
    ],
    publicTests: `test("failed batch is atomic", () => {
      const t=new AtomicTable();
      expect(()=>t.batch([{key:"a",expected:null,value:1},{key:"b",expected:9,value:2}])).toThrow();
      expect(t.snapshot()).toEqual([]);
    });`,
    hiddenTests: `test("nested commits preserve outer rollback", () => {
      const t=new AtomicTable(); t.batch([{key:"x",expected:null,value:4}]);
      t.begin(); t.batch([{key:"x",expected:4,value:5}]); t.begin();
      t.batch([{key:"x",expected:5,value:6}]); t.commit(); expect(t.get("x")).toBe(6);
      t.rollback(); expect(t.get("x")).toBe(4); expect(()=>t.rollback()).toThrow();
    });
    test("sequential compare and atomic rollback", () => {
      const t=new AtomicTable(); t.batch([{key:"a",expected:null,value:1},{key:"a",expected:1,value:2}]);
      expect(t.get("a")).toBe(2);
      expect(()=>t.batch([{key:"a",expected:2,value:3},{key:"z",expected:1,value:0}])).toThrow();
      expect(t.get("a")).toBe(2);
      expect(()=>t.batch([{key:"a",expected:2,value:3},{key:"z",expected:null,value:Infinity}])).toThrow();
      expect(t.get("a")).toBe(2);
    });
    test("savepoint trace and detached state", () => {
      const t=new AtomicTable(); let value:number|null=null; const stack:(number|null)[]=[];
      for(let i=0;i<90;i++) {
        if(i%5===0) {t.begin();stack.push(value);}
        else if(i%5===3) {t.begin();stack.push(value);}
        else if(i%5===4) {if(i%2) {t.commit();stack.pop();} else {t.rollback();value=stack.pop()!;}}
        else {const next=i%3===0?null:i;t.batch([{key:"__proto__",expected:value,value:next}]);value=next;}
        expect(t.get("__proto__")).toBe(value);
      }
      while(stack.length) {t.rollback();value=stack.pop()!;expect(t.get("__proto__")).toBe(value);}
      t.batch([{key:"z",expected:null,value:0},{key:"A",expected:null,value:1}]);
      const snap=t.snapshot(); expect(snap.map(x=>x[0])).toEqual(["A","z"]); snap[0]![1]=99;
      expect(t.get("A")).toBe(1);
    });`,
  }),
  fixture({
    name: "single-flight-invalidation",
    exported: "SingleFlight",
    asynchronous: true,
    transactional: false,
    spec: "Repair SingleFlight<T>. run shares the exact same pending Promise for a key, invoking its loader synchronously only on first registration. Register before invoking the loader so synchronous reentrant run sees the same flight (loaders must not return their own flight promise). A loader may return a value/promise or throw any value; convert throws into rejection without throwing from run. Completed results are never cached. invalidate detaches the current flight and returns whether one existed; it does not cancel or settle its existing callers. A later run may register a replacement. Settlement of an old detached flight must not erase that replacement. Remove the settling flight before notifying callers, even on rejection; preserve exact result/reason including undefined. pending counts current registrations, excluding detached flights. Keys arbitrary strings.",
    reference: singleFlightReference,
    mutations: [
      {
        id: "stale-flight-removes-replacement",
        before:
          "if (this.flights.get(key) === flight) this.flights.delete(key);",
        after: "this.flights.delete(key);",
      },
      {
        id: "synchronous-throw-escapes",
        before: "catch (error) { settle(false, error); }",
        after: "catch (error) { throw error; }",
      },
      {
        id: "late-registration",
        before: "this.flights.set(key, flight);",
        after: "queueMicrotask(() => this.flights.set(key, flight));",
      },
    ],
    publicTests:
      deferred +
      `test("concurrent callers share one load", async () => {
      const f=new SingleFlight<number>(), d=deferred<number>(); let calls=0;
      const a=f.run("a",()=>{calls++;return d.promise;});
      const b=f.run("a",()=>{calls++;return 99;}); expect(b).toBe(a);expect(calls).toBe(1);
      d.resolve(5);expect(await a).toBe(5); expect(f.pending()).toBe(0);
    });`,
    hiddenTests:
      deferred +
      `test("old settlements cannot remove replacements", async () => {
      for(const rejectOld of [false,true]) {
        const f=new SingleFlight<number>(), a=deferred<number>(),b=deferred<number>();
        const old=f.run("x",()=>a.promise); const caught=old.then(v=>v,e=>e);
        expect(f.invalidate("x")).toBe(true);expect(f.invalidate("x")).toBe(false);
        const current=f.run("x",()=>b.promise);
        if(rejectOld) a.reject("old");else a.resolve(1);await caught;
        expect(f.pending()).toBe(1);expect(f.run("x",()=>99)).toBe(current);
        b.resolve(2);expect(await current).toBe(2);expect(f.pending()).toBe(0);
      }
    });
    test("reentry and synchronous exceptions", async () => {
      const f=new SingleFlight<number>();let nested:Promise<number>|undefined;
      const first=f.run("x",()=>{nested=f.run("x",()=>99);return 7;});expect(nested).toBe(first);
      expect(await first).toBe(7);
      let failed!:Promise<number>;expect(()=>{failed=f.run("x",()=>{throw undefined;});}).not.toThrow();
      expect(await failed.then(()=>"success",e=>e)).toBeUndefined();expect(f.pending()).toBe(0);
      expect(await f.run("x",()=>8)).toBe(8);
    });
    test("independent keys and detached caller completion", async () => {
      const f=new SingleFlight<number>();const waits=Array.from({length:12},()=>deferred<number>());
      const calls=waits.map((d,i)=>f.run(String(i),()=>d.promise));expect(f.pending()).toBe(12);
      for(let i=11;i>=0;i--) {if(i%2===0) f.invalidate(String(i)); waits[i]!.resolve(i);expect(await calls[i]).toBe(i);}
      expect(f.pending()).toBe(0);
    });`,
  }),
  fixture({
    name: "reentrant-turn-scheduler",
    exported: "TurnScheduler",
    asynchronous: false,
    transactional: false,
    spec: "Repair TurnScheduler. schedule stores/replaces an arbitrary string ID with a finite due time and synchronous callback; invalid due throws without replacing the old job. Replacement receives a new insertion order. cancel returns whether a job was pending; size counts pending jobs. run(now) requires finite now, snapshots jobs due at or before now, and invokes them in ascending due time then insertion order. A callback may cancel or replace other jobs; skip a captured job if its current registration is no longer that exact job. Newly scheduled/replacement jobs always wait until a later run, even if already due. Remove each job before calling it. If a callback throws, propagate that exact value, retain all not-yet-invoked jobs, and allow subsequent runs. Reentrant run throws before changing state. Return count invoked when all callbacks succeed. There are no timers, promises, or automatic runs.",
    reference: schedulerReference,
    mutations: [
      {
        id: "cancelled-snapshot-executes",
        before: "if (this.jobs.get(job.id) !== job) continue;",
        after: "// Invoke the captured job.",
      },
      {
        id: "exception-latches-running",
        before: "} finally { this.running = false; }",
        after: "} finally { /* running remains set */ }",
      },
      {
        id: "exclusive-deadline",
        before: "job.due <= now",
        after: "job.due < now",
      },
    ],
    publicTests: `test("deadline is inclusive", () => {
      const s=new TurnScheduler();const seen:string[]=[];s.schedule("a",3,()=>seen.push("a"));
      expect(s.run(3)).toBe(1);expect(seen).toEqual(["a"]);
    });`,
    hiddenTests: `test("snapshot respects cancellation and replacement identity", () => {
      const s=new TurnScheduler();const seen:string[]=[];
      s.schedule("a",0,()=>{seen.push("a");s.cancel("b");s.schedule("c",0,()=>seen.push("new"));});
      s.schedule("b",0,()=>seen.push("b"));s.schedule("c",0,()=>seen.push("old"));
      expect(s.run(1)).toBe(1);expect(seen).toEqual(["a"]);expect(s.size()).toBe(1);
      expect(s.run(1)).toBe(1);expect(seen).toEqual(["a","new"]);
    });
    test("throw preserves remaining work and releases guard", () => {
      const s=new TurnScheduler();const reason={fault:1};let done=false;
      s.schedule("a",0,()=>{throw reason;});s.schedule("b",0,()=>{done=true;});
      let caught:unknown;try{s.run(1);}catch(e){caught=e;}expect(caught).toBe(reason);
      expect(s.size()).toBe(1);expect(s.run(1)).toBe(1);expect(done).toBe(true);
    });
    test("ordering, boundaries and reentry", () => {
      const s=new TurnScheduler();const seen:string[]=[];
      s.schedule("a",2,()=>seen.push("a"));s.schedule("b",1,()=>seen.push("b"));
      s.schedule("a",1,()=>{expect(()=>s.run(9)).toThrow("reentrant");seen.push("new-a");});
      expect(()=>s.schedule("a",NaN,()=>seen.push("bad"))).toThrow();
      expect(s.run(0)).toBe(0);expect(s.run(1)).toBe(2);expect(seen).toEqual(["b","new-a"]);
      expect(s.size()).toBe(0);
    });`,
  }),
];
