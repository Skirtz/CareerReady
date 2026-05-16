import { useState, useEffect, useRef } from "react";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const JOB_TYPES = ["Retail","Hardware store","Grocery","Clothing store","Food service","Pharmacy","Other"];
const STAGES = ["Profile","Resume","Job Analysis","Documents","Interview","Summary"];

async function callClaude(sys, user, maxTokens = 1200) {
  const res = await fetch(API_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  return d.content?.[0]?.text || "";
}
async function storeGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
async function storeSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}
function safeJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const s = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  const a = s.match(/\[[\s\S]*\]/);
  if (a) { try { return JSON.parse(a[0]); } catch {} }
  return null;
}
function moveItem(arr, from, to) {
  const a = [...arr];
  const [item] = a.splice(from, 1);
  a.splice(to, 0, item);
  return a;
}

// ── COMPANY KEYWORD MAP ───────────────────────────────────────────────────────
const COMPANY_KEYWORDS = {
  "home depot":["Pro Xtra","lumber","OSHA forklift","power tools","building materials","garden centre","seasonal merchandise","project consultation","special order","SKU"],
  "lowe's":["MyLowe's","MVPs Pro Rewards","appliances","home improvement","millwork","project specialist","install services","tool rental","ProServices"],
  "best buy":["Geek Squad","protection plan","open box","trade-in","tech support","Totaltech","My Best Buy","home theatre","computing"],
  "walmart":["Walmart+","OneTouch","scan & go","general merchandise","grocery","fresh","pharmacy","auto care","pickup & delivery","everyday low price"],
  "target":["RedCard","Cartwheel","Drive Up","Order Pickup","fresh grocery","Style","beauty","team member","GiftCard"],
  "tim hortons":["Tims Rewards","drive-through","baking","fresh brew","double-double","Timbit","mobile order","catering","speed of service"],
  "mcdonald's":["McDonald's app","drive-thru","QSR","speed of service","food safety","order accuracy","crew trainer","Happy Meal","McCafé"],
  "starbucks":["My Starbucks Rewards","barista","espresso","cold brew","mobile order","Peak Hours","drive-through","café standards"],
  "shoppers drug mart":["PC Optimum","loyalty","pharmacy","beauty","cosmetics","post office","health & wellness","OTC"],
  "sobeys":["Scene+","grocery","fresh produce","deli","bakery","flyer","reduced for quick sale","planogram"],
  "loblaws":["PC Optimum","No Name","President's Choice","grocery","self-checkout","click & collect","produce","deli counter"],
  "metro":["Metro&Moi","flyer","grocery","fresh produce","private label","food safety","FIFO","deli"],
  "costco":["membership","bulk","Kirkland Signature","food court","cashier","receipt checker","forklift","pallet","stock rotation"],
  "amazon":["Prime","fulfilment centre","pick and pack","scanner","safety policy","productivity targets"],
};
function getCompanyKeywords(name) {
  if (!name) return [];
  const n = name.toLowerCase();
  for (const [k,v] of Object.entries(COMPANY_KEYWORDS)) { if (n.includes(k)) return v; }
  return [];
}

// ── SUMMARY vs OBJECTIVE DETECTOR ────────────────────────────────────────────
function detectDocType(experience) {
  const filled = (experience||[]).filter(e=>e.role&&e.role.trim()).length;
  return filled >= 2 ? "Summary" : "Objective";
}

// ── ATS SCORE ESTIMATOR (client-side running total) ───────────────────────────
function estimateATSGain(gaps, toggles) {
  if (!gaps||gaps.length===0) return 0;
  return gaps.reduce((acc,g,i)=>{
    if (toggles[i] && g.in_resume!=="Yes") acc += parseInt(g.ats_impact)||5;
    return acc;
  },0);
}

// ── RESUME FRESHNESS TRACKER ──────────────────────────────────────────────────
function FreshnessTracker({ lastSaved }) {
  if (!lastSaved) return null;
  const days = Math.floor((Date.now()-lastSaved)/(1000*60*60*24));
  const months = Math.floor(days/30);
  let status,color,tip;
  if (months<3){status="Fresh";color="green";tip="Looking good — nothing urgent to update.";}
  else if (months<6){status="Due for review";color="amber";tip="Finish a semester or earn a certificate recently? Worth adding.";}
  else{status="Outdated";color="red";tip="Over 6 months old — refresh before applying anywhere.";}
  return (
    <div className={`border rounded-xl p-3 mb-4 ${color==="green"?"bg-emerald-500/10 border-emerald-500/20":color==="amber"?"bg-amber-500/10 border-amber-500/20":"bg-red-500/10 border-red-500/20"}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-slate-300">Resume Freshness</p>
        <Badge color={color==="green"?"green":color==="amber"?"amber":"red"}>{status}</Badge>
      </div>
      <p className="text-xs text-slate-400">{tip}</p>
      <p className="text-xs text-slate-600 mt-1">Last updated: {new Date(lastSaved).toLocaleDateString()}</p>
    </div>
  );
}

// ── LINKEDIN ADVISORY PANEL ───────────────────────────────────────────────────
function LinkedInPanel({ profile, resumeData, onClose }) {
  const [loading,setLoading]=useState(false);
  const [advice,setAdvice]=useState(null);
  const [err,setErr]=useState("");
  const genAdvice=async()=>{
    setLoading(true);setErr("");
    try{
      const rt=resumeData?.rawResume||JSON.stringify(resumeData||{});
      const t=await callClaude(
        `LinkedIn profile advisor for students aged 16-24 applying for first/second jobs. Plain language. Never say "leverage","synergy","dynamic". Return ONLY valid JSON: {"headline":{"now":"example weak headline","should":"stronger headline","why":"1 sentence"},"about":{"now":"bland placeholder","should":"engaging 3-sentence About section","why":"1 sentence"},"skills":{"should":["skill1","skill2","skill3","skill4","skill5"],"why":"1 sentence"},"experience":{"should":"how to phrase their experience on LinkedIn in 1-2 sentences","why":"1 sentence"},"do_today":["action1","action2","action3"],"do_this_week":["action1","action2"],"update_triggers":["trigger1","trigger2","trigger3","trigger4","trigger5","trigger6","trigger7"]}`,
        `Profile:${JSON.stringify(profile)}\nResume:${rt.slice(0,1500)}`,1500);
      setAdvice(safeJSON(t));
    }catch{setErr("Couldn't generate — try again.");}
    setLoading(false);
  };
  return(
    <div className="fixed inset-0 bg-black/70 z-[150] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-center justify-between">
          <div><p className="text-sm font-bold text-slate-100">LinkedIn Advisory</p><p className="text-xs text-slate-400">You make the changes yourself at linkedin.com</p></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">✕</button>
        </div>
        <div className="p-5">
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 mb-4"><p className="text-xs text-indigo-300">⚠️ Advisory only — we don't connect to your LinkedIn. You make all changes yourself.</p></div>
          {!advice?(
            <>
              <p className="text-sm text-slate-300 mb-4">Even for a first retail job, LinkedIn helps. Recruiters look people up before interviews — and a complete profile shows you're serious.</p>
              <Btn onClick={genAdvice} disabled={loading} className="w-full">Generate my LinkedIn plan ✨</Btn>
              {loading&&<Spinner msg="Building your LinkedIn advisory..."/>}
              {err&&<ErrMsg msg={err} onRetry={genAdvice}/>}
            </>
          ):(
            <div className="flex flex-col gap-4">
              {[{s:"Headline",now:advice.headline?.now,should:advice.headline?.should,why:advice.headline?.why},{s:"About / Summary",now:advice.about?.now,should:advice.about?.should,why:advice.about?.why},{s:"Experience",now:"Generic job title, no bullets",should:advice.experience?.should,why:advice.experience?.why}].map((r,i)=>(
                <div key={i} className="border border-slate-700 rounded-xl overflow-hidden">
                  <div className="bg-slate-800/60 px-4 py-2 border-b border-slate-700"><p className="text-xs font-bold text-slate-300">{r.s}</p></div>
                  <div className="p-3 flex flex-col gap-2">
                    <div className="bg-red-500/10 rounded-lg p-2.5"><p className="text-xs text-slate-500 mb-0.5">Probably now:</p><p className="text-xs text-red-300 italic">"{r.now}"</p></div>
                    <div className="bg-emerald-500/10 rounded-lg p-2.5"><p className="text-xs text-slate-500 mb-0.5">Should say:</p><p className="text-xs text-emerald-300">"{r.should}"</p></div>
                    <p className="text-xs text-slate-500">Why: {r.why}</p>
                  </div>
                </div>
              ))}
              {advice.skills&&<div className="border border-slate-700 rounded-xl p-4"><p className="text-xs font-bold text-slate-300 mb-2">Skills to add on LinkedIn</p><div className="flex flex-wrap gap-1.5 mb-2">{(advice.skills.should||[]).map((sk,i)=><span key={i} className="px-2 py-1 bg-indigo-500/15 border border-indigo-500/30 rounded-full text-xs text-indigo-300">{sk}</span>)}</div><p className="text-xs text-slate-500">{advice.skills.why}</p></div>}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4"><p className="text-xs font-bold text-emerald-300 mb-2">✅ Do today (10 min)</p>{(advice.do_today||[]).map((a,i)=><p key={i} className="text-xs text-slate-300 mb-1">• {a}</p>)}</div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4"><p className="text-xs font-bold text-amber-300 mb-2">📅 Do this week</p>{(advice.do_this_week||[]).map((a,i)=><p key={i} className="text-xs text-slate-300 mb-1">• {a}</p>)}</div>
              <div className="border border-slate-700 rounded-xl p-4"><p className="text-xs font-bold text-slate-300 mb-2">🔔 Update your LinkedIn when…</p>{(advice.update_triggers||[]).map((t,i)=><p key={i} className="text-xs text-slate-400 mb-1">• {t}</p>)}</div>
              <Btn variant="secondary" onClick={()=>setAdvice(null)} size="sm">↺ Regenerate</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HIDDEN EXPERIENCE DISCOVERY ───────────────────────────────────────────────
function HiddenExperienceModal({ profile, onAdd, onClose }) {
  const DISCOVERY_QS=[
    {q:"Did you ever help organise something at school — an event, a fundraiser, a sports day?",key:"org"},
    {q:"Have you looked after children, pets, or elderly family members — even casually?",key:"care"},
    {q:"Did you help someone move, build something, fix something, or do yard work for them?",key:"manual"},
    {q:"Have you played a sport or been in a club where you had any kind of leadership role?",key:"lead"},
    {q:"Did you ever sell anything — at school, online, a lemonade stand, anything at all?",key:"sales"},
  ];
  const [answers,setAnswers]=useState({});
  const [loading,setLoading]=useState(false);
  const [results,setResults]=useState(null);
  const answered=Object.keys(answers).length;
  const generate=async()=>{
    const yes=DISCOVERY_QS.filter(q=>answers[q.key]===true);
    if(yes.length===0){onClose();return;}
    setLoading(true);
    try{
      const t=await callClaude(
        `Turn informal activities into professional resume experience entries for a ${profile.age}-year-old applying for ${profile.jobType} work. Sound genuine, not corporate. Never say "leverage". Return ONLY a JSON array: [{"role":"str","where":"str","bullets":["str","str"]}]. One entry per activity.`,
        `Activities confirmed: ${yes.map(q=>q.q).join(" | ")}. Job: ${profile.jobType}. Name: ${profile.name}.`,1200);
      const arr=safeJSON(t);setResults(Array.isArray(arr)?arr:[]);
    }catch{setResults([]);}
    setLoading(false);
  };
  return(
    <div className="fixed inset-0 bg-black/70 z-[150] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-100">🔍 Find hidden experience</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <div className="p-5">
          {!results?(
            <>
              <p className="text-sm text-slate-300 mb-5">A lot of people don't realise they already have experience. Answer honestly — we'll turn your yes answers into resume entries.</p>
              <div className="flex flex-col gap-3 mb-5">
                {DISCOVERY_QS.map(q=>(
                  <div key={q.key} className="border border-slate-700 rounded-xl p-4">
                    <p className="text-sm text-slate-200 mb-3">{q.q}</p>
                    <div className="flex gap-2">
                      <button onClick={()=>setAnswers(a=>({...a,[q.key]:true}))} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${answers[q.key]===true?"bg-emerald-500/20 border-emerald-500 text-emerald-200":"border-slate-600 text-slate-400 hover:border-slate-500"}`}>✓ Yes</button>
                      <button onClick={()=>setAnswers(a=>({...a,[q.key]:false}))} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${answers[q.key]===false?"bg-slate-700 border-slate-500 text-slate-300":"border-slate-600 text-slate-400 hover:border-slate-500"}`}>✗ No</button>
                    </div>
                  </div>
                ))}
              </div>
              <Btn onClick={generate} disabled={loading||answered<DISCOVERY_QS.length} className="w-full">{loading?"Finding your experience...":"Find my experience ✨"}</Btn>
              {loading&&<Spinner msg="Turning your activities into resume entries..."/>}
            </>
          ):results.length===0?(
            <div className="text-center py-8"><p className="text-slate-300 mb-4">No hidden experience found — but that's okay. Your current entries are a solid start.</p><Btn onClick={onClose} variant="secondary">Close</Btn></div>
          ):(
            <>
              <p className="text-sm text-emerald-300 mb-4">Found {results.length} experience {results.length===1?"entry":"entries"} to add:</p>
              {results.map((r,i)=>(
                <div key={i} className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4 mb-3">
                  <p className="text-sm font-semibold text-slate-200 mb-0.5">{r.role}</p>
                  <p className="text-xs text-slate-400 mb-2">{r.where}</p>
                  {(r.bullets||[]).map((b,j)=><p key={j} className="text-xs text-slate-300 mb-1">• {b}</p>)}
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <Btn onClick={()=>{onAdd(results);onClose();}} className="flex-1">Add all to my resume</Btn>
                <Btn variant="secondary" onClick={onClose}>Skip</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, type = "save") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 1800);
  };
  return [toast, show];
}
function Toast({ toast }) {
  if (!toast) return null;
  const colors = { save:"bg-slate-800 border-slate-600 text-slate-200", success:"bg-emerald-900/80 border-emerald-700 text-emerald-200", error:"bg-red-900/80 border-red-700 text-red-200" };
  return (
    <div className={`fixed bottom-5 right-5 z-[200] px-4 py-2.5 rounded-xl border text-xs font-medium shadow-xl transition-all ${colors[toast.type]||colors.save}`}>
      {toast.type==="save"?"✓ Saved":toast.msg}
    </div>
  );
}

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
function Spinner({ msg = "Working..." }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      <p className="text-slate-400 text-sm">{msg}</p>
    </div>
  );
}
function ErrMsg({ msg, onRetry }) {
  return (
    <div className="bg-red-950/80 border border-red-800/60 rounded-xl p-4 flex items-center justify-between gap-3">
      <p className="text-red-300 text-sm">⚠️ {msg || "Something went wrong."}</p>
      {onRetry && <button onClick={onRetry} className="text-xs bg-red-800 hover:bg-red-700 text-red-100 px-3 py-1.5 rounded-lg whitespace-nowrap">Try again</button>}
    </div>
  );
}
function Card({ children, className = "" }) {
  return <div className={`bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 ${className}`}>{children}</div>;
}
function Btn({ children, onClick, disabled, variant = "primary", className = "", size = "md" }) {
  const s = { sm:"px-3 py-1.5 text-xs", md:"px-5 py-2.5 text-sm", lg:"px-7 py-3 text-base" }[size] || "px-5 py-2.5 text-sm";
  const v = {
    primary:"bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20",
    secondary:"bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    ghost:"text-slate-400 hover:text-slate-200 hover:bg-slate-700/50",
    success:"bg-emerald-600 hover:bg-emerald-500 text-white",
    cyan:"bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold shadow-lg shadow-cyan-500/20",
    danger:"bg-red-700 hover:bg-red-600 text-white",
    amber:"bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold",
  }[variant] || "bg-indigo-500 hover:bg-indigo-400 text-white";
  return <button onClick={onClick} disabled={disabled} className={`rounded-xl font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${s} ${v} ${className}`}>{children}</button>;
}
function FInput({ label, value, onChange, onEnter, placeholder, type = "text", helper, required, min, max }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-slate-300">{label}{required && <span className="text-indigo-400 ml-1">*</span>}</label>}
      <input type={type} value={value} min={min} max={max}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter && onEnter()}
        placeholder={placeholder}
        className="bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors text-sm" />
      {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
    </div>
  );
}
function FTextarea({ label, value, onChange, placeholder, rows = 5, helper, showCount }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-slate-300">{label}</label>}
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors text-sm resize-none leading-relaxed" />
      {showCount && <p className={`text-xs mt-0.5 ${value.length > 500 ? "text-emerald-500" : value.length > 100 ? "text-amber-500" : "text-slate-500"}`}>
        {value.length.toLocaleString()} characters{value.length > 500 ? " — good amount ✓" : value.length > 100 ? " — add more for better analysis" : ""}
      </p>}
      {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
    </div>
  );
}
function Badge({ children, color = "indigo" }) {
  const c = { indigo:"bg-indigo-500/15 text-indigo-300 border-indigo-500/30", cyan:"bg-cyan-500/15 text-cyan-300 border-cyan-500/30", green:"bg-emerald-500/15 text-emerald-300 border-emerald-500/30", amber:"bg-amber-500/15 text-amber-300 border-amber-500/30", red:"bg-red-500/15 text-red-300 border-red-500/30", slate:"bg-slate-700/50 text-slate-400 border-slate-600" }[color] || "";
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${c}`}>{children}</span>;
}
function Tabs({ tabs, active, onSelect, disabled = [] }) {
  return (
    <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1 border border-slate-700/50">
      {tabs.map(t => {
        const isDisabled = disabled.includes(t);
        return (
          <button key={t} onClick={() => !isDisabled && onSelect(t)} disabled={isDisabled}
            title={isDisabled ? "Generate resume first" : undefined}
            className={`flex-1 py-2 px-1 rounded-lg text-xs font-semibold transition-all ${active===t?"bg-indigo-500 text-white shadow":isDisabled?"text-slate-600 cursor-not-allowed":"text-slate-400 hover:text-slate-200"}`}>{t}</button>
        );
      })}
    </div>
  );
}
// Render resume plain text as formatted document instead of code block
function ResumeDoc({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 font-sans text-sm leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        // ALL CAPS header lines (section titles)
        if (/^[A-Z][A-Z\s&\/]{3,}$/.test(trimmed) || /^-{3,}$/.test(trimmed)) {
          if (/^-{3,}$/.test(trimmed)) return <hr key={i} className="border-slate-700 my-1"/>;
          return <p key={i} className="text-slate-100 font-bold text-xs tracking-widest uppercase mt-4 mb-1 border-b border-slate-700 pb-1">{trimmed}</p>;
        }
        // Name line (first non-empty line, assume it's the name)
        if (i === 0 || (i < 3 && !trimmed.includes("•") && !trimmed.includes("|") && trimmed.split(" ").length <= 4)) {
          return <p key={i} className="text-slate-100 font-bold text-base mb-0.5">{trimmed}</p>;
        }
        // Bullet lines
        if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*")) {
          return <p key={i} className="text-slate-300 text-xs pl-3 mb-1">• {trimmed.replace(/^[•\-\*]\s*/,"")}</p>;
        }
        // Contact / separator lines
        if (trimmed.includes("|") || trimmed.includes("@") || trimmed.match(/\d{3}[-.\s]\d{3}/)) {
          return <p key={i} className="text-slate-400 text-xs mb-1">{trimmed}</p>;
        }
        // Regular lines (job titles, companies, dates)
        return <p key={i} className="text-slate-200 text-xs mb-1">{trimmed}</p>;
      })}
    </div>
  );
}

