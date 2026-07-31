import fs from "node:fs";
const t = fs.readFileSync(".env", "utf8");
for (const l of t.split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { syncVapiAssistant, buildAssistantConfig, toolServerUrl } = await import(
  "../src/integrations/vapi/index.ts"
);
console.log("tool server url ->", toolServerUrl());
const cfg = buildAssistantConfig();
console.log("pushing transcriber:", cfg.transcriber.provider, cfg.transcriber.model);
console.log("pushing voice      :", cfg.voice.provider, cfg.voice.voiceId);
console.log("pushing tools      :", cfg.model.tools.map((x: any) => x.function.name).join(", "));
console.log("result:", await syncVapiAssistant());
