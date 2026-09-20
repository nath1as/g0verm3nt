import type { TypescriptRefactorTask } from "./typescript-refactor.ts";

export type CentralTask = Readonly<{
  task: TypescriptRefactorTask;
  phase: "discovery" | "assessment" | "reuse";
  hiddenFiles: Readonly<Record<string, string>>;
  features: Readonly<{ localImport: boolean; multipleExports: boolean }>;
  /** Offline qualification oracle; never include this in provider input. */
  referenceSource: string;
}>;

function fixture(input: {
  name: string;
  phase: CentralTask["phase"];
  exports: string[];
  spec: string;
  source: string;
  reference: string;
  publicCases: string;
  hiddenCases: string;
  helper?: string;
}): CentralTask {
  const sourcePath = "src/repair.ts";
  const tests = (cases: string) =>
    `import { expect, test } from "bun:test";\nimport { ${input.exports.join(", ")} } from "../src/repair.ts";\ntest("specified behavior", () => {\n${cases}\n});\n`;
  return Object.freeze({
    phase: input.phase,
    features: Object.freeze({
      localImport: input.helper !== undefined,
      multipleExports: input.exports.length > 1,
    }),
    task: Object.freeze({
      ref: `central/${input.name}@1`,
      split: input.phase === "discovery" ? "development" : "held-out",
      sourcePath,
      editablePaths: Object.freeze([sourcePath]),
      evaluatorRef: "m3/typescript-refactor-evaluator@1",
      profileRef: "m3/linux-bwrap-bun@1",
      prompt: `${input.spec} Preserve exported names and signatures. Edit only ${sourcePath}; helper modules and tests are read-only. Return a restricted JSON patch artifact.`,
      files: Object.freeze({
        "package.json":
          '{"private":true,"type":"module","scripts":{"test":"bun test"}}',
        [sourcePath]: input.source,
        ...(input.helper === undefined
          ? {}
          : { "src/helper.ts": input.helper }),
        "test/public.test.ts": tests(input.publicCases),
      }),
    }),
    hiddenFiles: Object.freeze({
      "test/hidden.test.ts": tests(input.hiddenCases),
    }),
    referenceSource: input.reference,
  });
}

