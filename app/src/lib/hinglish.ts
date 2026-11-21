/**
 * Respells romanised Hindi so an English-trained speech stack says it the
 * Hindi way.
 *
 * Video generators read the dialogue string with English grapheme rules, so
 * the SPELLING decides the pronunciation - no language hint elsewhere in the
 * prompt overrides it. "karenge" ends in the same letters as "change" and
 * "orange", where English says "nj", so it comes out "kuh-RENJ". Spelling it
 * "karengay" gets the hard "ng" of "Bengal" instead.
 *
 * This table is deliberately small. The generator already handles most
 * romanised Hindi correctly - "tumhare", "dene", "hoon" and "rulaaye" all
 * read fine - and respelling a word that was never broken is how you trade a
 * known failure for an unknown one. Add an entry when a render mispronounces
 * something, not in advance.
 *
 * Words English already owns are out of scope: whether "main" is the Hindi
 * pronoun or the English adjective depends on meaning, not letters, so no
 * table can decide it. That is handled where the line is written - see the
 * dialogue rules in claude.ts.
 */

export interface Respelling {
  from: string;
  to: string;
}

/**
 * Keyed lowercase; the original capitalisation is restored on output. Only
 * include a word that (a) is not also an English word and (b) an English
 * reader gets audibly wrong.
 */
const RESPELLINGS: Record<string, string> = {
  // A two-letter word ending in -i takes the "eye" of "hi" and "bi", not the
  // "ee" these need.
  ki: "kee",
  bhi: "bhee",
  // Nasalised ending, routinely clipped to rhyme with "Hawaii".
  nahi: "naheen",
  nahin: "naheen",
};

/**
 * Future-tense endings where the "ge" lands on the "nj" of "change". Handled
 * as a suffix because the pattern is productive - any verb stem takes it, so
 * karenge, lenge, denge, jayenge, honge and karoge are all one rule.
 */
const FUTURE_SUFFIXES = ["enge", "onge", "oge"];

/**
 * English words ending the same way, which the suffix rule must not touch.
 * The set is small enough to list because English mostly spells this sound
 * "-ange" or "-unge" ("change", "orange", "plunge"), which these rules never
 * match. Matched as endings so prefixed forms come along: "shortchange",
 * "Stonehenge".
 */
const FUTURE_EXCEPTIONS = [
  "challenge",
  "lozenge",
  "venge", // avenge, revenge, scavenge
  "sponge",
  "longe",
];

/**
 * Two endings are deliberately NOT excepted, because the Hindi word is the one
 * that turns up in a fashion reel and the English word is not: "-henge" would
 * block "rahenge", to protect "Stonehenge"; "-oge" spells both the Venetian
 * "doge" and "doge", you will give. Both resolve in favour of Hindi.
 */

/** "Karenge" -> "Karengay", "KARENGE" -> "KARENGAY". */
function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function respellWord(word: string): string | null {
  const lower = word.toLowerCase();

  const mapped = RESPELLINGS[lower];
  if (mapped) return matchCase(word, mapped);

  // endsWith rather than an exact match so prefixed forms are covered too
  // ("shortchange", "prearrange").
  if (FUTURE_EXCEPTIONS.some((w) => lower.endsWith(w))) return null;

  for (const suffix of FUTURE_SUFFIXES) {
    if (lower.length > suffix.length && lower.endsWith(suffix)) {
      return matchCase(word, `${lower.slice(0, -2)}gay`);
    }
  }

  return null;
}

/**
 * Rewrites the Hindi words in one spoken line, and reports what it changed so
 * the change is visible before a render is paid for.
 *
 * Dialogue only. It must not run over a visual prompt, where nothing is
 * spoken, or over the voiceover script, which becomes on-screen captions and
 * has to stay readable.
 */
export function respellHinglish(text: string): { text: string; changes: Respelling[] } {
  // Keyed by the original word so the same word appearing twice is reported
  // once.
  const changes = new Map<string, string>();

  const out = text.replace(/[A-Za-z]+/g, (word) => {
    const replacement = respellWord(word);
    if (!replacement) return word;
    changes.set(word, replacement);
    return replacement;
  });

  return {
    text: out,
    changes: [...changes].map(([from, to]) => ({ from, to })),
  };
}
