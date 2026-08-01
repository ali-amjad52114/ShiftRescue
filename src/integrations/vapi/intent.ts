// What the worker actually meant.
//
// The model decides the call, but the model is not the only thing that has to
// understand "yeah I can do that". Two other places need the same reading:
//
//  - the confirmation gate in webhook.ts, which refuses to record an acceptance
//    when the worker's last words were not an acceptance;
//  - the prompt itself, which is handed these words as examples so the model and
//    the backend agree on what a yes sounds like instead of drifting apart.
//
// So the vocabulary lives here once, and both read from it.
//
// Matching is deliberately not a word list lookup. Phone transcription mangles
// short words, workers answer in four languages, and half the yeses in a real
// call log are phrases ("count me in", "main aa jaunga") rather than "yes".
// The rules that follow are all consequences of that.

import type { SupportedLanguage } from "./types";

export type WorkerIntent =
  /** A yes: takes the shift, or confirms the gate question. */
  | "affirm"
  /** A no: refuses the shift, or denies being the right person. */
  | "decline"
  /** Wants it but cannot commit now — "let me check", "call me back". */
  | "unsure"
  /** Did not hear or did not understand; wants the question again. */
  | "repeat"
  /** Asked not to be called again. Outranks everything else. */
  | "stop"
  /** Nothing usable: silence, or filler noise on its own. */
  | "silent"
  /** Something else — a question, an objection, a sentence we do not model. */
  | "unknown";

export interface IntentReading {
  intent: WorkerIntent;
  /** 0-1. Above CLEAR_INTENT is safe to act on; below it, ask rather than assume. */
  confidence: number;
  /** The phrase that decided it, for the call log. */
  matched?: string;
}

/**
 * The bar for acting on a reading without asking a human-shaped question first.
 * An exact phrase or word clears it; a fuzzy, mis-transcribed match does not,
 * because the cost of a wrong reading is a worker rostered onto a shift they
 * declined.
 */
export const CLEAR_INTENT = 0.8;

/**
 * Lowercases, strips accents and punctuation, and collapses whitespace, so
 * "Sí, claro!" and "si claro" are the same string. Apostrophes are deleted
 * rather than spaced, so "can't" becomes "cant" and stays one token.
 *
 * Urdu and Punjabi script survive this untouched: the class being stripped is
 * punctuation, not non-Latin letters. That matters because the transcriber
 * returns those languages in their own script, not romanized.
 */
export function normalizeUtterance(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’ʼ]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Noise a worker makes while thinking. On its own this is not an answer, so it
 * is read as silence and gets the question asked again. "mhm" and "uh huh" are
 * deliberately absent: those are yeses, and they live in the lexicon.
 */
const FILLERS = new Set([
  "um", "umm", "uh", "uhh", "er", "erm", "hmm", "hm", "ah", "oh", "eh", "mm", "well", "so",
]);

/**
 * Everything the backend recognises, per language. Ordered most useful first:
 * the first few of each list are what gets shown to the model as examples, so
 * put the phrases that actually turn up in call logs at the top.
 *
 * English is matched for every worker regardless of their language, because
 * "ok" and "yes" turn up in all four.
 */
