import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Loader2, ReceiptText, Zap } from "lucide-react";
import { Link, useLocation } from "wouter";
import { StatusSurface } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { authenticatedFetch } from "@/lib/queryClient";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [state, setState] = useState<"processing" | "credited" | "pending" | "error">("processing");
  const [message, setMessage] = useState("We're finalizing your payment…");
  const [showManualCheck, setShowManualCheck] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchParams(params);
    const receipt = params.get("receipt_id") || params.get("payment_id");
    setReceiptId(receipt);

    let cancelled = false;
    let timer: number | null = null;
    const startedAt = Date.now();

    const finalizeOnce = async (): Promise<{ terminal: boolean }> => {
      if (!receipt) {
        setState("pending");
        setMessage("The return URL did not include a receipt identifier, so this checkout cannot be verified yet.");
        return { terminal: true };
      }

      try {
        const retryDelaysMs = [300, 700, 1200];
        let response: Response | null = null;

        for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
          response = await authenticatedFetch("/api/checkout/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receipt_id: receipt }),
          });
          if (response.status !== 401) break;
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
        }

        if (!response) {
          setState("error");
          setMessage("A network error prevented payment verification.");
          return { terminal: true };
        }

        const data = await response.json().catch(() => null);
        if (response.ok && data?.success && data?.state === "credited") {
          setState("credited");
          setMessage("Payment confirmed. Your Sportfolio account has been updated.");
          return { terminal: true };
        }

        if (response.status === 202 || data?.state === "pending" || data?.state === "unresolved") {
          setState("pending");
          setMessage("Payment was received and is still being reconciled automatically.");
          return { terminal: false };
        }

        if (response.status === 401) {
          setState("error");
          setMessage("Your sign-in session was not available after checkout. Sign in again, then return to this receipt.");
          return { terminal: true };
        }

        if (response.status === 409 && (data?.reason === "underpaid" || data?.reason === "amount_mismatch")) {
          setState("error");
          setMessage("The payment amount did not match the selected purchase. Contact support before attempting another payment.");
          return { terminal: true };
        }

        setState("error");
        setMessage(data?.error || "Sportfolio could not confirm this payment yet.");
        return { terminal: true };
      } catch {
        setState("error");
        setMessage("A network error prevented payment verification.");
        return { terminal: true };
      }
    };

    const poll = async () => {
      if (cancelled) return;
      const result = await finalizeOnce();
      if (cancelled || result.terminal) return;

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 10_000) setShowManualCheck(true);
      if (elapsedMs > 60_000) {
        setMessage("Reconciliation is taking longer than expected. Use Check again or contact support with the receipt identifier.");
        return;
      }

      timer = window.setTimeout(poll, elapsedMs < 10_000 ? 2000 : 5000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const statePresentation =
    state === "credited"
      ? { icon: CheckCircle2, title: "Payment confirmed", tone: "bg-market-positive-subtle text-market-positive" }
      : state === "pending"
        ? { icon: Clock3, title: "Payment pending", tone: "bg-status-warning-subtle text-status-warning" }
        : state === "error"
          ? { icon: AlertCircle, title: "Payment needs attention", tone: "bg-destructive-subtle text-destructive" }
          : { icon: Loader2, title: "Confirming payment", tone: "bg-brand-subtle text-brand" };
  const StateIcon = statePresentation.icon;

  return (
    <StatusSurface>
      <Card variant="default" className="border-border-strong shadow-medium">
        <CardContent className="p-6 text-center sm:p-9">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-circle ${statePresentation.tone}`}>
            <StateIcon className={`h-8 w-8 ${state === "processing" ? "animate-spin" : ""}`} aria-hidden="true" />
          </div>
          <p className="mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content-subtle">Checkout status</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-content-strong">{statePresentation.title}</h1>
          <p className="mx-auto mt-3 max-w-md leading-6 text-content-muted">{message}</p>

          {receiptId ? (
            <div className="mx-auto mt-5 flex max-w-sm items-center justify-center gap-2 rounded-control bg-surface-raised px-3 py-2 text-xs text-content-subtle">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              <span className="truncate font-mono">{receiptId}</span>
            </div>
          ) : null}

          <div className="mt-7 grid gap-3">
            {state === "credited" ? (
              <>
                <Button onClick={() => navigate("/boosts")} className="gap-2">
                  <Zap className="h-4 w-4" aria-hidden="true" />
                  Continue to Boosts
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="outline" onClick={() => navigate("/portfolio")}>View portfolio</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => window.location.reload()}>
                {showManualCheck ? "Check again" : "Retry verification"}
              </Button>
            )}
          </div>

          <Link href="/" className="mt-6 inline-flex text-sm font-medium text-content-muted hover:text-brand">
            Return to dashboard
          </Link>

          {process.env.NODE_ENV === "development" && searchParams ? (
            <pre className="mt-6 overflow-x-auto rounded-panel bg-surface-raised p-3 text-left text-xs">
              {Array.from(searchParams.entries()).map(([key, value]) => `${key}: ${value}`).join("\n")}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </StatusSurface>
  );
}
