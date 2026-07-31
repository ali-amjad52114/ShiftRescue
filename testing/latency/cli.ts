// Latency profiler CLI. Run with plain node (Node strips the types):
//
//   node testing/latency/cli.ts simulate [stack]
//   node testing/latency/cli.ts compare [before] [after]
//   node testing/latency/cli.ts bargein
//   node testing/latency/cli.ts probe [url] [samples]
//   node testing/latency/cli.ts report <callId>
//
// Deliberately imports nothing from src/: this has to run without Next, and
// without a build step, so it stays usable while the app is broken.

import { simulateBargeIn, simulateCall } from "./mockPipeline.ts";
import { STACKS, stackLanguageCoverage, resolveStack, type StackConfig } from "./profiles.ts";
import { formatProbe, probeToolServer } from "./probe.ts";
import {
  TALK_OVER_BUDGET_MS,
  buildReport,
  formatComparison,
  formatReport,
  talkOverMs,
} from "./timeline.ts";
import { analyzeCall, fetchVapiCall, formatRealCall } from "./vapiReport.ts";

const SIMULATION = { turns: 8, toolTurns: [7], seed: 20260731 };

function stackOrDie(name: string): StackConfig {
  const stack = STACKS[name];
  if (!stack) {
    console.error(`Unknown stack "${name}". Known: ${Object.keys(STACKS).join(", ")}`);
    process.exit(1);
  }
  return stack;
}

function describeStack(stack: StackConfig): string {
  const { stt, llm, tts } = resolveStack(stack);
  const coverage = stackLanguageCoverage(stack);
  const warning =
    coverage === "all-four" ? "" : `  <-- CANNOT SERVE THE FULL ROSTER (${coverage})`;
  return (
    `  stt ${stt.id}   llm ${llm.id}   tts ${tts.id}\n` +
    `  wait ${stack.waitSeconds}s   numWords ${stack.numWords}   ` +
    `voice ${stack.voiceSeconds}s   backoff ${stack.backoffSeconds}s   ` +
    `blocking dial ${stack.toolPathBlocksOnDial ? "yes" : "no"}${warning}`
  );
}

function runSimulate(name: string) {
  const stack = stackOrDie(name);
  console.log(describeStack(stack));
  console.log(formatReport(buildReport(`simulated: ${stack.name}`, simulateCall(stack, SIMULATION))));
  runBargeInFor(stack);
}

function runCompare(beforeName: string, afterName: string) {
  const before = stackOrDie(beforeName);
  const after = stackOrDie(afterName);

  console.log("");
  console.log(`  ${before.name}`);
  console.log(describeStack(before));
  console.log("");
  console.log(`  ${after.name}`);
  console.log(describeStack(after));

  console.log(
    formatComparison(
      buildReport(before.name, simulateCall(before, SIMULATION)),
      buildReport(after.name, simulateCall(after, SIMULATION)),
    ),
  );

  const beforeTalkOver = talkOverMs(simulateBargeIn(before));
  const afterTalkOver = talkOverMs(simulateBargeIn(after));
  console.log(
    `  barge-in talk-over: ${beforeTalkOver}ms -> ${afterTalkOver}ms ` +
      `(budget ${TALK_OVER_BUDGET_MS}ms)`,
  );
  console.log("");
}

function runBargeInFor(stack: StackConfig) {
  const barge = simulateBargeIn(stack);
  const total = talkOverMs(barge);
  const verdict = total <= TALK_OVER_BUDGET_MS ? "OK" : "OVER BUDGET";

  console.log(`  barge-in (${stack.name})`);
  console.log(`  ${"-".repeat(74)}`);
  console.log(`  voice activity detected        ${String(barge.vadDetect).padStart(6)}ms`);
  console.log(
    `  stop rule satisfied            ${String(barge.transcriptWait).padStart(6)}ms   ` +
      (stack.numWords > 0
        ? `waiting for ${stack.numWords} transcribed word(s)`
        : `voice activity only (${stack.voiceSeconds}s)`),
  );
  console.log(`  audio actually stops           ${String(barge.pipelineStop).padStart(6)}ms`);
  console.log(`  ${"-".repeat(74)}`);
  console.log(
    `  worker talked over for         ${String(total).padStart(6)}ms   ` +
      `[${verdict}, budget ${TALK_OVER_BUDGET_MS}ms]`,
  );
  console.log(`  then silence before reply      ${String(barge.recovery).padStart(6)}ms`);
  console.log("");
}

function runBargeIn() {
  for (const stack of Object.values(STACKS)) runBargeInFor(stack);
}

async function runProbe(url: string, samples: number) {
  for (const payload of ["decline", "accept", "end-of-call"] as const) {
    const result = await probeToolServer({ url, samples, payload });
    console.log(`  payload: ${payload}`);
    console.log(formatProbe(result));
  }
}

async function runReport(callId: string) {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error("VAPI_API_KEY is not set; cannot fetch a real call.");
    process.exit(1);
  }
  console.log(formatRealCall(analyzeCall(await fetchVapiCall(callId, apiKey))));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "simulate":
      runSimulate(args[0] ?? "current");
      break;
    case "compare":
      runCompare(args[0] ?? "current", args[1] ?? "tuned");
      break;
    case "bargein":
      runBargeIn();
      break;
    case "probe":
      await runProbe(
        args[0] ?? "http://localhost:3000/api/vapi-result",
        Number(args[1] ?? 10),
      );
      break;
    case "report":
      if (!args[0]) {
        console.error("Usage: node testing/latency/cli.ts report <callId>");
        process.exit(1);
      }
      await runReport(args[0]);
      break;
    default:
      console.log(
        [
          "",
          "  ShiftRescue voice latency profiler",
          "",
          "    simulate [stack]            stage-by-stage model of one call",
          "    compare [before] [after]    price a config or provider change",
          "    bargein                     interruption cost for every stack",
          "    probe [url] [samples]       time the real /api/vapi-result",
          "    report <callId>             real latencies from a call you made",
          "",
          `  stacks: ${Object.keys(STACKS).join(", ")}`,
          "",
        ].join("\n"),
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
