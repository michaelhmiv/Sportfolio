import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Crown, Zap, Check, Loader2, ShoppingCart, Plus, Minus, X, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface PremiumStatus {
  isPremium: boolean;
  premiumExpiresAt: string | null;
  premiumShares: number;
  recentPurchases: {
    id: string;
    quantity: number;
    amountCents: number;
    createdAt: string;
    completedAt: string | null;
  }[];
}

interface CheckoutSession {
  sessionId: string;
  planId: string;
  quantity: number;
  amountCents: number;
  email?: string;
}

const PRICE_PER_SHARE = 5;

const premiumBenefits = [
  {
    icon: Zap,
    title: "Double Scout Capacity",
    description: "Assign up to 10 scouts instead of 5 for faster share earnings",
  },
  {
    icon: Crown,
    title: "Ad-Free Experience",
    description: "Browse and trade without any advertisements",
  },
];

export default function Premium() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [quantity, setQuantity] = useState(1);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null);
  const [showPostPurchaseModal, setShowPostPurchaseModal] = useState(false);
  const [purchasedQuantity, setPurchasedQuantity] = useState(0);

  const { data: premiumStatus, isLoading } = useQuery<PremiumStatus>({
    queryKey: ["/api/premium/status"],
    enabled: isAuthenticated,
  });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/premium/redeem");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Premium Activated!",
        description: "You now have 30 days of premium access.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Redemption Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const syncWhopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whop/sync");
      return res.json();
    },
    onSuccess: (data: { credited: number; revoked: number; synced: number }) => {
      if (data.credited > 0) {
        toast({
          title: "Premium Shares Credited!",
          description: `${data.credited} Premium Share${data.credited > 1 ? "s" : ""} from Whop ${data.credited > 1 ? "have" : "has"} been added to your account.`,
        });
      } else {
        toast({
          title: "Sync Complete",
          description:
            data.synced > 0
              ? `Checked ${data.synced} payment${data.synced > 1 ? "s" : ""} from Whop. No new shares to credit.`
              : "No Whop payments found for your email.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await apiRequest("POST", "/api/premium/checkout-session", { quantity });
      const session = await res.json();
      setCheckoutSession(session);
      setShowCheckout(true);

      // Open Whop checkout in a new tab using the purchaseUrl from API
      const checkoutUrl = session.purchaseUrl;
      if (checkoutUrl) {
        window.open(checkoutUrl, "_blank");

        toast({
          title: "Checkout Opened",
          description:
            "Complete your purchase in the new tab. Your shares will be credited automatically.",
        });
      } else {
        toast({
          title: "Checkout Session Created",
          description: "Please complete your purchase at whop.com",
        });
      }
    } catch (error: any) {
      toast({
        title: "Checkout Failed",
        description: error.message || "Failed to create checkout session",
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="terminal-page">
        <div className="container max-w-4xl mx-auto p-4 md:p-6">
          <Card variant="terminal" className="p-8 text-center">
            <Crown className="h-16 w-16 mx-auto mb-4 text-yellow-500" />
            <CardTitle className="terminal-heading mb-4 text-lg">Unlock Premium Features</CardTitle>
            <CardDescription className="mb-6">
              Sign in to purchase Premium Shares and access exclusive features.
            </CardDescription>
            <Link href="/">
              <Button variant="terminal" data-testid="button-signin-premium">
                Sign In to Continue
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page">
      <div className="container max-w-4xl mx-auto space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="terminal-shell mb-8 p-5 text-center">
          <div className="terminal-strip mx-auto w-fit">
            <Crown className="h-3.5 w-3.5 text-yellow-400" />
            Premium Desk
          </div>
          <h1 className="terminal-heading mt-4 text-3xl" data-testid="text-premium-title">
            Premium Shares
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Purchase tradeable Premium Shares for $5 each. Redeem for 30 days of premium access or
            hold them for later use.
          </p>
        </div>

        {/* Premium Status Card */}
        <Card variant="terminal">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="terminal-heading text-sm">Your Premium Status</CardTitle>
            {premiumStatus?.isPremium && (
              <Badge
                variant="default"
                className="border-yellow-500/30 bg-yellow-500/20 font-mono text-[10px] uppercase text-yellow-200"
                data-testid="badge-premium-active"
              >
                <Crown className="h-3 w-3 mr-1" />
                Active
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="terminal-shell p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="terminal-label">Premium Shares Owned</div>
                    <Button
                      variant="terminalOutline"
                      size="sm"
                      onClick={() => syncWhopMutation.mutate()}
                      disabled={syncWhopMutation.isPending}
                      data-testid="button-sync-whop"
                      className="h-6 px-2 text-xs"
                      title="Sync purchases from Whop"
                    >
                      {syncWhopMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      <span className="ml-1">Sync</span>
                    </Button>
                  </div>
                  <div className="text-3xl font-bold" data-testid="text-premium-shares">
                    {premiumStatus?.premiumShares || 0}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Worth ${((premiumStatus?.premiumShares || 0) * PRICE_PER_SHARE).toFixed(2)}
                  </div>
                </div>

                <div className="terminal-shell p-4">
                  <div className="terminal-label mb-1">Premium Status</div>
                  {premiumStatus?.isPremium ? (
                    <>
                      <div className="text-lg font-semibold text-green-500">Active</div>
                      {premiumStatus.premiumExpiresAt && (
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Expires{" "}
                          {formatDistanceToNow(new Date(premiumStatus.premiumExpiresAt), {
                            addSuffix: true,
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-semibold text-muted-foreground">Inactive</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        Redeem a share to activate
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {(premiumStatus?.premiumShares || 0) > 0 && (
              <div className="flex justify-center">
                <Button
                  variant="terminal"
                  onClick={() => redeemMutation.mutate()}
                  disabled={redeemMutation.isPending || premiumStatus?.isPremium}
                  data-testid="button-redeem-premium"
                  className="border-yellow-500/30 bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/25"
                >
                  {redeemMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Crown className="h-4 w-4 mr-2" />
                  )}
                  Redeem 1 Share for 30 Days Premium
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchase Card */}
        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
              <ShoppingCart className="h-5 w-5" />
              Buy Premium Shares
            </CardTitle>
            <CardDescription>
              $5 per share - Tradeable on the marketplace or redeemable for premium access
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quantity selector */}
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="terminalOutline"
                size="icon"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                data-testid="button-decrease-quantity"
              >
                <Minus className="h-4 w-4" />
              </Button>

              <div className="min-w-[120px] text-center">
                <div className="terminal-value text-4xl" data-testid="text-quantity">
                  {quantity}
                </div>
                <div className="terminal-label mt-1">Shares</div>
              </div>

              <Button
                variant="terminalOutline"
                size="icon"
                onClick={() => setQuantity(quantity + 1)}
                data-testid="button-increase-quantity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Total */}
            <div className="text-center">
              <div className="terminal-value text-2xl" data-testid="text-total-price">
                ${(quantity * PRICE_PER_SHARE).toFixed(2)}
              </div>
              <div className="terminal-label mt-1">Total</div>
            </div>

            {/* Checkout button */}
            <Button
              variant="terminal"
              className="w-full"
              size="lg"
              onClick={handleCheckout}
              disabled={checkoutLoading}
              data-testid="button-checkout"
            >
              {checkoutLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4 mr-2" />
              )}
              Purchase via Whop
            </Button>

            {showCheckout && (
              <div className="terminal-empty text-center text-sm text-muted-foreground p-3">
                <p>Checkout opened in a new tab.</p>
                <p>Your shares will be credited automatically after payment.</p>
                <Button
                  variant="terminalOutline"
                  size="sm"
                  onClick={() =>
                    queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] })
                  }
                  data-testid="button-refresh-status"
                >
                  Refresh status
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Benefits */}
        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-sm">Premium Benefits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {premiumBenefits.map((benefit, index) => (
                <div key={index} className="terminal-shell flex items-start gap-3 p-3">
                  <div className="terminal-avatar border-yellow-500/20 bg-yellow-500/10 text-yellow-300">
                    <benefit.icon className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <div className="font-medium">{benefit.title}</div>
                    <div className="text-sm text-muted-foreground">{benefit.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Premium share trading removed */}

        {/* Recent Purchases */}
        {premiumStatus?.recentPurchases && premiumStatus.recentPurchases.length > 0 && (
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading text-sm">Recent Purchases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {premiumStatus.recentPurchases.map((purchase) => (
                  <div
                    key={purchase.id}
                    className="terminal-shell flex items-center justify-between p-3"
                  >
                    <div>
                      <div className="font-medium">
                        {purchase.quantity} Premium Share{purchase.quantity > 1 ? "s" : ""}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(purchase.completedAt || purchase.createdAt), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${(purchase.amountCents / 100).toFixed(2)}</div>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] uppercase text-green-500"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Completed
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Post-Purchase Modal */}
        <Dialog open={showPostPurchaseModal} onOpenChange={setShowPostPurchaseModal}>
          <DialogContent className="sm:max-w-md rounded-sm border border-border bg-card">
            <DialogHeader>
              <DialogTitle className="terminal-heading flex items-center justify-center gap-2 text-center text-base">
                <Crown className="h-6 w-6 text-yellow-500" />
                Purchase Complete!
              </DialogTitle>
              <DialogDescription className="text-center">
                You now have {purchasedQuantity} new Premium Share{purchasedQuantity > 1 ? "s" : ""}
                . What would you like to do?
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 mt-4">
              <Button
                variant="terminal"
                className="w-full border-yellow-500/30 bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/25"
                onClick={() => {
                  setShowPostPurchaseModal(false);
                  redeemMutation.mutate();
                }}
                disabled={redeemMutation.isPending || premiumStatus?.isPremium}
                data-testid="button-modal-redeem"
              >
                <Crown className="h-4 w-4 mr-2" />
                Redeem for 30 Days Premium
              </Button>
              {/* Premium share trading removed */}
              <Button
                variant="terminalOutline"
                className="w-full"
                onClick={() => setShowPostPurchaseModal(false)}
                data-testid="button-modal-hold"
              >
                <X className="h-4 w-4 mr-2" />
                Hold for Later
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
