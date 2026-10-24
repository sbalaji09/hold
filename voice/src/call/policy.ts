// Code-enforced safety rules for both call directions. These run in addition to the prompts,
// so a model mistake or a spoken prompt injection cannot change what Callback says or decides.
// All checks are deliberately conservative: when unsure, they pick the outcome that holds money.
import type { SupplierProfile } from "../../../shared/contract.js";

// ---------- What the other person said ----------

const NEGATION = String.raw`(?:never|not|didn'?t|did not|haven'?t|have not|hasn'?t|has not|wasn'?t|was not|no|nobody|nothing|don'?t|do not)`;
const CHANGE = String.raw`(?:chang|switch|updat|mov|new|differ|replac|swap|request)\w*`;
const BANKISH = String.raw`(?:bank\w*|account\w*|details|anything|payment info\w*|remittance)`;

const DENIAL_PATTERNS: RegExp[] = [
  // "We never changed our bank", "we didn't change anything", "no one asked for a new account"
  new RegExp(String.raw`\b${NEGATION}\b[^.?!]{0,40}\b${CHANGE}[^.?!]{0,40}\b${BANKISH}`, "i"),
  // "nothing has changed"
  /\bnothing(?:'s| has)? changed\b/i,
  // "same bank as always", "still with the same account"
  /\bsame (?:bank|account|details)\b/i,
  /\bstill (?:with|at|using|on) (?:the same|our|the old)\b/i,
  // "that wasn't us", "we didn't send that"
  /\b(?:wasn'?t|was not|not) (?:us|from us)\b/i,
  /\b(?:didn'?t|did not|never) send\b/i,
];

/** True if the text denies a bank change. Errs towards true: a false denial only holds a payment. */
export function isBankDenial(text: string): boolean {
  return DENIAL_PATTERNS.some((re) => re.test(text));
}

/** For an answer to "Did you recently change your bank account?": a leading "no" is a denial too. */
export function isBankAnswerDenial(answer: string): boolean {
  return isBankDenial(answer) || /^\W*(?:no|nope|nah|negative)\b(?!\s+(?:problem|worries))/i.test(answer);
}

const INJECTION =
  /\b(?:ignore|disregard|forget|override)\b[^.?!]{0,30}\b(?:instructions?|rules?|prompts?|guidelines|previous|above|everything)\b|\byou are now\b|\bnew instructions\b|\bsystem prompt\b|\bdeveloper mode\b|\bjailbreak\b|\bpretend (?:to be|you)\b|\bact as\b|\bmark (?:this|it|me|the call)\b[^.?!]{0,20}\b(?:confirmed|verified|approved|correct)\b|\b(?:as an ai|you'?re an ai|language model)\b/i;

/** Spoken prompt injection ("ignore your instructions", "you are now..."). A real supplier never says this. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

/** Whether a call request's reasons are about a bank or account change. */
export function mentionsBankChange(reasons: string[]): boolean {
  return reasons.some((r) => /\b(?:bank|account|routing|iban|remit|payment details)\w*/i.test(r));
}

const BANK_WORDS = /\b(?:bank\w*|account\w*|routing|iban|swift|sort code|wire|ach|payment (?:details|info\w*)|remit\w*|deposit)\b/i;
const CHANGE_WORDS = /\b(?:chang|updat|new|switch|moved?|moving|differ|replac|correct|redirect|send (?:it|payment|the payment) to|pay (?:us|into|to))\w*/i;

/** Caller is asking to change where Fogline pays them. */
export function isBankChangeRequest(text: string): boolean {
  return BANK_WORDS.test(text) && CHANGE_WORDS.test(text);
}

const READBACK =
  /\b(?:what|which|read|tell me|confirm|verify|give me|do you have|look up|check)\b[^.?!]{0,60}\b(?:account|bank|routing|number|amount|balance|invoice|on file|details|address|email|phone|contact|owe|paid|payment|records?)\b/i;

const CALLBACK_SWAP =
  /\b(?:call|ring|reach|text|phone)\s+(?:me|us|her|him|them)\s+(?:back\s+)?(?:on|at)\s+(?:my|our|this|a|the)?\s*(?:new|other|different|cell|mobile|direct|personal)?\s*(?:number|line|cell|mobile|phone)\b|\b(?:new|different|other|direct|personal)\s+(?:number|line)\s+(?:is|to call|for you)\b|\b(?:don'?t|do not|instead of)\s+(?:use|call|ring)\s+(?:the|our|that)\s+(?:office\s+)?(?:number|line)\b|\b(?:number|line)\s+you\s+have\s+(?:is|for us is)\s+(?:out of date|wrong|old|down|not working)/i;

/** "Call me back on this number instead": a check call must only ever go to the number on file. */
export function isCallbackSwap(text: string): boolean {
  return CALLBACK_SWAP.test(text);
}

/** Caller wants something on file read back or confirmed. */
export function isReadbackRequest(text: string): boolean {
  return READBACK.test(text);
}

const PRESSURE =
  /\b(?:urgent\w*|asap|right now|immediately|today|tonight|deadline|won'?t get built|can'?t wait|emergency|this is (?:dev|maya)|i'?m (?:dev|maya)|i'?m (?:the|your) (?:controller|boss|manager|cfo|ceo|director)|authori[sz]\w*|approv\w*|override|on my authority|i'?ll take responsibility)\b/i;

/** Urgency or claimed authority ("the stage won't get built", "this is Dev"). */
export function isPressure(text: string): boolean {
  return PRESSURE.test(text);
}

export function isGoodbye(text: string): boolean {
  return /\b(?:bye|goodbye|good bye)\b/i.test(text) || /^\W*(?:ok(?:ay)?[, ]*)?(?:bye|goodbye|good bye|thanks?,? bye|that'?s (?:all|it|everything)|nothing else|no,? (?:thanks?|thank you|that'?s it|that'?s all)|i'?m (?:all set|good)|have a good (?:one|day))\b/i.test(
    text.trim(),
  );
}

/** Intent of one supplier turn during an outbound check call. "answer" is the default. */
export type TurnIntent = "later" | "wrong_person" | "who" | "greeting" | "repeat" | "wait" | "clarify" | "answer";

export function classifyTurn(text: string): TurnIntent {
  const t = text.trim();
  if (/\b(?:call (?:me |us )?(?:back )?later|call (?:me |us )?back (?:later|tomorrow|another time|in)|not a good time|bad time|(?:i'?m|we'?re) (?:busy|in a meeting|driving|on another call)|can you call back)\b/i.test(t))
    return "later";
  if (/\b(?:wrong number|wrong person|(?:you|you'?ve) (?:have|got) the wrong|don'?t work (?:here|there|for)|never heard of|no one (?:here )?by that|not who you)\b/i.test(t))
    return "wrong_person";
  if (/\b(?:who (?:is|'s) (?:this|calling)|who are you|who'?s this|what is this (?:about|regarding)|what'?s this about|is this a (?:robot|bot|recording|real person)|are you (?:a )?(?:robot|bot|human|real|an? ai|a person))\b/i.test(t))
    return "who";
  // "Hello?" or "Hi, this is Rosa" heard where an answer was expected (e.g. said on pickup).
  if (/^\W*(?:(?:hello|hi|hey|yes|yeah)\W*)?(?:hello|hi|hey|good (?:morning|afternoon|evening)|speaking|this is [a-z' ]+?(?: speaking)?|[a-z']+ speaking)\W*$/i.test(t))
    return "greeting";
  if (/\b(?:repeat (?:that|the question|it)|say (?:that|it) again|come again|what was (?:that|the question)|didn'?t (?:catch|hear) (?:that|you|the question)|one more time)\b/i.test(t) || /^\W*(?:what|huh|sorry|pardon|excuse me)\W*$/i.test(t))
    return "repeat";
  if (/\b(?:hold on|hang on|one (?:sec|second|moment|minute)|give me a (?:sec|second|moment|minute)|let me (?:check|look|pull|find|see))\b/i.test(t))
    return "wait";
  // A question back to us, not a hesitant answer like "Um, about nine thousand?".
  const questionBack = /^\W*(?:(?:um|uh|sorry|wait|so|and|but)\W+)?(?:which|what|when|where|why|how|who|do|does|did|is|are|was|can|could|would|should)\b[^]*\?\s*$/i;
  if (!/\d/.test(t) && (questionBack.test(t) || /\b(?:which (?:one|invoice|bill)|what do you mean|do you mean|what invoice)\b/i.test(t)))
    return "clarify";
  return "answer";
}

// ---------- What Callback says ----------

const NUMBER_WORD = String.raw`(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)`;
const SPELLED_DIGITS = new RegExp(String.raw`\b${NUMBER_WORD}(?:[\s,-]+${NUMBER_WORD}){2,}\b`, "i");
const ACCOUNTISH = /\b(?:account|routing|iban|swift|sort code|card|acct)\s*(?:number|no\.?|#)|\bending in\b|\bon file (?:is|as|shows|says)\b|\bwe have (?:you|it|your \w+) (?:down|on file) as\b/i;
const CONFIRMS = /\b(?:that'?s (?:correct|right|it|exactly)|that matches|matches (?:our|what)|checks out|you'?re (?:correct|right)|exactly right)/i;
const CHANGES = /\b(?:i'?ve|i have|we'?ve|we have|has been|have been|i'?ll|i will|we'?ll|we will|let me|i can|i'?m going to)\s+(?:now\s+|just\s+|go ahead and\s+)?(?:updat|chang|switch|record(?:ed)? the new|sav|process|approv|releas|edit)\w*/i;

/**
 * True if a sentence Callback is about to speak would leak or confirm anything: digits (other than ones
 * already in the questions), spelled-out numbers, account-like phrases, confirmations of what's on file,
 * or claims to change something. The caller replaces the sentence with a safe line.
 */
export function leaksSomething(sentence: string, allowedNumbers: ReadonlySet<string> = new Set()): boolean {
  for (const run of sentence.match(/\d[\d,.]*/g) ?? []) {
    if (!allowedNumbers.has(run.replace(/[,.]+$/, "").replace(/,/g, ""))) return true;
  }
  return SPELLED_DIGITS.test(sentence) || ACCOUNTISH.test(sentence) || CONFIRMS.test(sentence) || CHANGES.test(sentence);
}

/** Digit runs in some text, for leaksSomething's allow-list. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Re-chunk a token stream into sentences and check each one before it is spoken, so streaming keeps
 * first-audio latency low but nothing unchecked reaches the phone. On the first bad sentence, or if
 * the model fails before saying anything, speaks `safeLine` instead and stops.
 */
export async function* guardStream(
  source: AsyncIterable<string>,
  isBad: (sentence: string) => boolean,
  safeLine: string,
): AsyncGenerator<string> {
  let buffer = "";
  let spoke = false;
  const emit = function* (sentence: string): Generator<string, boolean> {
    if (!sentence.trim()) return true;
    if (isBad(sentence)) {
      // Kept sentences end in whitespace (see the split below), so no separator is needed.
      yield safeLine;
      spoke = true;
      return false;
    }
    yield sentence;
    spoke = true;
    return true;
  };
  try {
    for await (const chunk of source) {
      buffer += chunk;
      let m: RegExpExecArray | null;
      // A sentence ends at . ! or ? followed by whitespace.
      while ((m = /[.!?]+\s+/.exec(buffer))) {
        const sentence = buffer.slice(0, m.index + m[0].length);
        buffer = buffer.slice(m.index + m[0].length);
        if (!(yield* emit(sentence))) return;
      }
    }
    if (!(yield* emit(buffer))) return;
  } catch (err) {
    console.error("[call] reply generation failed:", err);
    if (!spoke) yield safeLine;
    return;
  }
  if (!spoke) yield safeLine;
}

// ---------- Supplier matching ----------

const STOP_WORDS = new Set(["the", "a", "an", "inc", "llc", "ltd", "co", "company", "corp", "corporation", "and", "of", "from", "at", "with", "this", "is", "its", "it", "im", "i", "am", "calling", "here", "we", "are", "our", "us"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(nameToken: string, claimToken: string): boolean {
  if (nameToken === claimToken || nameToken + "s" === claimToken || claimToken + "s" === nameToken) return true;
  // Tolerate one speech-to-text slip on longer words only ("Stagecraf" for "Stagecraft").
  return nameToken.length >= 5 && claimToken.length >= 5 && editDistanceAtMostOne(nameToken, claimToken);
}

/**
 * Which supplier a caller claims to be, from their own words. A supplier matches when every
 * significant word of its name or one alias appears in the claim; the most specific match wins,
 * and a tie between suppliers means no match. Conservative on purpose: a wrong match would
 * send the follow-up check call to the wrong supplier.
 */
export function matchSupplier(claim: string | undefined | null, profiles: SupplierProfile[]): string | null {
  if (!claim) return null;
  const claimTokens = tokens(claim);
  if (claimTokens.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const p of profiles) {
    let score = 0;
    for (const name of [p.name, ...p.aliases]) {
      const nameTokens = tokens(name);
      if (nameTokens.length === 0) continue;
      if (nameTokens.every((nt) => claimTokens.some((ct) => tokenMatches(nt, ct)))) score = Math.max(score, nameTokens.length);
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: p.supplier_id, score };
      tie = false;
    } else if (score === best.score && best.id !== p.supplier_id) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}
