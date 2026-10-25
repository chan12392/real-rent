import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Mood } from "./types";
import { moods } from "./types";

// The approved six-expression artwork, in a 3 × 2 transparent atlas.
// One visible pose at a time avoids two faces overlapping during a transition.
const poses: { mood: Mood; x: string; y: string }[] = [
  { mood: "idle", x: "0%", y: "0%" },
  { mood: "good", x: "50%", y: "0%" },
  { mood: "so-so", x: "100%", y: "0%" },
  { mood: "bad", x: "0%", y: "100%" },
  { mood: "unknown", x: "50%", y: "100%" },
  { mood: "searching", x: "100%", y: "100%" },
];

export function Rabbit({
  mood = "idle",
  small = false,
  talking = false,
}: {
  mood?: Mood;
  small?: boolean;
  talking?: boolean;
}) {
  const [displayed, setDisplayed] = useState(mood);
  const [phase, setPhase] = useState("rest");
  const current = useRef(mood);

  useEffect(() => {
    // Ignore very short loading states: a fast response should not make the
    // character flash through a magnifying-glass pose between two expressions.
    if (current.current === mood) { setPhase("rest"); return; }
    const delay = mood === "searching" ? 450 : 80;
    const leave = window.setTimeout(() => setPhase("leaving"), delay);
    const change = window.setTimeout(() => {
      current.current = mood;
      setDisplayed(mood);
      setPhase("entering");
    }, delay + 110);
    const settle = window.setTimeout(() => setPhase("rest"), delay + 950);
    return () => { clearTimeout(leave); clearTimeout(change); clearTimeout(settle); };
  }, [mood]);

  const pose = poses.find(p => p.mood === displayed)!;
  return (
    <span
      className={`rabbit rabbit-${displayed} ${small ? "rabbit-small" : ""} ${talking ? "rabbit-talking" : ""} rabbit-${phase}`}
      role="img"
      aria-label={`토끼 캐릭터 · ${moods[mood]}`}
    >
      <span className="rabbit-frame" aria-hidden="true">
        <span className={`rabbit-pose pose-${displayed}`}>
          <span className="rabbit-reaction" key={displayed}>
            <span className="rabbit-art" style={{
              "--pose-x": pose.x,
              "--pose-y": pose.y,
            } as CSSProperties} />
          </span>
        </span>
      </span>
    </span>
  );
}
