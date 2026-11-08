import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const EXEMPT = new Set([
  "components/journal/journal.css", // hand-drawn notebook: ruled lines, hatching, irregular radii on purpose
  // Restored "A Silent Voice" Home hero, level deck, reveal cards and Levels hero: the sky/sakura washes, the tile bob and
  // the card lifts are the point of these areas. Every animation there stops under prefers-reduced-motion and data-reduce-motion.
  "components/landing/landing.css",
  "components/landing/path-hero.css",
]);
// silent-voice-ok marks single restored hero / level-look lines in styles.css (same reason as the landing files above).
const OK = /(gradient|infinite|glass|silent-voice)-ok/;

// Comments are blanked (same length, newlines kept) so offsets and line numbers stay valid.
// A line that carries an opt-out marker in a comment is flagged in `okLines`.
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const files = walk(SRC)
  .filter((p) => p.endsWith(".css"))
  .map((p) => {
    const raw = readFileSync(p, "utf8");
    const rawLines = raw.split("\n");
    return { file: p.slice(SRC.length).replace(/\\/g, "/"), raw, text: blank(raw), okLines: rawLines.map((l) => OK.test(l)) };
  });

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
// Search whole-file text (multi-line aware); report line of the match start; skip lines with an opt-out marker.
const find = (re, { exempt = true } = {}) => {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return files.flatMap(({ file, text, okLines }) => {
    if (exempt && EXEMPT.has(file)) return [];
    return [...text.matchAll(g)].flatMap((m) => {
      const n = lineOf(text, m.index);
      return okLines[n - 1] ? [] : [`${file}:${n}  ${m[0].replace(/\s+/g, " ").slice(0, 90)}`];
    });
  });
};

function rgbToHue(r, g, b) {
  [r, g, b] = [r, g, b].map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.04) return null; // grey
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h < 0 ? h + 360 : h;
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
function hueOf(c) {
  c = c.trim();
  if (c[0] === "#") {
    const v = c.length <= 5 ? [...c.slice(1, 4)].map((x) => parseInt(x + x, 16)) : [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return rgbToHue(...v);
  }
  const nums = (c.match(/-?\d*\.?\d+%?/g) ?? []).slice(0, 3).map((n) => parseFloat(n));
  if (nums.length < 3) return null;
  if (c.startsWith("rgb")) return rgbToHue(...nums);
  return rgbToHue(...hslToRgb(((nums[0] % 360) + 360) % 360, nums[1] / 100, nums[2] / 100)); // hsl
}
const COLOUR = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

test("no gradients (flat surfaces, outside the restored hero / level look)", () => assert.deepEqual(find(/(linear|radial|conic)-gradient\(/), []));
// The owner-chosen palette (indigo/periwinkle/lavender, #3D52A0 #7091E6 #8697C4 #ADBBDA #EDE8F5) sits at hue 220-265, so only
// true purple/magenta (272-320) is banned. The AI-look tell is purple gradients, which the "no gradients" test bans.
test("no purple/magenta colours (hue 272-320; the palette itself is hue 220-265)", () => {
  const bad = files.flatMap(({ file, text }) =>
    [...text.matchAll(COLOUR)].flatMap((m) => {
      const x = hueOf(m[0]);
      return x !== null && x >= 272 && x <= 320 ? [`${file}:${lineOf(text, m.index)}  ${m[0]}`] : [];
    }),
  );
  assert.deepEqual(bad, []);
});
test("no decorative infinite animations", () => assert.deepEqual(find(/animation[^;{}]*infinite/), []));
test("no transition: all", () => assert.deepEqual(find(/transition(-property)?:\s*all\b/), []));
test("no animated width/height (use transform)", () =>
  assert.deepEqual(find(/transition:[^;{}]*(?<![-\w])(width|height)\b|transition-property:[^;{}]*(?<![-\w])(width|height)\b/), []));
test("glass blur only on the nav (at most one use)", () => assert.ok(find(/backdrop-filter/).length <= 1, find(/backdrop-filter/).join("\n")));
test("radii come from tokens, not raw px", () => assert.deepEqual(find(/border-radius:[^;{}]*\d+px/), []));
test("no hover lift", () => assert.deepEqual(find(/:hover[^{}]*\{[^}]*translateY\(\s*-/), []));
test("font is chosen, not Inter by default", () => {
  const css = files.find((f) => f.file === "styles.css").text;
  assert.match(css, /--font:\s*"?Atkinson Hyperlegible Next/);
});
