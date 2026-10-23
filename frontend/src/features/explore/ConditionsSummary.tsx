import type { Conditions, Key } from './types';
import { labels } from './types';

const core:Key[]=['deposit','budget','office','minutes','move_in','kind'];
function value(c:Conditions,key:Key) {
  const v=c[key];
  if(v===null)return '제한 없음';
  if(key==='deposit'||key==='budget') return `${Number(v).toLocaleString('ko-KR')}원 이하`;
  if(key==='minutes')return `${v}분 이내`;
  if(key==='transfers')return v===0?'환승 없이':`${v}회 이내`;
  return String(v);
}
export function ConditionsSummary({conditions:c,busy,pending,canUndo,onEdit,onConfirm,onUndo}: {
  conditions:Conditions;busy:boolean;pending:boolean;canUndo:boolean;
  onEdit:(key:Key)=>void;onConfirm:()=>void;onUndo:()=>void;
}) {
  const keys=(Object.keys(labels) as Key[]).filter(k=>c[k]!==null || c.ignored.includes(k));
  const required=keys.filter(k=>k!=='office'&&!c.ignored.includes(k)&&(c.modes[k]??(['deposit','budget','move_in'].includes(k)?'required':'preferred'))==='required');
  const preferred=keys.filter(k=>k!=='office'&&!required.includes(k));
  const missing=core.filter(k=>c[k]===null&&!c.ignored.includes(k));
  function chips(group:Key[]) {return group.map(key=><button key={`${key}-${c[key]}-${c.modes[key]}-${c.ignored.includes(key)}`} className="condition-chip" disabled={busy} onClick={()=>onEdit(key)} aria-label={`${labels[key]} ${value(c,key)} 수정`}><span>{labels[key]}</span><strong>{value(c,key)}</strong><span aria-hidden="true">↗</span></button>);}
  return <section className="conditions-summary" aria-label="현재 파악한 조건">
    <header><strong>지금까지 알려주신 조건</strong><button disabled={busy||!canUndo} onClick={onUndo}>직전 변경 취소</button></header>
    <div className="summary-context"><button disabled={busy} onClick={()=>onEdit("office")} aria-label="직장 조건 수정">{c.office ? `직장 ${c.office}` : '직장 미입력'} ↗</button><span>{c.workdays === null ? '출근일 미입력' : `월 출근 ${c.workdays}일`}</span></div>
    <div className="summary-group"><h3>꼭 지킬 조건</h3><div>{required.length?chips(required):<small>아직 지정하지 않았어요.</small>}</div></div>
    <div className="summary-group"><h3>선호 조건</h3><div>{preferred.length?chips(preferred):<small>대화로 편하게 알려주세요.</small>}</div></div>
    {missing.length>0&&<p className="summary-missing">아직 필요한 정보 <span>{missing.map(k=>labels[k]).join(' · ')}</span></p>}
    {pending&&<div className="pending-confirmation"><p>해석한 값이 맞는지 대화에서 확인해 주세요.</p><button disabled={busy} onClick={onConfirm}>이대로 적용</button></div>}
    <small className="summary-hint">조건을 누르면 직접 수정할 수 있어요.</small>
  </section>;
}
