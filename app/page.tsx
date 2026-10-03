"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, AudioLines, ChevronRight, Compass, Film, Heart, MapPin, MessageCircleMore, Music2, Sparkles, Users, X } from "lucide-react";

type View = "journey" | "talk" | "spark" | "reveal" | "return";
type Adventure = { id:string; title:string; eyebrow:string; description:string; place:string; detail:string; qlooEntityId?:string; mode:"LIVE"|"DEMO"|"FALLBACK"; reason:string; trace:{reflections:string[];resolvedEntities:Array<{id:string;name:string;type:string}>;candidateCount:number;knownFilteredCount:number} };

const demoAdventure: Adventure = {
  id:"demo-tokyo-listening-bar", title:"A midnight listening bar", eyebrow:"YOUR NEXT ADVENTURE",
  description:"Follow a quiet Tokyo side street into a room built for vinyl, low light, and the kind of conversation that only starts after midnight.",
  place:"Shibuya, Tokyo", detail:"A prepared story · together", mode:"DEMO",
  reason:"A prepared example inspired by the two reflections. No Qloo entity or recommendation is represented here.",
  trace:{reflections:["Tokyo at night · lonely but beautiful","soundtrack · indie music"],resolvedEntities:[],candidateCount:0,knownFilteredCount:0}
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
  const [saveError,setSaveError]=useState(false);

  const findAdventure=useCallback(async()=>{
    setLoading(true); setPlanned(false); setSaved(false); setSaveError(false); setView("reveal");
    try{
      const response=await fetch("/api/adventure",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reflections:messages.filter(message=>message.who!=="partner")})});
      if(!response.ok) throw new Error("Unavailable");
      setAdventure(await response.json());
    }catch{ setAdventure({...demoAdventure,mode:"FALLBACK",reason:"The adventure service is unavailable. This is a prepared story, not a live recommendation."}); }finally{ setLoading(false); }
  },[]);

  const saveJourney=useCallback(async(nextReaction="planned")=>{
    setSaved(false); setSaveError(false);
    try{ const response=await fetch("/api/journey",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entityId:adventure.id,qlooEntityId:adventure.qlooEntityId,title:adventure.title,type:"place",reaction:nextReaction,reflection:note,culturalSignals:adventure.trace.resolvedEntities.map(entity=>entity.name)})}); if(!response.ok)throw new Error("Journey save failed"); setPlanned(true); setSaved(true); }catch{setSaveError(true);}
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
        <span className={`mode-pill ${loading?"checking":adventure.mode.toLowerCase()}`}><i/>{loading?"CHECKING":adventure.mode}</span>
      </header>
      <div className="screen-frame">
        {view==="journey"&&<Journey planned={planned} adventureTitle={adventure.title} onTalk={()=>setView("talk")}/>}
        {view==="talk"&&<Talk onContinue={()=>setView("spark")}/>} 
        {view==="spark"&&<SharedSpark onContinue={findAdventure}/>} 
        {view==="reveal"&&<Reveal adventure={adventure} loading={loading} planned={planned} saveError={saveError} onExplain={()=>setExplainOpen(true)} onAccept={()=>saveJourney()} onReject={()=>setView("journey")} onReturn={()=>setView("return")}/>}
        {view==="return"&&<ReturnView note={note} setNote={setNote} reaction={reaction} setReaction={setReaction} saved={saved} saveError={saveError} onSave={()=>reaction&&saveJourney(reaction)} onJourney={()=>setView("journey")}/>}
      </div>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={view==="journey"?"active":""} onClick={()=>setView("journey")}><Compass size={21}/><span>Journey</span></button>
        <button className={view==="talk"?"active":""} onClick={()=>setView("talk")}><b><MessageCircleMore size={23}/></b><span>Talk</span></button>
        <button className={view==="reveal"?"active":""} onClick={()=>setView(planned?"reveal":"talk")}><Sparkles size={21}/><span>Adventure</span></button>
      </nav>
    </section>
    <aside className="desktop-story"><span className="overline">QLOO AGENTIC HACKATHON · MVP</span><h1>Make life more interesting. <em>Together.</em></h1><p>AI shouldn&apos;t replace your friends. It should give you more to share with them.</p><div/><small>One shared reflection. One grounded adventure. One more story in your journey.</small></aside>
    {explainOpen&&<div className="modal-backdrop" onClick={()=>setExplainOpen(false)}><section className="explain-sheet" role="dialog" aria-modal="true" aria-label="Why this adventure?" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setExplainOpen(false)} aria-label="Close"><X size={18}/></button><span className="overline">{adventure.mode==="LIVE"?"QLOO RESULT":"PREPARED EXAMPLE"}</span><h2>Why this adventure?</h2><div className="trace-flow"><Trace n="01" title="Conversation" text={adventure.trace.reflections.join(" · ")}/><Trace n="02" title={adventure.mode==="LIVE"?"Qloo entities":"Cultural clues"} text={adventure.mode==="LIVE"?adventure.trace.resolvedEntities.map(entity=>entity.name+" · "+entity.type.replace("urn:entity:","")+" · "+entity.id).join(" / "):"Lost in Translation · Tokyo at night · indie soundtrack"}/><Trace n="03" title={adventure.mode==="LIVE"?"Qloo result":"Prepared story"} text={adventure.mode==="LIVE"?adventure.trace.candidateCount+" place results returned for the combined signals":"No Qloo result was used"} highlight={adventure.mode==="LIVE"}/><Trace n="04" title="Journey history" text={adventure.mode==="LIVE"?adventure.trace.knownFilteredCount+" known places excluded before this reveal":"No live history filtering claimed"}/></div><p className="reason">{adventure.reason}</p><p className="honesty">{adventure.mode==="LIVE"?"Qloo supplied the place and result order. Together wrote the explanation; no Qloo affinity score is shown.":adventure.mode==="DEMO"?"Qloo API key is not configured. This story is for the demo.":"The live request could not complete. This story is a fallback."}</p></section></div>}
  </main>
}

