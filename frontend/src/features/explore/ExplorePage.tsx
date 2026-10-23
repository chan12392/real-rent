import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { requestApi } from "../../lib/api";
import { Rabbit } from "./Rabbit";
import { Companion } from "./Companion";
import { StreetMap } from "./StreetMap";
import { initial, labels, moods, won } from "./types";
import type { Conditions, Home, Key, Message, Result } from "./types";
import "./explore.css";

const STORAGE = "real-rent-explore-v1";
const greeting: Message = {
  role: "assistant",
  text: "야하~! 안녕하세요! 함께 살 곳을 찾아볼까요? 예산과 직장, 원하는 조건을 편하게 말씀해 주세요.",
};
const suggestions = [
  "보증금 천만 원, 월 80만 원, 강남역까지 40분",
  "환승 없이 가고 싶어요",
  "가능하면 원룸이 좋아요",
];
function restore(): {
  conditions: Conditions;
  messages: Message[];
  selected: string | null;
  confirmed: boolean;
  history: Conditions[];
  pending: Conditions | null;
} {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (
      raw &&
      typeof raw.conditions === "object" &&
      raw.conditions &&
      Array.isArray(raw.messages) &&
      raw.messages.every(
        (m: Message) =>
          ["user", "assistant"].includes(m.role) && typeof m.text === "string",
      )
    ) {
      return {
        conditions: { ...initial, ...raw.conditions },
        messages: raw.messages.slice(-100),
        selected: typeof raw.selected === "string" ? raw.selected : null,
        confirmed: raw.confirmed === true,
        history: Array.isArray(raw.history) ? raw.history.slice(-20) : [],
        pending: raw.pending && typeof raw.pending === 'object' ? raw.pending : null,
      };
    }
  } catch {
    /* Missing or damaged local state starts a fresh search. */
  }
  return {
    conditions: initial,
    messages: [greeting],
    selected: null,
    confirmed: false,
    history: [],
    pending: null,
  };
}
function isResult(data: unknown): data is Result {
  if (!data || typeof data !== "object") return false;
  const r = data as Partial<Result>;
  return (
    r.synthetic === true &&
    typeof r.reply === "string" &&
    typeof r.partial === "boolean" &&
    !!r.conditions &&
    Array.isArray(r.conditions.ignored) &&
    Array.isArray(r.homes) &&
    r.homes.length === 12 &&
    r.homes.every(
      (h) =>
        typeof h.id === "string" &&
        typeof h.name === "string" &&
        typeof h.x === "number" &&
        typeof h.y === "number" &&
        h.status in moods &&
        Array.isArray(h.checks) &&
        Array.isArray(h.reasons),
    )
  );
}

