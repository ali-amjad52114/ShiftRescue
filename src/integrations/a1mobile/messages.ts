// SMS copy in the worker's language. The voice agent is multilingual; the texts
// have to match it or the demo speaks Urdu and then texts in English.

// Hindi is here because Urdu speech-to-text is poorly supported by most
// transcribers. Spoken Hindi and Urdu are mutually intelligible, so the voice
// agent can be switched to Hindi without changing how the demo sounds.
export type SupportedLanguage = "english" | "spanish" | "urdu" | "hindi";

export interface ShiftDetails {
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  pay: string;
}

// The demo runs one shift, so a small lookup beats a translation dependency.
// Anything not listed passes through in English rather than being mangled.
const ROLES: Record<string, Partial<Record<SupportedLanguage, string>>> = {
  "kitchen assistant": {
    spanish: "Asistente de Cocina",
    urdu: "کچن اسسٹنٹ",
    hindi: "किचन असिस्टेंट",
  },
  "line cook": {
    spanish: "Cocinero de Línea",
    urdu: "لائن کُک",
    hindi: "लाइन कुक",
  },
  server: { spanish: "Mesero", urdu: "ویٹر", hindi: "सर्वर" },
  dishwasher: {
    spanish: "Lavaplatos",
    urdu: "برتن دھونے والا",
    hindi: "बर्तन धोने वाला",
  },
};

const DAYS: Record<string, Partial<Record<SupportedLanguage, string>>> = {
  monday: { spanish: "lunes", urdu: "پیر", hindi: "सोमवार" },
  tuesday: { spanish: "martes", urdu: "منگل", hindi: "मंगलवार" },
  wednesday: { spanish: "miércoles", urdu: "بدھ", hindi: "बुधवार" },
  thursday: { spanish: "jueves", urdu: "جمعرات", hindi: "गुरुवार" },
  friday: { spanish: "viernes", urdu: "جمعہ", hindi: "शुक्रवार" },
  saturday: { spanish: "sábado", urdu: "ہفتہ", hindi: "शनिवार" },
  sunday: { spanish: "domingo", urdu: "اتوار", hindi: "रविवार" },
};

const MONTHS: Record<string, Partial<Record<SupportedLanguage, string>>> = {
  january: { spanish: "enero", urdu: "جنوری", hindi: "जनवरी" },
  february: { spanish: "febrero", urdu: "فروری", hindi: "फ़रवरी" },
  march: { spanish: "marzo", urdu: "مارچ", hindi: "मार्च" },
  april: { spanish: "abril", urdu: "اپریل", hindi: "अप्रैल" },
  may: { spanish: "mayo", urdu: "مئی", hindi: "मई" },
  june: { spanish: "junio", urdu: "جون", hindi: "जून" },
  july: { spanish: "julio", urdu: "جولائی", hindi: "जुलाई" },
  august: { spanish: "agosto", urdu: "اگست", hindi: "अगस्त" },
  september: { spanish: "septiembre", urdu: "ستمبر", hindi: "सितंबर" },
  october: { spanish: "octubre", urdu: "اکتوبر", hindi: "अक्टूबर" },
  november: { spanish: "noviembre", urdu: "نومبر", hindi: "नवंबर" },
  december: { spanish: "diciembre", urdu: "دسمبر", hindi: "दिसंबर" },
};

function lookup(
  table: Record<string, Partial<Record<SupportedLanguage, string>>>,
  key: string,
  language: SupportedLanguage,
): string | null {
  return table[key.trim().toLowerCase()]?.[language] ?? null;
}

function localizeRole(role: string, language: SupportedLanguage): string {
  return lookup(ROLES, role, language) ?? role;
}

// "Friday, July 31" -> "viernes 31 de julio" / "جمعہ، 31 جولائی" / "शुक्रवार, 31 जुलाई"
function localizeDate(date: string, language: SupportedLanguage): string {
  const match = date.match(/^\s*(\w+),\s*(\w+)\s+(\d+)\s*$/);
  if (!match) return date;

  const [, weekday, month, day] = match;
  const localDay = lookup(DAYS, weekday, language);
  const localMonth = lookup(MONTHS, month, language);
  if (!localDay || !localMonth) return date;

  if (language === "spanish") return `${localDay} ${day} de ${localMonth}`;
  if (language === "urdu") return `${localDay}، ${day} ${localMonth}`;
  return `${localDay}, ${day} ${localMonth}`;
}

// "$24 per hour" -> "$24 por hora" / "$24 فی گھنٹہ" / "$24 प्रति घंटा"
function localizePay(pay: string, language: SupportedLanguage): string {
  const match = pay.match(/^\s*(.+?)\s*(?:per|an|\/)\s*hour\s*$/i);
  if (!match) return pay;

  const amount = match[1];
  if (language === "spanish") return `${amount} por hora`;
  if (language === "urdu") return `${amount} فی گھنٹہ`;
  if (language === "hindi") return `${amount} प्रति घंटा`;
  return pay;
}

