import type { CentralTask } from "./central-hypothesis.ts";

function task(
  name: string,
  spec: string,
  source: string,
  referenceSource: string,
  exports: string,
  publicTests: string,
  hiddenTests: string,
): CentralTask {
  const tests = (body: string) =>
    `import { expect, test } from "bun:test";\nimport { ${exports} } from "../src/repair.ts";\n${body}\n`;
  return Object.freeze({
    phase: "discovery",
    features: Object.freeze({ localImport: false, multipleExports: false }),
    task: Object.freeze({
      ref: `luna/${name}@1`,
      split: "development",
      sourcePath: "src/repair.ts",
      editablePaths: Object.freeze(["src/repair.ts"]),
      evaluatorRef: "m3/typescript-refactor-evaluator@1",
      profileRef: "m3/linux-bwrap-bun@1",
      prompt: `${spec} Preserve exported names and signatures. Edit only src/repair.ts. Return a restricted JSON patch artifact.`,
      files: Object.freeze({
        "package.json":
          '{"private":true,"type":"module","scripts":{"test":"bun test"}}',
        "src/repair.ts": source,
        "test/public.test.ts": tests(publicTests),
      }),
    }),
    referenceSource,
    hiddenFiles: Object.freeze({ "test/hidden.test.ts": tests(hiddenTests) }),
  });
}

const parserReference = String.raw`export class RecordParser {
  private field = "";
  private row: string[] = [];
  private rows: string[][] = [];
  private mode: "start" | "plain" | "quoted" | "closed" = "start";
  private skipLf = false;
  private touched = false;
  private ended = false;
  private invalid = false;

  private fail(): never {
    this.invalid = true;
    throw new Error("malformed record");
  }

  private appendField(): void {
    this.row.push(this.field);
    this.field = "";
    this.mode = "start";
  }

  private appendRow(): void {
    this.appendField();
    this.rows.push(this.row);
    this.row = [];
    this.touched = false;
  }

  write(chunk: string): void {
    if (this.invalid) throw new Error("malformed record");
    if (this.ended) throw new Error("parser finished");
    for (const char of chunk) {
      if (this.skipLf) {
        this.skipLf = false;
        if (char === "\n") continue;
      }
      this.touched = true;
      if (this.mode === "quoted") {
        if (char === '"') this.mode = "closed";
        else this.field += char;
        continue;
      }
      if (this.mode === "closed" && char === '"') {
        this.field += '"';
        this.mode = "quoted";
        continue;
      }
      if (char === ",") {
        this.appendField();
        continue;
      }
      if (char === "\r" || char === "\n") {
        this.appendRow();
        this.skipLf = char === "\r";
        continue;
      }
      if (this.mode === "closed") this.fail();
      if (char === '"') {
        if (this.mode !== "start") this.fail();
        this.mode = "quoted";
        continue;
      }
      this.field += char;
      this.mode = "plain";
    }
  }

  finish(): string[][] {
    if (this.invalid) throw new Error("malformed record");
    if (!this.ended) {
      if (this.mode === "quoted") this.fail();
      if (this.touched) this.appendRow();
      this.ended = true;
    }
    return this.rows.map(row => [...row]);
  }
}
`;

const queueReference = `export type Work<T> = () => T | Promise<T>;

export function runQueue<T>(
  jobs: readonly Work<T>[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<T[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return Promise.reject(new Error("invalid concurrency"));
  }
  return new Promise<T[]>((resolve, reject) => {
    const results: T[] = new Array(jobs.length);
    let next = 0;
    let active = 0;
    let stopped = false;
    let settled = false;
    let cause: unknown;

    function stop(reason: unknown): void {
      if (!stopped) {
        stopped = true;
        cause = reason;
      }
    }

    function finishIfReady(): void {
      if (settled || active !== 0) return;
      if (!stopped && next < jobs.length) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      if (stopped) reject(cause);
      else resolve(results);
    }

    function cancel(): void {
      stop(new Error("cancelled"));
      finishIfReady();
    }

    function completed(index: number, ok: boolean, value: unknown): void {
      if (ok) results[index] = value as T;
      else stop(value);
      active -= 1;
      pump();
    }

    function pump(): void {
      while (!stopped && active < concurrency && next < jobs.length) {
        const index = next++;
        const job = jobs[index]!;
        active += 1;
        let pending: T | Promise<T>;
        try {
          pending = job();
        } catch (error) {
          active -= 1;
          stop(error);
          break;
        }
        Promise.resolve(pending).then(
          value => completed(index, true, value),
          error => completed(index, false, error),
        );
      }
      finishIfReady();
    }

    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    pump();
  });
}
`;

