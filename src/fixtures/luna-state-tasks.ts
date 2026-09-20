import type { CentralTask } from "./central-hypothesis.ts";

function task(
  name: string,
  exported: string,
  spec: string,
  reference: string,
  bugs: readonly [string, string][],
  publicCases: string,
  hiddenCases: string,
): CentralTask {
  let source = reference;
  for (const [before, after] of bugs) {
    if (!source.includes(before))
      throw new Error(`missing fixture mutation: ${name}`);
    source = source.replace(before, after);
  }
  const suite = (cases: string) =>
    `import { expect, test } from "bun:test";\nimport { ${exported} } from "../src/repair.ts";\n${cases}\n`;
  return Object.freeze({
    phase: "discovery",
    features: Object.freeze({ localImport: false, multipleExports: false }),
    referenceSource: reference,
    task: Object.freeze({
      ref: `central/luna-${name}@1`,
      split: "development",
      sourcePath: "src/repair.ts",
      editablePaths: Object.freeze(["src/repair.ts"]),
      evaluatorRef: "m3/typescript-refactor-evaluator@1",
      profileRef: "m3/linux-bwrap-bun@1",
      prompt: `${spec} Preserve exported signatures. Edit only src/repair.ts. Tests are read-only. Return a restricted JSON patch artifact.`,
      files: Object.freeze({
        "package.json":
          '{"private":true,"type":"module","scripts":{"test":"bun test"}}',
        "src/repair.ts": source,
        "test/public.test.ts": suite(publicCases),
      }),
    }),
    hiddenFiles: Object.freeze({ "test/hidden.test.ts": suite(hiddenCases) }),
  });
}

const cacheReference = `
type Entry<T> = { value: T; expires: number };
type Lookup<T> = { hit: false } | { hit: true; value: T };

export class ExpiringLru<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly capacity: number,
    private readonly clock: () => number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error("invalid capacity");
    }
  }

  private purge(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expires <= now) {
        this.entries.delete(key);
      }
    }
  }

  set(key: string, value: T, ttl: number): void {
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error("invalid ttl");
    }
    const now = this.clock();
    this.purge(now);
    this.entries.delete(key);
    if (this.capacity === 0 || ttl === 0) {
      return;
    }
    this.entries.set(key, { value, expires: now + ttl });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  get(key: string): Lookup<T> {
    const now = this.clock();
    this.purge(now);
    const entry = this.entries.get(key);
    if (!entry) return { hit: false };
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { hit: true, value: entry.value };
  }

  peek(key: string): Lookup<T> {
    const now = this.clock();
    this.purge(now);
    const entry = this.entries.get(key);
    if (!entry) return { hit: false };
    return { hit: true, value: entry.value };
  }

  delete(key: string): boolean {
    this.purge(this.clock());
    return this.entries.delete(key);
  }

  keys(): string[] {
    this.purge(this.clock());
    return [...this.entries.keys()];
  }

  size(): number {
    this.purge(this.clock());
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
`;

