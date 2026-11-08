// WCAG 2.x contrast check for the tokens in src/styles.css.
// Run: node src/styles.contrast.mjs   (exit code 1 if any pair is below its minimum)
// Text needs 4.5:1. Non-text UI (borders, focus ring) needs 3:1.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const root = css.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? "";
const tokens = {};
for (const m of root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim().replace(/\s*\/\*.*$/, "");
const resolve = (v) => {
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(tokens[ref[1]]) : v;
};
const hex = (name) => {
  const v = resolve(tokens[name] ?? name);
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`token --${name} is not a 6-digit hex colour: ${v}`);
  return v;
};

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const rgb = (name) => toRgb(hex(name));
// [label, foreground, background, minimum]
const pairs = [
  // [label, foreground, background, minimum]. Surfaces: bg (page), card, raised, tint, panel-light (C4), hero (brand).
  ...["bg", "card", "raised", "tint", "panel-light"].flatMap((s) => [
    [`--text on ${s}`, rgb("text"), rgb(s), 4.5],
    [`--muted on ${s}`, rgb("muted"), rgb(s), 4.5],
    [`--brand-text on ${s}`, rgb("brand-text"), rgb(s), 4.5],
  ]),
  ["white on --brand (button face, hero, unit badge)", toRgb("#ffffff"), rgb("brand"), 4.5],
  ["white on --brand-deep (dark card, lip)", toRgb("#ffffff"), rgb("brand-deep"), 4.5],
  ["white on hero background (--brand)", toRgb("#ffffff"), rgb("brand"), 4.5],
  ["--brand-deep text on white hero tile", rgb("brand-deep"), toRgb("#ffffff"), 4.5],
  ["--brand-ink on --brand", rgb("brand-ink"), rgb("brand"), 4.5],
  ["--text on --brand-2 (periwinkle chips: flag, mastered, current)", rgb("brand-2-ink"), rgb("brand-2"), 4.5],
  ["--text on hero white caption", rgb("text"), toRgb("#ffffff"), 4.5],
  ["tile text brand-deep on tint", rgb("brand-deep"), rgb("tint"), 4.5],
  ["text on blue 3D panel (on-panel-light)", rgb("on-panel-light"), rgb("panel-light"), 4.5],
  ["disabled button text", rgb("muted"), rgb("reference-bg"), 4.5],
  ["nav: inactive label on card", rgb("muted"), rgb("card"), 4.5],
  ["nav: active label on indicator tint", rgb("brand-text"), rgb("tint"), 4.5],
  ["match text on match tint", rgb("match"), rgb("match-bg"), 4.5],
  ["not-yet text on not-yet tint", rgb("notyet"), rgb("notyet-bg"), 4.5],
  ["reference text on reference tint", rgb("reference"), rgb("reference-bg"), 4.5],
  ["match text on card", rgb("match"), rgb("card"), 4.5],
  ["not-yet text on card (error status, halo error)", rgb("notyet"), rgb("card"), 4.5],
  ["reference text on card", rgb("reference"), rgb("card"), 4.5],
  ["notify status: --text on match tint", rgb("text"), rgb("match-bg"), 4.5],
  ["notify status: --text on not-yet tint", rgb("text"), rgb("notyet-bg"), 4.5],
  ["notify status: --text on reference tint", rgb("text"), rgb("reference-bg"), 4.5],
  ["notify error text: not-yet on page bg", rgb("notyet"), rgb("bg"), 4.5],
  ["notify status shape: match on match tint (3:1)", rgb("match"), rgb("match-bg"), 3],
  ["notify status shape: not-yet on not-yet tint (3:1)", rgb("notyet"), rgb("notyet-bg"), 3],
  ["notify status shape: reference on reference tint (3:1)", rgb("reference"), rgb("reference-bg"), 3],
  ["white text on camera message (#000)", toRgb("#ffffff"), toRgb("#000000"), 4.5],
  ["light-hint: white on 92% #0e0e11 over white (worst case)", toRgb("#ffffff"), blend(toRgb("#0e0e11"), 0.92, toRgb("#ffffff")), 4.5],
  ["shadcn destructive text on --notyet", rgb("notyet-bg"), rgb("notyet"), 4.5],
  ["journal ink on paper (#FAF8FD)", rgb("text"), toRgb("#FAF8FD"), 4.5],
  ["journal muted on paper (#FAF8FD)", rgb("muted"), toRgb("#FAF8FD"), 4.5],
  // non-text UI, 3:1
  ...["card", "bg", "raised", "tint"].flatMap((s) => [
    [`--border-strong on ${s} (inputs, UI boundaries)`, rgb("border-strong"), rgb(s), 3],
    [`--focus ring on ${s}`, rgb("focus"), rgb(s), 3],
  ]),
  ["status mark: periwinkle fill vs card", rgb("brand-2"), rgb("card"), 3],
  ["settings: white thumb on --border-strong track (off)", toRgb("#ffffff"), rgb("border-strong"), 3],
  ["settings: white thumb on --brand track (on)", toRgb("#ffffff"), rgb("brand"), 3],
  ["settings: tile letter --brand-deep on card", rgb("brand-deep"), rgb("card"), 4.5],
  ["settings: white on hand chip (white 12% over --brand)", toRgb("#ffffff"), blend(toRgb("#ffffff"), 0.12, rgb("brand")), 4.5],
  ["settings: --brand-text on --raised (button hover)", rgb("brand-text"), rgb("raised"), 4.5],
  ["settings: white on --brand-deep (primary hover)", toRgb("#ffffff"), rgb("brand-deep"), 4.5],
  ["status mark: ink check on periwinkle fill", rgb("brand-2-ink"), rgb("brand-2"), 3],
  ["status mark: dashed reference ring vs its tint", rgb("reference"), rgb("reference-bg"), 3],
  ["step dots / tile border: brand-text on tint", rgb("brand-text"), rgb("tint"), 3],
  ["selected outline (brand-text) on page", rgb("brand-text"), rgb("bg"), 3],
  ["progress fill (periwinkle) vs its track (--border C4)", rgb("brand-2"), rgb("border"), 1.5],
  ["progress fill (periwinkle) on card", rgb("brand-2"), rgb("card"), 3],
  ["hold ring fill on card", rgb("brand-2"), rgb("card"), 3],
  ["hold bar on camera", rgb("brand-2"), toRgb("#000000"), 3],
  ["done node ring (periwinkle) on card", rgb("brand-2"), rgb("card"), 3],
  ["locked node dashed ring on page", rgb("border-strong"), rgb("bg"), 3],
  ["path trail dots on page", rgb("border-strong"), rgb("bg"), 3],
  ["level ring --lv1 (C1) on card", toRgb("#3D52A0"), rgb("card"), 3],
  ["level ring --lv2 (C2) on card", toRgb("#7091E6"), rgb("card"), 3],
  ["level ring --lv4 (ink) on card", toRgb("#1F2A5C"), rgb("card"), 3],
  ["card edge vs page (decorative, 1.3:1 min)", rgb("border"), rgb("bg"), 1.3],
];

let failed = 0;
console.log("ratio   min   result  pair");
for (const [label, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${r.toFixed(2).padStart(5)}  ${String(min).padStart(4)}  ${ok ? "PASS  " : "FAIL  "}  ${label}`);
}
console.log(failed ? `\n${failed} pair(s) below minimum` : "\nAll pairs pass.");
process.exit(failed ? 1 : 0);
