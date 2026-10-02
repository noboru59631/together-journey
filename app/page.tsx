"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, AudioLines, ChevronRight, Compass, Film, Heart, MapPin, MessageCircleMore, Music2, Sparkles, Users, X } from "lucide-react";

type View = "journey" | "talk" | "spark" | "reveal" | "return";
type Adventure = { id:string; title:string; eyebrow:string; description:string; place:string; detail:string; qlooEntityId?:string; signals:Array<{label:string;source:"you"|"mika"|"shared"}>; mode:"LIVE"|"DEMO"; reason:string };

const demoAdventure: Adventure = {
  id:"demo-tokyo-listening-bar", title:"A midnight listening bar", eyebrow:"YOUR NEXT ADVENTURE",
  description:"Follow a quiet Tokyo side street into a room built for vinyl, low light, and the kind of conversation that only starts after midnight.",
  place:"Shibuya, Tokyo", detail:"Tonight · after 9 PM · together", mode:"DEMO",
  signals:[{label:"Tokyo after dark",source:"you"},{label:"lonely, but beautiful",source:"you"},{label:"indie soundtrack",source:"mika"},{label:"intimate discovery",source:"shared"}],
  reason:"Your reflections resolve to Lost in Translation, Tokyo nightlife, and indie music. Qloo combines those cultural entities across film, place, and music; the Journey Engine removes experiences you already know and keeps the strongest unfamiliar place-shaped result."
};
const messages = [
  {who:"partner",text:"You both watched Lost in Translation. What stayed with you?"},
  {who:"you",text:"Tokyo at night. It felt lonely, but somehow beautiful."},
  {who:"mika",text:"The soundtrack. I want more of that dreamy indie sound."}
];
const nodes = [
  {label:"Lost in Translation",icon:Film,x:21,y:73,active:true},
  {label:"Night walk",icon:MapPin,x:45,y:55},
  {label:"Indie mix",icon:Music2,x:69,y:39},
  {label:"Unknown",icon:Sparkles,x:84,y:18,unknown:true}
];

declare global { interface Document { modelContext?: { registerTool:(tool:{name:string;title:string;description:string;inputSchema:Record<string,unknown>;annotations?:Record<string,boolean>;execute:(input:unknown)=>unknown},options?:{signal?:AbortSignal})=>void|Promise<void> } } }

