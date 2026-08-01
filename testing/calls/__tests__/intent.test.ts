// Reading what the worker meant.
//
// The complaint this exists for: a worker says "yeah I can do that" and nothing
// downstream counts it as a yes, because only the word "yes" was ever looked
// for. Every case below is a phrasing a real caller uses instead of yes or no,
// plus the ones that look like a yes and are not.

import { describe, expect, it } from "vitest";
import {
  CLEAR_INTENT,
  intentExampleLine,
  intentExamples,
  isClearAffirmation,
  isClearRefusal,
  normalizeUtterance,
  readIntent,
} from "../../../src/integrations/vapi/intent";

const intentOf = (text: string) => readIntent(text).intent;

/** Enough of the English list to tell whether it survived into a mixed one. */
const LEXICON_ENGLISH_AFFIRM = intentExamples("affirm", "English", 12);

describe("normalizing what the transcriber gives us", () => {
  it("flattens case, accents and punctuation", () => {
    expect(normalizeUtterance("Sí, claro!")).toBe("si claro");
    expect(normalizeUtterance("  YES.  ")).toBe("yes");
  });

  it("keeps contractions as one word", () => {
    // "can't" splitting into "can" and "t" turns a refusal into "i can".
    expect(normalizeUtterance("I can't")).toBe("i cant");
    expect(normalizeUtterance("I can’t")).toBe("i cant");
  });

  it("leaves non-Latin script alone", () => {
    expect(normalizeUtterance("جی ہاں")).toBe("جی ہاں");
  });
});

describe("a yes that never says yes", () => {
  const yeses = [
    "yeah",
    "yep",
    "sure",
    "sure thing",
    "okay",
    "alright",
    "of course",
    "absolutely",
    "I can do that",
    "yeah I can do it",
    "count me in",
    "I'll take it",
    "I'll be there",
    "that works for me",
    "sounds good",
    "no problem",
    "put me down",
    "sign me up",
    "I'm available",
    "I'm free that evening",
    "uh huh",
    "mhm",
    "yes please",
    "why not",
    "happy to",
  ];

  for (const reply of yeses) {
    it(`reads "${reply}" as a yes`, () => {
      expect(intentOf(reply)).toBe("affirm");
      expect(isClearAffirmation(reply)).toBe(true);
    });
  }
});

describe("a no that never says no", () => {
  const noes = [
    "nope",
    "nah",
    "I can't",
    "I can't make it",
    "sorry no",
    "I'm working that day",
    "I'm busy",
    "I have plans",
    "not available",
    "no thanks",
    "that doesn't work for me",
    "I'll pass",
    "unfortunately not",
    "I'm out of town",
    "wrong number",
  ];

  for (const reply of noes) {
    it(`reads "${reply}" as a no`, () => {
      expect(intentOf(reply)).toBe("decline");
    });
  }
});

describe("the answers that look like a decision and are not", () => {
  it("does not take maybe for a yes", () => {
    for (const reply of ["maybe", "probably", "I think so", "possibly"]) {
      expect(intentOf(reply)).toBe("unsure");
      expect(isClearAffirmation(reply)).toBe(false);
    }
  });

  it("does not take a promise to check for a yes", () => {
    for (const reply of [
      "let me check",
      "I'll check my calendar",
      "call me back",
      "I'll let you know",
      "can I let you know",
      "text me the details",
    ]) {
      expect(intentOf(reply)).toBe("unsure");
    }
  });

  it("hears a request to repeat, not an answer", () => {
    for (const reply of ["what", "pardon", "say that again", "I didn't catch that"]) {
      expect(intentOf(reply)).toBe("repeat");
    }
  });

  it("hears an opt-out and does not confuse it with a decline", () => {
    expect(intentOf("stop calling me")).toBe("stop");
    expect(isClearRefusal("stop calling me")).toBe(true);
  });

  it("treats silence and filler noise as no answer at all", () => {
    expect(intentOf("")).toBe("silent");
    expect(intentOf("   ")).toBe("silent");
    expect(intentOf("um")).toBe("silent");
    expect(intentOf("uh, um")).toBe("silent");
  });

  it("says so plainly when it has no idea", () => {
    expect(intentOf("who gave you this number")).toBe("unknown");
    expect(readIntent("who gave you this number").confidence).toBe(0);
  });
});

describe("the traps a word list falls into", () => {
  it("does not read the 'no' in 'no problem' as a refusal", () => {
    // Longest match wins: "no problem" is more specific evidence than "no".
    expect(intentOf("no problem")).toBe("affirm");
    expect(intentOf("no worries, I'll be there")).toBe("affirm");
    expect(intentOf("that's not a problem")).toBe("affirm");
  });

  it("does not read the 'sure' in 'not sure' as a yes", () => {
    expect(intentOf("not sure")).toBe("unsure");
    expect(intentOf("I'm not sure yet")).toBe("unsure");
  });

  it("does not read the 'can' in 'I can't' as a yes", () => {
    expect(intentOf("I can't")).toBe("decline");
    expect(intentOf("I don't think I can")).toBe("decline");
  });

  it("takes the last clause when the worker changes their mind mid-sentence", () => {
    // "Yeah, no" is one of the most common ways an English speaker refuses.
    expect(intentOf("yeah, no, I'm working")).toBe("decline");
    expect(intentOf("sure - actually no, I can't")).toBe("decline");
    expect(intentOf("yes, well, let me check first")).toBe("unsure");
  });

  it("does not let a trailing apology turn a refusal into a yes", () => {
    expect(intentOf("no, sorry")).toBe("decline");
    expect(intentOf("sorry, no")).toBe("decline");
  });

  it("still answers when a yes comes with a question attached", () => {
    // "what" is a request to repeat only when it is the whole reply.
    expect(intentOf("yes, what time again")).toBe("affirm");
  });
});

