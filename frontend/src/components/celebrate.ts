// Confetti + a short sound when something is completed.
// - Confetti is skipped entirely when the OS asks for reduced motion.
// - The sound is never the only cue: callers also show text (see <StatusMessage>).
// - No libraries, no network. Confetti pieces remove themselves.

// Sakura petals with a little sky (pink, blush, white, pale blue).
const COLOURS = ["#f2b8ca", "#e58aa8", "#fde4ec", "#ffffff", "#b9d6ea"];

function reducedMotion() {
  // OS setting OR the in-app "Reduce motion" switch (data-reduce-motion on <html>).
  const os = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return os || (typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduce-motion"));
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => ctx.close();
  } catch {
    /* audio blocked: the visible text is the cue */
  }
}

export type CelebrateKind = "match" | "lesson" | "unit";

const SHAPES = ["square", "circle", "ribbon"] as const;

/**
 * Short celebration. Always plays the beep; confetti only when motion is allowed.
 * - "match" (default, one letter): a light rain, like before.
 * - "lesson": two cannons from the bottom corners.
 * - "unit": a bigger double burst, then a second wave. Used when the last lesson of a unit is finished.
 * No library: pieces are plain elements animated with the Web Animations API and removed when done.
 * Callers must also show text (see <StatusMessage>); the confetti is never the only cue.
 */
export function celebrate(kind: CelebrateKind = "match") {
  beep();
  if (reducedMotion() || typeof document === "undefined") return;
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  const w = innerWidth;
  const h = innerHeight;
  let longest = 0;

  const piece = (x0: number, y0: number, vx: number, vy: number, delay: number) => {
    const bit = document.createElement("span");
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const size = 7 + Math.random() * 7;
    bit.className = `confetti-piece confetti-${shape}`;
    bit.style.cssText = `left:${x0}px;top:${y0}px;width:${shape === "ribbon" ? size * 0.5 : size}px;height:${shape === "ribbon" ? size * 2 : size}px;background:${COLOURS[Math.floor(Math.random() * COLOURS.length)]}`;
    layer.appendChild(bit);
    const spin = (Math.random() - 0.5) * 900;
    const dur = 1500 + Math.random() * 900;
    longest = Math.max(longest, dur + delay);
    // Up and out first, then gravity pulls it down and it fades.
    bit.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${vx * 0.55}px, ${vy}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.35, easing: "ease-in" },
        { transform: `translate(${vx}px, ${h * 0.55}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: dur, delay, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)", fill: "both" },
    );
  };

  if (kind === "match") {
    for (let i = 0; i < 36; i++) piece(Math.random() * w, -12, (Math.random() - 0.5) * 160, 0, Math.random() * 300);
  } else {
    const cannon = (fromLeft: boolean, count: number, delay: number) => {
      for (let i = 0; i < count; i++) {
        const dir = fromLeft ? 1 : -1;
        const vx = dir * (80 + Math.random() * w * 0.35);
        const vy = -(h * (0.35 + Math.random() * 0.4));
        piece(fromLeft ? 0 : w, h, vx, vy, delay + Math.random() * 120);
      }
    };
    const n = kind === "unit" ? 80 : 45;
    cannon(true, n, 0);
    cannon(false, n, 0);
    if (kind === "unit") {
      cannon(true, 60, 450);
      cannon(false, 60, 450);
    }
  }
  setTimeout(() => layer.remove(), longest + 200);
}
