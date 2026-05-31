import { callable } from "@decky/api";

const reportFrontendErrorCallable = callable<[message: string, stack?: string], boolean>("report_frontend_error");

export function reportError(error: unknown, context: string) {
  try {
    let message = "Unknown error";
    let stack = "";
    if (error instanceof Error) {
      message = error.message;
      stack = error.stack || "";
    } else if (typeof error === "string") {
      message = error;
    } else {
      message = JSON.stringify(error);
    }
    const fullMessage = `${context}: ${message}`;
    console.error(`[VARTA Sentry] ${fullMessage}`, stack);
    
    reportFrontendErrorCallable(fullMessage, stack).catch(() => {});
  } catch (e) {
    console.error("Failed to report error to python", e);
  }
}