const mergeReference = `export type ConfigValue = string | number | boolean | null | ConfigValue[] | Config;
export type Config = { [key: string]: ConfigValue };

function object(value: ConfigValue | undefined): value is Config {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function put(target: Config, key: string, value: ConfigValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function clone(value: ConfigValue): ConfigValue {
  if (Array.isArray(value)) {
    return value.map(item => clone(item));
  }
  if (object(value)) {
    const copy: Config = {};
    for (const key of Object.keys(value)) {
      put(copy, key, clone(value[key]!));
    }
    return copy;
  }
  return value;
}

function apply(base: Config, layer: Config): Config {
  for (const key of Object.keys(layer)) {
    const incoming = layer[key]!;
    if (incoming === null) {
      delete base[key];
      continue;
    }
    if (Array.isArray(incoming)) {
      put(base, key, clone(incoming));
      continue;
    }
    if (object(incoming)) {
      const previous = Object.hasOwn(base, key) ? base[key] : undefined;
      const nested = object(previous) ? previous : {};
      put(base, key, apply(nested, incoming));
      continue;
    }
    put(base, key, incoming);
  }
  return base;
}

export function mergeConfig(layers: readonly Config[]): Config {
  const result: Config = {};
  for (const layer of layers) {
    apply(result, layer);
  }
  return result;
}
`;

const queueHelpers = `
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i=0;i<8;i++) await Promise.resolve(); }
`;

