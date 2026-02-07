import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, ArrowRight, Zap, AlertCircle, Clock3 } from "lucide-react";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [state, setState] = useState<"processing" | "credited" | "pending" | "error">("processing");
  const [message, setMessage] = useState<string>("We're finalizing your payment...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchParams(params);

    const receipt = params.get("receipt_id") || params.get("payment_id");
    setReceiptId(receipt);

    const finalize = async () => {
      if (!receipt) {
        setState("pending");
        setMessage("Missing receipt id. We could not verify this checkout yet.");
        return;
      }

      try {
        const response = await fetch("/api/checkout/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ receipt_id: receipt }),
        });

        const data = await response.json();
        if (response.ok && data?.success && data?.state === "credited") {
          setState("credited");
          setMessage("Payment confirmed and shares credited to your account.");
          return;
        }

        if (response.status === 202 || data?.state === "pending" || data?.state === "unresolved") {
          setState("pending");
          setMessage("Payment received but still reconciling. Please refresh in a moment.");
          return;
        }

        if (response.status === 401) {
          setState("error");
          setMessage("You're not signed in. Please sign in again, then refresh this page to confirm your payment.");
          return;
        }

        if (response.status === 409 && (data?.reason === "underpaid" || data?.reason === "amount_mismatch")) {
          setState("error");
          setMessage("We received a payment, but the paid amount didn't match the selected quantity. Please contact support or try the purchase again.");
          return;
        }

        setState("error");
        setMessage(data?.error || "We couldn't confirm this payment yet.");
      } catch {
        setState("error");
        setMessage("Network error while finalizing payment.");
      }
    };

    finalize();
  }, []);

  const isCredited = state === "credited";

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="max-w-md w-full">
        <Card className="border-2">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              {state === "processing" && <Loader2 className="w-8 h-8 text-primary animate-spin" />}
              {state === "credited" && <CheckCircle className="w-8 h-8 text-green-500" />}
              {state === "pending" && <Clock3 className="w-8 h-8 text-amber-500" />}
              {state === "error" && <AlertCircle className="w-8 h-8 text-red-500" />}
            </div>
            <CardTitle className="text-2xl">
              {state === "processing" && "Processing Payment..."}
              {state === "credited" && "Payment Confirmed!"}
              {state === "pending" && "Payment Pending"}
              {state === "error" && "Payment Confirmation Failed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">{message}</p>
              {receiptId && <p className="text-xs text-muted-foreground font-mono">Receipt: {receiptId}</p>}
            </div>

            {isCredited ? (
              <>
                <div className="space-y-3">
                  <Button onClick={() => navigate("/power")} className="w-full" size="lg">
                    <Zap className="w-4 h-4 mr-2" />
                    Go to Power Page
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>

                  <Button onClick={() => navigate("/premium")} variant="outline" className="w-full">
                    View Premium Shares
                  </Button>
                </div>

                <div className="text-center">
                  <Badge variant="outline" className="text-xs">
                    You can now use your shares for boosts.
                  </Badge>
                </div>
              </>
            ) : (
              <div className="text-center">
                <Button onClick={() => window.location.reload()} variant="outline">Try Again</Button>
              </div>
            )}

            {process.env.NODE_ENV === "development" && searchParams && (
              <div className="mt-6 p-3 bg-muted rounded text-xs font-mono overflow-x-auto">
                <p className="font-semibold mb-1">Debug Info:</p>
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
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
