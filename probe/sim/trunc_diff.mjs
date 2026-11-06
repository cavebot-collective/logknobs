import { readFileSync } from "node:fs";
import { render } from "./simulator.mjs";
const sw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rec = subj => ({ H:"0",h:"0",T:"0",t:"0",P:[],p:[],author:{name:"A",email:"a@x",ts:0,tz:"+0000"},
  committer:{name:"C",email:"c@x",ts:0,tz:"+0000"},encoding:"",message:subj+"\n",host:{} });
let pass=0, fails=[];
for (const v of sw.vectors) {
  const want=Buffer.from(v.stdout_hex,"hex").toString("utf8");
  const got=render(v.fmt,rec(v.subject),{color:"never"}).text+"\n";
  if(want===got)pass++; else fails.push({n:v.name,want,got});
}
console.log(`trunc sweep (held-out): ${pass}/${sw.vectors.length} exact`);
const byMode={}; for(const f of fails){const k=f.n.split("/").slice(0,2).join("/");(byMode[k]=byMode[k]||[]).push(f);}
for(const [k,v] of Object.entries(byMode)) console.log(`  ${String(v.length).padStart(3)}  ${k}`);
for(const f of fails.slice(0,+process.env.N||6)){console.log(`\n${f.n}\n  want ${JSON.stringify(f.want)}\n  got  ${JSON.stringify(f.got)}`);}