const replayReference = `
export type Event = { id: string; seq: number; key: string; delta: number };
export type Snapshot = { cursor: number; balances: [string, number][]; events: Event[] };

export class ReplayLedger {
  private cursor = 0;
  private balances = new Map<string, number>();
  private events = new Map<string, Event>();

  constructor(snapshot?: Snapshot) {
    if (snapshot !== undefined) {
      const restored = new ReplayLedger();
      for (const event of snapshot.events) {
        restored.apply(event);
      }
      const expected = restored.snapshot();
      if (JSON.stringify(expected) !== JSON.stringify(snapshot)) {
        throw new Error("invalid snapshot");
      }
      this.cursor = restored.cursor;
      this.balances = new Map(restored.balances);
      this.events = new Map(restored.events);
    }
  }

  private equal(a: Event, b: Event): boolean {
    return a.id === b.id && a.seq === b.seq &&
      a.key === b.key && a.delta === b.delta;
  }

  apply(event: Event): boolean {
    if (typeof event.id !== "string" || typeof event.key !== "string" ||
        !Number.isSafeInteger(event.seq) || event.seq <= 0 ||
        !Number.isSafeInteger(event.delta)) {
      throw new Error("invalid event");
    }
    const prior = this.events.get(event.id);
    if (prior) {
      if (!this.equal(prior, event)) throw new Error("conflicting id");
      return false;
    }
    if (event.seq !== this.cursor + 1) {
      throw new Error("out of order");
    }
    const next = this.balance(event.key) + event.delta;
    if (!Number.isSafeInteger(next)) {
      throw new Error("balance overflow");
    }
    this.events.set(event.id, { ...event });
    this.balances.set(event.key, next);
    this.cursor = event.seq;
    return true;
  }

  balance(key: string): number {
    return this.balances.get(key) ?? 0;
  }

  position(): number {
    return this.cursor;
  }

  snapshot(): Snapshot {
    return {
      cursor: this.cursor,
      balances: [...this.balances].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      events: [...this.events.values()].map(event => ({ ...event })),
    };
  }

  replay(events: readonly Event[]): number {
    let applied = 0;
    for (const event of events) {
      if (this.apply(event)) applied += 1;
    }
    return applied;
  }
}
`;

const allocatorReference = `
export type Reservation = { id: string; start: number; end: number };
export type Range = [number, number];

export class IntervalAllocator {
  private readonly reservations = new Map<string, Reservation>();

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new Error("invalid capacity");
    }
  }

  reserve(id: string, length: number, alignment = 1): Reservation | null {
    if (this.reservations.has(id)) throw new Error("duplicate id");
    if (!Number.isSafeInteger(length) || length <= 0 ||
        !Number.isSafeInteger(alignment) || alignment <= 0) {
      throw new Error("invalid request");
    }
    for (const [lo, hi] of this.freeRanges()) {
      const start = Math.ceil(lo / alignment) * alignment;
      if (start + length <= hi) {
        const reservation = { id, start, end: start + length };
        this.reservations.set(id, reservation);
        return { ...reservation };
      }
    }
    return null;
  }

  cancel(id: string): boolean {
    return this.reservations.delete(id);
  }

  get(id: string): Reservation | null {
    const reservation = this.reservations.get(id);
    return reservation ? { ...reservation } : null;
  }

  list(): Reservation[] {
    return [...this.reservations.values()]
      .sort((a, b) => a.start - b.start)
      .map(reservation => ({ ...reservation }));
  }

  freeRanges(): Range[] {
    const free: Range[] = [];
    let cursor = 0;
    for (const reservation of this.list()) {
      if (cursor < reservation.start) {
        free.push([cursor, reservation.start]);
      }
      cursor = reservation.end;
    }
    if (cursor < this.capacity) {
      free.push([cursor, this.capacity]);
    }
    return free;
  }

  available(): number {
    let total = 0;
    for (const [start, end] of this.freeRanges()) {
      total += end - start;
    }
    return total;
  }

  used(): number {
    return this.capacity - this.available();
  }

  clear(): void {
    this.reservations.clear();
  }
}
`;