const LEXICON: Record<SupportedLanguage, Partial<Record<WorkerIntent, string[]>>> = {
  English: {
    affirm: [
      "I can do that", "count me in", "that works for me", "sounds good", "of course",
      "for sure", "sure thing", "no problem", "I'll take it", "I'll be there",
      "I'm available", "put me down", "yes", "yeah", "yep", "yup", "sure", "ok", "okay",
      "alright", "absolutely", "definitely", "that works", "works for me",
      "not a problem", "I'm in", "I can", "I can do it", "I can work it", "I can take it",
      "I can make it", "I'll do it", "I'll come", "I'm free", "sign me up", "book me",
      "happy to", "glad to", "why not", "correct", "that's right", "that's fine",
      "that's correct", "fine by me", "all good", "yes please", "let's do it", "I got it",
      "you got it", "uh huh", "mhm", "mm hmm", "will do", "deal", "perfect", "great",
      "gotcha", "right", "yea", "ya", "yah", "yes I can", "I am in",
    ],
    decline: [
      "I can't make it", "I'm working that day", "I'm not available",
      "that doesn't work for me", "I have plans", "no thanks", "I'm busy", "sorry no",
      "unfortunately not", "I don't think I can", "no", "nope", "nah", "can't", "I can't",
      "I can't do that", "I can't do it", "I can't work", "can't make it", "not available",
      "I'm working", "I have work", "I'm out of town", "I'm on holiday", "not this time",
      "not that day", "not tonight", "I'm off that day", "no thank you", "I won't",
      "I will not", "I'm afraid not", "pass", "I'll pass", "doesn't work for me",
      "that doesn't work", "wrong number", "wrong person", "that's not me",
      "you have the wrong",
    ],
    unsure: [
      "let me check", "call me back", "I'll let you know", "I'm not sure",
      "I'll get back to you", "not sure", "can I let you know", "text me the details",
      "maybe", "I'll check", "I need to check", "I have to check", "call back later",
      "I think so", "probably", "possibly", "it depends", "depends", "I don't know",
      "don't know", "let me think", "give me time", "send me the details", "I'll see",
      "we will see",
    ],
    repeat: [
      "say that again", "can you repeat", "I didn't catch that", "I can't hear you",
      "what", "sorry", "pardon", "come again", "repeat that", "I didn't hear",
      "you're breaking up", "you are breaking up", "excuse me", "what was that",
      "one more time", "louder",
    ],
    stop: [
      "stop calling me", "don't call me", "take me off the list", "stop calling",
      "do not call", "remove me", "take me off", "unsubscribe", "quit calling",
    ],
  },
  Spanish: {
    affirm: [
      "si", "claro", "por supuesto", "vale", "dale", "esta bien", "de acuerdo",
      "perfecto", "cuenta conmigo", "si puedo", "puedo", "lo tomo", "lo hago", "seguro",
      "obvio", "listo", "correcto", "si claro", "ahi estare", "me sirve", "esta perfecto",
      "sin problema", "ningun problema", "por favor si", "acepto",
    ],
    decline: [
      "no", "no puedo", "no voy a poder", "imposible", "no me sirve", "estoy ocupado",
      "estoy ocupada", "estoy trabajando", "tengo trabajo", "ese dia no", "esa noche no",
      "lo siento no", "no gracias", "no esta vez", "numero equivocado", "no soy yo",
    ],
    unsure: [
      "quizas", "tal vez", "no estoy seguro", "no estoy segura", "dejame ver",
      "dejame revisar", "tengo que revisar", "te aviso", "te llamo luego",
      "llamame despues", "no se", "depende", "creo que si", "mandame los detalles",
    ],
    repeat: [
      "que", "como", "mande", "perdon", "repita", "puede repetir", "no te escucho",
      "no le escucho", "no escuche", "otra vez", "mas fuerte",
    ],
    stop: ["no me llame", "no me llamen", "no llame mas", "sacame de la lista"],
  },
  Urdu: {
    affirm: [
      "haan", "han", "haan ji", "hanji", "ji", "ji haan", "jee", "jee haan", "bilkul",
      "zaroor", "theek hai", "thik hai", "thek hai", "acha", "achha", "ok ji",
      "kar sakta hoon", "kar sakti hoon", "kar loonga", "kar loongi", "aa jaunga",
      "aa jaungi", "main aa jaunga", "main aa jaungi", "manzoor", "chalega", "sahi hai",
      "main tayyar hoon", "koi masla nahi", "ہاں", "جی", "جی ہاں", "بالکل", "ٹھیک ہے",
      "ضرور", "اچھا",
    ],
    decline: [
      "nahi", "nahin", "nai", "nahi kar sakta", "nahi kar sakti", "nahi ho payega",
      "mumkin nahi", "mushkil hai", "main busy hoon", "kaam hai", "us din nahi",
      "maaf karna", "muaf karna", "galat number", "main nahi hoon", "نہیں", "نہیں کر سکتا",
      "ممکن نہیں", "معاف کرنا",
    ],
    unsure: [
      "pata nahi", "shayad", "dekhta hoon", "dekhti hoon", "dekh kar batata hoon",
      "baad mein batata hoon", "phone karna baad mein", "socha nahi", "confirm karke batata hoon",
      "پتہ نہیں", "شاید", "دیکھتا ہوں", "بعد میں بتاتا ہوں",
    ],
    repeat: [
      "kya", "kya kaha", "dobara", "phir se", "samajh nahi aaya", "sunai nahi diya",
      "awaz nahi aa rahi", "zara phir se", "کیا", "دوبارہ", "سمجھ نہیں آیا", "سنائی نہیں دیا",
    ],
    stop: ["call mat karo", "phone mat karo", "dobara call na karna", "فون مت کرو"],
  },
  Punjabi: {
    affirm: [
      "haanji", "haan ji", "aho", "ho ji", "haan", "ji", "bilkul", "theek ae", "thik ae",
      "sahi ae", "changa", "chalda", "kar sakda haan", "kar sakdi haan", "main aa javanga",
      "main aa javangi", "aa javanga", "ਹਾਂ", "ਹਾਂ ਜੀ", "ਜੀ", "ਬਿਲਕੁਲ", "ਠੀਕ ਹੈ", "ਚੰਗਾ",
    ],
    decline: [
      "nahi", "na", "ni", "nahi kar sakda", "nahi kar sakdi", "nahi ho sakda",
      "main busy haan", "kamm hai", "us din nahi", "maaf karna", "ਨਹੀਂ", "ਨਹੀਂ ਹੋ ਸਕਦਾ",
    ],
    unsure: [
      "pata nahi", "shayad", "vekhda haan", "vekh ke dassa", "baad wich dassa",
      "ਪਤਾ ਨਹੀਂ", "ਸ਼ਾਇਦ", "ਵੇਖ ਕੇ ਦੱਸਾਂ",
    ],
    repeat: [
      "ki", "ki kiha", "fer ton", "dobara", "samajh nahi aaya", "sunai nahi ditta",
      "ਕੀ", "ਦੁਬਾਰਾ", "ਸਮਝ ਨਹੀਂ ਆਇਆ",
    ],
    stop: ["call na karo", "phone na karo", "ਫੋਨ ਨਾ ਕਰੋ"],
  },
};