export default function Home(){
  const [view,setView]=useState<View>("journey");
  const [adventure,setAdventure]=useState<Adventure>(demoAdventure);
  const [loading,setLoading]=useState(false);
  const [explainOpen,setExplainOpen]=useState(false);
  const [planned,setPlanned]=useState(false);
  const [note,setNote]=useState("");
  const [reaction,setReaction]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);

  const findAdventure=useCallback(async()=>{
    setLoading(true); setView("reveal");
    try{
      const response=await fetch("/api/adventure",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({journeyId:"journey-demo-shared",location:"Tokyo",reflections:messages.filter(m=>m.who!=="partner"),knownEntityIds:["lost-in-translation"]})});
      if(!response.ok) throw new Error("Unavailable");
      setAdventure(await response.json());
    }catch{ setAdventure(demoAdventure); }finally{ setLoading(false); }
  },[]);

  const saveJourney=useCallback(async(nextReaction="planned")=>{
    setPlanned(true); setSaved(false);
    try{ await fetch("/api/journey",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({journeyId:"journey-demo-shared",entityId:adventure.id,qlooEntityId:adventure.qlooEntityId,title:adventure.title,type:"place",reaction:nextReaction,reflection:note,culturalSignals:adventure.signals.map(s=>s.label),withWhom:"Mika",discoveredFrom:"Lost in Translation"})}); }finally{ setSaved(true); }
  },[adventure,note]);

  useEffect(()=>{
    const context=document.modelContext; if(!context?.registerTool) return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({name:"reveal_next_adventure",title:"Reveal the next adventure",description:"Use the current shared reflections to reveal one culturally grounded next adventure.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:async()=>{await findAdventure();return{status:"revealed"};}},{signal:lifecycle.signal})).catch(()=>undefined);
    return()=>lifecycle.abort();
  },[findAdventure]);

  const titles:Record<View,string>={journey:"Our Journey",talk:"Talk",spark:"Shared Spark",reveal:"Next Adventure",return:"After"};
  return <main className="app-shell">
    <div className="aurora one"/><div className="aurora two"/>
    <section className="phone-stage" aria-label="Together journey app">
      <header className="topbar">
        <button className={`icon-button ${view==="journey"?"invisible":""}`} onClick={()=>setView(view==="return"?"reveal":"journey")} aria-label="Go back"><ArrowLeft size={19}/></button>
        <div className="brand"><span><Sparkles size={13}/></span>{titles[view]}</div>
        <span className={`mode-pill ${adventure.mode.toLowerCase()}`}><i/>{adventure.mode}</span>
      </header>
      <div className="screen-frame">
        {view==="journey"&&<Journey planned={planned} onTalk={()=>setView("talk")} onReveal={findAdventure}/>} 
        {view==="talk"&&<Talk onContinue={()=>setView("spark")}/>} 
        {view==="spark"&&<SharedSpark onContinue={findAdventure}/>} 
        {view==="reveal"&&<Reveal adventure={adventure} loading={loading} planned={planned} onExplain={()=>setExplainOpen(true)} onAccept={()=>saveJourney()} onReject={()=>setAdventure({...demoAdventure,id:"demo-tokyo-cinema",title:"A tiny late-night cinema",description:"A one-screen repertory cinema, followed by a slow walk through the city lights."})} onReturn={()=>setView("return")}/>} 
        {view==="return"&&<ReturnView note={note} setNote={setNote} reaction={reaction} setReaction={setReaction} saved={saved} onSave={()=>reaction&&saveJourney(reaction)} onJourney={()=>setView("journey")}/>} 
      </div>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={view==="journey"?"active":""} onClick={()=>setView("journey")}><Compass size={21}/><span>Journey</span></button>
        <button className={view==="talk"?"active":""} onClick={()=>setView("talk")}><b><MessageCircleMore size={23}/></b><span>Talk</span></button>
        <button className={view==="reveal"?"active":""} onClick={findAdventure}><Sparkles size={21}/><span>Adventure</span></button>
      </nav>
    </section>
    <aside className="desktop-story"><span className="overline">QLOO AGENTIC HACKATHON · MVP</span><h1>Make life more interesting. <em>Together.</em></h1><p>AI shouldn&apos;t replace your friends. It should give you more to share with them.</p><div/><small>One shared reflection. One grounded adventure. One more story in your journey.</small></aside>
    {explainOpen&&<div className="modal-backdrop" onClick={()=>setExplainOpen(false)}><section className="explain-sheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setExplainOpen(false)} aria-label="Close"><X size={18}/></button><span className="overline">TRACEABLE BY DESIGN</span><h2>Why this adventure?</h2><div className="trace-flow"><Trace n="01" title="Conversation" text="Tokyo at night · lonely but beautiful · indie soundtrack"/><Trace n="02" title="Resolved entities" text="Lost in Translation · Tokyo nightlife · indie music"/><Trace n="03" title="Qloo Taste Graph" text="Cross-domain affinity across film, music, and place" highlight/><Trace n="04" title="Journey filter" text="Known experiences removed · shared context applied"/></div><p className="reason">{adventure.reason}</p><p className="honesty">{adventure.mode==="LIVE"?"Built from a live Qloo response.":"Demo path using a fixed, clearly labeled fallback. Add QLOO_API_KEY to enable live grounding."}</p></section></div>}
  </main>
}

function Journey({planned,onTalk,onReveal}:{planned:boolean;onTalk:()=>void;onReveal:()=>void}){return <div className="journey screen-enter"><div className="journey-intro"><div><span className="eyebrow">YOU + MIKA</span><h2>Your world is getting bigger.</h2></div><div className="avatars"><span>Y</span><span>M</span></div></div><div className="constellation"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M21 73 C31 63 36 61 45 55 S61 45 69 39 S78 27 84 18"/><path className="ghost" d="M45 55 C50 72 68 76 88 64"/></svg>{nodes.map(node=>{const Icon=node.icon;const isPlanned=node.unknown&&planned;return <div key={node.label} className={`node ${node.active?"active":""} ${node.unknown?"unknown":""} ${isPlanned?"planned":""}`} style={{left:`${node.x}%`,top:`${node.y}%`}}><span><Icon size={node.unknown?18:15}/></span><small>{isPlanned?"Listening bar":node.label}</small></div>})}<i>3 experiences · 1 new edge</i></div><div className="partner-card"><span><Sparkles size={18}/></span><div><b>YOUR AI PARTNER</b><p>{planned?"It’s on the map. When you’re back, tell me what happened.":"I noticed something in what you both said. Want to follow it?"}</p></div></div><div className="dual-actions"><button className="secondary-action" onClick={onTalk}><MessageCircleMore size={18}/>Talk about today</button><button className="primary-action" onClick={onReveal}><Sparkles size={18}/>Find our next</button></div></div>}

function Talk({onContinue}:{onContinue:()=>void}){const[draft,setDraft]=useState("");return <div className="talk screen-enter"><Heading eyebrow="TODAY'S EXPERIENCE" title="What stayed with you?" text="There’s no right answer. A detail, a feeling, a sound—anything."/><div className="experience"><Film size={16}/><span>Lost in Translation</span><small>Movie · together</small></div><div className="conversation">{messages.map((m,i)=><div key={i} className={`message ${m.who}`}><span>{m.who==="partner"?"Together":m.who==="you"?"You":"Mika"}</span><p>{m.text}</p></div>)}</div><div className="signal-preview"><AudioLines size={16}/>Listening for cultural clues, not judging feelings.</div><div className="composer"><textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Add one more thought…"/><button onClick={onContinue} aria-label="Continue"><ChevronRight/></button></div><button className="text-action" onClick={onContinue}>See what connected you both <ChevronRight size={16}/></button></div>}

function SharedSpark({onContinue}:{onContinue:()=>void}){return <div className="spark screen-enter"><Heading eyebrow="SAME MOVIE · DIFFERENT DOORS" title="This is where you met." text="Not a score. A shared spark with two distinct edges."/><div className="venn"><div className="taste you"><small>YOU</small><strong>City solitude</strong><span>Tokyo at night</span><span>quiet beauty</span></div><div className="taste mika"><small>MIKA</small><strong>Dreamy sound</strong><span>indie music</span><span>soft nostalgia</span></div><div className="shared"><Sparkles size={19}/><strong>Intimate discovery</strong><small>your shared spark</small></div></div><div className="spark-insight"><span><Heart size={17}/></span><p>You both lean toward experiences that feel <strong>hidden, atmospheric, and a little unexpected.</strong></p></div><button className="primary-action full" onClick={onContinue}><Sparkles size={18}/>Let&apos;s follow it</button><p className="privacy"><Users size={14}/>Built from this conversation—not an identity profile.</p></div>}

function Reveal({adventure,loading,planned,onExplain,onAccept,onReject,onReturn}:{adventure:Adventure;loading:boolean;planned:boolean;onExplain:()=>void;onAccept:()=>void;onReject:()=>void;onReturn:()=>void}){if(loading)return <div className="finding"><span><Sparkles size={24}/></span><p>Wait…</p><h2>I found something.</h2><small>Connecting film, music, and place through Qloo</small></div>;return <div className="reveal screen-enter"><article className="adventure-card"><Image src="/tokyo-listening-bar.png" alt="Two people walking toward a warm Tokyo listening bar" fill sizes="(max-width: 850px) 100vw, 470px" priority/><div className="scrim"/><div className="adventure-copy"><span className="eyebrow">{adventure.eyebrow}</span><h2>{adventure.title}</h2><p>{adventure.description}</p><div className="meta"><span><MapPin size={15}/>{adventure.place}</span><span>{adventure.detail}</span></div></div><div className="status"><Sparkles size={14}/>{adventure.mode==="LIVE"?"Qloo grounded":"Demo story"}</div></article><button className="why" onClick={onExplain}><span><i><Sparkles size={15}/></i><span><strong>Why this adventure?</strong><small>See the taste path</small></span></span><ChevronRight size={18}/></button>{!planned?<div className="reveal-actions"><button onClick={onReject}>Not for us</button><button onClick={onAccept}>Let&apos;s go <ChevronRight size={18}/></button></div>:<div className="planned-state"><span><Sparkles size={17}/>Added to your Journey</span><button onClick={onReturn}>We went—tell you about it</button></div>}</div>}

function ReturnView({note,setNote,reaction,setReaction,saved,onSave,onJourney}:{note:string;setNote:(v:string)=>void;reaction:string|null;setReaction:(v:string)=>void;saved:boolean;onSave:()=>void;onJourney:()=>void}){const reactions=["Loved it","Good","Meh","Never again"];return <div className="return screen-enter"><div className="return-photo"><Image src="/tokyo-listening-bar.png" alt="Night in Tokyo" fill sizes="(max-width: 850px) 100vw, 470px"/><div><span className="eyebrow">THE MORNING AFTER</span><h2>So… how was it?</h2></div></div><div className="reactions">{reactions.map(r=><button key={r} className={reaction===r?"selected":""} onClick={()=>setReaction(r)}>{r}</button>)}</div><label className="reflection"><span>Tell me why <small>optional</small></span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="The room felt like a secret…"/></label>{!saved?<button className="primary-action full" disabled={!reaction} onClick={onSave}>Add this chapter</button>:<div className="saved"><span><Sparkles size={20}/></span><h3>A new node is glowing.</h3><p>I&apos;ll carry what you said into the next adventure.</p><button className="primary-action full" onClick={onJourney}>See our Journey</button></div>}</div>}

function Heading({eyebrow,title,text}:{eyebrow:string;title:string;text:string}){return <div className="heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>}
function Trace({n,title,text,highlight=false}:{n:string;title:string;text:string;highlight?:boolean}){return <div className={`trace ${highlight?"highlight":""}`}><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>}
