#!/usr/bin/env node
// a1mobile CLI. Run from the repo root:
//   node --env-file=.env src/integrations/a1mobile/cli.mjs <command> [args]
//
//   claim                        claim a phone number (returns SIP credentials)
//   point <webhookUrl>           point the number's voice webhook at your server
//   verify <phone>               send an OTP to a number you want to reach
//   confirm <phone> <code>       confirm that OTP
//   sms <phone> <message...>     send a text
//
// Only OTP-verified numbers may be called or texted.

const BASE_URL = "https://hack.a1mobile.com";
// Accept every name the docs and .env.example have used, so a mismatched
// variable name fails loudly here instead of as an empty auth header.
const teamKey =
  process.env.A1MOBILE_API_KEY ||
  process.env.A1MOBILE_TEAM_KEY ||
  process.env.A1_TEAM_KEY;

if (!teamKey) {
  console.error(
    "No a1mobile team key found. Set A1MOBILE_API_KEY in .env (not .env.local),",
  );
  console.error("then re-run with --env-file=.env");
  process.exit(1);
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "X-Team-Key": teamKey,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }

  console.log(`${response.status} ${response.statusText}`);
  console.dir(parsed, { depth: null });

  if (!response.ok) process.exit(1);
  return parsed;
}

function requireArgs(count, usage) {
  if (process.argv.length < 3 + count) {
    console.error(`usage: ${usage}`);
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "claim":
    await post("/api/numbers/claim");
    break;

  case "point":
    requireArgs(1, "point <webhookUrl>");
    await post("/api/numbers/point", { webhook_url: args[0] });
    break;

  case "verify":
    requireArgs(1, "verify <phone>");
    await post("/api/verified-numbers", { phone: args[0] });
    console.log("\nOTP sent. Confirm it with:");
    console.log(`  node --env-file=.env src/integrations/a1mobile/cli.mjs confirm ${args[0]} <code>`);
    break;

  case "confirm":
    requireArgs(2, "confirm <phone> <code>");
    await post("/api/verified-numbers/confirm", { phone: args[0], code: args[1] });
    break;

  case "sms":
    requireArgs(2, "sms <phone> <message...>");
    await post("/api/sms", { to: args[0], body: args.slice(1).join(" ") });
    break;

  default:
    console.error("commands: claim | point <url> | verify <phone> | confirm <phone> <code> | sms <phone> <message...>");
    process.exit(1);
}
