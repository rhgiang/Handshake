/** Letters a split-flap tile shows on its way to the real one: `steps - 1` random letters, then `letter`. No letter repeats back to back, and none equals the real letter. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function flipSequence(letter: string, steps: number, rand: () => number = Math.random): string[] {
  const out: string[] = [];
  let prev = letter;
  for (let i = 0; i < Math.max(0, steps - 1); i++) {
    let at = Math.floor(rand() * ALPHABET.length) % ALPHABET.length;
    // Skip the previous letter and the real one; at most two bumps are needed.
    while (ALPHABET[at] === prev || ALPHABET[at] === letter) at = (at + 1) % ALPHABET.length;
    prev = ALPHABET[at];
    out.push(prev);
  }
  out.push(letter);
  return out;
}