describe("the other three languages", () => {
  it("reads Spanish", () => {
    expect(intentOf("sí")).toBe("affirm");
    expect(intentOf("claro que sí")).toBe("affirm");
    expect(intentOf("cuenta conmigo")).toBe("affirm");
    expect(intentOf("está bien")).toBe("affirm");
    expect(intentOf("no puedo")).toBe("decline");
    expect(intentOf("estoy trabajando")).toBe("decline");
    expect(intentOf("déjame ver")).toBe("unsure");
  });

  it("reads romanized Urdu", () => {
    expect(intentOf("haan ji")).toBe("affirm");
    expect(intentOf("bilkul")).toBe("affirm");
    expect(intentOf("theek hai")).toBe("affirm");
    expect(intentOf("main aa jaunga")).toBe("affirm");
    expect(intentOf("nahi kar sakta")).toBe("decline");
    expect(intentOf("dekhta hoon")).toBe("unsure");
  });

  it("reads Urdu in its own script, which is what the transcriber returns", () => {
    expect(intentOf("جی ہاں")).toBe("affirm");
    expect(intentOf("بالکل")).toBe("affirm");
    expect(intentOf("نہیں")).toBe("decline");
  });

  it("reads Punjabi in both scripts", () => {
    expect(intentOf("haanji")).toBe("affirm");
    expect(intentOf("aho")).toBe("affirm");
    expect(intentOf("ਹਾਂ ਜੀ")).toBe("affirm");
    expect(intentOf("ਨਹੀਂ")).toBe("decline");
  });

  it("does not mistake Urdu 'nahi' for Punjabi 'sahi'", () => {
    // One edit apart, opposite meanings. Fuzzy matching must not bridge them.
    expect(intentOf("nahi")).toBe("decline");
    expect(intentOf("sahi hai")).toBe("affirm");
  });
});

describe("surviving the transcriber", () => {
  it("recognises a mangled long word", () => {
    // gpt-4o-transcribe on a noisy line: "haan" comes back as "hann".
    expect(intentOf("hann")).toBe("affirm");
    expect(intentOf("absolutly")).toBe("affirm");
  });

  it("prices a guess as a guess", () => {
    // Below CLEAR_INTENT, so the confirmation gate asks rather than acting.
    expect(readIntent("absolutly").confidence).toBeLessThan(CLEAR_INTENT);
    expect(readIntent("absolutely").confidence).toBeGreaterThanOrEqual(CLEAR_INTENT);
  });

  it("gives short words no slack at all", () => {
    // "no" is one edit from "so", "go" and "know". Guessing there is worse
    // than not guessing: it invents a refusal the worker never made.
    expect(intentOf("go")).toBe("unknown");
    expect(intentOf("know")).toBe("unknown");
  });
});

describe("the examples handed to the prompt", () => {
  it("leads with the worker's own language, then adds English", () => {
    const spanish = intentExamples("affirm", "Spanish", 12);
    expect(spanish[0]).toBe("por supuesto");
    // Workers switch to English mid-sentence, so it is never crowded out.
    expect(spanish.some((phrase) => LEXICON_ENGLISH_AFFIRM.includes(phrase))).toBe(true);
  });

  it("gives English callers English only", () => {
    expect(intentExamples("affirm", "English", 5).every((word) => word !== "haan")).toBe(true);
  });

  it("spends the budget on phrases, not on the word 'yes'", () => {
    // "yes" tells the model nothing. "count me in" tells it what the job is.
    const english = intentExamples("affirm", "English", 12);
    expect(english.every((phrase) => phrase.includes(" "))).toBe(true);
    expect(english).toContain("count me in");
  });

  it("formats as a quoted list a prompt can drop in", () => {
    expect(intentExampleLine("affirm", "English", 2)).toBe('"I can do that", "count me in"');
  });

  it("only offers examples the matcher can actually recognise", () => {
    // The whole point of sharing the lexicon: the model is never told to accept
    // a phrasing the confirmation gate would then challenge.
    for (const language of ["English", "Spanish", "Urdu", "Punjabi"] as const) {
      for (const example of intentExamples("affirm", language, 12)) {
        expect(readIntent(example).intent, `"${example}" (${language})`).toBe("affirm");
      }
      for (const example of intentExamples("decline", language, 12)) {
        expect(readIntent(example).intent, `"${example}" (${language})`).toBe("decline");
      }
    }
  });
});
