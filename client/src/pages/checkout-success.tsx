import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, ArrowRight, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  useEffect(() => {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    setSearchParams(params);
    
    const status = params.get("checkout_status") || params.get("status");
    const receipt = params.get("receipt_id") || params.get("payment_id");
    
    setCheckoutStatus(status);
    setReceiptId(receipt);

    // Show success toast if checkout was successful
    if (status === "success") {
      toast({
        title: "Purchase Successful!",
        description: "Your community boost shares have been added to your account.",
      });
    }
  }, [toast]);

  const handleGoToPower = () => {
    navigate("/power");
  };

  const handleGoToPremium = () => {
    navigate("/premium");
  };

  // Determine if this was a community boost purchase or premium purchase
  // This is a heuristic - you might want to store the purchase type in sessionStorage
  const isSuccess = checkoutStatus === "success";

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="max-w-md w-full">
        <Card className="border-2">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              {isSuccess ? (
                <CheckCircle className="w-8 h-8 text-green-500" />
              ) : (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {isSuccess ? "Payment Successful!" : "Processing Payment..."}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {isSuccess ? (
              <>
                <div className="text-center space-y-2">
                  <p className="text-muted-foreground">
                    Thank you for your purchase! Your premium shares have been added to your account.
                  </p>
                  {receiptId && (
                    <p className="text-xs text-muted-foreground font-mono">
                      Receipt: {receiptId}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleGoToPower} 
                    className="w-full"
                    size="lg"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Go to Power Page
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  
                  <Button 
                    onClick={handleGoToPremium} 
                    variant="outline"
                    className="w-full"
                  >
                    View Premium Shares
                  </Button>
                </div>

                <div className="text-center">
                  <Badge variant="outline" className="text-xs">
                    You can now use your premium shares for community boosts!
                  </Badge>
                </div>
              </>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">
                  We're processing your payment. This may take a moment...
                </p>
                <div className="flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  If this takes too long, please check your email for confirmation.
                </p>
              </div>
            )}

            {/* Debug info - remove in production */}
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