export const lunaStateTasks: readonly CentralTask[] = Object.freeze([
  task(
    "lru-ttl",
    "ExpiringLru",
    "Repair ExpiringLru<T>. Capacity is a nonnegative integer; invalid capacity throws. The injected clock returns finite nondecreasing milliseconds. set accepts finite nonnegative TTL milliseconds (invalid TTL throws without modifying state). Entries expire inclusively at write time + TTL; zero TTL deletes any old value and retains nothing. Purge all expired entries before valid operations. A set replaces value and expiry and marks key most recent; successful get marks most recent; peek does not. Evict least-recent live entries to enforce capacity; capacity zero retains nothing. get/peek return {hit:false} on absence and {hit:true,value} even for undefined values. keys returns oldest to newest live keys. delete returns whether a live entry was removed; size counts live entries; clear empties. Keys are arbitrary strings. Returned keys arrays are independent.",
    cacheReference,
    [
      ["entry.expires <= now", "entry.expires < now"],
      [
        "this.entries.delete(key);\n    if (this.capacity",
        "// Existing keys keep their insertion position.\n    if (this.capacity",
      ],
      [
        "this.entries.delete(key);\n    this.entries.set(key, entry);",
        "// Reads leave insertion order unchanged.",
      ],
      ["this.capacity === 0 || ttl === 0", "this.capacity === 0"],
    ],
    `test("reads refresh recency", () => {
    let now = 0; const c = new ExpiringLru<number>(2, () => now);
    c.set("a", 1, 100); c.set("b", 2, 100); c.get("a"); c.set("c", 3, 100);
    expect(c.keys()).toEqual(["a", "c"]);
    now = 100; expect(c.size()).toBe(0);
  });`,
    `test("expiry, replacement and undefined", () => {
    let now = 7; const c = new ExpiringLru<number | undefined>(2, () => now);
    c.set("__proto__", undefined, 3); expect(c.peek("__proto__")).toEqual({hit:true,value:undefined});
    c.set("b", 2, 50); now=8; c.set("__proto__", 4, 100);
    expect(c.keys()).toEqual(["b","__proto__"]); now=58;
    c.set("d", 5, 10); expect(c.keys()).toEqual(["__proto__","d"]);
    expect(() => c.set("__proto__", 9, -1)).toThrow();
    expect(c.peek("__proto__")).toEqual({hit:true,value:4});
    c.set("__proto__", 10, 0); expect(c.delete("__proto__")).toBe(false);
    const z = new ExpiringLru<number>(0, () => now); z.set("x", 1, 50); expect(z.size()).toBe(0);
  });
  test("deterministic operation trace against array oracle", () => {
    let now=0, seed=971; const rnd=()=> (seed=(seed*1664525+1013904223)>>>0);
    const c=new ExpiringLru<number | undefined>(3,()=>now);
    let rows:{key:string,value:number | undefined,end:number}[]=[];
    for(let i=0;i<300;i++) {
      now+=rnd()%3; rows=rows.filter(r=>r.end>now);
      const key=String(rnd()%6), op=rnd()%5;
      if(op===0 || op===1) {
        const ttl=rnd()%11, value=i%4 ? i : undefined;
        c.set(key,value,ttl); rows=rows.filter(r=>r.key!==key);
        if(ttl>0) rows.push({key,value,end:now+ttl});
        if(rows.length>3) rows.shift();
      } else if(op===2 || op===3) {
        const row=rows.find(r=>r.key===key);
        expect(op===2?c.get(key):c.peek(key)).toEqual(row?{hit:true,value:row.value}:{hit:false});
        if(row && op===2) rows=[...rows.filter(r=>r!==row),row];
      } else { expect(c.delete(key)).toBe(rows.some(r=>r.key===key)); rows=rows.filter(r=>r.key!==key); }
      expect(c.keys()).toEqual(rows.map(r=>r.key)); expect(c.size()).toBe(rows.length);
    }
    c.clear(); expect(c.keys()).toEqual([]);
  });`,
  ),
  task(
    "event-replay",
    "ReplayLedger",
    "Repair ReplayLedger. Each event has string id/key and positive safe-integer seq plus safe-integer delta. First unique seq is 1; each new unique event must be exactly cursor+1. An identical redelivery (equal id,seq,key,delta) returns false with no state change regardless of current cursor; conflicting reuse of an id throws. Invalid events, sequence gaps and balance overflow throw atomically. apply returns true for a new event and adds delta to that key (initial balance zero); retain keys whose balance becomes zero. balance of absent key is zero. position is last unique seq. replay processes sequentially and returns unique-event count; if an event throws, earlier successful events remain applied and later ones are not processed. snapshot returns detached {cursor,balances,events}: balances sorted by raw string comparison, events in unique application order. Constructor accepts a valid canonical snapshot (exact shape/order as snapshot returns), reconstructing duplicate knowledge and cursor with no input aliasing; reject inconsistent cursor, balances or event history. Events passed in and snapshots passed out must not alias internal state.",
    replayReference,
    [
      [
        'if (!this.equal(prior, event)) throw new Error("conflicting id");',
        "// Duplicate IDs are already applied.",
      ],
      ["event.seq !== this.cursor + 1", "event.seq <= this.cursor"],
      [
        "this.events.set(event.id, { ...event });",
        "this.events.set(event.id, event);",
      ],
      [
        "events: [...this.events.values()].map(event => ({ ...event })),",
        "events: [...this.events.values()],",
      ],
    ],
    `test("conflict and sequence gap leave state intact", () => {
    const ledger=new ReplayLedger(); const event={id:"a",seq:1,key:"wallet",delta:4};
    expect(ledger.apply(event)).toBe(true); expect(ledger.apply({...event})).toBe(false);
    expect(()=>ledger.apply({...event,delta:5})).toThrow();
    expect(()=>ledger.apply({id:"b",seq:3,key:"wallet",delta:2})).toThrow();
    expect(ledger.balance("wallet")).toBe(4);
  });`,
    `test("all prefix restarts preserve state and deduplication", () => {
    const events=Array.from({length:24},(_,i)=>({id:"e"+i,seq:i+1,key:["z","__proto__","A"][i%3]!,delta:(i%7)-3}));
    const balances=new Map<string,number>(); for(const e of events) balances.set(e.key,(balances.get(e.key)??0)+e.delta);
    for(let prefix=0;prefix<=events.length;prefix++) {
      const first=new ReplayLedger(); first.replay(events.slice(0,prefix));
      const checkpoint=first.snapshot(); const restored=new ReplayLedger(checkpoint);
      if(prefix) { checkpoint.events[0]!.delta=999; checkpoint.balances[0]![1]=999; }
      expect(restored.replay(events)).toBe(events.length-prefix);
      expect(restored.position()).toBe(events.length);
      expect(restored.snapshot().balances).toEqual([...balances].sort(([a],[b])=>a<b?-1:a>b?1:0));
      expect(restored.snapshot().events).toEqual(events);
    }
  });
  test("detached events, snapshots, atomic errors and replay prefix",()=>{
    const l=new ReplayLedger(); const e={id:"x",seq:1,key:"x",delta:8}; l.apply(e); e.delta=99;
    expect(l.apply({id:"x",seq:1,key:"x",delta:8})).toBe(false);
    const s=l.snapshot(); s.events[0]!.key="corrupt"; s.balances[0]![1]=999;
    expect(l.snapshot().events[0]!.key).toBe("x");
    for(const bad of [{id:"x",seq:1,key:"other",delta:8},{id:"bad",seq:0,key:"x",delta:1},{id:"gap",seq:5,key:"x",delta:1}]) {
      const before=l.snapshot(); expect(()=>l.apply(bad)).toThrow(); expect(l.snapshot()).toEqual(before);
    }
    expect(()=>l.replay([{id:"y",seq:2,key:"x",delta:-8},{id:"gap",seq:4,key:"x",delta:2}])).toThrow();
    expect(l.position()).toBe(2); expect(l.snapshot().balances).toEqual([["x",0]]);
    const cp=l.snapshot(); expect(()=>new ReplayLedger({...cp,cursor:9})).toThrow();
    expect(()=>new ReplayLedger({...cp,balances:[]})).toThrow();
    l.apply({id:"max",seq:3,key:"max",delta:Number.MAX_SAFE_INTEGER}); const before=l.snapshot();
    expect(()=>l.apply({id:"overflow",seq:4,key:"max",delta:1})).toThrow(); expect(l.snapshot()).toEqual(before);
  });`,
  ),
  task(
    "interval-allocator",
    "IntervalAllocator",
    "Repair IntervalAllocator over integer half-open capacity [0,capacity). Capacity is a nonnegative safe integer; invalid capacity throws. reserve(id,length,alignment=1) chooses the smallest nonnegative start divisible by positive safe-integer alignment with length contiguous free units. Length must be positive safe integer; invalid requests and duplicate active IDs throw without modification. Return detached {id,start,end} or null when no fit; failed reservations do not consume IDs. IDs are arbitrary strings. cancel returns true once for an active ID, otherwise false; cancelled IDs can be reused. get returns detached reservation or null. list returns detached reservations sorted by start. freeRanges returns all maximal free half-open ranges sorted by start with adjacent free space coalesced, no empty ranges; available counts free units, used counts reserved units. clear releases everything. Mutating any returned object/array must not change internal state.",
    allocatorReference,
    [
      ["Math.ceil(lo / alignment)", "Math.floor(lo / alignment)"],
      ["start + length <= hi", "start + length < hi"],
      ["return { ...reservation };", "return reservation;"],
      [
        "return reservation ? { ...reservation } : null;",
        "return reservation ?? null;",
      ],
    ],
    `test("exact capacity and aligned fragment",()=>{
    const a=new IntervalAllocator(8); expect(a.reserve("all",8)).toEqual({id:"all",start:0,end:8});
    expect(a.cancel("all")).toBe(true); a.reserve("head",3);
    expect(a.reserve("aligned",2,4)).toEqual({id:"aligned",start:4,end:6});
    expect(a.freeRanges()).toEqual([[3,4],[6,8]]);
  });`,
    `test("occupancy oracle and conservation",()=>{
    const n=31,a=new IntervalAllocator(n),cells:(string|null)[]=Array(n).fill(null);
    const active=new Map<string,{id:string,start:number,end:number}>(); let seed=487;
    const rnd=()=>seed=(Math.imul(seed,1103515245)+12345)>>>0;
    for(let i=0;i<250;i++) {
      const id="id"+(rnd()%17);
      if(rnd()%3===0) { expect(a.cancel(id)).toBe(active.delete(id)); for(let j=0;j<n;j++) if(cells[j]===id) cells[j]=null; }
      else {
        const length=1+rnd()%8,align=1+rnd()%6;
        if(active.has(id)) expect(()=>a.reserve(id,length,align)).toThrow();
        else { let start=-1; for(let j=0;j+length<=n;j+=align) if(cells.slice(j,j+length).every(v=>v===null)){start=j;break;}
          const expected=start<0?null:{id,start,end:start+length}; expect(a.reserve(id,length,align)).toEqual(expected);
          if(expected){active.set(id,expected);for(let j=start;j<start+length;j++)cells[j]=id;}
        }
      }
      const free:[number,number][]=[]; for(let j=0;j<n;) { if(cells[j]!==null){j++;continue;} const lo=j;while(j<n&&cells[j]===null)j++;free.push([lo,j]); }
      expect(a.freeRanges()).toEqual(free); expect(a.list()).toEqual([...active.values()].sort((x,y)=>x.start-y.start));
      expect(a.available()).toBe(cells.filter(v=>v===null).length); expect(a.used()+a.available()).toBe(n);
    }
  });
  test("returned values, invalid requests, failed ID reuse",()=>{
    const a=new IntervalAllocator(7); const r=a.reserve("__proto__",2)!; r.end=99;
    const read=a.get("__proto__")!; read.start=88; const listed=a.list(); listed[0]!.end=100;
    expect(a.list()).toEqual([{id:"__proto__",start:0,end:2}]);
    expect(a.reserve("later",8)).toBeNull(); expect(a.reserve("later",5)).toEqual({id:"later",start:2,end:7});
    const before=a.list(); expect(()=>a.reserve("invalid",0)).toThrow(); expect(()=>a.reserve("invalid",1,0)).toThrow(); expect(a.list()).toEqual(before);
    expect(a.cancel("later")).toBe(true); expect(a.cancel("later")).toBe(false); expect(a.freeRanges()).toEqual([[2,7]]);
    a.clear(); expect(a.freeRanges()).toEqual([[0,7]]); expect(new IntervalAllocator(0).reserve("x",1)).toBeNull();
  });`,
  ),
]);
