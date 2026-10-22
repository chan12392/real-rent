import { useId } from "react";
import type { Mood } from "./types";
import { moods } from "./types";

export function Rabbit({
  mood = "idle",
  small = false,
}: {
  mood?: Mood;
  small?: boolean;
}) {
  const id = useId();
  return (
    <svg
      className={`rabbit rabbit-${mood} ${small ? "rabbit-small" : ""}`}
      viewBox="0 0 200 220"
      role="img"
      aria-label={`토끼 캐릭터 · ${moods[mood]}`}
    >
      <defs>
        <radialGradient id={id}>
          <stop stopColor="#fff7cf" />
          <stop offset="1" stopColor="#f6e6a8" />
        </radialGradient>
      </defs>
      {!small && (
        <ellipse
          className="rabbit-shadow"
          cx="100"
          cy="206"
          rx="49"
          ry="6"
          fill="#d9cdb4"
          opacity=".35"
        />
      )}
      <g
        className="rabbit-body"
        fill={`url(#${id})`}
        stroke="#554437"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="ear ear-left">
          <path d="M68 92C45 62 44 14 59 12C75 9 83 55 83 82Z" />
          <path
            d="M65 70Q51 29 59 26Q67 25 72 70"
            fill="#f0b3ad"
            stroke="none"
          />
        </g>
        <g className="ear ear-right">
          <path d="M112 82C111 47 120 9 134 13C150 18 137 69 129 93Z" />
          <path
            d="M123 70Q127 26 133 27Q140 28 132 71"
            fill="#f0b3ad"
            stroke="none"
          />
        </g>
        <path d="M63 170Q49 199 68 200L77 190Q100 199 124 190Q138 207 146 195Q153 185 139 168Z" />
        <path d="M100 70C53 69 32 99 37 137C40 164 59 184 99 184C142 184 163 164 164 133C164 96 141 71 100 70Z" />
        <g className="arm arm-left">
          <path d="M43 145Q21 140 27 158Q32 170 48 162" />
        </g>
        <g className="arm arm-right">
          <path d="M157 145Q180 140 174 158Q169 170 153 162" />
        </g>
        <ellipse cx="59" cy="140" rx="13" ry="8" fill="#efb0a6" stroke="none" />
        <ellipse
          cx="141"
          cy="140"
          rx="13"
          ry="8"
          fill="#efb0a6"
          stroke="none"
        />
        <g className="rabbit-eyes" fill="#493c32" stroke="none">
          {mood === "good" ? (
            <g fill="none" stroke="#493c32" strokeWidth="4">
              <path d="M66 121Q75 110 84 121" />
              <path d="M117 121Q126 110 135 121" />
            </g>
          ) : (
            <>
              <ellipse
                cx="76"
                cy={mood === "so-so" ? 126 : 120}
                rx="5"
                ry={mood === "so-so" ? 2.5 : 6}
              />
              <ellipse
                cx="125"
                cy={mood === "so-so" ? 126 : 120}
                rx="5"
                ry={mood === "so-so" ? 2.5 : 6}
              />
            </>
          )}
        </g>
        {mood === "bad" ? (
          <>
            <path d="M68 108L81 113M119 113L132 108" fill="none" />
            <path d="M91 151Q100 139 109 151" fill="none" />
          </>
        ) : mood === "unknown" ? (
          <ellipse cx="100" cy="148" rx="5" ry="7" fill="#bc776a" />
        ) : (
          <>
            <path d="M92 137Q100 148 108 137" fill="none" />
            {mood === "good" && (
              <path d="M91 144Q100 174 110 144Z" fill="#df9d94" />
            )}
          </>
        )}
      </g>
      {mood === "unknown" && (
        <text x="166" y="76" fontSize="35" fill="#557b65" fontWeight="700">
          ?
        </text>
      )}
      {mood === "good" && (
        <g className="sparkles" fill="#d2aa4d">
          <path d="M25 85l3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" />
          <path d="M173 105l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
        </g>
      )}
    </svg>
  );
}
