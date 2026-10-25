import { useId, useRef, useState } from 'react';
import type { ReactNode, PointerEvent, KeyboardEvent } from 'react';

const roads = [
  'M-30 190Q240 220 420 295T1040 340',
  'M-30 650Q210 600 390 635T1040 700',
  'M180-30Q205 185 290 350L350 840',
  'M570-40Q520 180 550 325L620 850',
  'M885-20Q780 200 820 370L880 840',
  'M-30 85L1030 175',
  'M-30 755L1030 790',
];
const river = 'M-60 440C120 350 215 555 395 500S605 355 760 440 930 535 1070 400';
// All footprints and landmarks are decorative, not surveyed geography.
const blocks = Array.from({length: 200}, (_, i) => {
  const col = i % 20, row = Math.floor(i / 20);
  return {x:col*54+9+(row%2)*12,y:row*89+10,w:18+(i*13)%23,h:13+(i*7)%30};
});
export function IllustratedMap() {
  const id = useId().replaceAll(':','');
  return <svg className="seoul-map detailed-map" viewBox="0 0 1000 800" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <pattern id={`${id}-streets`} width="108" height="89" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
        <rect width="108" height="89" fill="#f2f0e7"/>
        <path d="M0 0H108V89M54 0V89M0 45H108" fill="none" stroke="#fffdf8" strokeWidth="5"/>
      </pattern>
      <pattern id={`${id}-trees`} width="25" height="23" patternUnits="userSpaceOnUse">
        <rect width="25" height="23" fill="#dfe8d0"/><circle cx="7" cy="7" r="4" fill="#cadab9"/><circle cx="20" cy="18" r="3" fill="#c9d9b7"/>
      </pattern>
      <linearGradient id={`${id}-water`} x2="0" y2="1"><stop stopColor="#bfdfdf"/><stop offset="1" stopColor="#a7cfd2"/></linearGradient>
    </defs>
    <rect width="1000" height="800" fill={`url(#${id}-streets)`}/>
    <g fill="#e5e2d8" stroke="#dddacf" strokeWidth=".7" opacity=".85">{blocks.map((b,i)=><rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="2" transform={`rotate(${i%3===0 ? -8 : 0} ${b.x} ${b.y})`}/>)}</g>
    <g fill={`url(#${id}-trees)`} stroke="#d0ddbf" strokeWidth="1.5"><path d="M10 12L145 5 180 75 137 145 20 120Z"/><path d="M752 0H1000V195L924 185 875 113 795 93Z"/><path d="M22 660L120 650 171 729 128 800H0Z"/><path d="M756 628L810 610 853 666 825 739 754 716Z"/></g>
    <g fill="none" strokeLinecap="round">{roads.map((d,i)=><g key={d}><path d={d} stroke="#ddd8c9" strokeWidth={i<5?19:12}/><path d={d} stroke="#fffdf6" strokeWidth={i<5?16:10}/><path d={d} stroke="#e8dcb8" strokeWidth="1"/></g>)}</g>
    <path d={river} fill="none" stroke="#d8e3c7" strokeWidth="99"/>
    <path d={river} fill="none" stroke="#f5f4e5" strokeWidth="85"/>
    <path d={river} fill="none" stroke={`url(#${id}-water)`} strokeWidth="73"/>
    <path d="M-40 430C120 355 215 540 390 488S610 366 755 429 930 520 1050 407" fill="none" stroke="#d6eeee" strokeWidth="1.5" opacity=".7"/>
    <g fill="none">{['M265 426L300 529','M460 422L492 503','M675 383L655 470','M864 452L843 530'].map(d=><g key={d}><path d={d} stroke="#b5b9aa" strokeWidth="16"/><path d={d} stroke="#fffdf5" strokeWidth="12"/><path d={d} stroke="#e4d8b6" strokeWidth="1.3"/></g>)}</g>
    <g fill="#e9e5d7" stroke="#d5cfbf"><rect x="463" y="221" width="32" height="44" rx="4"/><rect x="704" y="267" width="48" height="29" rx="4"/><rect x="383" y="690" width="37" height="27" rx="3"/></g>
    <g fill="none" stroke="#bdc6b4" strokeDasharray="5 5" strokeWidth="1.2"><path d="M335 0L390 170 430 310M650 10L680 180 720 310M160 600L200 800M710 560L750 800"/></g>
    <g fontFamily="inherit" fontSize="12" fill="#8d9584" textAnchor="middle"><text x="92" y="72">동네 숲</text><text x="918" y="90">초록 산책공원</text><text x="798" y="680">작은 공원</text><text x="75" y="740">산책길</text></g>
    <g fill="#b5c3a5">{[0,1,2,3,4,5,6,7].map(i=><circle key={i} cx={143+i*12} cy={569+i*1.5} r="3"/>)}</g>
  </svg>;
}

