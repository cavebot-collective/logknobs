import { readFileSync } from "node:fs";
import { render } from "./simulator.mjs";
const sw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rec = body => ({ H:"0", h:"0", T:"0", t:"0", P:[], p:[], author:{name:"A",email:"a@x",ts:0,tz:"+0000"},
  committer:{name:"C",email:"c@x",ts:0,tz:"+0000"}, encoding:"", message:"s\n\n"+body, host:{} });
let pass=0, rows=[];
for (const v of sw.vectors) {
  const want = Buffer.from(v.stdout_hex,"hex").toString("utf8");
  const got = render(v.fmt, rec(v.body), {color:"never"}).text + "\n";
  if (want===got) pass++; else rows.push({name:v.name, want, got});
}
console.log(`wrap sweep: ${pass}/${sw.vectors.length} exact`);
const show = process.argv[3] ? rows.filter(r=>r.name.includes(process.argv[3])) : rows;
for (const r of show.slice(0, +process.env.N||8)) {
  console.log(`\n${r.name}`);
  console.log(`  want ${JSON.stringify(r.want)}`);
  console.log(`  got  ${JSON.stringify(r.got)}`);
}