// ── REORDER CONTROLS ──────────────────────────────────────────────────────────
function ReorderBtns({ i, total, onMove }) {
  return (
    <div className="flex flex-col gap-0.5">
      <button onClick={() => i > 0 && onMove(i, i-1)} disabled={i === 0}
        className="w-6 h-6 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center text-slate-300 text-xs transition-colors">↑</button>
      <button onClick={() => i < total-1 && onMove(i, i+1)} disabled={i === total-1}
        className="w-6 h-6 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center text-slate-300 text-xs transition-colors">↓</button>
    </div>
  );
}

// ── TOP NAV ──────────────────────────────────────────────────────────────────
function TopNav({ currentStage, completedStages, onNav, onBack, onRestart }) {
  return (
    <div className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-800">
      <div className="max-w-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {currentStage > 1 && (
              <button onClick={onBack} className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors text-xs mr-1">←</button>
            )}
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center">
              <span className="text-white text-xs font-black">CR</span>
            </div>
            <span className="font-bold text-slate-100 text-sm">CareerReady</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRestart} className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">↺ Restart</button>
            <Badge color="cyan">AI</Badge>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {STAGES.map((s, i) => {
            const done = completedStages.includes(i+1);
            const active = currentStage === i+1;
            const accessible = done || active;
            const short = ["Profile","Resume","Jobs","Docs","Interview","Summary"][i];
            return (
              <button key={s} onClick={() => accessible && onNav(i+1)} disabled={!accessible}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg transition-all ${active?"opacity-100":done?"opacity-80 hover:opacity-100":"opacity-25 cursor-not-allowed"}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border ${active?"bg-indigo-500 border-indigo-400 text-white":done?"bg-emerald-500/20 border-emerald-500 text-emerald-400":"border-slate-600 text-slate-500"}`}>
                  {done&&!active?"✓":i+1}
                </div>
                <span className={`text-[8px] font-medium leading-tight text-center ${active?"text-indigo-300":done?"text-emerald-400":"text-slate-600"}`}>{short}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── STAGE 1: PROFILE ──────────────────────────────────────────────────────────
function Stage1({ onComplete, savedProfile }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState(savedProfile || { name:"", age:"", city:"", schoolType:"", schoolName:"", grade:"", jobType:"", jobTypeOther:"", hasResume:null });
  const [err, setErr] = useState("");
  const upd = (k,v) => setP(x=>({...x,[k]:v}));

  // Autosave partial profile on each step advance
  useEffect(() => { storeSet("user:profile:partial", p); }, [p]);

  const questions = [
    { title:"Hey! 👋 What's your first name?", sub:"We'll use it throughout.",
      content:<FInput label="First name" value={p.name} onChange={v=>upd("name",v)} onEnter={()=>next()} placeholder="e.g. Alex" required />,
      valid:()=>p.name.trim().length>0 },
    { title:`Nice, ${p.name||"you"}! How old are you?`, sub:"Helps tailor the advice.",
      content:<FInput label="Age" type="number" min="13" max="30" value={p.age} onChange={v=>upd("age",v)} onEnter={()=>next()} placeholder="16–24" required />,
      valid:()=>Number(p.age)>=13&&Number(p.age)<=30 },
    { title:"What city are you in?", sub:"Used for local job tips.",
      content:<FInput label="City / Town" value={p.city} onChange={v=>upd("city",v)} onEnter={()=>next()} placeholder="e.g. Toronto, ON" required />,
      valid:()=>p.city.trim().length>0 },
    {
      title:"High school or university?", sub:"",
      content:(
        <div className="flex flex-col gap-3">
          {["High school","University / College"].map(opt=><button key={opt} onClick={()=>upd("schoolType",opt)} className={`w-full py-3 px-4 rounded-xl border text-left text-sm font-medium transition-all ${p.schoolType===opt?"bg-indigo-500/20 border-indigo-500 text-indigo-200":"border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800"}`}>{opt}</button>)}
          {p.schoolType&&(
            <div className="flex flex-col gap-3 mt-1">
              <FInput label="School name" value={p.schoolName} onChange={v=>upd("schoolName",v)} placeholder="e.g. Riverside Secondary School" />
              <FInput label={p.schoolType==="High school"?"Grade":"Year & program"} value={p.grade} onChange={v=>upd("grade",v)} placeholder={p.schoolType==="High school"?"e.g. Grade 10":"e.g. 2nd year, Business Administration"} />
            </div>
          )}
        </div>
      ), valid:()=>p.schoolType&&p.schoolName.trim().length>0,
    },
    {
      title:"What kind of job?", sub:"Pick the closest fit.",
      content:(
        <div className="flex flex-col gap-2">
          {JOB_TYPES.map(jt=><button key={jt} onClick={()=>upd("jobType",jt)} className={`w-full py-2.5 px-4 rounded-xl border text-left text-sm font-medium transition-all ${p.jobType===jt?"bg-indigo-500/20 border-indigo-500 text-indigo-200":"border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800"}`}>{jt}</button>)}
          {p.jobType==="Other"&&<FInput value={p.jobTypeOther} onChange={v=>upd("jobTypeOther",v)} onEnter={()=>next()} placeholder="Describe the job..." />}
        </div>
      ), valid:()=>p.jobType&&(p.jobType!=="Other"||p.jobTypeOther.trim()),
    },
    {
      title:"Do you have a resume already?", sub:"Even a rough draft counts.",
      content:(
        <div className="flex flex-col gap-3">
          {[{key:true,label:"Yes, I'll paste it in",icon:"📄"},{key:false,label:"No, help me build one",icon:"✨"}].map(opt=>(
            <button key={opt.label} onClick={()=>upd("hasResume",opt.key)} className={`w-full py-3 px-4 rounded-xl border text-left text-sm font-medium transition-all flex items-center gap-3 ${p.hasResume===opt.key?"bg-indigo-500/20 border-indigo-500 text-indigo-200":"border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800"}`}>
              <span>{opt.icon}</span>{opt.label}
            </button>
          ))}
        </div>
      ), valid:()=>p.hasResume!==null,
    },
  ];
  const q = questions[step];
  const isLast = step===questions.length-1;
  const next = async()=>{
    if(!q.valid()){setErr("Fill this in to continue — it doesn't have to be perfect!");return;}
    setErr("");
    if(isLast){await storeSet("user:profile",p);onComplete(p);}
    else setStep(s=>s+1);
  };
  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="flex gap-1.5 mb-8 justify-center">
        {questions.map((_,i)=><div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i===step?"w-6 bg-indigo-500":i<step?"w-3 bg-indigo-500/50":"w-3 bg-slate-700"}`}/>)}
      </div>
      <h2 className="text-xl font-bold text-slate-100 mb-1">{q.title}</h2>
      {q.sub&&<p className="text-sm text-slate-400 mb-5">{q.sub}</p>}
      <div className="mb-5">{q.content}</div>
      {err&&<p className="mb-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{err}</p>}
      <div className="flex gap-3">
        {step>0&&<Btn variant="secondary" onClick={()=>{setStep(s=>s-1);setErr("");}}>← Back</Btn>}
        <Btn onClick={next} className="flex-1">{isLast?"Let's go! 🚀":"Next →"}</Btn>
      </div>
    </div>
  );
}

// ── STAGE 2A: RESUME BUILDER ──────────────────────────────────────────────────
const EMPTY_RESUME = {
  phone:"",email:"",linkedin:"",
  summary:"",summaryLoading:false,summaryErr:"",
  skills:[],customSkill:"",suggestedSkills:[],skillsLoading:false,
  experience:[],extras:[],
  education:[],  // array now, not single fields
  languages:[],certs:[]
};