export function ExplorePage() {
  const [saved] = useState(restore);
  const [conditions, setConditions] = useState(saved.conditions);
  const [messages, setMessages] = useState(saved.messages);
  const [history, setHistory] = useState<Conditions[]>(saved.history);
  const [pending, setPending] = useState<Conditions | null>(saved.pending);
  const [selected, setSelected] = useState<string | null>(saved.selected);
  const [confirmed, setConfirmed] = useState(saved.confirmed);
  const [resetArmed, setResetArmed] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [showConditions, setShowConditions] = useState(false);
  const [editorPosition, setEditorPosition] = useState({ left: 16, top: 60 });
  const [editingCondition, setEditingCondition] = useState<Key | "workdays" | null>(null);
  const [storageError, setStorageError] = useState(false);
  const sequence = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const conditionBar = useRef<HTMLElement>(null);
  const conditionEditor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!showConditions) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (conditionBar.current?.contains(target) || conditionEditor.current?.contains(target)) return;
      setShowConditions(false);
    };
    // Click follows input blur, so the existing value update runs before closing.
    // Capture also sees map clicks that Leaflet stops from bubbling.
    document.addEventListener("click", dismiss, true);
    return () => document.removeEventListener("click", dismiss, true);
  }, [showConditions]);
  const home = result?.homes.find((h) => h.id === selected);
  const current = home?.status || "idle";
  const active = Object.keys(labels).some((k) => conditions[k as Key] !== null);
  const ready =
    !busy &&
    !!result &&
    !error &&
    JSON.stringify(conditions) === JSON.stringify(result.conditions);

  async function update(next: Conditions, message = "", addMessage = true) {
    const resetting = next === initial;
    next = { ...next, ignored: (next.ignored ?? []).filter(k => next[k] === null) };
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const data = await requestApi("/explore", isResult, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: next, message,
          previous_conditions: resetting ? null : history.at(-1) ?? null,
          pending_conditions: resetting || (addMessage && !message) ? null : pending,
        }),
      });
      if (id !== sequence.current) return;
      const before = result?.conditions ?? conditions;
      if (addMessage && JSON.stringify(data.conditions) !== JSON.stringify(before)) {
        setHistory(h => data.undone ? h.slice(0,-1) : [...h,before].slice(-20));
      }
      setPending(data.pending_conditions ?? null);
      setResult(data);
      setConditions(data.conditions);
      if (addMessage)
        setMessages((m) =>
          [
            ...m,
            ...(message ? [{ role: "user" as const, text: message }] : []),
            { role: "assistant" as const, text: `야하~ ${data.reply}` },
          ].slice(-100),
        );
      setInput("");
    } catch (reason) {
      if (id === sequence.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "잠시 후 다시 시도해 주세요.",
        );
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void update(saved.conditions, "", false);
    return () => {
      sequence.current += 1;
    };
    // Only restore once; subsequent requests are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ conditions, messages, selected, confirmed, history, pending }),
      );
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [conditions, messages, selected, confirmed, history, pending]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, selected, result]);
  function send(event: FormEvent) {
    event.preventDefault();
    if (input.trim() && !busy) void update(conditions, input.trim());
  }
  function change(key: keyof Conditions, value: unknown) {
    const next = { ...conditions, [key]: value };
    if (key in labels && value !== null) next.ignored = conditions.ignored.filter(k => k !== key);
    void update(next, "", true);
  }
  function openCondition(key: Key | "workdays", event: ReactMouseEvent<HTMLButtonElement>) {
    const panel = conditionBar.current?.parentElement?.getBoundingClientRect();
    const button = event.currentTarget.getBoundingClientRect();
    const bar = conditionBar.current?.getBoundingClientRect();
    const detail = conditionBar.current?.closest(".workspace")?.querySelector(".details");
    const overlayWidth = window.innerWidth > 760 ? detail?.getBoundingClientRect().width ?? 0 : 0;
    if (panel && bar) setEditorPosition({
      left: Math.max(12, Math.min(button.left - panel.left, panel.width - overlayWidth - 352)),
      top: bar.bottom - panel.top + 8,
    });
    setEditingCondition(key);
    setShowConditions(true);
    window.setTimeout(() => document.getElementById(`condition-${key}`)?.focus(), 0);
  }
  function reset() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setShowConditions(false);
    setEditingCondition(null);
    setMessages([greeting]);
    setHistory([]);
    setPending(null);
    setSelected(null);
    setConfirmed(false);
    setInput("");
    setConditions(initial);
    setResult(null);
    void update(initial, "", false);
  }
  const reaction = pending && !busy
    ? (messages.findLast(m => m.role === "assistant")?.text ?? "해석한 조건을 확인해 주세요.")
    : busy
    ? "우라… 조건을 차근차근 살펴보고 있어요."
    : home
      ? `${home.status === "good" ? "우라~! " : home.status === "so-so" ? "야하…? " : home.status === "bad" ? "우라…! " : "야하? "}${home.name}, ${home.reasons.join(" ").replaceAll("필수 조건 미충족", "필수 조건에 맞지 않아요.").replaceAll("선호 미충족", "선호에는 조금 아쉬워요.")}`
      : (messages.findLast(m => m.role === "assistant")?.text ?? "야하~! 지도에서 궁금한 집을 눌러보세요.");
  return (
    <main className="explore-app">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="REAL RENT 홈">
          <span>⌂</span> REAL RENT<span className="wordmark-dot">.</span>
        </a>
        <span className="demo-pill">합성 데이터 시연</span>
        <nav>
          <button className="new-search" onClick={reset} disabled={busy}>
            {resetArmed ? "대화를 지우고 새로 시작할까요?" : "새로운 조건으로 찾아보기"}
          </button>
        </nav>
      </header>
      <div className="workspace">
        <aside className="conversation" aria-label="집 찾기 대화">
          <div className="chat-log" role="log" aria-label="대화 내역">
            {messages.map((m, i) => (
              m.role === "assistant" && i === messages.length - 1 && !home && !busy ? null : <div className={`chat-message ${m.role}`} key={i}>
                {m.role === "assistant" && (
                  <span className="chat-avatar" aria-hidden="true"><Rabbit small /></span>
                )}
                <p>{m.text}</p>
              </div>
            ))}
            {active && !confirmed && (
              <div className="confirmation">
                <p>
                  별도 지정이 없으면 예산·입주일은 필수, 통근·유형은 선호예요.
                  이렇게 찾아볼까요?
                </p>
                <button disabled={busy} onClick={() => setConfirmed(true)}>
                  이대로 찾기 ✓
                </button>
                <button onClick={() => { setEditingCondition(null); setShowConditions(true); }}>
                  조건 수정
                </button>
              </div>
            )}
            {busy && (
              <p className="typing" role="status">
                조건을 살펴보고 있어요 <span>•••</span>
              </p>
            )}
            {active && ready && conditions.office && (
              <div className="recommendation-list">
                <h3>
                  먼저 살펴볼 집 <small>월 지출이 적은 순</small>
                </h3>
                {result.homes
                  .filter((h) => h.status === "good")
                  .slice(0, 3)
                  .map((h) => (
                    <button key={h.id} onClick={() => setSelected(h.id)}>
                      <span>{h.name}</span>
                      <strong>{won(h.total)} ↗</strong>
                    </button>
                  ))}
                {!result.homes.some((h) => h.status === "good") && (
                  <p>
                    지금 추천 기준에 맞는 집은 없어요. 지도의 다른 집도 살펴볼
                    수 있어요.
                  </p>
                )}
              </div>
            )}
            <div className="latest-reply">
              <Companion text={reaction} mood={pending ? "unknown" : busy ? "searching" : current} selected={!!home || !!pending} />
            </div>
            <div ref={chatEnd} />
          </div>
          {error && (
            <div className="api-error" role="alert">
              {error}
              <button
                onClick={() => void update(conditions, input, !!input)}
                disabled={busy}
              >
                다시 연결하기
              </button>
            </div>
          )}
          <div className="composer-area">
            <div className="suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  disabled={busy}
                  onClick={() => void update(conditions, s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <form onSubmit={send} className="composer">
              <input
                aria-label="집 찾기 메시지"
                placeholder="어떤 집을 찾고 계세요?"
                value={input}
                maxLength={2000}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                aria-label="메시지 보내기"
                disabled={!input.trim() || busy}
              >
                ↑
              </button>
            </form>
            <small>
              {storageError
                ? "브라우저 저장을 사용할 수 없어 새로고침하면 초기화돼요."
                : "대화는 이 브라우저에 저장돼요. 상단에서 새로운 조건으로 시작할 수 있어요."}
            </small>
          </div>
        </aside>
        <section className="map-panel" aria-label="서울 합성 매물 시연 지도">
          <section ref={conditionBar} className="map-conditions" aria-label="대화로 정한 현재 조건" aria-live="polite">
            <strong>나의 조건</strong>
            <div className="map-condition-items">
              {(Object.keys(labels) as Key[]).map(key => {
                const value = conditions[key];
                const text = conditions.ignored.includes(key) ? "상관없어요"
                  : value === null ? "미입력"
                  : key === "deposit" || key === "budget" ? `${(Number(value) / 10000).toLocaleString("ko-KR")}만 이하`
                  : key === "minutes" ? `${value}분 이내`
                  : key === "transfers" ? value === 0 ? "환승 없이" : `${value}회 이내`
                  : String(value);
                const mode = conditions.ignored.includes(key) || key === "office" ? null
                  : conditions.modes[key] ?? (["deposit", "budget", "move_in"].includes(key) ? "required" : "preferred");
                return <button className={`map-condition ${value !== null || conditions.ignored.includes(key) ? "is-set" : ""}`} key={key} disabled={busy} aria-expanded={showConditions && editingCondition === key} onClick={event => openCondition(key, event)}>
                  <span>{{ deposit: "보증금", budget: "월 예산", office: "직장", minutes: "통근", move_in: "입주일", kind: "주거 유형", transfers: "환승" }[key]}</span>{(value !== null || conditions.ignored.includes(key)) && <b>{text}</b>}
                  {mode && value !== null && <small>{mode === "required" ? "필수" : "선호"}</small>}<i className="condition-chevron" aria-hidden="true" />
                </button>;
              })}
              <button className="map-condition is-set" disabled={busy} aria-expanded={showConditions && editingCondition === "workdays"} onClick={event => openCondition("workdays", event)}><span>출근</span><b>월 {conditions.workdays}일</b><i className="condition-chevron" aria-hidden="true" /></button>
            </div>
          </section>
          {showConditions && (
            <section ref={conditionEditor} className="condition-editor map-condition-editor" style={editorPosition} aria-label="조건 수정" onKeyDown={e => { if (e.key === "Escape") setShowConditions(false); }}>
              <header><strong>{editingCondition === "workdays" ? "월 출근일" : editingCondition ? labels[editingCondition] : "조건 수정"}</strong><button onClick={() => setShowConditions(false)} aria-label="조건 설정 닫기">닫기 ×</button></header>
              <p>{editingCondition === "workdays" ? "월 통근비 계산에 사용하는 출근 일수예요." : editingCondition === "office" ? "통근을 비교할 직장 위치를 선택해 주세요." : "원하는 조건과 필수·선호를 설정해 주세요."}</p>
              {(Object.keys(labels) as Key[]).filter(key => !editingCondition || editingCondition === key).map((key) => (
                <div className="condition-row" key={key}>
                  <label>
                    {labels[key]}{(key === "deposit" || key === "budget") && " (원)"}
                    {key === "office" || key === "kind" ? (
                      <select
                        id={`condition-${key}`}
                        disabled={busy}
                        value={conditions[key] ?? ""}
                        onChange={(e) => change(key, e.target.value || null)}
                      >
                        <option value="">미입력</option>
                        {(key === "office"
                          ? ["강남역", "서울역", "여의도역"]
                          : ["원룸", "오피스텔", "빌라"]
                        ).map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        disabled={busy}
                        id={`condition-${key}`}
                        type={key === "move_in" ? "date" : "number"}
                        min="0"
                        max={
                          key === "transfers"
                            ? 10
                            : key === "minutes"
                              ? 1440
                              : key === "budget"
                                ? 100000000
                                : key === "deposit"
                                  ? 1000000000
                                  : undefined
                        }
                        value={conditions[key] ?? ""}
                        placeholder="미입력"
                        onBlur={() => {
                          if (!busy && conditions[key] !== result?.conditions[key]) void update(conditions);
                        }}
                        onChange={(e) => {
                          if (e.target.validity.valid)
                            setConditions((c) => ({
                              ...c,
                              [key]:
                                e.target.value === ""
                                  ? null
                                  : key === "move_in"
                                    ? e.target.value
                                    : Number(e.target.value),
                            }));
                        }}
                      />
                    )}
                  </label>
                  <select
                    aria-label={`${labels[key]} 중요도`}
                    disabled={busy || key === "office"}
                    value={
                      conditions.modes[key] ??
                      (["deposit", "budget", "move_in", "office"].includes(key)
                        ? "required"
                        : "preferred")
                    }
                    onChange={(e) =>
                      change("modes", {
                        ...conditions.modes,
                        [key]: e.target.value,
                      })
                    }
                  >
                    <option value="required">필수</option>
                    <option value="preferred">선호</option>
                  </select>
                </div>
              ))}
              {(!editingCondition || editingCondition === "workdays") && <label>
                월 출근일
                <input
                  id="condition-workdays"
                  type="number"
                  min="0"
                  max="31"
                  disabled={busy}
                  value={conditions.workdays}
                  onBlur={() => {
                    if (!busy && conditions.workdays !== result?.conditions.workdays) void update(conditions);
                  }}
                  onChange={(e) => {
                    if (e.target.validity.valid && e.target.value !== "")
                      setConditions((c) => ({
                        ...c,
                        workdays: Number(e.target.value),
                      }));
                  }}
                />
              </label>}
            </section>
          )}
          <div className="map-result-summary" role="status">
            {!result ? "시연 매물을 불러오고 있어요."
              : `${result.homes.length}개 시연 매물${active ? ` · 추천 ${result.homes.filter(h => h.status === "good").length}개 · ${result.partial ? "입력된 조건 기준 임시 결과" : "모든 조건 반영"}` : " · 대화로 조건을 알려주세요."}`}
          </div>
          <div className={`map-canvas ${selected ? "has-selection" : ""}`}>
            <StreetMap homes={result?.homes ?? []} office={conditions.office} selected={selected} ready={ready} onSelect={setSelected} />
          </div>
          <div className="map-bottom">
            <span className="status-dot" /> 실제 매물·교통 조회 없이 합성
            데이터로 체험하는 화면이에요.
            <span>월 지출 = 월세 + 관리비 + 통근비</span>
          </div>
        </section>
        {home && (
          <Details
            home={home}
            conditions={conditions}
            partial={result?.partial ?? true}
            stale={!ready}
            close={() => setSelected(null)}
          />
        )}
      </div>
    </main>
  );
}

function Details({
  home: h,
  conditions,
  partial,
  stale,
  close,
}: {
  home: Home;
  conditions: Conditions;
  partial: boolean;
  stale: boolean;
  close: () => void;
}) {
  return (
    <aside className="details" aria-label="선택한 매물 상세">
      <div className="detail-top">
        <div><small>지금 살펴보는 집</small><h2>{h.name}</h2></div>
        <button aria-label="매물 상세 닫기" className="close" onClick={close}>
          ×
        </button>
      </div>
      <figure className="property-demo-photo">
        <img src="/properties/officetel-interior-demo.png" alt="밝은 주거 공간을 표현한 공통 AI 생성 시연 이미지. 실제 매물 사진이 아니에요." width="1536" height="1024" />
        <figcaption>AI 생성 · 시연용 이미지</figcaption>
      </figure>
      <div className="detail-body">
        <div className="detail-title">
          <span className={`mood-tag mood-${h.status}`}>{moods[h.status]}</span>
          <span>
            {h.size}m² · {h.kind}
          </span>
        </div>
        <p className="detail-location">서울 {h.area} · 합성 시연 매물</p>
        {stale && (
          <p className="stale-note">
            조건을 반영 중이거나 연결이 끊겼어요. 아래는 이전 결과예요.
          </p>
        )}
        <div className="price-highlight">
          <span>월 예상 지출 {partial && <small>· 임시</small>}</span>
          <strong>{won(h.total)}</strong>
          <small>
            {!conditions.office
              ? "직장을 선택하면 통근비를 포함해 계산해요."
              : "공과금·일회성 비용·보증금 기회비용 제외"}
          </small>
        </div>
        <dl className="breakdown">
          {[
            ["보증금", won(h.deposit)],
            ["월세", won(h.rent)],
            ["관리비", won(h.management)],
            ["월 통근비", won(h.commute)],
            ["관리비 포함", h.includes.join(", ")],
            ["입주 가능일", h.available],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <section className="commute-card">
          <h3>
            출퇴근 살펴보기 <small>월 {conditions.workdays}일</small>
          </h3>
          {h.route ? (
            <>
              <p>{conditions.office} 기준 · 도보 포함 합성 시간</p>
              {(["outbound", "inbound"] as const).map((key, i) => (
                <div key={key}>
                  <span>{i ? "퇴근" : "출근"}</span>
                  <strong>{h.route![key].minutes}분</strong>
                  <span>
                    {h.route![key].transfers === 0
                      ? "환승 없이 한 번에"
                      : `환승 ${h.route![key].transfers}회`}
                  </span>
                  <small>{won(h.route![key].fare)}</small>
                </div>
              ))}
            </>
          ) : (
            <p>
              {conditions.office
                ? "경로를 확인하지 못했어요."
                : "대화에서 직장을 알려주세요."}
            </p>
          )}
        </section>
        <section className="reason-card">
          <h3>이렇게 판단했어요</h3>
          {h.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
          {h.checks.map((c) => (
            <div className="check-row" key={c.key}>
              <span>
                {c.passed === null ? "?" : c.passed ? "✓" : "−"} {c.label}
              </span>
              <span>
                {c.mode === "required" ? "필수" : "선호"} ·{" "}
                {c.passed === null ? "미확인" : c.passed ? "충족" : "미충족"}
              </span>
            </div>
          ))}
        </section>
        <p className="detail-disclaimer">
          시연용 가정값이에요. 실제 계약이나 매물 정보로 사용할 수 없어요.
        </p>
      </div>
    </aside>
  );
}