/** Frozen before execution; each phase spans all four declared feature cells. */
export const centralTasks: readonly CentralTask[] = Object.freeze([
  fixture({
    name: "clamp",
    phase: "discovery",
    exports: ["clamp"],
    spec: "Repair clamp(value, a, b): bound a finite number inclusively between the two finite endpoints, even when a > b. Inputs are finite numbers.",
    source:
      "export function clamp(value: number, a: number, b: number): number { return Math.min(b, Math.max(a, value)); }\n",
    reference:
      "export function clamp(value: number, a: number, b: number): number { return Math.min(Math.max(a,b), Math.max(Math.min(a,b), value)); }\n",
    publicCases:
      "expect(clamp(5,0,10)).toBe(5); expect(clamp(5,10,0)).toBe(5);",
    hiddenCases:
      "expect(clamp(-9,4,-2)).toBe(-2); expect(clamp(9,4,-2)).toBe(4); expect(clamp(0,2,2)).toBe(2); expect(clamp(0.5,0,1)).toBe(0.5);",
  }),
  fixture({
    name: "rolling-sum",
    phase: "discovery",
    exports: ["rollingSums", "rollingMeans"],
    spec: "Repair rollingSums and rollingMeans to return one sum/mean for each contiguous full window of positive integer width. Return [] if width exceeds input length. Inputs contain finite numbers; do not mutate them.",
    source:
      "export function rollingSums(xs: number[], width: number): number[] { return xs.slice(0, -width).map((_, i) => xs.slice(i, i + width).reduce((a,b) => a+b,0)); }\nexport function rollingMeans(xs: number[], width: number): number[] { return rollingSums(xs,width).map(x => x / xs.length); }\n",
    reference:
      "export function rollingSums(xs: number[], width: number): number[] { return Array.from({length:Math.max(0,xs.length-width+1)},(_,i)=>xs.slice(i,i+width).reduce((a,b)=>a+b,0)); }\nexport function rollingMeans(xs: number[], width: number): number[] { return rollingSums(xs,width).map(x=>x/width); }\n",
    publicCases:
      "expect(rollingSums([1,2,3],2)).toEqual([3,5]); expect(rollingMeans([1,2,3],2)).toEqual([1.5,2.5]);",
    hiddenCases:
      "const xs=[-2,4,7]; expect(rollingSums(xs,1)).toEqual(xs); expect(rollingMeans(xs,3)).toEqual([3]); expect(rollingSums(xs,4)).toEqual([]); expect(rollingMeans([],1)).toEqual([]); expect(xs).toEqual([-2,4,7]);",
  }),
  fixture({
    name: "decimal-rounding",
    phase: "discovery",
    exports: ["roundToStep"],
    spec: "Repair roundToStep(value, step): round finite value to its closest multiple of positive finite step; ties round away from zero. Inputs avoid floating-point near-ties, except exact binary-representable ties. Normalize a zero result to positive zero. Use the visible helper's tie convention correctly.",
    helper:
      "export function nearestInteger(value: number): number { return Math.round(value); }\n",
    source:
      'import { nearestInteger } from "./helper.ts";\nexport function roundToStep(value: number, step: number): number { return nearestInteger(value / step) * step; }\n',
    reference:
      'import { nearestInteger } from "./helper.ts";\nexport function roundToStep(value: number, step: number): number { const r = Math.sign(value) * nearestInteger(Math.abs(value)/step) * step; return r === 0 ? 0 : r; }\n',
    publicCases:
      "expect(roundToStep(3,2)).toBe(4); expect(roundToStep(-3,2)).toBe(-4);",
    hiddenCases:
      "expect(roundToStep(-1.25,0.5)).toBe(-1.5); expect(roundToStep(1.1,0.5)).toBe(1); expect(Object.is(roundToStep(-0.1,1),0)).toBe(true); expect(roundToStep(-4,2)).toBe(-4);",
  }),
  fixture({
    name: "pagination",
    phase: "discovery",
    exports: ["pageItems", "pageCount"],
    spec: "Repair pagination: pageItems uses one-based positive integer page numbers and positive integer page sizes and returns at most that page's size without mutating input; beyond-last pages return []. pageCount returns the number of pages needed, with zero for empty input. The helper uses an exclusive end index.",
    helper:
      "export function segment<T>(xs: T[], start: number, end: number): T[] { return xs.slice(start,end); }\n",
    source:
      'import { segment } from "./helper.ts";\nexport function pageItems<T>(xs:T[], page:number, size:number):T[] { return segment(xs,page*size,size); }\nexport function pageCount(total:number,size:number):number { return Math.floor(total/size); }\n',
    reference:
      'import { segment } from "./helper.ts";\nexport function pageItems<T>(xs:T[], page:number, size:number):T[] { return segment(xs,(page-1)*size,page*size); }\nexport function pageCount(total:number,size:number):number { return Math.ceil(total/size); }\n',
    publicCases:
      "expect(pageItems([1,2,3,4,5],2,2)).toEqual([3,4]); expect(pageCount(5,2)).toBe(3);",
    hiddenCases:
      "const xs=['a','b','c']; expect(pageItems(xs,1,2)).toEqual(['a','b']); expect(pageItems(xs,2,2)).toEqual(['c']); expect(pageItems(xs,4,2)).toEqual([]); expect(pageCount(0,2)).toBe(0); expect(pageCount(4,2)).toBe(2); expect(xs).toEqual(['a','b','c']);",
  }),
  fixture({
    name: "csv-field",
    phase: "assessment",
    exports: ["csvField"],
    spec: "Repair csvField: encode one CSV field by quoting iff it contains a comma, double quote, CR, or LF. Inside quoted fields double every double quote. Preserve all other characters, including whitespace and empty strings.",
    source:
      "export function csvField(s:string):string { return s.includes(\",\") ? '\"'+s+'\"' : s; }\n",
    reference:
      "export function csvField(s:string):string { return /[,\"\\r\\n]/.test(s) ? '\"'+s.replaceAll('\"','\"\"')+'\"' : s; }\n",
    publicCases:
      'expect(csvField("a,b")).toBe(\'"a,b"\'); expect(csvField(\'a"b\')).toBe(\'"a""b"\');',
    hiddenCases:
      'expect(csvField("a\\nb")).toBe(\'"a\\nb"\'); expect(csvField("\\r")).toBe(\'"\\r"\'); expect(csvField(\'""\')).toBe(\'""""""\'); expect(csvField("")).toBe(""); expect(csvField(" a ")).toBe(" a ");',
  }),
  fixture({
    name: "sorted-median",
    phase: "assessment",
    exports: ["median", "spread"],
    spec: "Repair median and spread for arrays of finite numbers without mutating input. Median is the middle numerically sorted value or mean of the two middle values; spread is maximum minus minimum. Both return null for empty arrays.",
    source:
      "export function median(xs:number[]):number|null { if(!xs.length)return null; xs.sort(); return xs[Math.floor(xs.length/2)]!; }\nexport function spread(xs:number[]):number|null { return xs.length ? xs[xs.length-1]!-xs[0]! : null; }\n",
    reference:
      "export function median(xs:number[]):number|null { if(!xs.length)return null; const sorted=[...xs].sort((a,b)=>a-b); const m=Math.floor(sorted.length/2); return sorted.length%2 ? sorted[m]! : (sorted[m-1]!+sorted[m]!)/2; }\nexport function spread(xs:number[]):number|null { return xs.length ? Math.max(...xs)-Math.min(...xs) : null; }\n",
    publicCases:
      "expect(median([10,2,4])).toBe(4); expect(spread([4,1,3])).toBe(3);",
    hiddenCases:
      "const xs=[8,-1,2,4]; expect(median(xs)).toBe(3); expect(xs).toEqual([8,-1,2,4]); expect(median([])).toBeNull(); expect(spread([])).toBeNull(); expect(spread([7])).toBe(0);",
  }),
  fixture({
    name: "interval-overlap",
    phase: "assessment",
    exports: ["overlapLength"],
    spec: "Repair overlapLength to return the nonnegative length shared by two intervals. Each is given as two finite endpoints, possibly reversed. Touching or disjoint intervals share length zero. Use the helper that orders endpoints.",
    helper:
      "export function ordered(a:number,b:number):[number,number] { return a<=b ? [a,b] : [b,a]; }\n",
    source:
      'import { ordered } from "./helper.ts";\nexport function overlapLength(a:number,b:number,c:number,d:number):number { const [lo,hi]=ordered(a,b); const [otherLo,otherHi]=ordered(c,d); return Math.max(hi,otherHi)-Math.min(lo,otherLo); }\n',
    reference:
      'import { ordered } from "./helper.ts";\nexport function overlapLength(a:number,b:number,c:number,d:number):number { const [lo,hi]=ordered(a,b); const [otherLo,otherHi]=ordered(c,d); return Math.max(0,Math.min(hi,otherHi)-Math.max(lo,otherLo)); }\n',
    publicCases:
      "expect(overlapLength(1,5,3,8)).toBe(2); expect(overlapLength(0,1,3,4)).toBe(0);",
    hiddenCases:
      "expect(overlapLength(5,1,8,3)).toBe(2); expect(overlapLength(0,9,2,4)).toBe(2); expect(overlapLength(-3,-1,-1,0)).toBe(0); expect(overlapLength(2,2,0,4)).toBe(0);",
  }),
  fixture({
    name: "inventory",
    phase: "assessment",
    exports: ["available", "canFulfill"],
    spec: "Repair inventory functions. Rows have sku:string and quantity:nonnegative integer; duplicate SKUs must be summed. available returns the total for the exact case-sensitive SKU, zero if absent. canFulfill aggregates duplicate requested SKUs and returns true iff every requested total is available; empty request succeeds. Do not mutate either input.",
    helper:
      "export type Row={sku:string;quantity:number};\nexport function sameSku(a:string,b:string):boolean { return a===b; }\n",
    source:
      'import { type Row, sameSku } from "./helper.ts";\nexport function available(stock:Row[],sku:string):number { return stock.find(r=>sameSku(r.sku,sku))?.quantity??0; }\nexport function canFulfill(stock:Row[],requests:Row[]):boolean { return requests.every(r=>available(stock,r.sku)>=r.quantity); }\n',
    reference:
      'import { type Row, sameSku } from "./helper.ts";\nexport function available(stock:Row[],sku:string):number { return stock.filter(r=>sameSku(r.sku,sku)).reduce((n,r)=>n+r.quantity,0); }\nexport function canFulfill(stock:Row[],requests:Row[]):boolean { return requests.every(r=>available(stock,r.sku)>=available(requests,r.sku)); }\n',
    publicCases:
      "expect(available([{sku:'a',quantity:2},{sku:'a',quantity:3}],'a')).toBe(5); expect(canFulfill([{sku:'a',quantity:3}],[{sku:'a',quantity:2},{sku:'a',quantity:2}])).toBe(false);",
    hiddenCases:
      "expect(available([{sku:'A',quantity:9}],'a')).toBe(0); expect(canFulfill([],[])).toBe(true); expect(canFulfill([],[{sku:'x',quantity:0}])).toBe(true); expect(canFulfill([{sku:'x',quantity:1},{sku:'x',quantity:2}],[{sku:'x',quantity:3}])).toBe(true);",
  }),
  fixture({
    name: "stable-unique",
    phase: "reuse",
    exports: ["uniqueById"],
    spec: "Repair uniqueById: keep only the first object for each id:string, preserving first-occurrence order and object identity. IDs are arbitrary strings including object-property names. Do not mutate input or objects.",
    source:
      "export function uniqueById<T extends {id:string}>(xs:T[]):T[] { const byId:Record<string,T>={}; for(const x of xs)byId[x.id]=x; return Object.values(byId); }\n",
    reference:
      "export function uniqueById<T extends {id:string}>(xs:T[]):T[] { const seen=new Set<string>(); return xs.filter(x=>{if(seen.has(x.id))return false; seen.add(x.id);return true;}); }\n",
    publicCases:
      "const a={id:'x',value:1}; expect(uniqueById([a,{id:'x',value:2}])).toEqual([a]);",
    hiddenCases:
      "const a={id:'2'},b={id:'1'},c={id:'__proto__'},d={id:'constructor'}; const xs=[a,b,c,d,a]; const out=uniqueById(xs); expect(out).toEqual([a,b,c,d]); expect(out[0]).toBe(a); expect(xs.length).toBe(5); expect(uniqueById([])).toEqual([]);",
  }),
  fixture({
    name: "run-length",
    phase: "reuse",
    exports: ["encodeRuns", "decodeRuns"],
    spec: "Repair run-length encoding over string arrays: encodeRuns emits [value,count] for each consecutive run, preserving order; nonadjacent equal values stay separate. decodeRuns expands each pair in order. Counts are positive integers. Empty input yields empty output; do not mutate inputs.",
    source:
      "export function encodeRuns(xs:string[]):[string,number][] { const counts=new Map<string,number>(); for(const x of xs)counts.set(x,(counts.get(x)??0)+1); return [...counts]; }\nexport function decodeRuns(runs:[string,number][]):string[] { return runs.map(([value])=>value); }\n",
    reference:
      "export function encodeRuns(xs:string[]):[string,number][] { const out:[string,number][]=[]; for(const x of xs){const last=out[out.length-1];if(last&&last[0]===x)last[1]++;else out.push([x,1]);}return out; }\nexport function decodeRuns(runs:[string,number][]):string[] { return runs.flatMap(([value,count])=>Array<string>(count).fill(value)); }\n",
    publicCases:
      "expect(encodeRuns(['a','a','b','a'])).toEqual([['a',2],['b',1],['a',1]]); expect(decodeRuns([['x',2]])).toEqual(['x','x']);",
    hiddenCases:
      "const xs=['','','a','']; expect(decodeRuns(encodeRuns(xs))).toEqual(xs); expect(encodeRuns([])).toEqual([]); expect(decodeRuns([])).toEqual([]); const runs:[string,number][]=[['a',1],['b',3]]; expect(decodeRuns(runs)).toEqual(['a','b','b','b']); expect(runs).toEqual([['a',1],['b',3]]);",
  }),
  fixture({
    name: "query-values",
    phase: "reuse",
    exports: ["queryValues"],
    spec: "Repair queryValues(query,key): parse application/x-www-form-urlencoded query fields separated by &, optional leading ?. Decode both names and values with the helper, preserve repeated matching values in encounter order, split each field only at its first =, and treat a missing = as empty value. Ignore empty fields. Inputs have valid percent escapes. Match decoded keys exactly.",
    helper:
      'export function decode(s:string):string { return decodeURIComponent(s.replaceAll("+"," ")); }\n',
    source:
      'import { decode } from "./helper.ts";\nexport function queryValues(query:string,key:string):string[] { return query.replace(/^\\?/,"").split("&").filter(Boolean).flatMap(field=>{const [k,v]=field.split("="); return k===key?[decode(v??"")]:[];}); }\n',
    reference:
      'import { decode } from "./helper.ts";\nexport function queryValues(query:string,key:string):string[] { return query.replace(/^\\?/,"").split("&").filter(Boolean).flatMap(field=>{const i=field.indexOf("="); const k=i<0?field:field.slice(0,i); const v=i<0?"":field.slice(i+1); return decode(k)===key?[decode(v)]:[];}); }\n',
    publicCases:
      "expect(queryValues('?a=x=y&a=z','a')).toEqual(['x=y','z']); expect(queryValues('first+name=Ada','first name')).toEqual(['Ada']);",
    hiddenCases:
      "expect(queryValues('flag&x=1&flag=','flag')).toEqual(['','']); expect(queryValues('a=%26%3D&a=x+y','a')).toEqual(['&=','x y']); expect(queryValues('&&','')).toEqual([]); expect(queryValues('%61=1&A=2','a')).toEqual(['1']);",
  }),
  fixture({
    name: "expiry",
    phase: "reuse",
    exports: ["isExpired", "remainingSeconds"],
    spec: "Repair expiry functions for a timestamp expressed in milliseconds since epoch, TTL expressed in nonnegative whole seconds, and now in milliseconds. Expiry occurs at createdAt + TTL*1000, inclusive. remainingSeconds is the nonnegative ceiling of remaining milliseconds divided by 1000. now can precede createdAt. Use the helper's unit contract correctly.",
    helper:
      "export function secondsToMilliseconds(seconds:number):number { return seconds*1000; }\n",
    source:
      'import { secondsToMilliseconds } from "./helper.ts";\nexport function isExpired(createdAt:number,ttl:number,now:number):boolean { return now>secondsToMilliseconds(createdAt+ttl); }\nexport function remainingSeconds(createdAt:number,ttl:number,now:number):number { return Math.floor((createdAt+ttl-now)/1000); }\n',
    reference:
      'import { secondsToMilliseconds } from "./helper.ts";\nexport function isExpired(createdAt:number,ttl:number,now:number):boolean { return now>=createdAt+secondsToMilliseconds(ttl); }\nexport function remainingSeconds(createdAt:number,ttl:number,now:number):number { return Math.max(0,Math.ceil((createdAt+secondsToMilliseconds(ttl)-now)/1000)); }\n',
    publicCases:
      "expect(isExpired(10000,2,12000)).toBe(true); expect(remainingSeconds(10000,2,11001)).toBe(1);",
    hiddenCases:
      "expect(isExpired(10000,2,11999)).toBe(false); expect(remainingSeconds(10000,2,15000)).toBe(0); expect(isExpired(10000,0,10000)).toBe(true); expect(remainingSeconds(10000,2,9000)).toBe(3); expect(remainingSeconds(10000,2,10000)).toBe(2);",
  }),
]);
