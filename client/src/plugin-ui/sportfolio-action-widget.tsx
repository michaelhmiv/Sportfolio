import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_REVIEW_CSS, ActionReviewPanel } from "./action-review-panel";
import {
  asRecord,
  callTool,
  getHostSnapshot,
  initializeMcpApp,
  notifyIntrinsicHeight,
  subscribeHostMessages,
  type JsonRecord,
} from "./openai-host";

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f1f3f7,#222630);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--r:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;padding:15px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:39px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5;cursor:not-allowed}.loading{min-height:130px;display:grid;place-items:center;color:var(--m)}.error{min-height:130px;display:grid;place-items:center;text-align:center;color:var(--r)}${ACTION_REVIEW_CSS}
`;

export const ACTION_REVIEW_RECOVERY_TIMEOUT_MS = 12_000;
const ACTION_REVIEW_RECOVERY_ERROR =
  "The staged Sportfolio action could not be loaded. Please ask ChatGPT to reopen the action review.";

type ActionPayload = {
  view: "action_review";
  asOf: string;
  data: JsonRecord;
};

export function normalizeActionReview(value: unknown): ActionPayload | null {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  const candidate = structured.view === "action_review" ? structured : root;
  if (candidate.view !== "action_review") return null;
  return {
    view: "action_review",
    asOf: typeof candidate.asOf === "string" ? candidate.asOf : new Date().toISOString(),
    data: asRecord(candidate.data),
  };
}

function stringTransactionId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function transactionIdFromSnapshot(snapshot = getHostSnapshot()): string {
  const input = asRecord(snapshot.toolInput);
  const inputId = stringTransactionId(input.transactionId);
  if (inputId) return inputId;

  // Recovery only: if a host accidentally mounts a raw stage_* result into the action
  // resource, use the exact server-issued transaction ID and re-fetch the canonical review.
  const output = asRecord(snapshot.toolOutput);
  const structured = asRecord(output.structuredContent);
  const structuredData = asRecord(structured.data);
  const outputData = asRecord(output.data);
  return (
    stringTransactionId(structured.transactionId) ||
    stringTransactionId(structuredData.transactionId) ||
    stringTransactionId(output.transactionId) ||
    stringTransactionId(outputData.transactionId)
  );
}

function App() {
  const [payload, setPayload] = useState<ActionPayload | null>(() =>
    normalizeActionReview(getHostSnapshot().toolOutput),
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeHostMessages((event) => {
      if (event.method === "openai:set_globals") {
        const params = asRecord(event.params);
        const globals = asRecord(params.globals);
        const next = normalizeActionReview(
          globals.toolOutput ?? params.toolOutput ?? getHostSnapshot().toolOutput,
        );
        if (next) {
          setMessage("");
          setPayload(next);
        }
      }
      if (event.method === "ui/notifications/tool-result") {
        const params = asRecord(event.params);
        const next = normalizeActionReview(params.result ?? params);
        if (next) {
          setMessage("");
          setPayload(next);
        }
      }
    });
    void initializeMcpApp();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (payload) return;
    const transactionId = transactionIdFromSnapshot();
    if (!transactionId) {
      setMessage(
        "The staged Sportfolio action could not be identified. Please stage the action again.",
      );
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) setMessage(ACTION_REVIEW_RECOVERY_ERROR);
    }, ACTION_REVIEW_RECOVERY_TIMEOUT_MS);

    void callTool("render_action_review", { transactionId })
      .then((result) => {
        if (!active) return;
        window.clearTimeout(timeout);
        const next = normalizeActionReview(result);
        if (next) {
          setMessage("");
          setPayload(next);
        } else {
          setMessage(ACTION_REVIEW_RECOVERY_ERROR);
        }
      })
      .catch(() => {
        if (!active) return;
        window.clearTimeout(timeout);
        setMessage(ACTION_REVIEW_RECOVERY_ERROR);
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [payload]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => notifyIntrinsicHeight());
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => notifyIntrinsicHeight())
        : null;
    observer?.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [payload, message]);

  return (
    <>
      <style>{CSS}</style>
      <main className="shell">
        <div className="panel">
          {payload ? (
            <ActionReviewPanel review={payload.data} closeOnFinalized />
          ) : message ? (
            <div className="error" role="alert">
              {message}
            </div>
          ) : (
            <div className="loading" role="status">
              Loading Sportfolio action…
            </div>
          )}
        </div>
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio action widget root was not found.");
createRoot(root).render(<App />);