interface LexiconEntry {
  intent: WorkerIntent;
  language: SupportedLanguage;
  /** Normalized form, which is what is actually matched. */
  text: string;
  words: number;
}

const ENTRIES: LexiconEntry[] = Object.entries(LEXICON).flatMap(([language, byIntent]) =>
  Object.entries(byIntent).flatMap(([intent, phrases]) =>
    (phrases as string[]).map((phrase) => {
      const text = normalizeUtterance(phrase);
      return {
        intent: intent as WorkerIntent,
        language: language as SupportedLanguage,
        text,
        words: text.split(" ").length,
      };
    }),
  ),
);

/**
 * When two readings are equally well evidenced, the more cautious one wins.
 * Hearing a no in an ambiguous "yes... no" costs one extra question; hearing a
 * yes in it costs a worker their evening.
 */
const CAUTION: Record<WorkerIntent, number> = {
  stop: 6,
  decline: 5,
  unsure: 4,
  repeat: 3,
  affirm: 2,
  silent: 1,
  unknown: 0,
};

interface Candidate {
  intent: WorkerIntent;
  confidence: number;
  matched: string;
  /**
   * Characters of evidence, with a bonus per extra word. A phrase is a more
   * specific reading than a word that happens to sit inside it, and the bonus
   * makes sure "no problem" beats "problem"-length coincidences, not just "no".
   */
  weight: number;
  /** Where in the sentence it was found. Later clauses revise earlier ones. */
  position: number;
  end: number;
}

/**
 * Damerau-Levenshtein, capped. Only used to survive transcription slips, so it
 * gives up as soon as the words are further apart than `max`.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious: number[] = [];

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i, ...Array<number>(b.length).fill(0)];
    let rowBest = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);

      // Transposition: "haan" heard as "hana".
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }
      rowBest = Math.min(rowBest, current[j]);
    }

    if (rowBest > max) return max + 1;
    beforePrevious = previous;
    previous = current;
  }

  return previous[b.length];
}

/**
 * How wrong a word may be and still count.
 *
 * Nothing under four letters gets any slack at all: at that length "no" is one
 * edit from "so", "go" and "know", and a false decline is as bad as a false
 * accept. Longer words get one or two, and must still start with the same
 * letter, which is what keeps "nahi" (no) away from "sahi" (right).
 */
function slackFor(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

/** Word starts in the normalized string, so matches can be ordered by clause. */
function tokenize(normalized: string): Array<{ text: string; at: number }> {
  const tokens: Array<{ text: string; at: number }> = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    tokens.push({ text: match[0], at: match.index });
  }
  return tokens;
}

function isFillerOnly(tokens: Array<{ text: string }>): boolean {
  return tokens.length > 0 && tokens.every((token) => FILLERS.has(token.text));
}

function stronger(a: Candidate, b: Candidate): Candidate {
  if (a.weight !== b.weight) return a.weight > b.weight ? a : b;
  if (a.position !== b.position) return a.position > b.position ? a : b;
  return CAUTION[a.intent] >= CAUTION[b.intent] ? a : b;
}

/**
 * Reads one thing the worker said.
 *
 * The three rules that do the real work, in the order they matter:
 *
 * 1. **Longest match wins.** This is what stops "no problem" being read as a
 *    refusal because "no" is in it, and "not sure" being read as "sure".
 * 2. **A later clause revises an earlier one.** "Yeah, no, I'm working" ends in
 *    a refusal, and that is the part that counts.
 * 3. **Exact beats approximate.** A fuzzy match never clears CLEAR_INTENT on its
 *    own, so the gate asks instead of guessing.
 * 4. **A request to repeat only counts alone.** "Sorry, no" is a refusal.
 */