export function MapViewport({children}: {children: ReactNode}) {
  const [view, setView] = useState({zoom:1,x:0,y:0});
  const [dragging,setDragging] = useState(false);
  const frame=useRef<HTMLDivElement>(null);
  const drag=useRef<{id:number;x:number;y:number;originX:number;originY:number;distance:number}|null>(null);
  const suppressClick=useRef(false);
  function bound(x:number,y:number,zoom:number) {
    const w=frame.current?.clientWidth ?? 1000,h=frame.current?.clientHeight ?? 800;
    const maxX=w*(.12+(zoom-1)*.62),maxY=h*(.12+(zoom-1)*.62);
    return {zoom,x:Math.max(-maxX,Math.min(maxX,x)),y:Math.max(-maxY,Math.min(maxY,y))};
  }
  function zoom(step:number) {setView(v=>bound(v.x,v.y,Math.max(1,Math.min(2.5,Math.round((v.zoom+step)*100)/100))));}
  function down(e:PointerEvent<HTMLDivElement>) {
    if(e.button!==0 || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.focus({preventScroll:true});
    drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,originX:view.x,originY:view.y,distance:0};
    e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);suppressClick.current=false;
  }
  function move(e:PointerEvent<HTMLDivElement>) {
    const d=drag.current;if(!d||d.id!==e.pointerId)return;
    const x=e.clientX-d.x,y=e.clientY-d.y;d.distance=Math.max(d.distance,Math.hypot(x,y));
    setView(bound(d.originX+x,d.originY+y,view.zoom));
  }
  function end(e:PointerEvent<HTMLDivElement>) {
    if(!drag.current || drag.current.id!==e.pointerId)return;
    suppressClick.current=drag.current.distance>5;drag.current=null;setDragging(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function key(e:KeyboardEvent<HTMLDivElement>) {
    if(e.target!==e.currentTarget)return;
    const delta:Record<string,[number,number]>={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]};
    if(delta[e.key]) {e.preventDefault();const [x,y]=delta[e.key];setView(v=>bound(v.x+x,v.y+y,v.zoom));}
    if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.25);}
    if(e.key==='-'){e.preventDefault();zoom(-.25);}
    if(e.key==='Home'){e.preventDefault();setView({zoom:1,x:0,y:0});}
  }
  return <>
    <div ref={frame} className={`map-interaction ${dragging?'is-dragging':''}`} tabIndex={0} aria-label="시연 지도 탐색. 드래그 또는 방향키로 이동하고 더하기·빼기로 확대·축소합니다." onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClickCapture={e=>{if(suppressClick.current){e.stopPropagation();suppressClick.current=false;}}}>
      <div className="map-world" style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.zoom})`}}>{children}</div>
    </div>
    <div className="map-navigation"><span className="map-compass" aria-hidden="true">N<span>↑</span></span><div className="zoom-buttons"><button aria-label="지도 확대" disabled={view.zoom>=2.5} onClick={()=>zoom(.25)}>+</button><span aria-live="polite">{Math.round(view.zoom*100)}%</span><button aria-label="지도 축소" disabled={view.zoom<=1} onClick={()=>zoom(-.25)}>−</button></div><button className="map-reset" aria-label="지도 처음 위치로" onClick={()=>setView({zoom:1,x:0,y:0})}>⌖</button></div>
    <div className="map-style-label">동네 둘러보기 <span>드래그로 이동 · + / − 확대</span></div>
  </>;
}
