import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { syncVapiAssistant, toolServerUrl } from "@/integrations/vapi";

/**
 * Push this deployment's prompt, decision tools and webhook URL onto the Vapi
 * assistant. Run it after every deploy and after any prompt or tool change.
 *
 * It lives as a route rather than a local script on purpose: what has to be
 * registered with Vapi is the URL of the instance actually taking the calls, and
 * only that instance knows it. The assistant-level `server.url` and
 * `serverMessages` set here are what make Vapi deliver the end-of-call report,
 * which on serverless is the only way a worker who never answered is detected.
 */
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  const target = toolServerUrl();
  if (target.startsWith("http://localhost")) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The webhook URL resolves to localhost, which Vapi cannot reach. Set PUBLIC_BASE_URL to this deployment's public origin.",
        target,
      },
      { status: 400 },
    );
  }

  const result = await syncVapiAssistant();
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, target }, { status: 502 });
  }

  return NextResponse.json({ success: true, target });
}
