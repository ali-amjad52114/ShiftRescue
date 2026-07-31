#!/usr/bin/env node
// Outbound spike: wire the a1mobile/Telnyx SIP credentials into Vapi as a BYO
// trunk, then place one real call. a1mobile has no outbound-call API, so this
// is the only outbound path.
//
//   node --env-file=.env src/integrations/a1mobile/spike-sip-trunk.mjs trunk
//   node --env-file=.env src/integrations/a1mobile/spike-sip-trunk.mjs call +1XXXXXXXXXX
//
// `trunk` prints a VAPI_PHONE_NUMBER_ID to paste into .env. `call` needs that
// plus VAPI_ASSISTANT_ID, and the target must be OTP-verified.

// dns.lookup goes through the OS resolver; resolve4 issues a direct DNS query
// that some networks refuse. Set A1MOBILE_SIP_IPS to bypass resolution entirely.
import { lookup } from "node:dns/promises";

const VAPI_BASE_URL = "https://api.vapi.ai";
const SIP_HOST = "sip.telnyx.com";

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) {
  console.error("VAPI_API_KEY is not set");
  process.exit(1);
}

async function vapi(path, body) {
  const response = await fetch(`${VAPI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }

  console.log(`POST ${path} -> ${response.status}`);
  console.dir(parsed, { depth: null });

  if (!response.ok) {
    console.error(
      "\nIf this is a 4xx/5xx from Telnyx rather than Vapi, outbound is probably",
      "\ndisabled on the credentials a1mobile issued. That is server-side and not",
      "\nfixable here -- ask an organizer, and switch to ORIGINATION=inbound.",
    );
    process.exit(1);
  }

  return parsed;
}

async function createTrunk() {
  const number = process.env.A1MOBILE_PHONE_NUMBER;
  const username = process.env.A1MOBILE_SIP_USERNAME;
  const password = process.env.A1MOBILE_SIP_PASSWORD;

  if (!number || !username || !password) {
    console.error(
      "Set A1MOBILE_PHONE_NUMBER, A1MOBILE_SIP_USERNAME and A1MOBILE_SIP_PASSWORD in .env",
    );
    process.exit(1);
  }

  // Vapi rejects FQDNs in `gateways` with a 400, so resolve to A records first.
  const override = process.env.A1MOBILE_SIP_IPS;
  const ips = override
    ? override.split(",").map((ip) => ip.trim()).filter(Boolean)
    : (await lookup(SIP_HOST, { all: true, family: 4 })).map((a) => a.address);

  if (ips.length === 0) {
    console.error(`could not resolve ${SIP_HOST}; set A1MOBILE_SIP_IPS instead`);
    process.exit(1);
  }

  console.log(`${SIP_HOST} resolved to: ${ips.join(", ")}\n`);

  const credential = await vapi("/credential", {
    provider: "byo-sip-trunk",
    name: "a1mobile-telnyx",
    gateways: ips.map((ip) => ({ ip, inboundEnabled: true })),
    outboundAuthenticationPlan: {
      authUsername: username,
      authPassword: password,
      sipRegisterPlan: { realm: SIP_HOST },
    },
  });

  const phoneNumber = await vapi("/phone-number", {
    provider: "byo-phone-number",
    name: "a1mobile-demo-number",
    number,
    numberE164CheckEnabled: false,
    credentialId: credential.id,
  });

  console.log("\nAdd this to .env:");
  console.log(`VAPI_PHONE_NUMBER_ID=${phoneNumber.id}`);
}

async function placeCall(target) {
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!assistantId || !phoneNumberId) {
    console.error("Set VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID in .env (run `trunk` first)");
    process.exit(1);
  }

  const call = await vapi("/call/phone", {
    assistantId,
    phoneNumberId,
    customer: { number: target },
  });

  console.log(`\nSpike is green if that phone rings. callId=${call.id}`);
}

const [command, target] = process.argv.slice(2);

if (command === "trunk") {
  await createTrunk();
} else if (command === "call" && target) {
  await placeCall(target);
} else {
  console.error("usage: trunk | call <+1XXXXXXXXXX>");
  process.exit(1);
}