export function readIntent(text: string): IntentReading {
  const normalized = normalizeUtterance(text);
  if (!normalized) return { intent: "silent", confidence: 1 };

  const tokens = tokenize(normalized);
  if (isFillerOnly(tokens)) return { intent: "silent", confidence: 0.9, matched: normalized };

  const padded = ` ${normalized} `;
  const candidates: Candidate[] = [];

  for (const entry of ENTRIES) {
    if (entry.words > 1) {
      const at = padded.indexOf(` ${entry.text} `);
      if (at >= 0) {
        candidates.push({
          intent: entry.intent,
          confidence: 0.95,
          matched: entry.text,
          weight: entry.text.length + (entry.words - 1) * 10,
          position: at,
          end: at + entry.text.length,
        });
      }
      continue;
    }

    for (const token of tokens) {
      const exact = token.text === entry.text;
      const slack = slackFor(entry.text);
      const near =
        !exact &&
        slack > 0 &&
        token.text[0] === entry.text[0] &&
        editDistance(token.text, entry.text, slack) <= slack;

      if (!exact && !near) continue;

      candidates.push({
        intent: entry.intent,
        // A one-word answer is the whole reply, so an exact one is strong
        // evidence. An approximate one is a guess and is priced as one.
        confidence: exact ? 0.85 : 0.6,
        matched: entry.text,
        weight: entry.text.length,
        position: token.at,
        end: token.at + token.text.length,
      });
    }
  }

  if (candidates.length === 0) return { intent: "unknown", confidence: 0 };

  let best = candidates.reduce(stronger);

  // "Sorry, no" and "yes, what time?" both contain a request to repeat, but
  // neither is one. A worker who asks for the question again asks for it and
  // nothing else, so this reading only stands when nothing decided the shift.
  if (best.intent === "repeat") {
    const decisive = candidates.filter((c) => c.intent === "affirm" || c.intent === "decline");
    if (decisive.length > 0) best = decisive.reduce(stronger);
  }

  // Rule 2. Only a yes gets revised this way: someone who refuses and then adds
  // "yeah, sorry" has still refused.
  if (best.intent === "affirm") {
    const revisions = candidates.filter(
      (c) => c.position >= best.end && (c.intent === "decline" || c.intent === "unsure" || c.intent === "stop"),
    );
    if (revisions.length > 0) best = revisions.reduce(stronger);
  }

  return { intent: best.intent, confidence: best.confidence, matched: best.matched };
}

/** True when the reply is a yes we would stake a rostered shift on. */
export function isClearAffirmation(text: string): boolean {
  const reading = readIntent(text);
  return reading.intent === "affirm" && reading.confidence >= CLEAR_INTENT;
}

/** True when the reply is anything but a yes, clearly enough to act on. */
export function isClearRefusal(text: string): boolean {
  const reading = readIntent(text);
  return (
    (reading.intent === "decline" || reading.intent === "stop") &&
    reading.confidence >= CLEAR_INTENT
  );
}

/**
 * Example answers for the prompt, in the worker's language and in English,
 * since workers mix the two. This is the whole point of keeping the lexicon in
 * one place: the model is told to accept exactly the phrasings the backend can
 * verify, so the gate in webhook.ts rarely has to fire.
 */
export function intentExamples(
  intent: WorkerIntent,
  language: SupportedLanguage,
  limit = 12,
): string[] {
  // Phrases first. "I can do that" teaches the model something about how people
  // answer a question; "yes" teaches it nothing it did not already know, and
  // the list is short because every entry costs tokens on a latency-sensitive
  // call.
  const byUsefulness = (phrases: string[]) => [
    ...phrases.filter((phrase) => phrase.includes(" ")),
    ...phrases.filter((phrase) => !phrase.includes(" ")),
  ];

  const own = byUsefulness(LEXICON[language]?.[intent] ?? []);
  if (language === "English") return own.slice(0, limit);

  // Workers switch to English mid-sentence, so their language never gets the
  // whole budget.
  const share = Math.ceil(limit * 0.6);
  const english = byUsefulness(LEXICON.English[intent] ?? []);

  const examples: string[] = [];
  for (const phrase of [...own.slice(0, share), ...english]) {
    if (!examples.includes(phrase)) examples.push(phrase);
    if (examples.length >= limit) break;
  }
  return examples;
}

/** The same list, formatted for a prompt line. */
export function intentExampleLine(
  intent: WorkerIntent,
  language: SupportedLanguage,
  limit = 12,
): string {
  return intentExamples(intent, language, limit)
    .map((phrase) => `"${phrase}"`)
    .join(", ");
}