export // "6:00 PM" -> "6:00 de la tarde" / "شام 6:00" / "शाम 6:00".
// "PM" is an English token; leaving it in turned every Spanish call into a
// mix of two languages.
function localizeTime(time: string, language: SupportedLanguage): string {
  const match = time.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i);
  if (!match) return time;

  let hour = Number(match[1]) % 12;
  const minute = match[2] ?? "00";
  const isPm = match[3].toLowerCase() === "pm";
  if (isPm) hour += 12;

  const clock = `${hour % 12 === 0 ? 12 : hour % 12}${minute === "00" ? "" : ":" + minute}`;
  // Urdu and Hindi separate late afternoon from midday; Spanish runs "tarde"
  // right through until night.
  const partOfDay =
    hour < 12 ? "morning" : hour < 16 ? "afternoon" : hour < 20 ? "evening" : "night";

  if (language === "spanish") {
    const es = {
      morning: "de la mañana",
      afternoon: "de la tarde",
      evening: "de la tarde",
      night: "de la noche",
    }[partOfDay];
    return `${clock} ${es}`;
  }
  if (language === "urdu") {
    const ur = { morning: "صبح", afternoon: "دوپہر", evening: "شام", night: "رات" }[partOfDay];
    return `${ur} ${clock}`;
  }
  if (language === "hindi") {
    const hi = { morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात" }[partOfDay];
    return `${hi} ${clock}`;
  }
  return time;
}

export function localizeShift(
  shift: ShiftDetails,
  language: SupportedLanguage,
): ShiftDetails {
  if (language === "english") return shift;

  return {
    ...shift,
    role: localizeRole(shift.role, language),
    date: localizeDate(shift.date, language),
    startTime: localizeTime(shift.startTime, language),
    endTime: localizeTime(shift.endTime, language),
    pay: localizePay(shift.pay, language),
  };
}

export function normalizeLanguage(language: string): SupportedLanguage {
  const value = language.trim().toLowerCase();
  if (value.startsWith("es") || value === "spanish") return "spanish";
  if (value.startsWith("ur") || value === "urdu") return "urdu";
  if (value.startsWith("hi") || value === "hindi") return "hindi";
  return "english";
}

export function callbackInviteSms(
  language: string,
  demoNumber: string,
  details?: ShiftDetails,
): string {
  const target = normalizeLanguage(language);
  const shift = details ? localizeShift(details, target) : undefined;

  switch (target) {
    case "spanish":
      return shift
        ? `Se abrió un turno de ${shift.role} el ${shift.date}, de ${shift.startTime} a ${shift.endTime}, ${shift.pay}. Llama al ${demoNumber} ahora para escuchar los detalles.`
        : `Se abrió un turno y encajas con el perfil. Llama al ${demoNumber} ahora para escuchar los detalles.`;
    case "urdu":
      return shift
        ? `${shift.date} کو ${shift.role} کی شفٹ خالی ہے، ${shift.startTime} سے ${shift.endTime} تک، ${shift.pay}۔ تفصیلات سننے کے لیے ابھی ${demoNumber} پر کال کریں۔`
        : `ایک شفٹ خالی ہے اور آپ اس کے لیے موزوں ہیں۔ تفصیلات سننے کے لیے ابھی ${demoNumber} پر کال کریں۔`;
    case "hindi":
      return shift
        ? `${shift.date} को ${shift.role} की शिफ्ट खाली है, ${shift.startTime} से ${shift.endTime} तक, ${shift.pay}। जानकारी सुनने के लिए अभी ${demoNumber} पर कॉल करें।`
        : `एक शिफ्ट खाली है और आप इसके लिए उपयुक्त हैं। जानकारी सुनने के लिए अभी ${demoNumber} पर कॉल करें।`;
    default:
      return shift
        ? `A ${shift.role} shift just opened on ${shift.date}, ${shift.startTime} to ${shift.endTime}, ${shift.pay}. Call ${demoNumber} now to hear the details.`
        : `A shift just opened up and you're a match. Call ${demoNumber} now to hear the details.`;
  }
}

export function shiftConfirmationSms(
  language: string,
  workerName: string,
  details: ShiftDetails,
): string {
  const target = normalizeLanguage(language);
  const shift = localizeShift(details, target);

  switch (target) {
    case "spanish":
      return `${workerName}, tu turno está confirmado: ${shift.role}, ${shift.date}, de ${shift.startTime} a ${shift.endTime}, en ${shift.location}. ${shift.pay}.`;
    case "urdu":
      return `${workerName}، آپ کی شفٹ کنفرم ہو گئی ہے: ${shift.role}، ${shift.date}، ${shift.startTime} سے ${shift.endTime} تک، ${shift.location}۔ ${shift.pay}۔`;
    case "hindi":
      return `${workerName}, आपकी शिफ्ट कन्फर्म हो गई है: ${shift.role}, ${shift.date}, ${shift.startTime} से ${shift.endTime} तक, ${shift.location}। ${shift.pay}।`;
    default:
      return `${workerName}, you're confirmed for the ${shift.role} shift on ${shift.date}, ${shift.startTime} to ${shift.endTime}, at ${shift.location}. ${shift.pay}.`;
  }
}
