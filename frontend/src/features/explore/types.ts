export type Mood = "idle" | "good" | "so-so" | "bad" | "unknown" | "searching";
export type Key =
  | "deposit"
  | "budget"
  | "office"
  | "minutes"
  | "move_in"
  | "kind"
  | "transfers";
export type Conditions = {
  deposit: number | null;
  budget: number | null;
  office: string | null;
  minutes: number | null;
  move_in: string | null;
  kind: string | null;
  transfers: number | null;
  workdays: number;
  modes: Partial<Record<Key, "required" | "preferred">>;
};
export type Leg = { minutes: number; fare: number; transfers: number };
export type Home = {
  id: string;
  name: string;
  area: string;
  kind: string;
  size: number;
  deposit: number;
  rent: number;
  management: number | null;
  includes: string[];
  available: string;
  x: number;
  y: number;
  status: Mood;
  reasons: string[];
  total: number | null;
  commute: number | null;
  minutes: number | null;
  transfers: number | null;
  route: { outbound: Leg; inbound: Leg } | null;
  checks: { key: Key; label: string; mode: string; passed: boolean | null }[];
};
export type Result = {
  conditions: Conditions;
  homes: Home[];
  reply: string;
  partial: boolean;
  synthetic: true;
  note: string;
};
export type Message = { role: "user" | "assistant"; text: string };
export const initial: Conditions = {
  deposit: null,
  budget: null,
  office: null,
  minutes: null,
  move_in: null,
  kind: null,
  transfers: null,
  workdays: 20,
  modes: {},
};
export const labels: Record<Key, string> = {
  deposit: "보증금 상한",
  budget: "월 지출 상한",
  office: "직장",
  minutes: "편도 통근 상한",
  move_in: "희망 입주일",
  kind: "주거 유형",
  transfers: "편도 환승 상한",
};
export const moods: Record<Mood, string> = {
  idle: "조건 입력 전",
  good: "추천",
  "so-so": "쏘쏘",
  bad: "비추",
  unknown: "판단 불가",
  searching: "찾는 중",
};
export function won(value: number | null) {
  return value === null ? "미확인" : `${value.toLocaleString("ko-KR")}원`;
}