export const lunaLogicTasks: readonly CentralTask[] = Object.freeze([
  task(
    "streaming-records",
    `Repair RecordParser.write(chunk) and finish(). Parse comma-delimited records incrementally. Outside quotes, CR, LF, and CRLF each terminate one record; CRLF is one separator even across writes. Quotes may open only at the beginning of a field; doubled quotes inside a quoted field encode one quote. Quoted fields retain all delimiters and CR/LF literally. After a closing quote only a comma, record separator, doubled quote, or EOF is legal; whitespace is not ignored. Empty input yields []; a blank line yields [""]; a terminal separator adds no extra record. A trailing comma retains the empty last field. Empty writes are no-ops. Malformed characters throw Error("malformed record") immediately, and an unfinished quoted field throws that error at finish; all subsequent calls on a malformed parser throw the same message. finish() is idempotent and returns independent deep copies. Writes after successful finish throw Error("parser finished"). Chunk boundaries must never change parsing.`,
    parserReference
      .replace(
        'if (char === "\\n") continue;',
        'if (char === "\\n") this.appendRow();',
      )
      .replace(
        'this.mode = "quoted";\n        continue;',
        'this.mode = "plain";\n        continue;',
      )
      .replace(
        "if (this.touched) this.appendRow();",
        "if (this.field.length > 0) this.appendRow();",
      )
      .replace("return this.rows.map(row => [...row]);", "return this.rows;"),
    parserReference,
    "RecordParser",
    String.raw`test("basic records and terminal empty field", () => {
      const parser = new RecordParser(); parser.write("a,b\nc,");
      expect(parser.finish()).toEqual([["a","b"],["c",""]]);
    });
    test("quoted delimiter", () => { const p=new RecordParser(); p.write('"a,b",c'); expect(p.finish()).toEqual([["a,b","c"]]); });`,
    String.raw`test("known records at every pair of boundaries", () => {
      const text='"a""b\r\nc",d\r\n,\r\nx,';
      const expected=[['a"b\r\nc','d'],['',''],['x','']];
      for(let a=0;a<=text.length;a++) for(let b=a;b<=text.length;b++) {
        const p=new RecordParser(); p.write(text.slice(0,a)); p.write(""); p.write(text.slice(a,b)); p.write(text.slice(b));
        expect(p.finish()).toEqual(expected);
      }
    });
    test("independent encoded record corpus", () => {
      const values=['','a','a,b','"','\n','\r\n',' a '];
      const encode=(s:string)=>'"'+s.replaceAll('"','""')+'"';
      for(const left of values) for(const right of values) {
        const p=new RecordParser(); for(const c of encode(left)+','+encode(right)+'\r\n') p.write(c);
        expect(p.finish()).toEqual([[left,right]]);
      }
    });
    test("empty input, blank records, malformed and lifecycle", () => {
      for(const [text,expected] of [['',[]],['\n',[['']]],['\r\n',[['']]],['\r\r',[[''],['']]], [',',[['','']]]] as const) {
        const p=new RecordParser(); p.write(text); expect(p.finish()).toEqual(expected);
      }
      for(const bad of ['ab"c','"a"x','"a" ']) {
        const p=new RecordParser(); expect(()=>p.write(bad)).toThrow('malformed record'); expect(()=>p.finish()).toThrow('malformed record'); expect(()=>p.write('')).toThrow('malformed record');
      }
      const bad=new RecordParser(); bad.write('"abc'); expect(()=>bad.finish()).toThrow('malformed record');
      const p=new RecordParser(); p.write('a,b'); const first=p.finish(); first[0]![0]='changed'; first.push([]);
      expect(p.finish()).toEqual([['a','b']]); expect(()=>p.write('')).toThrow('parser finished');
    });`,
  ),
  task(
    "async-work-queue",
    `Repair runQueue(jobs, concurrency, signal?). Jobs are invoked in ascending index order, synchronously when a slot is available (including the initial batch before runQueue returns), with at most concurrency active jobs. A job is active from invocation until its promise fulfillment/rejection handler runs; synchronous throws are observed immediately. On success return results in input order. concurrency must be a positive integer, otherwise return a rejected Promise with Error("invalid concurrency") even for empty input. On the first observed failure or signal abort stop starting jobs, drain all already started jobs, and only then reject. First observed terminal cause wins: preserve the exact thrown/rejected value, including undefined; abort uses a new Error("cancelled"), ignoring signal.reason. A signal already aborted rejects without invoking any jobs, including for an empty list. Abort during a job invocation also prevents subsequent starts. Already running jobs are not interrupted; their later failures must be handled without replacing the first cause. Empty non-aborted input resolves []. Remove abort listeners on terminal settlement. Inputs are readonly; do not mutate jobs.`,
    queueReference
      .replace("results[index] = value as T;", "results.push(value as T);")
      .replace(
        "if (settled || active !== 0) return;",
        "if (settled || (!stopped && active !== 0)) return;",
      )
      .replace("if (!stopped) {", "if (reason !== undefined) {")
      .replace(
        "if (signal?.aborted) cancel();",
        "// Abort listeners handle future cancellation.",
      ),
    queueReference,
    "runQueue",
    queueHelpers +
      `test("input ordering despite completion order", async () => {
      const a=deferred<number>(), b=deferred<number>(); const started:number[]=[];
      const result=runQueue([()=>{started.push(0);return a.promise},()=>{started.push(1);return b.promise}],2);
      expect(started).toEqual([0,1]); b.resolve(20); await flush(); a.resolve(10);
      expect(await result).toEqual([10,20]);
    });
    test("validation", async()=>{await expect(runQueue([],0)).rejects.toThrow('invalid concurrency');expect(await runQueue([],1)).toEqual([]);});`,
    queueHelpers +
      `test("bounded refill and exact ordering", async()=> {
      const ds=Array.from({length:5},()=>deferred<number>()), starts:number[]=[];
      const result=runQueue(ds.map((d,i)=>()=>{starts.push(i);return d.promise}),2);
      expect(starts).toEqual([0,1]); ds[1]!.resolve(11); await flush(); expect(starts).toEqual([0,1,2]);
      ds[2]!.resolve(12); await flush(); expect(starts).toEqual([0,1,2,3]);
      ds[0]!.resolve(10); await flush(); expect(starts).toEqual([0,1,2,3,4]);
      ds[4]!.resolve(14); ds[3]!.resolve(13); expect(await result).toEqual([10,11,12,13,14]);
    });
    test("failure drains and preserves undefined", async()=>{
      const a=deferred<number>(),b=deferred<number>(); let third=false, settled=false;
      const result=runQueue([()=>a.promise,()=>b.promise,()=>{third=true;return 3}],2);
      const outcome=result.then(v=>({ok:true,value:v}),reason=>({ok:false,reason})); void outcome.then(()=>{settled=true});
      a.reject(undefined); await flush(); expect(settled).toBe(false); expect(third).toBe(false);
      b.reject('later'); expect(await outcome).toEqual({ok:false,reason:undefined});
    });
    test("abort drains, failure vs abort uses first observation", async()=>{
      for(const abortFirst of [false,true]) {
        const controller=new AbortController(), a=deferred<number>(), b=deferred<number>(); let third=false, settled=false;
        const p=runQueue([()=>a.promise,()=>b.promise,()=>{third=true;return 1}],2,controller.signal);
        const caught=p.then(()=>null,e=>e); void caught.then(()=>{settled=true});
        if(abortFirst) controller.abort('ignored');
        a.reject('first failure'); await flush();
        if(!abortFirst) controller.abort();
        expect(settled).toBe(false); expect(third).toBe(false); b.resolve(1);
        const reason=await caught; if(abortFirst) expect(reason.message).toBe('cancelled'); else expect(reason).toBe('first failure');
      }
    });
    test("pre-abort, synchronous throw and in-invocation abort",async()=>{
      const c=new AbortController(); c.abort(); let starts=0;
      await expect(runQueue([()=>++starts],2,c.signal)).rejects.toThrow('cancelled'); expect(starts).toBe(0);
      await expect(runQueue([],1,c.signal)).rejects.toThrow('cancelled');
      const failure={exact:true}; const caught=await runQueue([()=>{throw failure},()=>++starts],2).catch(e=>e); expect(caught).toBe(failure); expect(starts).toBe(0);
      const d=new AbortController(); const held=deferred<number>(); const p=runQueue([()=>{d.abort();return held.promise},()=>++starts],2,d.signal); const handled=p.catch(e=>e); held.resolve(1); expect((await handled).message).toBe('cancelled'); expect(starts).toBe(0);
      for(const n of [-1,0,1.5,NaN,Infinity]) await expect(runQueue([],n)).rejects.toThrow('invalid concurrency');
    });`,
  ),
  task(
    "layered-config",
    `Repair mergeConfig(layers). Inputs are finite acyclic JSON-like data: finite numbers, strings, booleans, null, arrays, and plain objects with own enumerable string keys (including __proto__, constructor, and toString). Layers are objects. Fold left to right into a fresh plain object. An object member whose incoming value is null deletes that key if present. An incoming object recursively merges with the previous object or an empty object if the previous value is missing, primitive, or array. Arrays replace the entire previous value and are deeply cloned as literal data: null values and object members equal to null inside arrays must be preserved, not treated as deletion directives. Other values replace. Empty objects preserve a previous object's members, or replace a non-object with {}. Inherited members are never merge input or previous values; special names must become ordinary own data properties without affecting prototypes. Never mutate input and share no array/object references with any input or between distinct output branches, even if the input reuses references. Repeated calls yield independent outputs.`,
    mergeReference
      .replace(
        "return value.map(item => clone(item));",
        "return value.slice();",
      )
      .replace("delete base[key];", "put(base, key, null);")
      .replace(
        "const nested = object(previous) ? previous : {};",
        "const nested = object(previous) ? previous : incoming;",
      ),
    mergeReference,
    "mergeConfig",
    `test("nested override and deletion",()=>{
      expect(mergeConfig([{db:{host:'local',port:12},debug:true},{db:{port:13},debug:null}])).toEqual({db:{host:'local',port:13}});
    });
    test("array replacement",()=>{expect(mergeConfig([{xs:[1,2]},{xs:[3]}])).toEqual({xs:[3]});});`,
    `test("literal arrays and deletion when object replaces scalar",()=>{
      const input={x:[{keep:null,deep:[1]}]}; const out=mergeConfig([input]);
      expect(out).toEqual(input); (out.x as any)[0].deep.push(2); expect(input.x[0]!.deep).toEqual([1]);
      const layer={x:{remove:null,keep:{yes:1}}};
      expect(mergeConfig([{x:4},layer])).toEqual({x:{keep:{yes:1}}}); expect(layer.x.remove).toBeNull();
      expect(mergeConfig([{x:{a:1}},{x:[]},{x:{b:null}}])).toEqual({x:{}});
    });
    test("special names and alias independence",()=>{
      const special=JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{"y":2}},"toString":3}');
      const out=mergeConfig([special]); expect(Object.getPrototypeOf(out)).toBe(Object.prototype); expect(Object.hasOwn(out,'__proto__')).toBe(true); expect(out).toEqual(special);
      const shared={nested:[{x:1}]}; const input={a:shared,b:shared}; const result=mergeConfig([input]);
      (result.a as any).nested[0].x=7; expect((result.b as any).nested[0].x).toBe(1); expect(shared.nested[0]!.x).toBe(1);
      expect(mergeConfig([special,{__proto__:null}])).toEqual(special);
      const deleted=mergeConfig([special,JSON.parse('{"__proto__":null,"constructor":null}')]); expect(deleted).toEqual({toString:3});
    });
    test("independent path-based oracle over deterministic layers",()=>{
      const atom=[0,false,'x',null,[],[null,{literal:null}],{}, {a:1}, {a:null,b:{c:2}}];
      const oracle=(layers:any[])=>{
        const result:any={};
        function visit(dst:any,src:any){for(const k of Object.keys(src)){
          const v=src[k]; if(v===null){delete dst[k];continue}
          if(typeof v==='object'&&!Array.isArray(v)){
            if(!Object.hasOwn(dst,k)||dst[k]===null||typeof dst[k]!=='object'||Array.isArray(dst[k])) Object.defineProperty(dst,k,{value:{},enumerable:true,writable:true,configurable:true});
            visit(dst[k],v);
          }else Object.defineProperty(dst,k,{value:JSON.parse(JSON.stringify(v)),enumerable:true,writable:true,configurable:true});
        }}
        for(const layer of layers)visit(result,layer); return result;
      };
      for(const a of atom)for(const b of atom)for(const c of atom){
        const layers=[{x:a,y:{keep:1}},{x:b},{x:c,y:{keep:null,last:2}}]; const before=JSON.stringify(layers);
        expect(mergeConfig(layers)).toEqual(oracle(layers)); expect(JSON.stringify(layers)).toBe(before);
      }
    });`,
  ),
]);
