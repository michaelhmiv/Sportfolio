import React, { useState } from "react";
import { asRecord, callTool, requestClose, type JsonRecord } from "./openai-host";

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function labelForAction(actionType: string): string {
  switch (actionType) {
    case "pool_buy":
      return "Buy virtual shares";
    case "pool_sell":
      return "Sell virtual shares";
    case "pool_add_liquidity":
    case "pool_add_liquidity_optimal":
    case "pool_zap_add_shares":
    case "pool_zap_add_sb":
      return "Add virtual liquidity";
    case "pool_remove_liquidity":
      return "Remove virtual liquidity";
    case "scout_set_count":
      return "Update scouting assignment";
    case "holdings_stack_shares":
      return "Stack virtual shares";
    case "daily_boost_assign":
      return "Assign daily boost";
    case "daily_boost_remove":
      return "Remove daily boost";
    case "community_boost_create":
      return "Create community boost";
    case "watchlist_add_player":
      return "Add player to watchlist";
    case "watchlist_remove_player":
      return "Remove player from watchlist";
    default:
      return "Sportfolio action";
  }
}

function detailRows(action: JsonRecord): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const entries: Array<[string, string]> = [
    ["playerId", "Player"],
    ["targetCount", "Scout count"],
    ["sbAmount", "Virtual spend (SB)"],
    ["sharesAmount", "Shares"],
    ["shares", "Shares"],
    ["playMoney", "Play money"],
    ["maxShares", "Maximum shares"],
    ["maxPlayMoney", "Maximum play money"],
    ["lpShares", "LP shares"],
    ["sharesToStack", "Shares to stack"],
    ["slotTier", "Boost slot"],
    ["boostDate", "Boost date"],
    ["sport", "Sport"],
  ];
  for (const [key, label] of entries) {
    const value = action[key];
    if (value == null || value === "") continue;
    rows.push({ label, value: key === "slotTier" ? `${String(value)}x` : String(value) });
  }
  return rows;
}

export function ActionReviewPanel({
  review,
  onFinalized,
  closeOnFinalized = false,
}: {
  review: JsonRecord;
  onFinalized?: (result: JsonRecord) => Promise<void> | void;
  closeOnFinalized?: boolean;
}) {
  const transaction = asRecord(review.transaction);
  const action = asRecord(transaction.action);
  const transactionId = text(review.transactionId || transaction.transactionId);
  const status = text(review.status || transaction.status, "pending_confirmation");
  const pending = status === "pending_confirmation" && review.confirmationRequired !== false;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const finalize = async (tool: "confirm_pending_action" | "cancel_pending_action") => {
    if (!transactionId) {
      setMessage("This staged action is missing its transaction id. Stage the action again.");
      return;
    }
    setBusy(true);
    try {
      const root = asRecord(await callTool(tool, { transactionId }));
      const result = Object.keys(asRecord(root.structuredContent)).length
        ? asRecord(root.structuredContent)
        : root;
      setMessage(
        text(
          result.summary,
          tool === "confirm_pending_action"
            ? "Sportfolio action confirmed."
            : "Sportfolio action canceled.",
        ),
      );
      await onFinalized?.(result);
      if (closeOnFinalized) await requestClose();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The Sportfolio action could not be finalized.",
      );
    } finally {
      setBusy(false);
    }
  };

  const rows = detailRows(action);
  const warnings = arr(review.warnings || transaction.warnings).filter(
    (value): value is string => typeof value === "string",
  );

  return (
    <section className="action-review">
      <div className="action-review__eyebrow">{labelForAction(text(action.actionType))}</div>
      <h2 className="action-review__title">Review before applying</h2>
      <p className="action-review__summary">
        {text(review.summary || transaction.summary, "Review this staged Sportfolio action.")}
      </p>
      {rows.length ? (
        <dl className="action-review__details">
          {rows.map((row) => (
            <div key={`${row.label}:${row.value}`} className="action-review__detail">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {warnings.map((warning) => (
        <div className="action-review__warning" key={warning}>
          {warning}
        </div>
      ))}
      {!pending ? (
        <div className="action-review__status">This action is {status.replaceAll("_", " ")}.</div>
      ) : (
        <div className="action-review__buttons">
          <button
            className="btn primary"
            disabled={busy || !transactionId}
            onClick={() => void finalize("confirm_pending_action")}
          >
            Confirm
          </button>
          <button
            className="btn"
            disabled={busy || !transactionId}
            onClick={() => void finalize("cancel_pending_action")}
          >
            Cancel
          </button>
        </div>
      )}
      {message ? <div className="action-review__status">{message}</div> : null}
    </section>
  );
}

export const ACTION_REVIEW_CSS = `
.action-review{display:grid;gap:12px}.action-review__eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--m);font-weight:750}.action-review__title{font-size:19px;margin:0}.action-review__summary{margin:0;color:var(--t);line-height:1.45}.action-review__details{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:0}.action-review__detail{background:var(--p2);border:1px solid var(--b);border-radius:12px;padding:9px}.action-review__detail dt{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--m)}.action-review__detail dd{margin:4px 0 0;font-weight:700;overflow-wrap:anywhere}.action-review__warning,.action-review__status{background:var(--p2);border:1px solid var(--b);border-radius:12px;padding:10px;font-size:12px;line-height:1.4}.action-review__warning{border-color:color-mix(in srgb,var(--r) 35%,var(--b))}.action-review__buttons{display:flex;gap:8px;flex-wrap:wrap}
`;
