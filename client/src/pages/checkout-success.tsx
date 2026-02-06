import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, ArrowRight, Zap, AlertCircle } from "lucide-react";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [state, setState] = useState<"processing" | "credited" | "pending" | "error">("processing");
  const [message, setMessage] = useState<string>("Verifying your payment...");
  const [assetType, setAssetType] = useState<"community" | "premium" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout_status") || params.get("status");
    const receipt = params.get("receipt_id") || params.get("payment_id");

    setCheckoutStatus(status);
    setReceiptId(receipt);

    const finalize = async () => {
      if (status !== "success" || !receipt) {
        setState("error");
        setMessage("Missing successful checkout receipt. Please contact support.");
        return;
      }

      try {
        setState("processing");
        const res = await fetch("/api/checkout/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ receiptId: receipt, paymentId: receipt }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.status === "credited") {
          setState("credited");
          setAssetType(data.assetType || null);
          setMessage("Payment confirmed and shares credited.");
          return;
        }

        if (res.status === 202 || data?.status === "pending") {
          setState("pending");
          setMessage(data?.message || "Payment is still processing. Please retry in a moment.");
          return;
        }

        setState("error");
        setMessage(data?.error || data?.message || "Could not verify your payment yet.");
      } catch (error) {
        console.error("[checkout-success] finalize failed", error);
        setState("error");
        setMessage("Unable to verify payment right now. Please retry in a moment.");
      }
    };

    finalize();
  }, []);

  const handleGoToPower = () => navigate("/power");
  const handleGoToPremium = () => navigate("/premium");
  const handleRetry = async () => {
    if (!receiptId) return;
    setState("processing");
    setMessage("Retrying verification...");
    const res = await fetch("/api/checkout/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ receiptId, paymentId: receiptId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.status === "credited") {
      setState("credited");
      setAssetType(data.assetType || null);
      setMessage("Payment confirmed and shares credited.");
    } else if (res.status === 202 || data?.status === "pending") {
      setState("pending");
      setMessage(data?.message || "Still processing.");
    } else {
      setState("error");
      setMessage(data?.error || data?.message || "Could not verify payment.");
    }
  };

  const title = useMemo(() => {
    if (state === "credited") return "Payment Confirmed";
    if (state === "pending" || state === "processing") return "Processing Payment";
    return "Payment Needs Attention";
  }, [state]);

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="max-w-md w-full">
        <Card className="border-2">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              {state === "credited" ? (
                <CheckCircle className="w-8 h-8 text-green-500" />
              ) : state === "error" ? (
                <AlertCircle className="w-8 h-8 text-amber-500" />
              ) : (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              )}
            </div>
            <CardTitle className="text-2xl">{title}</CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">{message}</p>
              {receiptId && (
                <p className="text-xs text-muted-foreground font-mono">Receipt: {receiptId}</p>
              )}
            </div>

            {state === "credited" ? (
              <>
                <div className="space-y-3">
                  <Button onClick={handleGoToPower} className="w-full" size="lg">
                    <Zap className="w-4 h-4 mr-2" />
                    Go to Power Page
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <Button onClick={handleGoToPremium} variant="outline" className="w-full">
                    View Holdings
                  </Button>
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="text-xs">
                    {assetType === "community" ? "Community shares are now available for boosts" : "Premium shares are now available"}
                  </Badge>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Button onClick={handleRetry} className="w-full" variant="outline">
                  Retry Verification
                </Button>
                <Button onClick={handleGoToPremium} className="w-full" variant="ghost">
                  Go to Holdings
                </Button>
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