function Stage2A({ profile, onComplete, savedDraft }) {
  const SECS = ["Contact","Summary","Skills","Experience","Activities","Education","Languages","Certs"];
  const [sec, setSec] = useState(0);
  const [toast, showToast] = useToast();
  const [data, setData] = useState(() => {
    if (savedDraft && savedDraft.phone !== undefined) {
      // Migrate old single-school format to array
      const d = { ...EMPTY_RESUME, ...savedDraft };
      if (!d.education || !Array.isArray(d.education)) {
        d.education = [{
          school: profile.schoolName || "", degree: profile.grade || "",
          city: profile.city || "", startDate: savedDraft.schoolStart || "",
          endDate: savedDraft.schoolEnd || "", current: true,
          courses: savedDraft.courses || "", gpa: savedDraft.gpa || ""
        }];
      }
      return d;
    }
    return {
      ...EMPTY_RESUME,
      education: [{
        school: profile.schoolName || "", degree: profile.grade || "",
        city: profile.city || "", startDate: "", endDate: "", current: true,
        courses: "", gpa: ""
      }]
    };
  });
  const [err, setErr] = useState("");
  const upd = (k,v) => setData(d=>({...d,[k]:v}));

  // Autosave with toast
  useEffect(() => {
    storeSet("resume:draft", {...data, profile});
    showToast("Saved");
  }, [data]);

  // ── SUMMARY ──
  const genSummary = async() => {
    upd("summaryLoading",true); upd("summaryErr","");
    try {
      const docType = detectDocType(data.experience);
      const t = await callClaude(
        `Write a ${docType} for a resume. NEVER use: leverage, synergy, dynamic, passionate, detail-oriented, results-driven, team player, hard worker. Lead with a character trait. Under 60 words. Sound like a real person. Return ONLY the ${docType} text.`,
        `Type: ${docType}. Name:${profile.name}, Age:${profile.age}, Job target:${profile.jobType}, School:${profile.schoolName} ${profile.grade}, City:${profile.city}, Experience count:${data.experience.filter(e=>e.role).length}`);
      upd("summary", t.trim());
    } catch { upd("summaryErr","Couldn't generate — try again"); }
    upd("summaryLoading",false);
  };

  // ── SKILLS ──
  const loadSkills = async() => {
    if (data.suggestedSkills.length) return;
    upd("skillsLoading",true);
    try {
      const t = await callClaude("Return ONLY a JSON array of 12 skill strings for this job type. No markdown.", "Job type: "+profile.jobType);
      const arr = safeJSON(t);
      upd("suggestedSkills", Array.isArray(arr) ? arr : ["Customer service","Teamwork","Communication","Problem solving","Attention to detail","Cash handling","Inventory","Time management","Reliability","Adaptability","Active listening","Conflict resolution"]);
    } catch { upd("suggestedSkills",["Customer service","Teamwork","Communication","Problem solving","Attention to detail","Cash handling","Inventory","Time management","Reliability","Adaptability","Active listening","Conflict resolution"]); }
    upd("skillsLoading",false);
  };
  useEffect(() => { if (sec===2) loadSkills(); }, [sec]);
  const toggleSkill = sk => setData(d=>({...d,skills:d.skills.includes(sk)?d.skills.filter(x=>x!==sk):[...d.skills,sk]}));
  const addCustomSkill = () => {
    if (!data.customSkill.trim()) return;
    data.customSkill.split(",").map(s=>s.trim()).filter(Boolean).forEach(sk => {
      setData(d=>({...d,skills:d.skills.includes(sk)?d.skills:[...d.skills,sk]}));
    });
    upd("customSkill","");
  };

  // ── EXPERIENCE ──
  const [showHiddenExp, setShowHiddenExp] = useState(false);
  const addExp = () => setData(d=>({...d,experience:[...d.experience,{role:"",where:"",city:"",startDate:"",endDate:"",current:false,bullets:["",""],bulletsLoading:false,quant:{customers:"",transactions:"",pct:""}}]}));
  const updExp = (i,k,v) => setData(d=>{const e=[...d.experience];e[i]={...e[i],[k]:v};return{...d,experience:e};});
  const moveExp = (from,to) => setData(d=>({...d,experience:moveItem(d.experience,from,to)}));
  const addBullet = i => setData(d=>{const e=[...d.experience];e[i]={...e[i],bullets:[...e[i].bullets,""]};return{...d,experience:e};});
  const genBullets = async(i) => {
    updExp(i,"bulletsLoading",true);
    try {
      const e = data.experience[i];
      const quantCtx = e.quant ? `Customers per shift: ${e.quant.customers||"unknown"}, Transactions per shift: ${e.quant.transactions||"unknown"}, Performance vs target: ${e.quant.pct||"unknown"}` : "";
      const t = await callClaude(
        "Generate 3 strong resume bullets using [Action verb]+[Task]+[Quantified result]. Use the specific numbers provided. NEVER say 'leverage' or 'synergy'. Return ONLY a JSON array of 3 strings. No markdown.",
        `Role:${e.role}, Company:${e.where}, City:${e.city}, Dates:${e.startDate}-${e.current?"Present":e.endDate}, Job target:${profile.jobType}. ${quantCtx}`);
      const arr = safeJSON(t);
      updExp(i,"bullets", Array.isArray(arr) ? arr : ["Assisted customers with product selection and provided tailored recommendations","Processed transactions accurately using point-of-sale systems","Maintained organized work area and supported team goals"]);
    } catch { updExp(i,"bullets",["Assisted customers with product selection and provided tailored recommendations","Processed transactions accurately using point-of-sale systems","Maintained organized work area and supported team goals"]); }
    updExp(i,"bulletsLoading",false);
  };
  const regenOneBullet = async(i, j) => {
    updExp(i,"bulletsLoading",true);
    try {
      const e = data.experience[i];
      const t = await callClaude(
        "Generate exactly 1 strong resume bullet: [Action verb] + [Task] + [Result]. Return ONLY the bullet as a plain string, no array, no markdown.",
        `Role:${e.role}, Where:${e.where}, Job:${profile.jobType}`);
      setData(d=>{const exp=[...d.experience];const bs=[...exp[i].bullets];bs[j]=t.trim().replace(/^["'\-•*]/,"").trim();exp[i]={...exp[i],bullets:bs};return{...d,experience:exp};});
    } catch {}
    updExp(i,"bulletsLoading",false);
  };

  // ── ACTIVITIES ──
  const addExtra = () => setData(d=>({...d,extras:[...d.extras,{name:"",role:"",startYear:"",endYear:"",desc:""}]}));
  const updExtra = (i,k,v) => setData(d=>{const e=[...d.extras];e[i]={...e[i],[k]:v};return{...d,extras:e};});
  const moveExtra = (from,to) => setData(d=>({...d,extras:moveItem(d.extras,from,to)}));

  // ── EDUCATION (array now) ──
  const addEdu = () => setData(d=>({...d,education:[...d.education,{school:"",degree:"",city:"",startDate:"",endDate:"",current:false,courses:"",gpa:""}]}));
  const updEdu = (i,k,v) => setData(d=>{const e=[...d.education];e[i]={...e[i],[k]:v};return{...d,education:e};});
  const moveEdu = (from,to) => setData(d=>({...d,education:moveItem(d.education,from,to)}));

  // ── LANGUAGES ──
  const addLang = () => setData(d=>({...d,languages:[...d.languages,{lang:"",level:""}]}));
  const updLang = (i,k,v) => setData(d=>{const l=[...d.languages];l[i]={...l[i],[k]:v};return{...d,languages:l};});
  const moveLang = (from,to) => setData(d=>({...d,languages:moveItem(d.languages,from,to)}));

  // ── CERTS ──
  const addCert = () => setData(d=>({...d,certs:[...d.certs,{name:"",issuer:"",date:""}]}));
  const updCert = (i,k,v) => setData(d=>{const c=[...d.certs];c[i]={...c[i],[k]:v};return{...d,certs:c};});

  const [showLinkedIn, setShowLinkedIn] = useState(false);
  const [lastSaved] = useState(Date.now());

  const handleNext = async() => {
    if (sec < SECS.length-1) { setSec(s=>s+1); setErr(""); return; }
    const final = {...data, profile};
    await storeSet("resume:draft", final);
    onComplete(final);
  };

  const content = [
    // 0 Contact
    <Card key="contact">
      <p className="text-xs text-slate-400 mb-4">Your name and city are pulled from your profile.</p>
      <div className="flex flex-col gap-3">
        <div className="bg-slate-900/50 rounded-xl px-4 py-2.5 border border-slate-700"><p className="text-xs text-slate-500">Name</p><p className="text-slate-200 text-sm font-medium">{profile.name}</p></div>
        <div className="bg-slate-900/50 rounded-xl px-4 py-2.5 border border-slate-700"><p className="text-xs text-slate-500">City</p><p className="text-slate-200 text-sm font-medium">{profile.city}</p></div>
        <FInput label="Phone" value={data.phone} onChange={v=>upd("phone",v)} placeholder="416-555-0199"/>
        <FInput label="Email" type="email" value={data.email} onChange={v=>upd("email",v)} placeholder="alex@email.com"/>
        <FInput label="LinkedIn URL" value={data.linkedin} onChange={v=>upd("linkedin",v)} placeholder="linkedin.com/in/yourname" helper="Optional"/>
      </div>
    </Card>,

    // 1 Summary
    <Card key="summary">
      {(() => {
        const docType = detectDocType(data.experience);
        return (
          <>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-slate-400">A 2–3 line snapshot — recruiters read this first.</p>
              <Badge color={docType==="Summary"?"green":"amber"}>{docType}</Badge>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {docType==="Summary"
                ? "You have enough experience for a Summary — highlight your strongest points."
                : "With limited experience, use an Objective — state what you bring and what you're looking for. Mention the company by name."}
            </p>
          </>
        );
      })()}
      <FTextarea value={data.summary} onChange={v=>upd("summary",v)} placeholder="Write it yourself, or let Claude write one for you..." rows={4}/>
      <Btn variant="cyan" onClick={genSummary} disabled={data.summaryLoading} size="sm" className="mt-3">✨ Write one for me</Btn>
      {data.summaryLoading&&<Spinner msg="Writing your summary..."/>}
      {data.summaryErr&&<ErrMsg msg={data.summaryErr} onRetry={genSummary}/>}
    </Card>,

    // 2 Skills
    <Card key="skills">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-400">Tap skills that apply. Add your own below.</p>
        {data.skills.length>0&&<Badge color="indigo">{data.skills.length} selected</Badge>}
      </div>
      {data.skillsLoading?<Spinner msg="Loading suggestions..."/>:(
        <div className="flex flex-wrap gap-2 mb-4">
          {data.suggestedSkills.map(sk=>(
            <button key={sk} onClick={()=>toggleSkill(sk)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${data.skills.includes(sk)?"bg-indigo-500/20 border-indigo-500 text-indigo-200":"border-slate-600 text-slate-400 hover:border-slate-500"}`}>
              {data.skills.includes(sk)?"✓ ":""}{sk}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={data.customSkill} onChange={e=>upd("customSkill",e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomSkill()} placeholder="Type your own (comma-separated)" className="flex-1 bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"/>
        <Btn size="sm" variant="secondary" onClick={addCustomSkill}>Add</Btn>
      </div>
      {data.skills.length>0&&<p className="text-xs text-emerald-400 mt-2">{data.skills.join(", ")}</p>}
    </Card>,

    // 3 Experience
    <Card key="exp">
      <p className="text-xs text-slate-400 mb-3">Jobs, volunteering, babysitting, school events — anything useful counts. Drag to reorder with ↑↓.</p>
      {data.experience.map((e,i)=>(
        <div key={i} className="border border-slate-600 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-2 mb-3">
            <ReorderBtns i={i} total={data.experience.length} onMove={moveExp}/>
            <div className="flex-1">
              <div className="flex justify-between mb-2">
                <p className="text-xs font-semibold text-slate-300">Experience {i+1}</p>
                <button onClick={()=>setData(d=>({...d,experience:d.experience.filter((_,j)=>j!==i)}))} className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </div>
              <div className="flex flex-col gap-2.5">
                <FInput value={e.role} onChange={v=>updExp(i,"role",v)} placeholder="Role / What you did (e.g. Cashier, Volunteer)"/>
                <FInput value={e.where} onChange={v=>updExp(i,"where",v)} placeholder="Company / Organisation (e.g. Walmart)"/>
                <FInput value={e.city} onChange={v=>updExp(i,"city",v)} placeholder="City (e.g. Mississauga, ON)"/>
                <div className="flex gap-2">
                  <div className="flex-1"><FInput value={e.startDate} onChange={v=>updExp(i,"startDate",v)} placeholder="Start (e.g. Sept 2023)"/></div>
                  <div className="flex-1">
                    {e.current
                      ?<div className="bg-slate-900/50 rounded-xl px-4 py-2.5 border border-slate-600 text-slate-400 text-sm">Present</div>
                      :<FInput value={e.endDate} onChange={v=>updExp(i,"endDate",v)} placeholder="End (e.g. June 2024)"/>}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={()=>updExp(i,"current",!e.current)} className={`w-8 h-4 rounded-full transition-colors relative ${e.current?"bg-indigo-500":"bg-slate-700"}`}>
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${e.current?"translate-x-4":""}`}/>
                  </div>
                  <span className="text-xs text-slate-400">I still work here</span>
                </label>
                <div>
                  <p className="text-xs text-slate-400 mb-1.5">What did you do? (bullet points)</p>
                  {e.bullets.map((b,j)=>(
                    <div key={j} className="flex gap-1.5 mb-1.5 items-center">
                      <input value={b} onChange={ev=>{const bs=[...e.bullets];bs[j]=ev.target.value;updExp(i,"bullets",bs);}}
                        placeholder={`Bullet ${j+1}...`}
                        className="flex-1 bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"/>
                      <button onClick={()=>regenOneBullet(i,j)} title="Regenerate this bullet" className="text-slate-500 hover:text-indigo-400 text-xs px-1.5 py-1 rounded transition-colors">↺</button>
                      {e.bullets.length>1&&<button onClick={()=>{const bs=e.bullets.filter((_,k)=>k!==j);updExp(i,"bullets",bs);}} className="text-slate-600 hover:text-red-400 text-xs transition-colors">✕</button>}
                    </div>
                  ))}
                  {/* Quantification prompts */}
                  <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3 mb-2 mt-1">
                    <p className="text-xs text-slate-500 mb-2">📊 Add numbers to make bullets stronger (optional but powerful):</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input value={e.quant?.customers||""} onChange={ev=>updExp(i,"quant",{...e.quant,customers:ev.target.value})} placeholder="Customers/shift" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 placeholder-slate-600 text-xs focus:outline-none focus:border-indigo-500"/>
                      <input value={e.quant?.transactions||""} onChange={ev=>updExp(i,"quant",{...e.quant,transactions:ev.target.value})} placeholder="Transactions/shift" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 placeholder-slate-600 text-xs focus:outline-none focus:border-indigo-500"/>
                      <input value={e.quant?.pct||""} onChange={ev=>updExp(i,"quant",{...e.quant,pct:ev.target.value})} placeholder="Sales target %" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 placeholder-slate-600 text-xs focus:outline-none focus:border-indigo-500"/>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {e.bullets.length<5&&<Btn size="sm" variant="secondary" onClick={()=>addBullet(i)}>+ Add bullet</Btn>}
                    <Btn size="sm" variant="cyan" onClick={()=>genBullets(i)} disabled={e.bulletsLoading||!e.role}>✨ Write all bullets</Btn>
                  </div>
                  {e.bulletsLoading&&<Spinner msg="Writing bullets..."/>}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" onClick={addExp}>+ Add experience</Btn>
      {data.experience.length===0&&<p className="text-xs text-slate-500 mt-2">No experience? That's okay — add anything, even informal work.</p>}
      <div className="mt-3 border-t border-slate-700/50 pt-3">
        <button onClick={()=>setShowHiddenExp(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1.5">
          🔍 Not sure if you have experience? Answer 5 quick questions →
        </button>
      </div>
      {showHiddenExp&&<HiddenExperienceModal profile={profile} onAdd={entries=>{
        setData(d=>({...d,experience:[...d.experience,...entries.map(e=>({role:e.role||"",where:e.where||"",city:"",startDate:"",endDate:"",current:false,bullets:e.bullets||["",""],bulletsLoading:false,quant:{customers:"",transactions:"",pct:""}}))]}));
      }} onClose={()=>setShowHiddenExp(false)}/>}
    </Card>,

    // 4 Activities
    <Card key="extras">
      <p className="text-xs text-slate-400 mb-3">Sports, clubs, student council, volunteering — anything you're proud of. Use ↑↓ to reorder.</p>
      {data.extras.map((e,i)=>(
        <div key={i} className="border border-slate-600 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-2">
            <ReorderBtns i={i} total={data.extras.length} onMove={moveExtra}/>
            <div className="flex-1">
              <div className="flex justify-between mb-2"><p className="text-xs font-semibold text-slate-300">Activity {i+1}</p><button onClick={()=>setData(d=>({...d,extras:d.extras.filter((_,j)=>j!==i)}))} className="text-xs text-red-400">Remove</button></div>
              <div className="flex flex-col gap-2">
                <FInput value={e.name} onChange={v=>updExtra(i,"name",v)} placeholder="e.g. Basketball team, Drama club"/>
                <FInput value={e.role} onChange={v=>updExtra(i,"role",v)} placeholder="Your role (e.g. Member, Captain, Volunteer)"/>
                <div className="flex gap-2">
                  <div className="flex-1"><FInput value={e.startYear} onChange={v=>updExtra(i,"startYear",v)} placeholder="Start year (e.g. 2022)"/></div>
                  <div className="flex-1"><FInput value={e.endYear} onChange={v=>updExtra(i,"endYear",v)} placeholder="End year or Present"/></div>
                </div>
                <FInput value={e.desc} onChange={v=>updExtra(i,"desc",v)} placeholder="One sentence: what you did or achieved"/>
              </div>
            </div>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" onClick={addExtra}>+ Add activity</Btn>
    </Card>,

    // 5 Education — now a full array with add/remove/reorder
    <Card key="edu">
      <p className="text-xs text-slate-400 mb-3">Add all schools — current and previous. Use ↑↓ to put most recent first.</p>
      {data.education.map((e,i)=>(
        <div key={i} className="border border-slate-600 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-2">
            <ReorderBtns i={i} total={data.education.length} onMove={moveEdu}/>
            <div className="flex-1">
              <div className="flex justify-between mb-2">
                <p className="text-xs font-semibold text-slate-300">{i===0?"Current school":"Previous school"}</p>
                {i>0&&<button onClick={()=>setData(d=>({...d,education:d.education.filter((_,j)=>j!==i)}))} className="text-xs text-red-400">Remove</button>}
              </div>
              <div className="flex flex-col gap-2.5">
                <FInput label="School name" value={e.school} onChange={v=>updEdu(i,"school",v)} placeholder="e.g. Riverside Secondary School"/>
                <FInput label="Degree / Program / Grade" value={e.degree} onChange={v=>updEdu(i,"degree",v)} placeholder="e.g. Grade 10 / 2nd year Business Administration"/>
                <FInput label="City" value={e.city} onChange={v=>updEdu(i,"city",v)} placeholder="e.g. Mississauga, ON"/>
                <div className="flex gap-2">
                  <div className="flex-1"><FInput label="Start date" value={e.startDate} onChange={v=>updEdu(i,"startDate",v)} placeholder="e.g. Sept 2021"/></div>
                  <div className="flex-1">
                    {e.current
                      ?<div className="mt-5 bg-slate-900/50 rounded-xl px-4 py-2.5 border border-slate-600 text-slate-400 text-sm">Present</div>
                      :<FInput label="End date" value={e.endDate} onChange={v=>updEdu(i,"endDate",v)} placeholder="e.g. June 2025"/>}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={()=>updEdu(i,"current",!e.current)} className={`w-8 h-4 rounded-full transition-colors relative ${e.current?"bg-indigo-500":"bg-slate-700"}`}>
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${e.current?"translate-x-4":""}`}/>
                  </div>
                  <span className="text-xs text-slate-400">Currently attending</span>
                </label>
                <FInput label="Relevant courses" value={e.courses} onChange={v=>updEdu(i,"courses",v)} placeholder="e.g. Computer Science, Business" helper="Optional — courses relevant to the job"/>
                <FInput label="GPA or average" value={e.gpa} onChange={v=>updEdu(i,"gpa",v)} placeholder="e.g. 3.8/4.0 or 85%" helper="Optional — only add if it's strong"/>
              </div>
            </div>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" onClick={addEdu}>+ Add previous school</Btn>
    </Card>,

    // 6 Languages
    <Card key="langs">
      <p className="text-xs text-slate-400 mb-3">Another language is a real advantage in customer-facing roles. Use ↑↓ to reorder.</p>
      {data.languages.map((l,i)=>(
        <div key={i} className="flex items-center gap-2 mb-2">
          <ReorderBtns i={i} total={data.languages.length} onMove={moveLang}/>
          <div className="flex-1"><FInput value={l.lang} onChange={v=>updLang(i,"lang",v)} placeholder="Language"/></div>
          <select value={l.level} onChange={e=>updLang(i,"level",e.target.value)} className="bg-slate-900/80 border border-slate-600 rounded-xl px-3 py-2.5 text-slate-100 text-xs focus:outline-none focus:border-indigo-500">
            <option value="">Level</option>
            {["Basic","Conversational","Fluent","Native"].map(lv=><option key={lv}>{lv}</option>)}
          </select>
          <button onClick={()=>setData(d=>({...d,languages:d.languages.filter((_,j)=>j!==i)}))} className="text-red-400 text-xs">✕</button>
        </div>
      ))}
      <Btn size="sm" variant="secondary" onClick={addLang}>+ Add language</Btn>
    </Card>,

    // 7 Certs
    <Card key="certs">
      <p className="text-xs text-slate-400 mb-3">Food handler certificate, first aid, online courses, driver's licence — all count.</p>
      {data.certs.map((c,i)=>(
        <div key={i} className="border border-slate-600 rounded-xl p-3 mb-2">
          <div className="flex justify-between mb-2"><p className="text-xs font-semibold text-slate-300">Cert {i+1}</p><button onClick={()=>setData(d=>({...d,certs:d.certs.filter((_,j)=>j!==i)}))} className="text-xs text-red-400">Remove</button></div>
          <div className="flex flex-col gap-2">
            <FInput value={c.name} onChange={v=>updCert(i,"name",v)} placeholder="Certification name"/>
            <FInput value={c.issuer} onChange={v=>updCert(i,"issuer",v)} placeholder="Issued by (e.g. Red Cross, Coursera)"/>
            <FInput value={c.date} onChange={v=>updCert(i,"date",v)} placeholder="Date completed (e.g. June 2024)"/>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" onClick={addCert}>+ Add certification</Btn>
      {data.certs.length===0&&<p className="text-xs text-slate-500 mt-2">None yet? That's fine.</p>}
    </Card>,
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Toast toast={toast}/>
      {showLinkedIn&&<LinkedInPanel profile={profile} resumeData={{...data,profile}} onClose={()=>setShowLinkedIn(false)}/>}
      <FreshnessTracker lastSaved={lastSaved}/>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-slate-100">Build Your Resume</h2>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowLinkedIn(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors border border-indigo-500/30 px-2 py-1 rounded-lg">LinkedIn tips</button>
          <Badge color="slate">{sec+1}/{SECS.length}</Badge>
        </div>
      </div>
      <div className="flex gap-0.5 mb-5">
        {SECS.map((_,i)=><div key={i} className={`h-1 flex-1 rounded-full transition-all ${i<sec?"bg-indigo-500":i===sec?"bg-indigo-400":"bg-slate-700"}`}/>)}
      </div>
      <h3 className="text-sm font-semibold text-indigo-300 mb-3 uppercase tracking-wider">{SECS[sec]}</h3>
      {content[sec]}
      {err&&<p className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{err}</p>}
      <div className="flex gap-3 mt-5">
        {sec>0&&<Btn variant="secondary" onClick={()=>{setSec(s=>s-1);setErr("");}}>← Back</Btn>}
        <Btn onClick={handleNext} className="flex-1">{sec===SECS.length-1?"Generate my resume →":"Next →"}</Btn>
      </div>
    </div>
  );
}

// ── STAGE 2B: RESUME REVIEW ───────────────────────────────────────────────────
function Stage2B({ profile, onComplete, savedDraft }) {
  const [pasted, setPasted] = useState(savedDraft?.rawResume||"");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [review, setReview] = useState(savedDraft?.review||null);
  const [fixingIdx, setFixingIdx] = useState(null);
  const [fixes, setFixes] = useState({});
  const [toast, showToast] = useToast();

  useEffect(() => { storeSet("resume:draft",{rawResume:pasted,review,fixes,profile}); showToast("Saved"); }, [pasted,review,fixes]);

  const doReview = async() => {
    if (!pasted.trim()) { setErr("Paste your resume first."); return; }
    setLoading(true); setErr(""); setReview(null);
    try {
      const t = await callClaude(
        `Review resumes for 16-24yo first/second job applicants. Be specific and encouraging. Return ONLY valid JSON: {"score":number_1_to_10,"score_note":"one sentence","strengths":["s1","s2","s3"],"easy_wins":[{"issue":"string","fix":"string"}],"bigger_improvements":[{"issue":"string","fix":"string"}]}`,
        `Job type:${profile.jobType}, Profile:${profile.name}, ${profile.age}yo, ${profile.city}.\n\nResume:\n${pasted}`, 1200);
      const parsed = safeJSON(t);
      if (!parsed) throw new Error("parse fail");
      setReview(parsed);
    } catch { setErr("Couldn't analyse — try again."); }
    setLoading(false);
  };

  const fixIssue = async(type, idx) => {
    setFixingIdx(`${type}-${idx}`);
    const item = type==="easy" ? review.easy_wins[idx] : review.bigger_improvements[idx];
    try {
      const fixed = await callClaude(
        "Rewrite a resume section to fix the issue. Return ONLY the improved text.",
        `Resume:\n${pasted}\n\nIssue: ${item.issue}\nHow to fix: ${item.fix}\n\nRewrite the relevant section.`, 900);
      setFixes(f=>({...f,[`${type}-${idx}`]:fixed}));
    } catch { setFixes(f=>({...f,[`${type}-${idx}`]:"Couldn't generate — try again."})); }
    setFixingIdx(null);
  };

  const applyFix = (type, idx) => {
    const fixed = fixes[`${type}-${idx}`];
    if (!fixed) return;
    const item = type==="easy" ? review.easy_wins[idx] : review.bigger_improvements[idx];
    // Replace relevant section — append fix to resume if we can't find exact match
    const newText = pasted.includes(item.issue.slice(0,20))
      ? pasted.replace(item.issue.slice(0,20), fixed.slice(0,20))
      : pasted + "\n\n" + fixed;
    setPasted(newText);
    showToast("Fix applied ✓", "success");
  };

  const finish = async() => {
    const d = {rawResume:pasted,review,fixes,profile};
    await storeSet("resume:draft",d);
    onComplete(d);
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Toast toast={toast}/>
      <h2 className="text-lg font-bold text-slate-100 mb-1">Review Your Resume</h2>
      <p className="text-sm text-slate-400 mb-5">Paste your current resume — even a rough draft is fine.</p>
      <FTextarea value={pasted} onChange={setPasted} placeholder="Paste your resume text here..." rows={10} showCount/>
      <Btn onClick={doReview} disabled={loading||!pasted.trim()} className="w-full mt-4">Review my resume →</Btn>
      {loading&&<Spinner msg="Claude is reading your resume..."/>}
      {err&&<ErrMsg msg={err} onRetry={doReview}/>}
      {review&&(
        <div className="mt-6 flex flex-col gap-4">
          <Card className="text-center">
            <div className="text-4xl font-black text-indigo-400 mb-1">{review.score}/10</div>
            <p className="text-sm text-slate-300">{review.score_note}</p>
          </Card>
          <Card><p className="text-xs font-bold text-emerald-400 mb-2">✅ Already strong</p>{review.strengths?.map((s,i)=><p key={i} className="text-sm text-slate-300 mb-1">• {s}</p>)}</Card>
          <Card>
            <p className="text-xs font-bold text-amber-400 mb-2">⚡ Easy wins</p>
            {review.easy_wins?.map((w,i)=>(
              <div key={i} className="mb-3 pb-3 border-b border-slate-700/50 last:border-0 last:mb-0 last:pb-0">
                <p className="text-sm text-slate-300 mb-1">• {w.issue}</p>
                <p className="text-xs text-slate-500 mb-2">→ {w.fix}</p>
                {fixes[`easy-${i}`]
                  ? <div>
                      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 text-xs text-indigo-200 whitespace-pre-wrap mb-2">{fixes[`easy-${i}`]}</div>
                      <Btn size="sm" variant="success" onClick={()=>applyFix("easy",i)}>✓ Apply this fix</Btn>
                    </div>
                  : <Btn size="sm" variant="secondary" onClick={()=>fixIssue("easy",i)} disabled={fixingIdx===`easy-${i}`}>{fixingIdx===`easy-${i}`?"Fixing...":"✨ Fix with AI"}</Btn>}
              </div>
            ))}
          </Card>
          <Card>
            <p className="text-xs font-bold text-red-400 mb-2">🔧 Bigger improvements</p>
            {review.bigger_improvements?.map((w,i)=>(
              <div key={i} className="mb-3 pb-3 border-b border-slate-700/50 last:border-0 last:mb-0 last:pb-0">
                <p className="text-sm text-slate-300 mb-1">• {w.issue}</p>
                <p className="text-xs text-slate-500 mb-2">→ {w.fix}</p>
                {fixes[`big-${i}`]
                  ? <div>
                      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 text-xs text-indigo-200 whitespace-pre-wrap mb-2">{fixes[`big-${i}`]}</div>
                      <Btn size="sm" variant="success" onClick={()=>applyFix("big",i)}>✓ Apply this fix</Btn>
                    </div>
                  : <Btn size="sm" variant="secondary" onClick={()=>fixIssue("big",i)} disabled={fixingIdx===`big-${i}`}>{fixingIdx===`big-${i}`?"Fixing...":"✨ Fix with AI"}</Btn>}
              </div>
            ))}
          </Card>
          <Btn onClick={finish} className="w-full">Continue to Job Analysis →</Btn>
        </div>
      )}
    </div>
  );
}

// ── JOB FETCH ─────────────────────────────────────────────────────────────────
async function fetchJobFromUrl(rawUrl) {
  const u = new URL(rawUrl); const host = u.hostname;
  const ghMatch = rawUrl.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (ghMatch) { const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs/${ghMatch[2]}?content=true`); if (r.ok) { const d = await r.json(); return `${d.title}\n\n${(d.content||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}`; } }
  const levMatch = rawUrl.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/);
  if (levMatch) { const r = await fetch(`https://api.lever.co/v0/postings/${levMatch[1]}/${levMatch[2]}?mode=json`); if (r.ok) { const d = await r.json(); return `${d.text}\n\n${d.descriptionPlain||d.description||""}`; } }
  if (/indeed\.|linkedin\.|glassdoor\./.test(host)) throw new Error("BLOCKED");
  const proxies = [u=>`https://corsproxy.io/?url=${encodeURIComponent(u)}`,u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,u=>`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`];
  for (const b of proxies) {
    try {
      const r = await fetch(b(rawUrl),{signal:AbortSignal.timeout(12000)});
      if (!r.ok) continue;
      const html = await r.text();
      if (html.includes("Just a moment")||html.includes("cf-chl")) continue;
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").trim();
      if (text.length>200) return text.slice(0,6000);
    } catch {}
  }
  throw new Error("PROXY_FAIL");
}

// ── STAGE 3: JOB ANALYSIS ─────────────────────────────────────────────────────
function Stage3({ profile, resumeData, onComplete, savedJob }) {
  const [inputMode, setInputMode] = useState("url");
  const [urlInput, setUrlInput] = useState(savedJob?.jobUrl||"");
  const [jobText, setJobText] = useState(savedJob?.jobText||"");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState("");
  const [fetchedMeta, setFetchedMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState("");
  const [err, setErr] = useState("");
  const [partialData, setPartialData] = useState(null); // cache call1 if call2 fails
  const [analysis, setAnalysis] = useState(savedJob?.analysis||null);
  const [activeTab, setActiveTab] = useState("Keywords");
  const [toggles, setToggles] = useState(savedJob?.toggles||{});
  const prevJobText = useRef(savedJob?.jobText||"");

  const resumeText = resumeData?.rawResume || resumeData?.summary || JSON.stringify(resumeData||{});

  const handleFetch = async() => {
    if (!urlInput.trim()) return;
    setFetchLoading(true); setFetchErr(""); setFetchedMeta(null);
    try { new URL(urlInput); } catch { setFetchErr("Needs to start with https://"); setFetchLoading(false); return; }
    try {
      const text = await fetchJobFromUrl(urlInput.trim());
      setJobText(text); setFetchedMeta({url:urlInput.trim(),chars:text.length}); setInputMode("paste");
    } catch(e) {
      if (e.message==="BLOCKED") setFetchErr("Indeed, LinkedIn & Glassdoor block automated access. Switch to 'Paste text' and copy manually.");
      else setFetchErr("Couldn't load that URL. Switch to 'Paste text' and copy manually.");
    }
    setFetchLoading(false);
  };

  const doAnalysis = async() => {
    const text = jobText.trim();
    if (!text) { setErr("Add a job description first."); return; }
    // Reset toggles only if job text changed
    const togglesToUse = text === prevJobText.current ? toggles : {};
    if (text !== prevJobText.current) { setToggles({}); prevJobText.current = text; }
    setLoading(true); setErr(""); setAnalysis(null); setPartialData(null);
    let p1 = null;
    try {
      setLoadStep("🔍 Scanning job posting for keywords...");
      const companyKws = getCompanyKeywords(jobText);
      const r1 = await callClaude(
        `ATS expert. Return ONLY compact JSON, no line breaks in strings: {"ats_gaps":[{"keyword":"str","in_resume":"Yes|Partial|No","why_it_matters":"1 sentence","suggested_wording":"exact phrase","where_to_add":"e.g. Skills section","ats_impact":"+X pts","priority":"High|Medium|Low"}],"ai_score_before":num,"ai_score_after":num,"human_score_before":num,"human_score_after":num,"hiring_score_before":num,"hiring_score_after":num,"ai_drag":"sentence","human_drag":"sentence","hiring_drag":"sentence","hire_probability_pct":num,"hire_probability_note":"1 encouraging sentence about what would improve it"}`,
        `Applicant:${profile.name}, ${profile.age}yo, ${profile.jobType} in ${profile.city}.\n\nRESUME:\n${resumeText.slice(0,2500)}\n\nJOB POSTING:\n${text.slice(0,2500)}\n\nCompany-specific keywords to check: ${companyKws.join(", ")||"none identified"}.\n\nList 6-10 keywords total. JSON only.`, 2500);
      p1 = safeJSON(r1);
      if (!p1) throw new Error("Keywords JSON failed");
      setPartialData(p1); // cache in case call2 fails

      setLoadStep("📊 Calculating your match score...");
      const r2 = await callClaude(
        `Career coach 16-24yo. Return ONLY compact JSON: {"fit_pct":num,"match_level":"Strong|Good|Moderate|Weak","strengths":[{"title":"str","detail":"1-2 sentences"}],"gaps":[{"gap":"str","why":"1 sentence","tip":"specific action"}],"salary_context":"1 sentence","company_name":"str","company_type":"str","company_what":"1 sentence","company_known_for":["str","str","str"],"first_job_verdict":"Good|OK|Risky","first_job_reason":"1 sentence","culture_fit":"1 sentence","interview_tip":"specific quote to say"}`,
        `Applicant:${profile.name}, ${profile.age}yo, ${profile.jobType} in ${profile.city}.\n\nRESUME:\n${resumeText.slice(0,2500)}\n\nJOB POSTING:\n${text.slice(0,2500)}\n\nJSON only.`, 2000);
      const p2 = safeJSON(r2);
      if (!p2) throw new Error("Fit JSON failed");

      const combined = {...p1,...p2};
      setAnalysis(combined);
      setToggles(togglesToUse);
      await storeSet("job:current",{jobText:text,jobUrl:urlInput,analysis:combined,toggles:togglesToUse});
    } catch(e) {
      if (p1) {
        // Call 1 succeeded, call 2 failed — show what we have
        setAnalysis({...p1, fit_pct:null, match_level:null, strengths:[], gaps:[], company_name:"Unknown", company_what:"", company_known_for:[], first_job_verdict:null, _partial:true});
        setErr("Match & company data failed to load. Tap 'Reload fit data' in the Fit tab to retry.");
      } else {
        setErr("Analysis failed: "+e.message+". Try again.");
      }
    }
    setLoading(false); setLoadStep("");
  };

  const reloadFit = async() => {
    if (!partialData) return;
    setErr(""); setLoading(true); setLoadStep("Reloading match data...");
    try {
      const r2 = await callClaude(
        `Career coach 16-24yo. Return ONLY compact JSON: {"fit_pct":num,"match_level":"Strong|Good|Moderate|Weak","strengths":[{"title":"str","detail":"1-2 sentences"}],"gaps":[{"gap":"str","why":"1 sentence","tip":"specific action"}],"salary_context":"1 sentence","company_name":"str","company_type":"str","company_what":"1 sentence","company_known_for":["str","str","str"],"first_job_verdict":"Good|OK|Risky","first_job_reason":"1 sentence","culture_fit":"1 sentence","interview_tip":"specific quote to say"}`,
        `Applicant:${profile.name}, ${profile.age}yo, ${profile.jobType}.\n\nRESUME:\n${resumeText.slice(0,2000)}\n\nJOB POSTING:\n${jobText.slice(0,2000)}\n\nJSON only.`, 2000);
      const p2 = safeJSON(r2);
      if (p2) { const combined={...partialData,...p2}; setAnalysis(combined); await storeSet("job:current",{jobText,jobUrl:urlInput,analysis:combined,toggles}); }
    } catch {}
    setLoading(false); setLoadStep("");
  };

  const toggleKw = (i) => {
    const newT = {...toggles,[i]:!toggles[i]};
    setToggles(newT);
    storeSet("job:current",{jobText,jobUrl:urlInput,analysis,toggles:newT});
  };

  if (!analysis) return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h2 className="text-lg font-bold text-slate-100 mb-1">Job Analysis</h2>
      <p className="text-sm text-slate-400 mb-5">Add the job — we'll compare it to your resume and show exactly how to improve your match.</p>
      <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1 border border-slate-700/50 mb-4">
        <button onClick={()=>{setInputMode("url");setFetchErr("");}} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${inputMode==="url"?"bg-indigo-500 text-white":"text-slate-400 hover:text-slate-200"}`}>🔗 Job URL</button>
        <button onClick={()=>setInputMode("paste")} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${inputMode==="paste"?"bg-indigo-500 text-white":"text-slate-400 hover:text-slate-200"}`}>📋 Paste text</button>
      </div>
      {inputMode==="url"&&(
        <div className="flex flex-col gap-3 mb-4">
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3">
            <p className="text-xs text-indigo-300 mb-1">✅ Auto-reads: Greenhouse, Lever, Ashby, Workable</p>
            <p className="text-xs text-slate-400">❌ Blocked: Indeed, LinkedIn, Glassdoor — use Paste text for those</p>
          </div>
          <div className="flex gap-2">
            <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleFetch()}
              placeholder="https://jobs.lever.co/company/..." className="flex-1 bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500"/>
            <Btn onClick={handleFetch} disabled={fetchLoading||!urlInput.trim()} size="sm">{fetchLoading?"Reading...":"Fetch"}</Btn>
          </div>
          {fetchLoading&&<Spinner msg="Reading job posting..."/>}
          {fetchErr&&<ErrMsg msg={fetchErr}/>}
          {fetchedMeta&&<div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3"><p className="text-xs text-emerald-300">✓ Got {fetchedMeta.chars.toLocaleString()} characters</p></div>}
          <Btn variant="secondary" size="sm" onClick={()=>setInputMode("paste")}>Or paste the text manually →</Btn>
        </div>
      )}
      {inputMode==="paste"&&(
        <div className="flex flex-col gap-3 mb-4">
          <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3">
            <p className="text-xs text-slate-200 font-semibold mb-1">📋 How to copy a job posting:</p>
            <p className="text-xs text-slate-400">1. Open the job listing<br/>2. Press <span className="bg-slate-700 px-1 py-0.5 rounded text-slate-200">Ctrl+A</span> (Mac: <span className="bg-slate-700 px-1 py-0.5 rounded text-slate-200">Cmd+A</span>)<br/>3. Press <span className="bg-slate-700 px-1 py-0.5 rounded text-slate-200">Ctrl+C</span> to copy<br/>4. Paste below — include everything</p>
          </div>
          {fetchedMeta&&<div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2"><p className="text-xs text-emerald-300">✓ Auto-filled from URL</p></div>}
          <FTextarea value={jobText} onChange={setJobText} placeholder="Paste the full job posting — title, company, responsibilities, requirements, salary, everything..." rows={12} showCount/>
        </div>
      )}
      {err&&<ErrMsg msg={err} onRetry={doAnalysis}/>}
      <Btn onClick={doAnalysis} disabled={loading||!jobText.trim()} className="w-full mt-2">{loading?(loadStep||"Analysing..."):"Analyse my match →"}</Btn>
      {loading&&<Spinner msg={loadStep||"Comparing your resume to the job..."}/>}
    </div>
  );

  const a = analysis;
  const tabs = ["Keywords","Scores","Fit","Company"];
  const matchedKws = (a.ats_gaps||[]).filter(g=>g.in_resume==="Yes").length;
  const totalKws = (a.ats_gaps||[]).length;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-100">Job Analysis</h2>
        <button onClick={()=>{setAnalysis(null);setJobText("");setPartialData(null);}} className="text-xs text-slate-500 hover:text-slate-300 underline">New job</button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-indigo-400">{a.fit_pct!=null?`${a.fit_pct}%`:"—"}</div>
          <p className="text-xs text-slate-400">match</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-cyan-400">{matchedKws}/{totalKws}</div>
          <p className="text-xs text-slate-400">keywords</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
          <div className={`text-lg font-black ${a.first_job_verdict==="Good"?"text-emerald-400":a.first_job_verdict==="OK"?"text-amber-400":a.first_job_verdict==="Risky"?"text-red-400":"text-slate-400"}`}>{a.first_job_verdict||"—"}</div>
          <p className="text-xs text-slate-400">verdict</p>
        </div>
      </div>
      <Tabs tabs={tabs} active={activeTab} onSelect={setActiveTab}/>
      <div className="mt-4">
        {activeTab==="Keywords"&&(
          <div className="flex flex-col gap-3">
            <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-3">
              <p className="text-xs text-slate-300 font-semibold mb-1">What is ATS keyword matching?</p>
              <p className="text-xs text-slate-400">ATS (Applicant Tracking System) is software companies use to automatically screen resumes before a human sees them. It scans for exact keywords from the job posting. Toggle ones you want applied to your resume in Documents.</p>
            </div>
            {(a.ats_gaps||[]).map((g,i)=>(
              <div key={i} className={`border rounded-xl p-4 ${toggles[i]?"border-indigo-500/50 bg-indigo-500/5":"border-slate-700/50 bg-slate-800/40"}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-slate-200">{g.keyword}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge color={g.in_resume==="Yes"?"green":g.in_resume==="Partial"?"amber":"red"}>{g.in_resume}</Badge>
                    <Badge color={g.priority==="High"?"red":g.priority==="Medium"?"amber":"slate"}>{g.priority}</Badge>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-2">{g.why_it_matters}</p>
                {g.in_resume!=="Yes"&&(
                  <div className="bg-slate-900/60 rounded-lg p-2.5 mb-2">
                    <p className="text-xs text-slate-500 mb-0.5">Add to <span className="text-slate-300">{g.where_to_add}</span>:</p>
                    <p className="text-xs text-indigo-300 font-medium">"{g.suggested_wording}"</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-emerald-400 font-medium">{g.ats_impact}</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-slate-400">{toggles[i]?"Will apply":"Apply?"}</span>
                    <div onClick={()=>toggleKw(i)} className={`w-9 h-5 rounded-full transition-colors relative ${toggles[i]?"bg-indigo-500":"bg-slate-700"}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${toggles[i]?"translate-x-4":""}`}/>
                    </div>
                  </label>
                </div>
              </div>
            ))}
            {/* Running ATS total */}
            {(a.ats_gaps||[]).length>0&&(()=>{
              const toggled=Object.values(toggles).filter(Boolean).length;
              const baseScore=a.ai_score_before||50;
              const gain=(a.ats_gaps||[]).reduce((acc,g,i)=>{ if(toggles[i]&&g.in_resume!=="Yes") acc+=parseInt(g.ats_impact)||5; return acc; },0);
              const projected=Math.min(baseScore+gain,99);
              const allHighSelected=(a.ats_gaps||[]).filter(g=>g.priority==="High").every((_,i)=>toggles[(a.ats_gaps||[]).findIndex(g=>g.priority==="High"&&(a.ats_gaps||[])[i]===g)]);
              return(
                <div className={`border rounded-xl p-4 ${projected>=90?"bg-emerald-500/10 border-emerald-500/30":"bg-amber-500/10 border-amber-500/30"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-300">Projected ATS score after your changes</p>
                    <span className={`text-lg font-black ${projected>=90?"text-emerald-400":"text-amber-400"}`}>{toggled>0?projected:baseScore}</span>
                  </div>
                  {projected<90&&toggled>0&&<p className="text-xs text-amber-300 mt-1">⚠️ Below 90 — apply all High priority keywords to cross the threshold and pass automated screening.</p>}
                  {projected>=90&&toggled>0&&<p className="text-xs text-emerald-300 mt-1">✓ Above 90 — you're likely to pass automated screening with these changes applied.</p>}
                  {toggled===0&&<p className="text-xs text-slate-400 mt-1">Toggle improvements above to see your projected score.</p>}
                </div>
              );
            })()}
            {/* Hire probability */}
            {a.hire_probability_pct&&(
              <div className="border border-slate-700/50 bg-slate-800/40 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-300">Hire probability</p>
                  <span className={`text-lg font-black ${a.hire_probability_pct>=60?"text-emerald-400":a.hire_probability_pct>=35?"text-amber-400":"text-red-400"}`}>{a.hire_probability_pct}%</span>
                </div>
                <p className="text-xs text-slate-400">{a.hire_probability_note}</p>
              </div>
            )}
            {Object.values(toggles).filter(Boolean).length>0&&(
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-emerald-300">✓ {Object.values(toggles).filter(Boolean).length} improvement{Object.values(toggles).filter(Boolean).length>1?"s":""} selected — applied when you generate your resume in Documents.</p>
              </div>
            )}
            <Btn onClick={()=>onComplete({jobText,jobUrl:urlInput,analysis,toggles})} className="w-full">Continue to Documents →</Btn>
          </div>
        )}
        {activeTab==="Scores"&&(
          <div className="flex flex-col gap-4">
            <Card><p className="text-xs text-slate-400">These scores show how your resume performs at each stage of the hiring process — before and after applying keyword improvements.</p></Card>
            {[
              {label:"AI Screener",sub:"Software that reads your resume first",before:a.ai_score_before,after:a.ai_score_after,drag:a.ai_drag,icon:"🤖"},
              {label:"Human Recruiter",sub:"HR person who reviews screened resumes",before:a.human_score_before,after:a.human_score_after,drag:a.human_drag,icon:"👤"},
              {label:"Hiring Manager",sub:"The boss who makes the final call",before:a.hiring_score_before,after:a.hiring_score_after,drag:a.hiring_drag,icon:"💼"},
            ].map(sc=>(
              <Card key={sc.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{sc.icon}</span>
                  <div><p className="text-sm font-semibold text-slate-200">{sc.label}</p><p className="text-xs text-slate-500">{sc.sub}</p></div>
                </div>
                <div className="flex gap-3 items-center my-2">
                  <span className="text-xs text-slate-400 w-6">Now</span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full"><div className="h-2 bg-red-500/70 rounded-full" style={{width:`${sc.before}%`}}/></div>
                  <span className="text-xs text-red-400 font-bold w-8">{sc.before}</span>
                </div>
                <div className="flex gap-3 items-center mb-2">
                  <span className="text-xs text-slate-400 w-6">After</span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full"><div className="h-2 bg-indigo-500 rounded-full" style={{width:`${sc.after}%`}}/></div>
                  <span className="text-xs text-indigo-400 font-bold w-8">{sc.after}</span>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                  <p className="text-xs text-amber-300">What's dragging it down: {sc.drag}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
        {activeTab==="Fit"&&(
          <div className="flex flex-col gap-4">
            {a._partial&&(
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-300">Match data didn't load. </p>
                <Btn size="sm" variant="amber" onClick={reloadFit} disabled={loading}>Reload fit data</Btn>
              </div>
            )}
            {!a._partial&&<Card className="text-center">
              <div className={`text-5xl font-black mb-1 ${a.fit_pct>=70?"text-emerald-400":a.fit_pct>=50?"text-amber-400":"text-red-400"}`}>{a.fit_pct}%</div>
              <Badge color={a.match_level==="Strong"?"green":a.match_level==="Good"?"cyan":a.match_level==="Moderate"?"amber":"red"}>{a.match_level||"—"} match</Badge>
              {a.salary_context&&<p className="text-xs text-slate-400 mt-3 border-t border-slate-700 pt-3">{a.salary_context}</p>}
            </Card>}
            <div className="flex flex-col gap-2">{(a.strengths||[]).map((s,i)=><div key={i} className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3"><p className="text-xs font-semibold text-emerald-300 mb-1">✅ {s.title}</p><p className="text-xs text-slate-300">{s.detail}</p></div>)}</div>
            <div className="flex flex-col gap-2">{(a.gaps||[]).map((g,i)=><div key={i} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3"><p className="text-xs font-semibold text-amber-300 mb-1">⚡ {g.gap}</p><p className="text-xs text-slate-400 mb-1">{g.why}</p><p className="text-xs text-amber-200/80">→ {g.tip}</p></div>)}</div>
          </div>
        )}
        {activeTab==="Company"&&(
          <div className="flex flex-col gap-4">
            <div className="bg-slate-700/30 border border-slate-600/30 rounded-xl p-3"><p className="text-xs text-slate-500">ℹ️ Based on Claude's knowledge — verify on Glassdoor before your interview.</p></div>
            <Card>
              <p className="text-base font-bold text-slate-100 mb-0.5">{a.company_name}</p>
              <p className="text-xs text-slate-500 mb-2">{a.company_type}</p>
              <p className="text-sm text-slate-300 mb-3">{a.company_what}</p>
              <p className="text-xs font-semibold text-slate-400 mb-2">Known for:</p>
              {(a.company_known_for||[]).map((k,i)=><p key={i} className="text-sm text-slate-300 mb-1">• {k}</p>)}
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-slate-200">First job verdict:</p>
                <Badge color={a.first_job_verdict==="Good"?"green":a.first_job_verdict==="OK"?"amber":"red"}>{a.first_job_verdict||"—"}</Badge>
              </div>
              <p className="text-sm text-slate-300 mb-2">{a.first_job_reason}</p>
              {a.culture_fit&&<p className="text-xs text-slate-400 mb-3 italic">{a.culture_fit}</p>}
              {a.interview_tip&&<div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3"><p className="text-xs font-semibold text-indigo-300 mb-1">💬 Say this in the interview:</p><p className="text-xs text-indigo-200">"{a.interview_tip}"</p></div>}
            </Card>
            <Btn onClick={()=>onComplete({jobText,jobUrl:urlInput,analysis,toggles})} className="w-full">Continue to Documents →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── STAGE 4: DOCUMENTS ────────────────────────────────────────────────────────
function Stage4({ profile, resumeData, jobData, onComplete, savedDocs }) {
  const [activeTab, setActiveTab] = useState("Resume");
  const [resumeLoading, setResumeLoading] = useState(false);
  const [generatedResume, setGeneratedResume] = useState(savedDocs?.generatedResume||"");
  const [coverLoading, setCoverLoading] = useState(false);
  const [generatedCover, setGeneratedCover] = useState(savedDocs?.generatedCover||"");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [flags, setFlags] = useState([]);
  const [flagsDone, setFlagsDone] = useState(!!(savedDocs?.generatedResume));
  const [savedVersions, setSavedVersions] = useState([]);
  const [versionLabel, setVersionLabel] = useState("");
  const [checks, setChecks] = useState({});
  const [toast, showToast] = useToast();
  const [showLinkedIn, setShowLinkedIn] = useState(false);
  const [freshnessDate] = useState(()=>Date.now());

  // Derive from props FIRST — must be before any const that references them
  const resumeText = resumeData?.rawResume||JSON.stringify(resumeData||{});
  const jobText = jobData?.jobText||"";
  const analysis = jobData?.analysis||{};
  const toggles = jobData?.toggles||{};

  // One-page length check (~600 words ≈ 1 page)
  const isLong = generatedResume && generatedResume.split(/\s+/).length > 600;

  // 90+ ATS gate — safe now that analysis is declared above
  const currentScore = analysis.ai_score_after || 0;
  const belowThreshold = currentScore < 90 && !!generatedResume && flagsDone;

  // Bug fix: storeGet is synchronous in JSX version — no .then()
  useEffect(() => {
    const vs = storeGet("resume:versions");
    if (vs) setSavedVersions(vs);
  }, []);
  useEffect(() => { storeSet("docs:current",{generatedResume,generatedCover}); showToast("Saved"); },[generatedResume,generatedCover]);

  const genResume = async() => {
    setResumeLoading(true); setErr(""); setFlags([]); setFlagsDone(false);
    try {
      const acceptedKws = (analysis.ats_gaps||[]).filter((_,i)=>toggles[i]).map(g=>`${g.keyword}: ${g.suggested_wording}`).join("\n");
      const raw = await callClaude(
        `Professional resume writer for students aged 16-24. Generate a complete ATS-optimized resume in plain text. Use ALL CAPS section headers on their own line followed by a line of dashes. [Action verb]+[Task]+[Quantified Result] for all bullets. Do NOT invent any experience or skills not provided. One page max. NEVER use: leverage, synergy, dynamic, passionate, detail-oriented, results-driven, team player, hardworking, self-starter. Sound like a real person.`,
        `Profile:\n${JSON.stringify(profile)}\n\nResume data:\n${resumeText}\n\nKeyword improvements to apply:\n${acceptedKws}\n\nGenerate the complete resume.`, 1600);
      const check = await callClaude(
        `Check resume for hallucinated content vs original user data. Return ONLY JSON array or []: [{"claim":"string","reason":"string"}]. Be strict — flag anything not clearly stated by the user.`,
        `User data:${resumeText}\n\nGenerated:\n${raw}`, 1000);
      let flagged = []; try { flagged = safeJSON(check)||[]; } catch {}
      setGeneratedResume(raw);
      if (flagged.length > 0) setFlags(flagged); else setFlagsDone(true);
    } catch { setErr("Couldn't generate — try again."); }
    setResumeLoading(false);
  };

  const genCover = async() => {
    if (!generatedResume) { setErr("Generate your resume first."); return; }
    setCoverLoading(true); setErr("");
    try {
      const letter = await callClaude(
        `Write cover letters for students aged 16-24. NEVER start with "I am writing to apply". Open with something specific and human. Under 300 words. Plain language. Reference company and role specifically. Include professional header.`,
        `Profile:${JSON.stringify(profile)}\nCompany:${analysis.company_name}\nJob:${jobText.slice(0,800)}\nResume:${generatedResume.slice(0,1000)}`, 1000);
      setGeneratedCover(letter);
    } catch { setErr("Cover letter failed — try again."); }
    setCoverLoading(false);
  };

  // ── COPY — iframe-safe fallback ──────────────────────────────────────────
  const copy = async(text, label) => {
    // Try modern clipboard API first
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label); setTimeout(()=>setCopied(""),2500);
      showToast("Copied to clipboard ✓","success"); return;
    } catch {}
    // Fallback: create a temporary textarea, select it, execCommand copy
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;boxShadow:none;background:transparent;";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setCopied(label); setTimeout(()=>setCopied(""),2500);
        showToast("Copied ✓","success"); return;
      }
    } catch {}
    // Last resort: show a modal with text pre-selected so user can Ctrl+C
    showToast("Press Ctrl+C (or Cmd+C) to copy the text below","save");
    setCopied(label+"_manual"); setTimeout(()=>setCopied(""),4000);
  };

  // ── PRINT — in-page modal approach (works in iframes, no popup needed) ──
  // ── DOWNLOAD ─────────────────────────────────────────────────────────────
  const downloadTxt = (text, filename) => {
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast("Download started ✓","success");
  };

  const downloadHtml = (text, filename, title="Resume") => {
    const lines = text.split("\n");
    let body = "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) { body += "<br/>"; continue; }
      if (/^[A-Z][A-Z\s&]+$/.test(t) && t.length > 2 && t.length < 50) {
        body += `<div class="sh">${t}</div>`;
      } else if (t.startsWith("•") || t.startsWith("-") || t.startsWith("·")) {
        body += `<div class="b">${t.replace(/^[•\-·]\s*/,"")}</div>`;
      } else if (t.includes("@") && t.includes("·")) {
        body += `<div class="ct">${t}</div>`;
      } else {
        body += `<p>${t}</p>`;
      }
    }
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.55;color:#111;max-width:780px;margin:0 auto;padding:48px 56px;}
h1{font-size:20pt;font-weight:bold;margin-bottom:3px;}.ct{font-size:10pt;color:#444;margin-bottom:16px;border-bottom:1.5px solid #111;padding-bottom:6px;}
.sh{font-size:10.5pt;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #111;padding-bottom:2px;margin:16px 0 7px;}
.b{margin-left:18px;margin-bottom:3px;font-size:10.5pt;}.b::before{content:"• ";}p{margin-bottom:4px;font-size:10.5pt;}br{display:block;margin:4px 0;}
@media print{body{padding:0;}}</style></head><body>${body}</body></html>`;
    const blob = new Blob([html], {type:"text/html;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast("Download started ✓","success");
  };
  const saveVersion = async() => {
    if (!generatedResume||!versionLabel.trim()) return;
    const v = [...savedVersions,{label:versionLabel,resume:generatedResume,cover:generatedCover,date:new Date().toLocaleDateString()}].slice(-3);
    setSavedVersions(v); await storeSet("resume:versions",v); setVersionLabel(""); showToast("Version saved ✓","success");
  };

  const CHECKLIST_ITEMS = ["Printed resume (2 copies)","Know address and how to get there","Arrive 10 minutes early","Phone on silent","Know the interviewer's name if possible","Prepared 'Tell me about yourself' answer","Prepared 'Why do you want this job?' answer","Thank-you email ready within 24 hrs"];

  // Cheat sheet questions pulled from actual analysis data
  const cheatSheetStrengths = (analysis.strengths||[]).slice(0,3).map(s=>s.title||s).filter(Boolean);
  const cheatSheetQuestionsToAsk = ["What does a typical day look like for someone in this role?","What do you enjoy most about working here?"];

  const coverTabDisabled = !generatedResume;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Toast toast={toast}/>
      {showLinkedIn&&<LinkedInPanel profile={profile} resumeData={resumeData} onClose={()=>setShowLinkedIn(false)}/>}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-100">Your Documents</h2>
        <button onClick={()=>setShowLinkedIn(true)} className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-2 py-1 rounded-lg transition-colors">LinkedIn tips</button>
      </div>
      <FreshnessTracker lastSaved={freshnessDate}/>
      <Tabs tabs={["Resume","Cover Letter","Cheat Sheet"]} active={activeTab} onSelect={setActiveTab} disabled={coverTabDisabled?["Cover Letter"]:[]}/>
      <div className="mt-5">

        {activeTab==="Resume"&&(
          <div className="flex flex-col gap-4">
            {!generatedResume?(
              <>
                <Card><p className="text-sm text-slate-300">Your resume will be generated with all selected keyword improvements. Claude will accuracy-check every claim before showing it to you.</p></Card>
                <Btn onClick={genResume} disabled={resumeLoading} className="w-full">✨ Generate my resume</Btn>
                {resumeLoading&&<Spinner msg="Writing and checking your resume..."/>}
                {err&&<ErrMsg msg={err} onRetry={genResume}/>}
              </>
            ):(
              <>
                {flags.length>0&&!flagsDone&&(
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-xs font-bold text-amber-300 mb-3">⚠️ Accuracy check — confirm these claims</p>
                    {flags.map((f,i)=>(
                      <div key={i} className="mb-3 bg-amber-500/5 rounded-lg p-3">
                        <p className="text-xs text-amber-200 mb-1">"{f.claim}"</p>
                        <p className="text-xs text-slate-400 mb-2">Why flagged: {f.reason}</p>
                        <div className="flex gap-2">
                          <Btn size="sm" variant="success" onClick={()=>setFlags(fs=>fs.filter((_,j)=>j!==i))}>✓ Yes, keep it</Btn>
                          <Btn size="sm" variant="danger" onClick={()=>{setGeneratedResume(r=>r.replace(f.claim,""));setFlags(fs=>fs.filter((_,j)=>j!==i));}}>✗ Remove</Btn>
                        </div>
                      </div>
                    ))}
                    {flags.length===0&&<Btn onClick={()=>setFlagsDone(true)} className="w-full">All confirmed — show me my resume</Btn>}
                  </div>
                )}
                {(flagsDone||flags.length===0)&&(
                  <>
                    {belowThreshold&&(
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                        <p className="text-xs font-bold text-amber-300 mb-1">⚠️ ATS score below 90 — may not pass automated screening</p>
                        <p className="text-xs text-slate-400 mb-2">Current score: {currentScore}/100. Go back to Job Analysis and apply more keyword improvements, then regenerate.</p>
                    <p className="text-xs text-slate-400 mt-2">← Use the back arrow (←) at the top to return to Job Analysis and apply more keyword improvements.</p>
                      </div>
                    )}
                    {isLong&&(
                      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                        <p className="text-xs font-bold text-red-300 mb-1">📄 This resume is running long — trim to one page</p>
                        <p className="text-xs text-slate-400 mb-1">Entry-level resumes must be one page. Consider removing:</p>
                        <p className="text-xs text-slate-400">• Any extracurricular with minimal relevance</p>
                        <p className="text-xs text-slate-400">• GPA if below 3.5</p>
                        <p className="text-xs text-slate-400">• Objectives or summaries longer than 3 lines</p>
                        <p className="text-xs text-slate-400">• Old education entries with no relevant courses</p>
                      </div>
                    )}
                    <ResumeDoc text={generatedResume}/>
                    {/* Manual copy fallback if clipboard API fails */}
                    {copied==="resume_manual"&&(
                      <div className="bg-slate-800 border border-slate-600 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-2">Select all and press Ctrl+C (Cmd+C on Mac):</p>
                        <textarea readOnly value={generatedResume} rows={6} onClick={e=>e.target.select()} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-300 font-mono resize-none focus:outline-none"/>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Btn variant="secondary" onClick={()=>copy(generatedResume,"resume")} className="flex-1">
                        {copied==="resume"?"✓ Copied!":copied==="resume_manual"?"Select & Ctrl+C →":"Copy to clipboard"}
                      </Btn>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="secondary" size="sm" onClick={()=>downloadTxt(generatedResume,`${profile.name?.replace(/\s+/g,"_")||"Resume"}_Resume.txt`)} className="flex-1">⬇ Download .txt</Btn>
                      <Btn variant="cyan" size="sm" onClick={()=>downloadHtml(generatedResume,`${profile.name?.replace(/\s+/g,"_")||"Resume"}_Resume.html`,"Resume")} className="flex-1">⬇ Download formatted</Btn>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3">
                      <p className="text-xs text-slate-400">💡 <strong className="text-slate-300">Best way to get a PDF:</strong> Click "Download formatted" → open the .html file in your browser → press Ctrl+P / Cmd+P → Save as PDF</p>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="secondary" onClick={()=>{setGeneratedResume("");setFlagsDone(false);}} className="flex-1" size="sm">↺ Regenerate resume</Btn>
                    </div>
                    {savedVersions.length<3&&(
                      <Card>
                        <p className="text-xs font-semibold text-slate-300 mb-2">Save this version</p>
                        <div className="flex gap-2">
                          <input value={versionLabel} onChange={e=>setVersionLabel(e.target.value)} placeholder="e.g. Retail — Home Depot" className="flex-1 bg-slate-900/80 border border-slate-600 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"/>
                          <Btn size="sm" variant="secondary" onClick={saveVersion} disabled={!versionLabel.trim()}>Save</Btn>
                        </div>
                      </Card>
                    )}
                    {savedVersions.length>0&&(
                      <Card>
                        <p className="text-xs font-semibold text-slate-400 mb-2">Saved versions</p>
                        {savedVersions.map((v,i)=>(
                          <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-700/50 last:border-0">
                            <div><p className="text-xs text-slate-300">{v.label}</p><p className="text-xs text-slate-500">{v.date}</p></div>
                            <Btn size="sm" variant="ghost" onClick={()=>{setGeneratedResume(v.resume);setFlagsDone(true);}}>Load</Btn>
                          </div>
                        ))}
                      </Card>
                    )}
                    <Btn onClick={()=>onComplete({generatedResume,generatedCover})} className="w-full">Continue to Interview Prep →</Btn>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab==="Cover Letter"&&(
          <div className="flex flex-col gap-4">
            {!generatedCover?(
              <>
                <Card><p className="text-sm text-slate-300">Tailored cover letter for <strong className="text-white">{analysis.company_name||"this company"}</strong>. Will NOT start with "I am writing to apply..."</p></Card>
                <Btn onClick={genCover} disabled={coverLoading} className="w-full">✨ Write my cover letter</Btn>
                {coverLoading&&<Spinner msg="Writing a genuine cover letter..."/>}
                {err&&<ErrMsg msg={err} onRetry={genCover}/>}
              </>
            ):(
              <>
                <ResumeDoc text={generatedCover}/>
                {copied==="cover_manual"&&(
                  <div className="bg-slate-800 border border-slate-600 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-2">Select all and press Ctrl+C (Cmd+C on Mac):</p>
                    <textarea readOnly value={generatedCover} rows={6} onClick={e=>e.target.select()} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-300 font-mono resize-none focus:outline-none"/>
                  </div>
                )}
                <div className="flex gap-2">
                  <Btn variant="secondary" onClick={()=>copy(generatedCover,"cover")} className="flex-1">
                    {copied==="cover"?"✓ Copied!":copied==="cover_manual"?"Select & Ctrl+C →":"Copy to clipboard"}
                  </Btn>
                </div>
                <div className="flex gap-2">
                  <Btn variant="secondary" size="sm" onClick={()=>downloadTxt(generatedCover,`${profile.name?.replace(/\s+/g,"_")||"Cover"}_CoverLetter.txt`)} className="flex-1">⬇ Download .txt</Btn>
                  <Btn variant="cyan" size="sm" onClick={()=>downloadHtml(generatedCover,`${profile.name?.replace(/\s+/g,"_")||"Cover"}_CoverLetter.html`,"Cover Letter")} className="flex-1">⬇ Download formatted</Btn>
                </div>
                <Btn variant="secondary" onClick={()=>setGeneratedCover("")} size="sm">↺ Regenerate cover letter</Btn>
              </>
            )}
          </div>
        )}

        {activeTab==="Cheat Sheet"&&(
          <div className="flex flex-col gap-4">
            <Card>
              <div className="flex justify-between mb-4">
                <div><p className="text-base font-bold text-slate-100">{analysis.company_name||"Company"}</p><p className="text-xs text-slate-400">Application Cheat Sheet</p></div>
                <p className="text-xs text-slate-500">{new Date().toLocaleDateString()}</p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3">
                  <p className="text-xs font-bold text-indigo-300 mb-2">Why I'm a good fit</p>
                  {cheatSheetStrengths.length>0
                    ? cheatSheetStrengths.map((s,i)=><p key={i} className="text-xs text-slate-300 mb-1">• {s}</p>)
                    : <><p className="text-xs text-slate-300 mb-1">• Your relevant skills and experience</p><p className="text-xs text-slate-300 mb-1">• Your availability and reliability</p><p className="text-xs text-slate-300">• Your enthusiasm for this role</p></>}
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                  <p className="text-xs font-bold text-emerald-300 mb-2">3 things to mention in the interview</p>
                  <p className="text-xs text-slate-300 mb-1">• Knowledge of {analysis.company_name||"the company"}'s products/services</p>
                  <p className="text-xs text-slate-300 mb-1">• Your availability and reliability</p>
                  {analysis.interview_tip?<p className="text-xs text-slate-300">• "{analysis.interview_tip}"</p>:<p className="text-xs text-slate-300">• A time you successfully helped someone</p>}
                </div>
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3">
                  <p className="text-xs font-bold text-cyan-300 mb-2">2 questions to ask them</p>
                  {cheatSheetQuestionsToAsk.map((q,i)=><p key={i} className="text-xs text-slate-300 mb-1">• "{q}"</p>)}
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="text-xs font-bold text-amber-300 mb-2">Follow-up plan</p>
                  <p className="text-xs text-slate-300">Send a thank-you email within 24 hours. Subject: "Thank you — [Role] interview". 3 sentences: thank them, restate your interest, say you look forward to hearing back.</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 mb-2">Before the interview</p>
                  {CHECKLIST_ITEMS.map((item,i)=>(
                    <button key={i} onClick={()=>setChecks(c=>({...c,[i]:!c[i]}))} className={`flex items-center gap-2 w-full py-1.5 px-2 rounded-lg text-left transition-colors ${checks[i]?"text-emerald-300":"text-slate-300"}`}>
                      <span className={`text-xs ${checks[i]?"text-emerald-400":"text-slate-500"}`}>{checks[i]?"☑":"☐"}</span>
                      <span className={`text-xs ${checks[i]?"line-through opacity-60":""}`}>{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
            <Btn onClick={()=>onComplete({generatedResume,generatedCover})} className="w-full">Continue to Interview Prep →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── STAGE 5: INTERVIEW PREP ──────────────────────────────────────────────────
function Stage5({ profile, resumeData, jobData, savedPrep, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [prep, setPrep] = useState(savedPrep||null);
  const [practiceAnswers, setPracticeAnswers] = useState({}); // keyed by question index — fixed bleed bug
  const [practiceOpen, setPracticeOpen] = useState(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceFeedback, setPracticeFeedback] = useState({});
  const [openSec, setOpenSec] = useState(0);
  const [checklist, setChecklist] = useState({});
  const [regenLoading, setRegenLoading] = useState(null);

  const analysis = jobData?.analysis||{};
  const resumeText = resumeData?.rawResume||JSON.stringify(resumeData||{});

  useEffect(() => { if (prep) storeSet("interview:prep", prep); }, [prep]);

  const genPrep = async() => {
    setLoading(true); setErr("");
    try {
      const r1 = await callClaude(
        `Interview coach for 16-24yo first/second job applicants. Return ONLY compact valid JSON: {"likely_questions":[{"q":"str","why":"1 sentence why they ask","sample_answer":"genuine answer using their background, sound like a real teenager not HR"}],"scenario_questions":[{"q":"str","answer":"suggested response"}]}. Generate exactly 5 likely_questions and 2 scenario_questions.`,
        `Profile:${JSON.stringify(profile)}\nCompany:${analysis.company_name||"retail"}\nJob:${profile.jobType}\nResume:${resumeText.slice(0,1500)}\nJob posting:${(jobData?.jobText||"").slice(0,1000)}`, 2200);
      const p1 = safeJSON(r1);
      if (!p1) throw new Error("Questions JSON failed");

      const r2 = await callClaude(
        `Interview coach for 16-24yo. Return ONLY compact valid JSON: {"curveball":{"q":"unexpected question this company type is known to ask","tip":"how to handle it in 1 sentence","sample":"sample answer in 2-3 sentences"},"questions_to_ask":["q1","q2","q3","q4","q5"]}`,
        `Profile:${JSON.stringify(profile)}\nCompany:${analysis.company_name||"retail"}\nJob:${profile.jobType}`, 1000);
      const p2 = safeJSON(r2);
      if (!p2) throw new Error("Curveball JSON failed");

      setPrep({...p1,...p2});
    } catch(e) { setErr("Couldn't generate: "+e.message+". Try again."); }
    setLoading(false);
  };

  const regenQuestion = async(i) => {
    setRegenLoading(i);
    try {
      const t = await callClaude(
        `Generate 1 interview question for a ${profile.jobType} job applicant aged ${profile.age} at ${analysis.company_name||"a retail store"}. Return ONLY compact JSON: {"q":"question","why":"1 sentence why they ask","sample_answer":"genuine teenager answer"}`,
        `Profile:${JSON.stringify(profile)}. Make it different from typical "tell me about yourself" questions.`, 600);
      const newQ = safeJSON(t);
      if (newQ) {
        setPrep(p => {
          const qs = [...(p.likely_questions||[])];
          qs[i] = newQ;
          return {...p, likely_questions: qs};
        });
      }
    } catch {}
    setRegenLoading(null);
  };

  const practiceQ = async(q, idx) => {
    const answer = practiceAnswers[idx];
    if (!answer?.trim()) return;
    setPracticeLoading(true);
    try {
      const fb = await callClaude(
        `Give interview feedback to a 16-24yo. Encouraging but specific. Return ONLY JSON: {"what_was_good":"specific praise","what_to_improve":"one specific suggestion","revised_version":"improved version of their answer"}`,
        `Question:${q}\nAnswer:${answer}\nProfile:${JSON.stringify(profile)}`, 900);
      const parsed = safeJSON(fb);
      setPracticeFeedback(f=>({...f,[idx]:parsed||{what_was_good:"Good effort!",what_to_improve:"Couldn't analyse — try again.",revised_version:""}}));
    } catch { setPracticeFeedback(f=>({...f,[idx]:{what_was_good:"Good effort!",what_to_improve:"Couldn't analyse — try again.",revised_version:""}})); }
    setPracticeLoading(false);
  };

  const CHECKLIST = ["Resume printed (2 copies)","Store address and directions ready","Planning to arrive 10 min early","Phone will be on silent","Interviewer's name looked up if possible","'Tell me about yourself' answer ready","'Why this job?' answer ready","Thank-you email draft ready"];
  const SECS = [
    {t:"Likely Questions",e:"💬",count:(prep?.likely_questions||[]).length},
    {t:"Scenario Questions",e:"🎭",count:(prep?.scenario_questions||[]).length},
    {t:"Curveball",e:"🎱",count:prep?.curveball?1:0},
    {t:"Questions to Ask",e:"🙋",count:(prep?.questions_to_ask||[]).length},
    {t:"Ready Checklist",e:"✅",count:Object.values(checklist).filter(Boolean).length+"/"+CHECKLIST.length}
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h2 className="text-lg font-bold text-slate-100 mb-1">Interview Prep</h2>
      <p className="text-sm text-slate-400 mb-5">Let's get you ready, {profile.name}.</p>
      {!prep?(
        <>
          <Card className="mb-5"><p className="text-sm text-slate-300">Claude will generate 5 likely interview questions, 2 scenario questions, 1 curveball, and smart questions to ask — all tailored to your background and this specific job.</p></Card>
          <Btn onClick={genPrep} disabled={loading} className="w-full">Generate my interview prep ✨</Btn>
          {loading&&<Spinner msg="Building your personalised interview prep..."/>}
          {err&&<ErrMsg msg={err} onRetry={genPrep}/>}
        </>
      ):(
        <div className="flex flex-col gap-2">
          {SECS.map((s,si)=>(
            <div key={si} className="border border-slate-700/50 rounded-2xl overflow-hidden">
              <button onClick={()=>setOpenSec(openSec===si?-1:si)}
                className={`w-full flex items-center justify-between px-5 py-4 text-left transition-colors ${openSec===si?"bg-slate-800/80":"bg-slate-800/30 hover:bg-slate-800/50"}`}>
                <div className="flex items-center gap-2">
                  <span>{s.e}</span>
                  <p className="text-sm font-semibold text-slate-200">{s.t}</p>
                  <Badge color="slate">{s.count}</Badge>
                </div>
                <span className="text-slate-400 text-xs">{openSec===si?"▲":"▼"}</span>
              </button>
              {openSec===si&&(
                <div className="px-5 py-4 bg-slate-900/30">
                  {si===0&&(
                    <div className="flex flex-col gap-5">
                      {(prep.likely_questions||[]).map((q,i)=>(
                        <div key={i} className="border-l-2 border-indigo-500/40 pl-4">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-sm font-semibold text-slate-200">{q.q}</p>
                            <button onClick={()=>regenQuestion(i)} disabled={regenLoading===i} title="Replace this question" className="text-slate-500 hover:text-indigo-400 text-xs transition-colors shrink-0 mt-0.5">{regenLoading===i?"...":"↺"}</button>
                          </div>
                          <p className="text-xs text-slate-500 mb-2 italic">Why they ask: {q.why}</p>
                          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 mb-3"><p className="text-xs text-slate-300">{q.sample_answer}</p></div>
                          {practiceOpen===`lq-${i}`?(
                            <div className="flex flex-col gap-2">
                              <FTextarea
                                value={practiceAnswers[i]||""}
                                onChange={v=>setPracticeAnswers(a=>({...a,[i]:v}))}
                                placeholder="Type your own answer..." rows={3}/>
                              <div className="flex gap-2">
                                <Btn size="sm" variant="cyan" onClick={()=>practiceQ(q.q,i)} disabled={practiceLoading||!(practiceAnswers[i]||"").trim()}>{practiceLoading?"Reviewing...":"Submit for feedback"}</Btn>
                                <Btn size="sm" variant="ghost" onClick={()=>setPracticeOpen(null)}>Cancel</Btn>
                              </div>
                              {practiceFeedback[i]&&(
                                <div className="flex flex-col gap-2">
                                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3"><p className="text-xs text-emerald-300">✅ {practiceFeedback[i].what_was_good}</p></div>
                                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3"><p className="text-xs text-amber-300">⚡ {practiceFeedback[i].what_to_improve}</p></div>
                                  {practiceFeedback[i].revised_version&&<div className="bg-slate-800 border border-slate-600 rounded-xl p-3"><p className="text-xs text-slate-300"><span className="text-slate-500">Revised: </span>{practiceFeedback[i].revised_version}</p></div>}
                                </div>
                              )}
                            </div>
                          ):<Btn size="sm" variant="secondary" onClick={()=>{setPracticeOpen(`lq-${i}`);}}>Practice this question</Btn>}
                        </div>
                      ))}
                    </div>
                  )}
                  {si===1&&<div className="flex flex-col gap-4">{(prep.scenario_questions||[]).map((q,i)=><div key={i}><p className="text-sm font-semibold text-slate-200 mb-1">{q.q}</p><div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3"><p className="text-xs text-slate-300">{q.answer}</p></div></div>)}</div>}
                  {si===2&&prep.curveball&&(
                    <div>
                      <p className="text-sm font-semibold text-slate-200 mb-2">{prep.curveball.q}</p>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-2"><p className="text-xs text-amber-300">💡 Tip: {prep.curveball.tip}</p></div>
                      <div className="bg-slate-800 border border-slate-600 rounded-xl p-3"><p className="text-xs text-slate-300">{prep.curveball.sample}</p></div>
                    </div>
                  )}
                  {si===3&&(
                    <div>
                      <p className="text-xs text-slate-400 mb-3">Interviewers remember people who ask good questions — it shows genuine interest.</p>
                      {(prep.questions_to_ask||[]).map((q,i)=><p key={i} className="text-sm text-slate-300 mb-2">• {q}</p>)}
                    </div>
                  )}
                  {si===4&&(
                    <div className="flex flex-col gap-2">
                      {CHECKLIST.map((item,i)=>(
                        <button key={i} onClick={()=>setChecklist(c=>({...c,[i]:!c[i]}))}
                          className={`flex items-center gap-3 py-2.5 px-3 rounded-xl text-left transition-colors ${checklist[i]?"bg-emerald-500/10 border border-emerald-500/20":"bg-slate-800/50 border border-slate-700"}`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${checklist[i]?"border-emerald-500 bg-emerald-500":"border-slate-500"}`}>{checklist[i]&&<span className="text-white text-xs">✓</span>}</div>
                          <p className={`text-sm ${checklist[i]?"text-emerald-300 line-through":"text-slate-300"}`}>{item}</p>
                        </button>
                      ))}
                      {Object.values(checklist).filter(Boolean).length===CHECKLIST.length&&(
                        <div className="bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 border border-indigo-500/30 rounded-xl p-4 mt-2 text-center">
                          <p className="text-base font-bold text-indigo-300">You're ready! 🎉</p>
                          <p className="text-sm text-slate-400">Go get that job, {profile.name}.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <Btn onClick={()=>onComplete(prep)} className="w-full mt-2">See my full summary →</Btn>
        </div>
      )}
    </div>
  );
}

// ── STAGE 6: SUMMARY ──────────────────────────────────────────────────────────
function Stage6({ profile, resumeData, jobData, docsData, prepData }) {
  const analysis = jobData?.analysis||{};
  const resume = docsData?.generatedResume||resumeData?.rawResume||"";

  // Truncate resume at last newline before 600 chars
  const resumePreview = (() => {
    if (!resume) return "";
    if (resume.length <= 600) return resume;
    const cut = resume.slice(0,600).lastIndexOf("\n");
    return resume.slice(0, cut > 0 ? cut : 600) + "\n...";
  })();

  const SECTIONS = [
    {
      emoji:"👤", title:"Your Profile", color:"indigo", defaultOpen:true,
      content:(
        <div className="grid grid-cols-2 gap-2">
          {[["Name",profile.name],["Age",profile.age],["City",profile.city],["School",profile.schoolName],["Year",profile.grade],["Job target",profile.jobType]].map(([k,v])=>(
            <div key={k} className="bg-slate-900/50 rounded-xl px-3 py-2">
              <p className="text-xs text-slate-500">{k}</p>
              <p className="text-xs text-slate-200 font-medium">{v||"—"}</p>
            </div>
          ))}
        </div>
      )
    },
    {
      emoji:"📄", title:"Resume", color:"cyan", defaultOpen:true,
      content:(
        <div className="flex flex-col gap-2">
          {resume ? (
            <>
              <div className="bg-slate-900/50 rounded-xl p-3 max-h-48 overflow-y-auto">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{resumePreview}</pre>
              </div>
              <p className="text-xs text-slate-500">{resume.length.toLocaleString()} characters · {resume.split("\n").filter(Boolean).length} lines</p>
            </>
          ):<p className="text-xs text-slate-500">Resume not generated yet.</p>}
        </div>
      )
    },
    {
      emoji:"🎯", title:"Job Analysis", color:"amber", defaultOpen:true,
      content:(
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1 bg-slate-900/50 rounded-xl px-3 py-2 text-center"><p className="text-xl font-black text-indigo-400">{analysis.fit_pct!=null?`${analysis.fit_pct}%`:"—"}</p><p className="text-xs text-slate-500">match</p></div>
            <div className="flex-1 bg-slate-900/50 rounded-xl px-3 py-2 text-center"><p className={`text-xl font-black ${analysis.first_job_verdict==="Good"?"text-emerald-400":analysis.first_job_verdict==="OK"?"text-amber-400":"text-red-400"}`}>{analysis.first_job_verdict||"—"}</p><p className="text-xs text-slate-500">verdict</p></div>
            <div className="flex-1 bg-slate-900/50 rounded-xl px-3 py-2 text-center"><p className="text-xl font-black text-cyan-400">{analysis.ai_score_after||"—"}</p><p className="text-xs text-slate-500">ATS score</p></div>
          </div>
          <div className="bg-slate-900/50 rounded-xl px-3 py-2"><p className="text-xs text-slate-500 mb-1">Company</p><p className="text-xs text-slate-200 font-medium">{analysis.company_name||"—"} — {analysis.company_what||""}</p></div>
          {(analysis.strengths||[]).slice(0,2).map((s,i)=><p key={i} className="text-xs text-emerald-300">✅ {s.title||s}</p>)}
          {(analysis.gaps||[]).slice(0,1).map((g,i)=><p key={i} className="text-xs text-amber-300">⚡ {g.gap}</p>)}
        </div>
      )
    },
    {
      emoji:"📋", title:"Documents Generated", color:"green", defaultOpen:false,
      content:(
        <div className="flex flex-col gap-2">
          {[{label:"Resume",done:!!(docsData?.generatedResume)},{label:"Cover Letter",done:!!(docsData?.generatedCover)},{label:"Application Cheat Sheet",done:!!(jobData)}].map((d,i)=>(
            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${d.done?"bg-emerald-500/10 border border-emerald-500/20":"bg-slate-800/50 border border-slate-700"}`}>
              <span className={`text-sm ${d.done?"text-emerald-400":"text-slate-500"}`}>{d.done?"✓":"○"}</span>
              <span className={`text-xs ${d.done?"text-emerald-300":"text-slate-400"}`}>{d.label}</span>
            </div>
          ))}
        </div>
      )
    },
    {
      emoji:"💬", title:"Interview Prep", color:"indigo", defaultOpen:false,
      content:(
        <div className="flex flex-col gap-2">
          {prepData?.likely_questions?(
            <>
              <p className="text-xs text-slate-400">{prepData.likely_questions.length} questions prepared · {prepData.questions_to_ask?.length||0} questions to ask</p>
              <p className="text-xs font-semibold text-slate-300 mb-1">Top questions prepared for:</p>
              {prepData.likely_questions.slice(0,3).map((q,i)=><p key={i} className="text-xs text-slate-400 mb-1">• {q.q}</p>)}
              {prepData.curveball&&<div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2 mt-1"><p className="text-xs text-amber-300">🎱 Curveball: "{prepData.curveball.q}"</p></div>}
            </>
          ):<p className="text-xs text-slate-500">Interview prep not generated yet.</p>}
        </div>
      )
    },
  ];

  const [open, setOpen] = useState(() => {
    // Default open the first 3 sections
    const o = {};
    SECTIONS.forEach((s,i) => { if (s.defaultOpen) o[i] = true; });
    return o;
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">You're all set, {profile.name}!</h2>
        <p className="text-sm text-slate-400">Here's everything you've built. Tap any section to expand or collapse.</p>
      </div>
      <div className="flex flex-col gap-3">
        {SECTIONS.map((s,i)=>{
          const colorMap = {indigo:"border-indigo-500/30 bg-indigo-500/5",cyan:"border-cyan-500/30 bg-cyan-500/5",amber:"border-amber-500/30 bg-amber-500/5",green:"border-emerald-500/30 bg-emerald-500/5"};
          const textMap = {indigo:"text-indigo-300",cyan:"text-cyan-300",amber:"text-amber-300",green:"text-emerald-300"};
          const isOpen = !!open[i];
          return (
            <div key={i} className="border border-slate-700/50 rounded-2xl overflow-hidden">
              <button onClick={()=>setOpen(o=>({...o,[i]:!o[i]}))}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${isOpen?"bg-slate-800/80":"bg-slate-800/30 hover:bg-slate-800/50"}`}>
                <div className="flex items-center gap-2"><span>{s.emoji}</span><p className={`text-sm font-semibold ${textMap[s.color]}`}>{s.title}</p></div>
                <span className="text-slate-400 text-xs">{isOpen?"▲":"▼"}</span>
              </button>
              {isOpen&&<div className={`px-4 py-3 ${colorMap[s.color]} border-t border-slate-700/30`}>{s.content}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-6 bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 border border-indigo-500/30 rounded-2xl p-5 text-center">
        <p className="text-base font-bold text-slate-100 mb-1">Good luck, {profile.name}! 💪</p>
        <p className="text-xs text-slate-400">You've done the prep work. Now go get that job.</p>
      </div>
    </div>
  );
}

// ── TRANSITION ────────────────────────────────────────────────────────────────
function Transition({ name, onContinue }) {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-slate-100 mb-2">Profile saved, {name}!</h2>
      <p className="text-slate-400 text-sm mb-8">Let's get your resume sorted. Takes about 10 minutes.</p>
      <Btn onClick={onContinue} size="lg" className="w-full">Start my resume →</Btn>
    </div>
  );
}
function RestartModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full">
        <p className="text-base font-bold text-slate-100 mb-2">Restart everything?</p>
        <p className="text-sm text-slate-400 mb-5">This clears all progress — profile, resume, job analysis, documents. Can't be undone.</p>
        <div className="flex gap-3">
          <Btn variant="secondary" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm} className="flex-1">Yes, restart</Btn>
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [stage, setStage] = useState(1);
  const [completed, setCompleted] = useState([]);
  const [showTransition, setShowTransition] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [profile, setProfile] = useState(null);
  const [resumeData, setResumeData] = useState(null);
  const [jobData, setJobData] = useState(null);
  const [docsData, setDocsData] = useState(null);
  const [prepData, setPrepData] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async() => {
      const p = await storeGet("user:profile");
      const partial = await storeGet("user:profile:partial");
      const r = await storeGet("resume:draft");
      const j = await storeGet("job:current");
      const dc = await storeGet("docs:current");
      const ip = await storeGet("interview:prep");
      const cs = [];
      if (p) { setProfile(p); cs.push(1); }
      else if (partial) { setProfile(partial); } // restore partial wizard data
      if (r) { setResumeData(r); cs.push(2); }
      if (j) { setJobData(j); cs.push(3); }
      if (dc) { setDocsData(dc); cs.push(4); }
      if (ip) { setPrepData(ip); cs.push(5); }
      setCompleted(cs);
      if (cs.length > 0) setStage(Math.min(Math.max(...cs), 6));
      setReady(true);
    })();
  }, []);

  const complete = (s) => { setCompleted(c=>[...new Set([...c,s])]); setStage(s+1); };

  const handleRestart = async() => {
    try {
      for (const k of ["user:profile","user:profile:partial","resume:draft","job:current","docs:current","interview:prep"]) {
        try { await window.storage.delete(k); } catch {}
      }
    } catch {}
    setProfile(null); setResumeData(null); setJobData(null); setDocsData(null); setPrepData(null);
    setCompleted([]); setStage(1); setShowRestart(false); setShowTransition(false);
  };

  const goBack = () => { if (stage > 1) setStage(s=>s-1); };

  if (!ready) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Spinner msg="Loading CareerReady..."/></div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl"/>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl"/>
      </div>
      {showRestart&&<RestartModal onConfirm={handleRestart} onCancel={()=>setShowRestart(false)}/>}
      <TopNav currentStage={stage} completedStages={completed} onNav={setStage} onBack={goBack} onRestart={()=>setShowRestart(true)}/>
      <div className="relative z-10 pb-16">
        {showTransition&&profile?(
          <Transition name={profile.name} onContinue={()=>{setShowTransition(false);setStage(2);}}/>
        ):stage===1?(
          <Stage1 onComplete={p=>{setProfile(p);setCompleted(c=>[...new Set([...c,1])]);setShowTransition(true);}} savedProfile={profile}/>
        ):stage===2?(
          profile?.hasResume
            ?<Stage2B profile={profile} onComplete={d=>{setResumeData(d);complete(2);}} savedDraft={resumeData}/>
            :<Stage2A profile={profile} onComplete={d=>{setResumeData(d);complete(2);}} savedDraft={resumeData}/>
        ):stage===3?(
          <Stage3 profile={profile} resumeData={resumeData} onComplete={d=>{setJobData(d);complete(3);}} savedJob={jobData}/>
        ):stage===4?(
          <Stage4 profile={profile} resumeData={resumeData} jobData={jobData} onComplete={d=>{setDocsData(d);complete(4);}} savedDocs={docsData}/>
        ):stage===5?(
          <Stage5 profile={profile} resumeData={resumeData} jobData={jobData} savedPrep={prepData} onComplete={p=>{setPrepData(p);storeSet("interview:prep",p);complete(5);}}/>
        ):stage===6?(
          <Stage6 profile={profile} resumeData={resumeData} jobData={jobData} docsData={docsData} prepData={prepData}/>
        ):null}
      </div>
    </div>
  );
}
