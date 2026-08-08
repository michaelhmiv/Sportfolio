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
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;padding:15px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:39px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5;cursor:not-allowed}.loading{min-height:130px;display:grid;place-items:center;color:var(--m)}${ACTION_REVIEW_CSS}
`;

type ActionPayload = {
  view: "action_review";
  asOf: string;
  data: JsonRecord;
};

function normalize(value: unknown): ActionPayload | null {
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

function transactionIdFromHost(): string {
  const input = asRecord(getHostSnapshot().toolInput);
  return typeof input.transactionId === "string" ? input.transactionId : "";
}

function App() {
  const [payload, setPayload] = useState<ActionPayload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeHostMessages((event) => {
      if (event.method === "openai:set_globals") {
        const params = asRecord(event.params);
        const globals = asRecord(params.globals);
        const next = normalize(globals.toolOutput ?? params.toolOutput ?? getHostSnapshot().toolOutput);
        if (next) setPayload(next);
      }
      if (event.method === "ui/notifications/tool-result") {
        const params = asRecord(event.params);
        const next = normalize(params.result ?? params);
        if (next) setPayload(next);
      }
    });
    void initializeMcpApp();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (payload) return;
    const transactionId = transactionIdFromHost();
    if (!transactionId) {
      setMessage("The staged Sportfolio action could not be identified.");
      return;
    }
    void callTool("render_action_review", { transactionId })
      .then((result) => {
        const next = normalize(result);
        if (next) setPayload(next);
        else setMessage("The staged Sportfolio action could not be loaded.");
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "The staged Sportfolio action could not be loaded."),
      );
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
          ) : (
            <div className="loading">{message || "Loading Sportfolio action…"}</div>
          )}
        </div>
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio action widget root was not found.");
createRoot(root).render(<App />);
