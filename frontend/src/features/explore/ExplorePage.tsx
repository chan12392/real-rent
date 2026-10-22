import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { requestApi } from "../../lib/api";
import { Rabbit } from "./Rabbit";
import { initial, labels, moods, won } from "./types";
import type { Conditions, Home, Key, Message, Result } from "./types";
import "./explore.css";

const STORAGE = "real-rent-explore-v1";
const greeting: Message = {
  role: "assistant",
  text: "안녕하세요! 함께 살 곳을 찾아볼까요? 예산과 직장, 원하는 조건을 편하게 말씀해 주세요.",
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
  const [selected, setSelected] = useState<string | null>(saved.selected);
  const [confirmed, setConfirmed] = useState(saved.confirmed);
  const [resetArmed, setResetArmed] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [showConditions, setShowConditions] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const sequence = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const home = result?.homes.find((h) => h.id === selected);
  const current = home?.status || "idle";
  const active = Object.keys(labels).some((k) => conditions[k as Key] !== null);
  const ready =
    !busy &&
    !!result &&
    !error &&
    JSON.stringify(conditions) === JSON.stringify(result.conditions);

  async function update(next: Conditions, message = "", addMessage = true) {
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const data = await requestApi("/explore", isResult, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: next, message }),
      });
      if (id !== sequence.current) return;
      setResult(data);
      setConditions(data.conditions);
      if (addMessage)
        setMessages((m) =>
          [
            ...m,
            ...(message ? [{ role: "user" as const, text: message }] : []),
            { role: "assistant" as const, text: data.reply },
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
        JSON.stringify({ conditions, messages, selected, confirmed }),
      );
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [conditions, messages, selected, confirmed]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  function send(event: FormEvent) {
    event.preventDefault();
    if (input.trim() && !busy) void update(conditions, input.trim());
  }
  function change(key: keyof Conditions, value: unknown) {
    void update({ ...conditions, [key]: value }, "", true);
  }
  function reset() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setMessages([greeting]);
    setSelected(null);
    setConfirmed(false);
    setInput("");
    setConditions(initial);
    setResult(null);
    void update(initial, "", false);
  }
  const reaction = busy
    ? "조건을 차근차근 살펴보고 있어요…"
    : home
      ? `${home.name} · ${home.reasons.join(" ")}`
      : "지도에서 궁금한 집을 눌러보세요. 같이 살펴봐요!";
  return (
    <main className="explore-app">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="REAL RENT 홈">
          <span>⌂</span> REAL RENT<span className="wordmark-dot">.</span>
        </a>
        <span className="demo-pill">합성 데이터 시연</span>
        <nav>
          <span className="nav-active">집 찾아보기</span>
          <button
            className="quiet"
            onClick={() => setShowConditions((v) => !v)}
          >
            내 조건{" "}
            <span className="count">
              {
                Object.keys(labels).filter((k) => conditions[k as Key] !== null)
                  .length
              }
            </span>
          </button>
          <button className="quiet" onClick={reset} disabled={busy}>
            {resetArmed ? "초기화 확인 ✓" : "새로 찾기 ↗"}
          </button>
        </nav>
      </header>
      <div className="workspace">
        <aside className="conversation" aria-label="집 찾기 대화">
          <div className="conversation-heading">
            <span className="eyebrow">YOUR LITTLE HOME GUIDE</span>
            <h1>우리, 어디서 살까요?</h1>
            <p>내 일상에 맞는 집을 함께 찾아요.</p>
          </div>
          <section className="companion">
            <Rabbit mood={busy ? "searching" : current} />
            <div className="companion-copy" aria-live="polite">
              <span className={`mood-tag mood-${current}`}>
                {home ? moods[current] : "집 찾기 도우미"}
              </span>
              <p>{reaction}</p>
            </div>
          </section>
          <button
            className="condition-toggle"
            onClick={() => setShowConditions((v) => !v)}
            aria-expanded={showConditions}
          >
            <span>
              나의 조건 <small>출근 월 {conditions.workdays}일</small>
            </span>
            <span>{showConditions ? "접기 −" : "수정하기 +"}</span>
          </button>
          {showConditions && (
            <section className="condition-editor" aria-label="조건 수정">
              <p>금액 단위는 원이에요. 필수·선호를 바꿀 수 있어요.</p>
              {(Object.keys(labels) as Key[]).map((key) => (
                <div className="condition-row" key={key}>
                  <label>
                    {labels[key]}
                    {key === "office" || key === "kind" ? (
                      <select
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
                          if (!busy) void update(conditions);
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
              <label>
                월 출근일
                <input
                  type="number"
                  min="0"
                  max="31"
                  disabled={busy}
                  value={conditions.workdays}
                  onBlur={() => {
                    if (!busy) void update(conditions);
                  }}
                  onChange={(e) => {
                    if (e.target.validity.valid && e.target.value !== "")
                      setConditions((c) => ({
                        ...c,
                        workdays: Number(e.target.value),
                      }));
                  }}
                />
              </label>
            </section>
          )}
          <div className="chat-log" role="log" aria-label="대화 내역">
            {messages.map((m, i) => (
              <div className={`chat-message ${m.role}`} key={i}>
                {m.role === "assistant" && (
                  <span className="chat-avatar">⌂</span>
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
                <button onClick={() => setShowConditions(true)}>
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
                    지금 조건에 모두 맞는 집은 없어요. 지도의 다른 집도 살펴볼
                    수 있어요.
                  </p>
                )}
              </div>
            )}
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
                : "이 브라우저에 대화가 저장돼요. 새로 찾기로 지울 수 있어요."}
            </small>
          </div>
        </aside>
        <section className="map-panel" aria-label="서울 합성 매물 시연 지도">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">FIND YOUR PLACE</span>
              <h2>서울에서 찾는 나의 자리</h2>
              <p>
                {!result
                  ? "시연 매물을 불러오고 있어요."
                  : !active
                    ? "12개의 집이 기다려요. 조건을 이야기해 주세요."
                    : `${result.homes.filter((h) => h.status === "good").length}개의 추천 집 · ${result.partial ? "입력된 조건 기준 임시 결과" : "모든 조건 반영"}`}
              </p>
            </div>
            <span className="map-count">⌂ 12개 시연 매물</span>
          </div>
          <div className={`map-canvas ${selected ? "has-selection" : ""}`}>
            <svg
              className="seoul-map"
              viewBox="0 0 1000 800"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect width="1000" height="800" fill="#eeeee2" />
              <g fill="#e0e7ce">
                <path d="M0 0H280L240 150 90 230 0 180Z" />
                <path d="M720 0H1000V270L860 200 810 100Z" />
                <path d="M750 550L1000 500V800H850Z" />
                <path d="M0 620L190 650 240 800H0Z" />
              </g>
              <g stroke="#fffdf5" strokeWidth="26" fill="none">
                <path d="M-50 180L1050 660M-20 670L1050 200M200-10L650 810M630-10L280 810M-50 360L1050 360M-50 560L1050 560M460-50L460 850M820-10L820 850" />
              </g>
              <g stroke="#dcdccb" strokeWidth="2" fill="none">
                <path d="M-50 180L1050 660M-20 670L1050 200M200-10L650 810M630-10L280 810M-50 360L1050 360M-50 560L1050 560M460-50L460 850M820-10L820 850" />
              </g>
              <path
                d="M-50 400C160 320 200 540 390 505S590 340 735 430 900 560 1050 370"
                fill="none"
                stroke="#b9d8d5"
                strokeWidth="68"
              />
              <g stroke="#fffdf5" strokeWidth="15">
                <path d="M265 405L280 510M465 405L500 505M665 365L645 475M860 435L820 535" />
              </g>
              <g fill="#7e9072" opacity=".6">
                <circle cx="110" cy="100" r="35" />
                <circle cx="900" cy="95" r="60" />
                <circle cx="895" cy="710" r="40" />
              </g>
            </svg>
            <span className="district district-a">마포구</span>
            <span className="district district-b">용산구</span>
            <span className="district district-c">성동구</span>
            <span className="district district-d">영등포구</span>
            <span className="district district-e">관악구</span>
            <span className="district district-f">강남구</span>
            <span className="river-label">한 강</span>
            {conditions.office && (
              <div
                className="office-marker"
                style={{
                  left:
                    conditions.office === "강남역"
                      ? "70%"
                      : conditions.office === "서울역"
                        ? "49%"
                        : "30%",
                  top:
                    conditions.office === "강남역"
                      ? "75%"
                      : conditions.office === "서울역"
                        ? "32%"
                        : "61%",
                }}
              >
                ⚑ {conditions.office}
                <small>직장 기준</small>
              </div>
            )}
            <div className={`pins ${busy || error ? "pins-stale" : ""}`}>
              {result?.homes.map((h) => (
                <button
                  style={{ left: `${h.x}%`, top: `${h.y}%` }}
                  className={`house-pin ${selected === h.id ? "selected" : ""}`}
                  key={h.id}
                  disabled={!ready}
                  onClick={() => setSelected(h.id)}
                  aria-label={`${h.name}, ${moods[h.status]}, 월세 ${won(h.rent)}`}
                  aria-pressed={selected === h.id}
                >
                  {h.status === "good" && (
                    <span className="pin-face">
                      <Rabbit mood="good" small />
                    </span>
                  )}
                  <span className="pin-house">⌂</span>
                  <span className="pin-label">
                    {h.area} <b>{h.rent / 10000}</b>
                  </span>
                </button>
              ))}
            </div>
            <div className="map-note">
              서울 동네를 재배치한 시연 지도
              <br />
              실제 위치·거리·교통 정보가 아니에요.
            </div>
            <div className="map-legend">
              <span className="legend-rabbit">🐰</span> 추천 <span>⌂</span> 다른
              집 · 클릭해서 확인
            </div>
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
        <span>지금 살펴보는 집</span>
        <button aria-label="매물 상세 닫기" className="close" onClick={close}>
          ×
        </button>
      </div>
      <div className="house-illustration" aria-hidden="true">
        <span className="sun" />
        <div
          className={`building building-${h.kind === "빌라" ? "villa" : h.kind === "오피스텔" ? "office" : "room"}`}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <span className="tree tree-one">♣</span>
        <span className="tree tree-two">♣</span>
        <span className="illustration-label">가상 매물 일러스트</span>
      </div>
      <div className="detail-body">
        <div className="detail-title">
          <span className={`mood-tag mood-${h.status}`}>{moods[h.status]}</span>
          <span>
            {h.size}m² · {h.kind}
          </span>
        </div>
        <h2>{h.name}</h2>
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
