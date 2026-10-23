import { useEffect, useState } from "react";
import { Rabbit } from "./Rabbit";
import { moods } from "./types";
import type { Mood } from "./types";

// Reveal one short sentence as a single utterance. Screen readers receive the
// complete sentence once, rather than an announcement for every character.
export function Companion({ text, mood, selected }: { text: string; mood: Mood; selected: boolean }) {
  const [progress, setProgress] = useState({ text, length: 0 });
  const length = progress.text === text ? progress.length : 0;
  const [reducedMotion, setReducedMotion] = useState(false);
  const letters = Array.from(text);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (reducedMotion) return;
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(cursor + 2, letters.length);
      setProgress({ text, length: cursor });
      if (cursor === letters.length) window.clearInterval(timer);
    }, 48);
    return () => window.clearInterval(timer);
  }, [text, letters.length, reducedMotion]);
  const speaking = !reducedMotion && length < letters.length;
  return <section className={`companion ${speaking ? "companion-speaking" : ""}`}>
    <Rabbit mood={mood} talking={speaking} />
    <div className="companion-copy">
      <span className={`mood-tag mood-${mood}`}>{selected ? moods[mood] : "우사기와 집 찾기"}</span>
      <p className="utterance-text"><span className="utterance-measure" aria-hidden="true">{text}</span><span className="sr-only" role="status">{text}</span><span className="utterance-output" aria-hidden="true">{reducedMotion ? text : letters.slice(0, length).join("")}{speaking && <span className="speech-dots">···</span>}</span></p>
    </div>
  </section>;
}
