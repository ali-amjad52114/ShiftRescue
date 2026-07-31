# A1Mobile & Hackathon Telephony / AI Gateway Guide

This guide covers the hackathon infrastructure provided by A1Mobile, including telephone number provisioning, verification, SMS, AI Gateway access, and MCP integration.

---

## 0. Where the real values live

**No credentials belong in this file.** Every secret below is referenced by environment
variable name only. The real values live in `.env.local`, which is gitignored — see
`.env.example` for the full list of required variables.

To use the `curl` examples, export the team key into your shell first:

```bash
export A1MOBILE_TEAM_KEY="$(grep A1MOBILE_TEAM_KEY .env.local | cut -d= -f2- | tr -d '\"')"
```

If a credential is ever pasted into a tracked file, rotate it with the organizers rather
than only deleting the line — anything committed stays in git history.

---

## 1. Team Credentials

- **Team Key (`X-Team-Key`)**: `$A1MOBILE_TEAM_KEY` — authenticates every telephony API and MCP call
- **Team Name**: WinTeam

---

## 2. AI Model Gateway (OpenAI-compatible)

Your key provides **$50 of inference** across three supported models via the AI gateway endpoint:
- `openai.gpt-5.6-sol`
- `openai.gpt-5.6-terra`
- `openai.gpt-5.6-luna`

### Environment Configuration
```env
# Real values in .env.local — never commit them.
OPENAI_API_KEY=<a1hk_... hackathon gateway key>
OPENAI_BASE_URL=<AI gateway lambda URL>/openai/v1
```

> **Note:** The endpoint uses the OpenAI **Responses** format (`/openai/v1/responses`), not standard chat completions.

---

## 3. Telephony API Workflows (A1Mobile)

### A. Claim a Phone Number
Claim a dedicated phone number for your agent:
```bash
curl -X POST https://hack.a1mobile.com/api/numbers/claim \
  -H "X-Team-Key: $A1MOBILE_TEAM_KEY"
```
**Response:**
```json
{
  "phone_number": "+1...",
  "sip_username": "...",
  "sip_password": "..."
}
```

> The returned `sip_password` is a credential. Store it in `.env.local`, not here.

### B. Wire Phone Number to Agent

#### Option 1: Webhook (Recommended)
Streams incoming calls to your public webhook endpoint:
```bash
curl -X POST https://hack.a1mobile.com/api/numbers/point \
  -H "X-Team-Key: $A1MOBILE_TEAM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://shiftrescue.vercel.app/api/voiceos-command"}'
```

#### Option 2: SIP Trunking
Register `sip_username` / `sip_password` at `sip.telnyx.com` as a SIP trunk (useful for Vapi BYO SIP or LiveKit inbound trunks).

---

### C. Verify & Communicate with Numbers

> ⚠️ **Consent Rule:** You may **only** call or text numbers that have been OTP-verified or organizer test lines. No cold outreach is permitted.

#### 1. Request OTP Verification
```bash
curl -X POST https://hack.a1mobile.com/api/verified-numbers \
  -H "X-Team-Key: $A1MOBILE_TEAM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890"}'
```

#### 2. Confirm OTP Verification Code
```bash
curl -X POST https://hack.a1mobile.com/api/verified-numbers/confirm \
  -H "X-Team-Key: $A1MOBILE_TEAM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890","code":"123456"}'
```

#### 3. Send SMS
```bash
curl -X POST https://hack.a1mobile.com/api/sms \
  -H "X-Team-Key: $A1MOBILE_TEAM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"+1234567890","body":"Hello from ShiftRescue agent!"}'
```

---

## 4. Telephony MCP (Model Context Protocol)

All telephony tools are accessible via the streamable HTTP MCP server at `https://hack.a1mobile.com/mcp/` (keep the trailing slash).

### Claude Desktop / Cursor Config
Add this to your MCP configuration file:
```json
{
  "mcpServers": {
    "a1mobile": {
      "type": "http",
      "url": "https://hack.a1mobile.com/mcp/"
    }
  }
}
```

### Terminal CLI Test
```bash
npx @modelcontextprotocol/inspector --cli https://hack.a1mobile.com/mcp/ \
  --transport http --method tools/list
```

### Available MCP Tools
- `claim_number`
- `point_number`
- `send_confirmation_sms`
- `request_number_verification`
- `confirm_number_verification`

*(Always pass the team key as an argument to each tool call — read it from the environment, never hardcode it)*
