import { FlipTile } from "./FlipTile";
import "./settings.css";

const MAX_TILES = 8;
const TILT = [-4, 3, -2, 4, -3, 2, -1, 3]; // static tilt in degrees, same idea as the Home tiles
const FLIP_STAGGER = 0.055; // seconds between tiles; 8 tiles + a 300 ms flip stays under 700 ms

/** Letters A-Z of a name, upper-cased; everything else is ignored. */
export const nameLetters = (name: string) => name.toUpperCase().match(/[A-Z]/g) ?? [];

/**
 * A name spelled as letter tiles (decorative; the wrapper carries the full name as its label).
 * Each tile flips once like a split-flap board and lands on its letter; see FlipTile.
 * Reduced motion: final letters, no flip.
 */
export function NameTiles({ name, label }: { name: string; label: string }) {
  const all = nameLetters(name);
  const shown = all.slice(0, MAX_TILES);
  const more = all.length > MAX_TILES;
  return (
    <div className="set-person">
      <p className="set-person-label">{label}</p>
      {all.length === 0 ? (
        <p className="set-name-plain">{name}</p>
      ) : (
        <div className="set-tiles" role="img" aria-label={`${label}: ${name}`}>
          {shown.map((l, i) => (
            <FlipTile key={`${l}-${i}`} letter={l} delay={i * FLIP_STAGGER} style={{ ["--r" as string]: `${TILT[i % TILT.length]}deg` }} />
          ))}
          {more && (
            <span className="set-tile set-tile-more" aria-hidden="true">
              …
            </span>
          )}
        </div>
      )}
    </div>
  );
}