function Journey({planned,adventureTitle,onTalk}:{planned:boolean;adventureTitle:string;onTalk:()=>void}){return <div className="journey screen-enter"><div className="journey-intro"><div><span className="eyebrow">YOU + MIKA</span><h2>Your world is getting bigger.</h2></div><div className="avatars"><span>Y</span><span>M</span></div></div><div className="constellation"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M21 73 C31 63 36 61 45 55 S61 45 69 39 S78 27 84 18"/><path className="ghost" d="M45 55 C50 72 68 76 88 64"/></svg>{nodes.map(node=>{const Icon=node.icon;const isPlanned=node.unknown&&planned;return <div key={node.label} className={`node ${node.active?"active":""} ${node.unknown?"unknown":""} ${isPlanned?"planned":""}`} style={{left:`${node.x}%`,top:`${node.y}%`}}><span><Icon size={node.unknown?18:15}/></span><small>{isPlanned?adventureTitle:node.label}</small></div>})}<i>What should we experience next?</i></div><div className="partner-card"><span><Sparkles size={18}/></span><div><b>YOUR AI PARTNER</b><p>{planned?"It’s on the map. When you’re back, tell me what happened.":"You both noticed different things in the same film. Start with your conversation."}</p></div></div><button className="primary-action full journey-start" onClick={onTalk}><MessageCircleMore size={18}/>Talk about today</button></div>}

function Talk({onContinue}:{onContinue:()=>void}){return <div className="talk screen-enter"><Heading eyebrow="TODAY'S EXPERIENCE" title="What stayed with you?" text="Two different memories of the same movie."/><div className="experience"><Film size={16}/><span>Lost in Translation</span><small>Movie · together</small></div><div className="conversation">{messages.map((m,i)=><div key={i} className={`message ${m.who}`}><span>{m.who==="partner"?"Together":m.who==="you"?"You":"Mika"}</span><p>{m.text}</p></div>)}</div><div className="signal-preview"><AudioLines size={16}/>Film, Tokyo at night, and its indie soundtrack are the cultural clues.</div><button className="primary-action full talk-continue" onClick={onContinue}>See your Shared Spark <ChevronRight size={16}/></button></div>}

function SharedSpark({onContinue}:{onContinue:()=>void}){return <div className="spark screen-enter"><Heading eyebrow="SAME MOVIE · DIFFERENT DOORS" title="This is where you met." text="Not a score. A shared spark with two distinct edges."/><div className="venn"><div className="taste you"><small>YOU</small><strong>City solitude</strong><span>Tokyo at night</span><span>quiet beauty</span></div><div className="taste mika"><small>MIKA</small><strong>Dreamy sound</strong><span>indie music</span><span>soft nostalgia</span></div><div className="shared"><Sparkles size={19}/><strong>Intimate discovery</strong><small>your shared spark</small></div></div><div className="spark-insight"><span><Heart size={17}/></span><p>You both lean toward experiences that feel <strong>hidden, atmospheric, and a little unexpected.</strong></p></div><button className="primary-action full" onClick={onContinue}><Sparkles size={18}/>Let&apos;s follow it</button><p className="privacy"><Users size={14}/>Built from this conversation—not an identity profile.</p></div>}

function Reveal({adventure,loading,planned,saveError,onExplain,onAccept,onReject,onReturn}:{adventure:Adventure;loading:boolean;planned:boolean;saveError:boolean;onExplain:()=>void;onAccept:()=>void;onReject:()=>void;onReturn:()=>void}){if(loading)return <div className="finding"><span><Sparkles size={24}/></span><p>Wait…</p><h2>Finding your next adventure.</h2><small>Following film and music clues</small></div>;return <div className="reveal screen-enter"><article className="adventure-card">{adventure.mode==="LIVE"?<div className="live-card-art"><MapPin size={48}/></div>:<Image src="/tokyo-listening-bar.png" alt="Illustration of two people near a Tokyo listening bar" fill sizes="(max-width: 850px) 100vw, 470px" priority/>}<div className="scrim"/><div className="adventure-copy"><span className="eyebrow">{adventure.eyebrow}</span><h2>{adventure.title}</h2><p>{adventure.description}</p><div className="meta"><span><MapPin size={15}/>{adventure.place}</span><span>{adventure.detail}</span></div></div><div className="status"><Sparkles size={14}/>{adventure.mode==="LIVE"?"Qloo result":adventure.mode==="FALLBACK"?"Fallback story":"Demo story"}</div></article><button className="why" onClick={onExplain}><span><i><Sparkles size={15}/></i><span><strong>Why this adventure?</strong><small>See what grounded this reveal</small></span></span><ChevronRight size={18}/></button>{saveError&&<p role="alert" className="save-error">Could not save to your Journey. Please try again.</p>}{!planned?<div className="reveal-actions"><button onClick={onReject}>Back to Journey</button><button onClick={onAccept}>Let&apos;s go <ChevronRight size={18}/></button></div>:<div className="planned-state"><span><Sparkles size={17}/>Added to your Journey</span><button onClick={onReturn}>We went—tell you about it</button></div>}</div>}

function ReturnView({note,setNote,reaction,setReaction,saved,saveError,onSave,onJourney}:{note:string;setNote:(v:string)=>void;reaction:string|null;setReaction:(v:string)=>void;saved:boolean;saveError:boolean;onSave:()=>void;onJourney:()=>void}){const reactions=["Loved it","Good","Meh","Never again"];return <div className="return screen-enter"><div className="return-photo"><div className="return-art"/><div><span className="eyebrow">AFTER THE ADVENTURE</span><h2>So… how was it?</h2></div></div><div className="reactions">{reactions.map(r=><button key={r} className={reaction===r?"selected":""} onClick={()=>setReaction(r)}>{r}</button>)}</div><label className="reflection"><span>Tell me why <small>optional</small></span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="What stayed with you?"/></label>{saveError&&<p role="alert" className="save-error">Could not save to your Journey. Please try again.</p>}{!saved?<button className="primary-action full" disabled={!reaction} onClick={onSave}>Add this chapter</button>:<div className="saved"><span><Sparkles size={20}/></span><h3>A new node is glowing.</h3><p>Your reaction is saved in the Journey.</p><button className="primary-action full" onClick={onJourney}>See our Journey</button></div>}</div>}

function Heading({eyebrow,title,text}:{eyebrow:string;title:string;text:string}){return <div className="heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>}
function Trace({n,title,text,highlight=false}:{n:string;title:string;text:string;highlight?:boolean}){return <div className={`trace ${highlight?"highlight":""}`}><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>}
