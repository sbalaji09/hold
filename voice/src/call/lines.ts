// Everything a call says word for word, per language, in the words of the company hold works for
// (lib/company.ts). Prompts tell Claude which language to use; these are the lines code speaks itself,
// so the disclosure, the bank question and the goodbyes are always exactly what was approved.
import type { Company } from "../../../lib/company.js";

export interface Lines {
  disclosure: string;
  /** "I'm calling to double-check a recent invoice from Stagecraft Rigging Co.": what the call is for. */
  calling: (payee: string) => string;
  intro: (payee: string, questions: number) => string;
  acks: string[];
  later: string;
  wrongPerson: string;
  closing: string;
  timeUp: string;
  sorryRepeat: (question: string) => string;
  skip: string;
  moveOn: string;
  takeYourTime: string;
  /** While a person on the team judges an answer mid-call. */
  hold: string;
  thanksForWaiting: string;
  cantShare: (question: string) => string;
  bankQuestion: string;
  noHistoryQuestion: string;
  /** Fallback questions when Claude is slow or down. */
  confirmTotal: (month: string, ref: string) => string;
  roughlyPaid: (month: string) => string;
  whatFor: (month: string, ref: string) => string;
  pastCall: (month: string) => string;
  onFile: string;
  /** "number 4471": how a reference is read out. */
  spokenNumber: string;
}

/** What the team is called in Spanish, and a payment record. */
const ES: Record<string, { team: string; record: string }> = {
  "accounts team": { team: "cuentas", record: "factura" },
  "escrow team": { team: "depósito en garantía", record: "desembolso" },
  "payroll team": { team: "nómina", record: "cheque de pago" },
};

function english(co: Company): Lines {
  const team = `${co.owner} ${co.team}`;
  const purpose = (payee: string) =>
    co.payee.one === "employee" ? `your upcoming ${co.record}` : co.payee.one === "supplier" ? `a recent ${co.record} from ${payee}` : `an upcoming ${co.record} to ${payee}`;
  // "Stagecraft Rigging Co." already ends the sentence; don't add a second full stop.
  const calling = (payee: string) => `I'm calling to double-check ${purpose(payee.replace(/\.$/, ""))}.`;
  return {
    disclosure: `Hi, this is an automated assistant calling for ${team}. This call is recorded.`,
    calling,
    intro: (payee, n) => `${calling(payee)} I have ${n === 1 ? "one quick question" : "a couple of quick questions"}.`,
    acks: ["Thanks.", "Got it, thank you.", "Okay, thanks."],
    later: `No problem, sorry to catch you at a bad time. Someone from ${team} will follow up. Goodbye.`,
    wrongPerson: "Sorry about that, I must have the wrong person. Thanks for your time. Goodbye.",
    closing: "Thanks, that's everything I needed. Have a good day. Goodbye.",
    timeUp: `I'm sorry, I need to wrap up here. Someone from ${team} will follow up. Goodbye.`,
    sorryRepeat: (q) => `Sorry, I didn't catch that. ${q}`,
    skip: "That's okay, let's move on.",
    moveOn: "Let's move on.",
    takeYourTime: "Sure, take your time.",
    hold: "One moment, I'm just checking that with the team.",
    thanksForWaiting: "Thanks for waiting.",
    cantShare: (q) => `Sorry, I can't go into what we have on file. ${q}`,
    bankQuestion: "Did you recently change your bank account?",
    noHistoryQuestion:
      co.payee.one === "supplier" ? `Can you tell me what the most recent bill you sent ${co.name} was for?` : `Can you tell me what your most recent ${co.record} with ${co.name} was for?`,
    confirmTotal: (month, ref) => `Can you confirm the total on your ${month} ${co.record}, ${ref}?`,
    roughlyPaid: (month) => `Can you tell me roughly how much ${co.name} paid you in ${month}?`,
    whatFor: (month, ref) => `Can you tell me what your ${month} ${co.record}, ${ref}, was for?`,
    pastCall: (month) => `We spoke on the phone in ${month}. Can you remind me what that call was about?`,
    onFile: co.payee.one === "employee" ? "Can you tell me what your role is, and who your manager is?" : `Can you tell me what ${co.name} hired you for, and what was agreed?`,
    spokenNumber: "number",
  };
}

function spanish(co: Company): Lines {
  const w = ES[co.team] ?? ES["accounts team"]!;
  const team = `del equipo de ${w.team} de ${co.name}`; // "de" + "el equipo"
  const purpose = (payee: string) =>
    co.payee.one === "employee" ? `su próximo ${w.record}` : co.payee.one === "supplier" ? `una ${w.record} reciente de ${payee}` : `un próximo ${w.record} para ${payee}`;
  const calling = (payee: string) => `Le llamo para confirmar ${purpose(payee.replace(/\.$/, ""))}.`;
  return {
    disclosure: `Hola, le llama un asistente automático ${team}. Esta llamada se graba.`,
    calling,
    intro: (payee, n) => `${calling(payee)} Tengo ${n === 1 ? "una pregunta rápida" : "un par de preguntas rápidas"}.`,
    acks: ["Gracias.", "Entendido, gracias.", "Muy bien, gracias."],
    later: `No hay problema, disculpe la molestia. Alguien ${team} le dará seguimiento. Adiós.`,
    wrongPerson: "Disculpe, debo tener a la persona equivocada. Gracias por su tiempo. Adiós.",
    closing: "Gracias, es todo lo que necesitaba. Que tenga un buen día. Adiós.",
    timeUp: `Lo siento, tengo que terminar aquí. Alguien ${team} le dará seguimiento. Adiós.`,
    sorryRepeat: (q) => `Perdón, no le escuché bien. ${q}`,
    skip: "No se preocupe, sigamos.",
    moveOn: "Sigamos.",
    takeYourTime: "Claro, tómese su tiempo.",
    hold: "Un momento, lo estoy confirmando con el equipo.",
    thanksForWaiting: "Gracias por esperar.",
    cantShare: (q) => `Disculpe, no puedo hablar de lo que tenemos registrado. ${q}`,
    bankQuestion: "¿Cambió usted su cuenta bancaria recientemente?",
    noHistoryQuestion: `¿Me puede decir de qué era su ${w.record} más reciente con ${co.name}?`,
    confirmTotal: (month, ref) => `¿Me puede confirmar el total de su ${w.record} de ${month}, ${ref}?`,
    roughlyPaid: (month) => `¿Más o menos cuánto le pagó ${co.name} en ${month}?`,
    whatFor: (month, ref) => `¿Me puede decir de qué era su ${w.record} de ${month}, ${ref}?`,
    pastCall: (month) => `Hablamos por teléfono en ${month}. ¿Me recuerda de qué se trató esa llamada?`,
    onFile: co.payee.one === "employee" ? "¿Me puede decir cuál es su puesto y quién es su supervisor?" : `¿Me puede decir para qué le contrató ${co.name} y qué se acordó?`,
    spokenNumber: "número",
  };
}

/** The lines for one call. Languages without their own table fall back to English. */
export function linesFor(co: Company, language = "en"): Lines {
  return language.startsWith("es") ? spanish(co) : english(co);
}

/** Month names for spoken dates, per language. */
export function monthName(isoDate: string, language = "en"): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return language.startsWith("es") ? "este mes" : "recent";
  return d.toLocaleString(language.startsWith("es") ? "es-US" : "en-US", { month: "long", timeZone: "UTC" });
}
