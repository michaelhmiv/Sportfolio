import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, ArrowRight, Zap, AlertCircle, Clock3 } from "lucide-react";
import { authenticatedFetch } from "@/lib/queryClient";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [state, setState] = useState<"processing" | "credited" | "pending" | "error">("processing");
  const [message, setMessage] = useState<string>("We're finalizing your payment...");
  const [showManualCheck, setShowManualCheck] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchParams(params);

    const receipt = params.get("receipt_id") || params.get("payment_id");
    setReceiptId(receipt);

    let cancelled = false;
    let timer: number | null = null;
    const startedAt = Date.now();

    const finalizeOnce = async (): Promise<{ terminal: boolean; pending: boolean }> => {
      if (!receipt) {
        setState("pending");
        setMessage("Missing receipt id. We could not verify this checkout yet.");
        return { terminal: true, pending: true };
      }

      try {
        const retryDelaysMs = [300, 700, 1200];

        let response: Response | null = null;
        for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
          response = await authenticatedFetch("/api/checkout/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receipt_id: receipt }),
          });

          // Auth can still be initializing right after redirect.
          if (response.status !== 401) break;

          await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
        }

        if (!response) {
          setState("error");
          setMessage("Network error while finalizing payment.");
          return { terminal: true, pending: false };
        }

        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (response.ok && data?.success && data?.state === "credited") {
          setState("credited");
          setMessage("Payment confirmed and shares credited to your account.");
          return { terminal: true, pending: false };
        }

        if (response.status === 202 || data?.state === "pending" || data?.state === "unresolved") {
          setState("pending");
          setMessage("Payment received. Confirming automatically...");
          return { terminal: false, pending: true };
        }

        if (response.status === 401) {
          setState("error");
          setMessage(
            "You're not signed in. Please sign in again, then refresh this page to confirm your payment.",
          );
          return { terminal: true, pending: false };
        }

        if (
          response.status === 409 &&
          (data?.reason === "underpaid" || data?.reason === "amount_mismatch")
        ) {
          setState("error");
          setMessage(
            "We received a payment, but the paid amount didn't match the selected quantity. Please contact support or try the purchase again.",
          );
          return { terminal: true, pending: false };
        }

        setState("error");
        setMessage(data?.error || "We couldn't confirm this payment yet.");
        return { terminal: true, pending: false };
      } catch {
        setState("error");
        setMessage("Network error while finalizing payment.");
        return { terminal: true, pending: false };
      }
    };

    const poll = async () => {
      if (cancelled) return;

      const result = await finalizeOnce();
      if (cancelled || result.terminal) return;

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 10_000) setShowManualCheck(true);

      // Keep polling for a reasonable window; webhook confirmation can lag.
      if (elapsedMs > 60_000) {
        setMessage("Still reconciling. This can take a bit — try again in a moment.");
        return;
      }

      const delay = elapsedMs < 10_000 ? 2000 : 5000;
      timer = window.setTimeout(poll, delay);
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const isCredited = state === "credited";

  return (
    <div className="terminal-page flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card variant="terminal" className="border-border">
          <CardHeader className="text-center pb-2">
            <div className="terminal-avatar mx-auto mb-4 h-16 w-16">
              {state === "processing" && <Loader2 className="w-8 h-8 text-primary animate-spin" />}
              {state === "credited" && <CheckCircle className="w-8 h-8 text-green-500" />}
              {state === "pending" && <Clock3 className="w-8 h-8 text-amber-500" />}
              {state === "error" && <AlertCircle className="w-8 h-8 text-red-500" />}
            </div>
            <div className="terminal-kicker">Payment Status</div>
            <CardTitle className="terminal-heading text-xl">
              {state === "processing" && "Processing Payment..."}
              {state === "credited" && "Payment Confirmed!"}
              {state === "pending" && "Payment Pending"}
              {state === "error" && "Payment Confirmation Failed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">{message}</p>
              {receiptId && (
                <p className="text-xs text-muted-foreground font-mono">Receipt: {receiptId}</p>
              )}
            </div>

            {isCredited ? (
              <>
                <div className="space-y-3">
                  <Button
                    variant="terminal"
                    onClick={() => navigate("/boosts")}
                    className="w-full"
                    size="lg"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Go to Boosts
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>

                  <Button
                    onClick={() => navigate("/premium")}
                    variant="terminalOutline"
                    className="w-full"
                  >
                    View Premium Shares
                  </Button>
                </div>

                <div className="text-center">
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    You can now use your shares for boosts.
                  </Badge>
                </div>
              </>
            ) : (
              <div className="text-center">
                {showManualCheck ? (
                  <Button onClick={() => window.location.reload()} variant="terminalOutline">
                    Check Again
                  </Button>
                ) : (
                  <Button onClick={() => window.location.reload()} variant="terminalOutline">
                    Try Again
                  </Button>
                )}
              </div>
            )}

            {process.env.NODE_ENV === "development" && searchParams && (
              <div className="terminal-shell mt-6 overflow-x-auto p-3 text-xs font-mono">
                <p className="mb-1 font-semibold">Debug Info:</p>
                {Array.from(searchParams.entries()).map(([key, value]) => (
                  <div key={key} className="truncate">
                    {key}: {value}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Link href="/" className="terminal-subtle hover:text-primary">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
