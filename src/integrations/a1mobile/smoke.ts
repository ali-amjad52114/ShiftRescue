// Offline checks for the parts that do not need the network.
//   npx --yes tsx src/integrations/a1mobile/smoke.ts

import { callbackInviteSms, shiftConfirmationSms } from "./messages";
import { extractCallerNumber, resolveInboundCaller } from "./inbound";
import { sendA1MobileSms, startA1MobileCall } from "./client";
import { classifyEndedReason } from "./status";

const shift = {
  role: "Kitchen Assistant",
  date: "Friday, July 31",
  startTime: "6:00 PM",
  endTime: "10:00 PM",
  location: "Downtown San Francisco",
  pay: "$24 per hour",
};

const workers = [
  { id: "worker-1", name: "Maria", phone: "+14155550101", language: "Spanish" },
  { id: "worker-2", name: "Ahmed", phone: "+14155550102", language: "Urdu" },
  { id: "worker-3", name: "John", phone: "+14155550103", language: "English" },
  { id: "worker-4", name: "Priya", phone: "+14155550104", language: "Hindi" },
];

let failures = 0;

function check(label: string, condition: boolean) {
  console.log(`${condition ? "ok  " : "FAIL"}  ${label}`);
  if (!condition) failures += 1;
}

console.log("\n-- localized copy --\n");
for (const worker of workers) {
  console.log(`${worker.name} (${worker.language}) invite:`);
  console.log(`  ${callbackInviteSms(worker.language, "+16676650161", shift)}`);
  console.log(`${worker.name} (${worker.language}) confirmation:`);
  console.log(`  ${shiftConfirmationSms(worker.language, worker.name, shift)}\n`);
}

console.log("-- checks --\n");

check(
  "spanish invite is not english",
  callbackInviteSms("Spanish", "+1667", shift).includes("Llama al"),
);
check(
  "urdu confirmation is not english",
  shiftConfirmationSms("Urdu", "Ahmed", shift).includes("کنفرم"),
);
check(
  "unknown language falls back to english",
  shiftConfirmationSms("Klingon", "John", shift).includes("you're confirmed"),
);

check(
  "spanish localizes role, date and pay",
  shiftConfirmationSms("Spanish", "Maria", shift).includes("Asistente de Cocina") &&
    shiftConfirmationSms("Spanish", "Maria", shift).includes("viernes 31 de julio") &&
    shiftConfirmationSms("Spanish", "Maria", shift).includes("$24 por hora"),
);
check(
  "urdu localizes role, date and pay",
  shiftConfirmationSms("Urdu", "Ahmed", shift).includes("کچن اسسٹنٹ") &&
    shiftConfirmationSms("Urdu", "Ahmed", shift).includes("جولائی") &&
    shiftConfirmationSms("Urdu", "Ahmed", shift).includes("فی گھنٹہ"),
);
check(
  "hindi localizes role, date and pay",
  shiftConfirmationSms("Hindi", "Priya", shift).includes("किचन असिस्टेंट") &&
    shiftConfirmationSms("Hindi", "Priya", shift).includes("शुक्रवार, 31 जुलाई") &&
    shiftConfirmationSms("Hindi", "Priya", shift).includes("$24 प्रति घंटा"),
);
check(
  "urdu and hindi copy stay distinct",
  shiftConfirmationSms("Hindi", "Priya", shift) !==
    shiftConfirmationSms("Urdu", "Priya", shift),
);

check(
  "unknown role and unparseable date pass through untouched",
  shiftConfirmationSms("Spanish", "Maria", {
    ...shift,
    role: "Sous Chef",
    date: "next Tuesday",
  }).includes("Sous Chef"),
);

check(
  "caller id resolves worker and language",
  resolveInboundCaller("(415) 555-0102", workers)?.language === "urdu",
);
check(
  "unknown caller resolves to null",
  resolveInboundCaller("+19998887777", workers) === null,
);
check(
  "caller number extracted from varied payload shapes",
  extractCallerNumber({ From: "+14155550101" }) === "+14155550101" &&
    extractCallerNumber({ caller_number: "+14155550102" }) === "+14155550102" &&
    extractCallerNumber({ nothing: true }) === null,
);

async function main() {
  process.env.SIMULATE = "true";

  const simulatedCall = await startA1MobileCall({
    workerId: "worker-2",
    phone: "+14155550102",
    language: "Urdu",
    shiftId: "shift-1",
  });
  const simulatedSms = await sendA1MobileSms({
    phone: "+14155550102",
    message: "hello",
  });

  check("simulate mode returns a call id without network", simulatedCall.success);
  check("simulate mode returns an sms id without network", simulatedSms.success);

  check(
    "an attempt id is generated when none is supplied",
    Boolean(simulatedCall.attemptId),
  );

  const supplied = await startA1MobileCall({
    workerId: "worker-2",
    phone: "+14155550102",
    language: "Urdu",
    shiftId: "shift-1",
    attemptId: "att_fixed_123",
  });
  check("a supplied attempt id is echoed back", supplied.attemptId === "att_fixed_123");

  const first = await startA1MobileCall({
    workerId: "worker-1",
    phone: "+14155550101",
    language: "Spanish",
    shiftId: "shift-1",
  });
  check(
    "generated attempt ids are unique per attempt",
    first.attemptId !== simulatedCall.attemptId,
  );

  check(
    "no-answer reasons are not treated as answered",
    classifyEndedReason("customer-did-not-answer", "ended") === "no-answer" &&
      classifyEndedReason("voicemail", "ended") === "no-answer",
  );
  check(
    "a hangup counts as answered",
    classifyEndedReason("customer-ended-call", "ended") === "answered",
  );
  check(
    "transport and pipeline problems are failures",
    classifyEndedReason("pipeline-error-openai-llm-failed", "ended") === "failed" &&
      classifyEndedReason("sip-gateway-failed-to-connect-call", "ended") === "failed",
  );
  check(
    "a live call is not classified as ended",
    classifyEndedReason(undefined, "in-progress") === "in-progress",
  );

  console.log(
    `\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
