import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AndroidPlayProduct, AndroidPlayPurchase } from "@/lib/android-play-billing";
import {
  getAndroidPlayPurchases,
  isAndroidPlayBillingAvailable,
  purchaseAndroidPlayProduct,
  queryAndroidPlayProducts,
} from "@/lib/android-play-billing";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  getRewardedScoutBoostUnavailableMessage,
  useRewardedScoutBoost,
} from "@/hooks/use-rewarded-scout-boost";
import { isNativeAndroid } from "@/lib/native-platform";
import { Check, Crown, Loader2, Minus, Plus, RefreshCw, ShoppingCart, Zap } from "lucide-react";

interface PremiumStatus {
  isPremium: boolean;
  premiumActive: boolean;
  premiumExpiresAt: string | null;
  premiumShares: number | string;
  rewardedScoutBoostActive: boolean;
  rewardedScoutBoostExpiresAt: string | null;
  maxScouts: number;
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
  purchaseUrl?: string;
}

interface GooglePlayVerifyResponse {
  success: boolean;
  state: string;
  credited: boolean;
  alreadyCredited: boolean;
  premiumShares: number;
  quantity: number;
  consumed?: boolean;
  consumePending?: boolean;
}

const PRICE_PER_SHARE = 5;
const ANDROID_PREMIUM_PRODUCT_ID = (
  import.meta.env.VITE_ANDROID_PREMIUM_PRODUCT_ID || "premium_share_1"
).trim();

const webPremiumBenefits = [
  {
    icon: Zap,
    title: "Double Scout Capacity",
    description: "Assign up to 10 scouts instead of 5 for faster share earnings.",
  },
  {
    icon: Crown,
    title: "Ad-Free Experience",
    description: "Browse and trade without any advertisements.",
  },
];

const androidPremiumBenefits = [
  {
    icon: Zap,
    title: "12-Hour Scout Boost",
    description: "Watch a rewarded ad to move from 5 scouts to 10 scouts for 12 hours.",
  },
  {
    icon: Crown,
    title: "Premium Share Redemption",
    description: "Redeem Premium Shares you already own for 30 days of full premium access.",
  },
];

export default function Premium() {
  const { toast } = useToast();
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const androidBuild = isNativeAndroid();

  const [quantity, setQuantity] = useState(1);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const {
    rewardedAdAvailable,
    rewardedAdLoading,
    rewardedVerificationPending,
    startRewardedScoutBoost,
  } = useRewardedScoutBoost({ userId: user?.id });
  const [playBillingAvailable, setPlayBillingAvailable] = useState(!androidBuild);
  const [playProduct, setPlayProduct] = useState<AndroidPlayProduct | null>(null);
  const [playProductLoading, setPlayProductLoading] = useState(false);
  const [playPurchaseLoading, setPlayPurchaseLoading] = useState(false);
  const [playRestoreLoading, setPlayRestoreLoading] = useState(false);
  const [, setClockTick] = useState(0);

  const { data: premiumStatus, isLoading } = useQuery<PremiumStatus>({
    queryKey: ["/api/premium/status"],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!androidBuild) {
      return;
    }

    let cancelled = false;
    setPlayProductLoading(true);

    void (async () => {
      try {
        const available = await isAndroidPlayBillingAvailable();
        if (cancelled) {
          return;
        }

        setPlayBillingAvailable(available);
        if (!available) {
          setPlayProduct(null);
          return;
        }

        const products = await queryAndroidPlayProducts([ANDROID_PREMIUM_PRODUCT_ID]);
        if (cancelled) {
          return;
        }

        const matched =
          products.find((product) => product.productId === ANDROID_PREMIUM_PRODUCT_ID) ||
          products[0] ||
          null;
        setPlayProduct(matched);
      } catch {
        if (!cancelled) {
          setPlayProduct(null);
          setPlayBillingAvailable(false);
        }
      } finally {
        if (!cancelled) {
          setPlayProductLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [androidBuild]);

  useEffect(() => {
    if (!premiumStatus?.rewardedScoutBoostExpiresAt) {
      return;
    }

    const interval = window.setInterval(() => {
      setClockTick((current) => current + 1);
    }, 30000);

    return () => window.clearInterval(interval);
  }, [premiumStatus?.rewardedScoutBoostExpiresAt]);

  const invalidateEntitlementQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
    ]);
  };

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/premium/redeem");
      return res.json();
    },
    onSuccess: async () => {
      await invalidateEntitlementQueries();
      toast({
        title: "Premium Activated",
        description: "You now have 30 days of premium access.",
      });
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
    onSuccess: async (data: { credited: number; revoked: number; synced: number }) => {
      if (data.credited > 0) {
        toast({
          title: "Premium Shares Credited",
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

      await invalidateEntitlementQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const verifyGooglePlayPurchase = async (purchase: AndroidPlayPurchase) => {
    const response = await apiRequest("POST", "/api/mobile/google-play/verify-purchase", {
      purchaseToken: purchase.purchaseToken,
      productId: ANDROID_PREMIUM_PRODUCT_ID,
      orderId: purchase.orderId,
    });
    return (await response.json()) as GooglePlayVerifyResponse;
  };

  const handleGooglePlayPurchase = async () => {
    if (!androidBuild) {
      return;
    }

    if (!playBillingAvailable) {
      toast({
        title: "Google Play Billing Unavailable",
        description: "Play Billing is not available on this Android build right now.",
        variant: "destructive",
      });
      return;
    }

    if (!playProduct) {
      toast({
        title: "Product Not Ready",
        description: "Premium purchase details are still syncing from Google Play.",
        variant: "destructive",
      });
      return;
    }

    setPlayPurchaseLoading(true);
    try {
      const purchase = await purchaseAndroidPlayProduct({
        productId: playProduct.productId,
        obfuscatedAccountId: user?.id || undefined,
      });

      if (purchase.purchaseState === "pending") {
        toast({
          title: "Purchase Pending",
          description:
            "Google Play marked this purchase as pending. We'll credit it once payment clears.",
        });
        return;
      }

      if (purchase.purchaseState !== "purchased") {
        toast({
          title: "Purchase Not Completed",
          description: "The purchase did not complete yet.",
          variant: "destructive",
        });
        return;
      }

      const verification = await verifyGooglePlayPurchase(purchase);
      await invalidateEntitlementQueries();

      if (verification.credited) {
        toast({
          title: "Premium Share Credited",
          description: `${verification.quantity} Premium Share${verification.quantity > 1 ? "s" : ""} added to your account.`,
        });
      } else if (verification.alreadyCredited) {
        toast({
          title: "Purchase Synced",
          description: "This Google Play purchase was already credited on your account.",
        });
      }

      if (verification.consumePending) {
        toast({
          title: "Repurchase Sync Pending",
          description:
            "Your share was credited, but Google Play consumption is still syncing in the background.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Google Play Purchase Failed",
        description: error.message || "Could not complete Google Play purchase.",
        variant: "destructive",
      });
    } finally {
      setPlayPurchaseLoading(false);
    }
  };

  const handleRestoreGooglePlayPurchases = async () => {
    if (!androidBuild) {
      return;
    }

    setPlayRestoreLoading(true);
    try {
      const purchases = await getAndroidPlayPurchases();
      const uniquePurchases = new Map<string, AndroidPlayPurchase>();

      for (const purchase of purchases) {
        const ownsProduct = purchase.products?.includes(ANDROID_PREMIUM_PRODUCT_ID);
        if (!ownsProduct || !purchase.purchaseToken) {
          continue;
        }
        uniquePurchases.set(purchase.purchaseToken, purchase);
      }

      if (uniquePurchases.size === 0) {
        toast({
          title: "No Purchases Found",
          description: "No unverified Premium Share purchases were found on this Google account.",
        });
        return;
      }

      let credited = 0;
      let alreadyCredited = 0;
      let pending = 0;
      let consumePending = 0;

      for (const purchase of uniquePurchases.values()) {
        if (purchase.purchaseState === "pending") {
          pending += 1;
          continue;
        }

        if (purchase.purchaseState !== "purchased") {
          continue;
        }

        const verification = await verifyGooglePlayPurchase(purchase);
        if (verification.credited) {
          credited += 1;
        } else if (verification.alreadyCredited) {
          alreadyCredited += 1;
        }

        if (verification.consumePending) {
          consumePending += 1;
        }
      }

      await invalidateEntitlementQueries();
      toast({
        title: "Google Play Sync Complete",
        description:
          credited > 0
            ? `Credited ${credited} purchase${credited > 1 ? "s" : ""}. ${alreadyCredited} already synced.${pending > 0 ? ` ${pending} still pending.` : ""}`
            : `${alreadyCredited} already synced.${pending > 0 ? ` ${pending} still pending.` : ""}`,
      });

      if (consumePending > 0) {
        toast({
          title: "Consumption Retry Pending",
          description:
            "Some purchases were credited but are still waiting for Play consumption retries.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Google Play Sync Failed",
        description: error.message || "Could not sync purchases from Google Play.",
        variant: "destructive",
      });
    } finally {
      setPlayRestoreLoading(false);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await apiRequest("POST", "/api/premium/checkout-session", { quantity });
      const session = (await res.json()) as CheckoutSession;
      setShowCheckout(true);

      if (session.purchaseUrl) {
        window.open(session.purchaseUrl, "_blank");
        toast({
          title: "Checkout Opened",
          description:
            "Complete your purchase in the new tab. Your shares will be credited automatically.",
        });
      } else {
        toast({
          title: "Checkout Session Created",
          description: "Please complete your purchase at whop.com.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Checkout Failed",
        description: error.message || "Failed to create checkout session.",
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleRewardedScoutBoost = async () => {
    try {
      const result = await startRewardedScoutBoost({
        previousExpiresAt: premiumStatus?.rewardedScoutBoostExpiresAt,
      });

      if (!result.session.eligible) {
        toast({
          title: "Scout Boost Unavailable",
          description: getRewardedScoutBoostUnavailableMessage(result.session.reason),
        });
        await invalidateEntitlementQueries();
        return;
      }

      if (result.outcome === "closed_early") {
        toast({
          title: "Ad Closed Early",
          description: "Finish the rewarded ad to add 12 hours of scout boost time.",
        });
        return;
      }

      toast({
        title: "Reward Received",
        description: "Verifying your scout boost with Google now.",
      });

      if (result.status?.rewardedScoutBoostActive) {
        queryClient.setQueryData<PremiumStatus>(["/api/premium/status"], (prev) =>
          prev ? { ...prev, ...result.status } : prev,
        );
        toast({
          title:
            result.status.verificationStatus === "pending_ssv"
              ? "Scout Boost Time Added"
              : "Scout Boost Verified",
          description:
            result.status.verificationStatus === "pending_ssv"
              ? "Your boost was credited now while Google server-side verification finishes."
              : "Your 10-scout boost was extended by 12 hours.",
        });
      } else {
        toast({
          title: "Unable to Verify Yet",
          description:
            "The ad completed, but no reward confirmation reached Sportfolio yet. Refresh again in a moment.",
        });
      }
      await invalidateEntitlementQueries();
    } catch (error: any) {
      toast({
        title: "Rewarded Ad Failed",
        description: error.message || "Could not start the rewarded scout boost.",
        variant: "destructive",
      });
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
              Sign in to redeem Premium Shares or manage your scout boost access.
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

  const ownedPremiumShares = Number(premiumStatus?.premiumShares || 0);
  const premiumActive = premiumStatus?.premiumActive ?? premiumStatus?.isPremium ?? false;
  const rewardedScoutBoostActive = premiumStatus?.rewardedScoutBoostActive ?? false;
  const rewardedScoutBoostExpiresAt = premiumStatus?.rewardedScoutBoostExpiresAt;
  const effectiveScoutCap = premiumStatus?.maxScouts || user?.maxScouts || 5;
  const rewardedScoutBoostCountdown = rewardedScoutBoostExpiresAt
    ? formatDistanceToNow(new Date(rewardedScoutBoostExpiresAt), {
        addSuffix: true,
      })
    : null;

  const showAndroidRewardedCta = androidBuild && !premiumActive;
  const benefits = androidBuild ? androidPremiumBenefits : webPremiumBenefits;
  const androidPurchasePrice = playProduct?.formattedPrice || `$${PRICE_PER_SHARE.toFixed(2)}`;

  return (
    <div className="terminal-page">
      <div className="container max-w-4xl mx-auto space-y-6 p-4 md:p-6">
        <div className="terminal-shell mb-8 p-5 text-center">
          <div className="terminal-strip mx-auto w-fit">
            <Crown className="h-3.5 w-3.5 text-yellow-400" />
            Premium Desk
          </div>
          <h1 className="terminal-heading mt-4 text-3xl" data-testid="text-premium-title">
            Premium Shares
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {androidBuild
              ? "Buy Premium Shares with Google Play, redeem shares for 30-day Premium access, or watch a rewarded ad for a 12-hour scout boost."
              : "Purchase tradeable Premium Shares for $5 each. Redeem for 30 days of premium access or hold them for later use."}
          </p>
        </div>

        <Card variant="terminal">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="terminal-heading text-sm">Your Premium Status</CardTitle>
            {premiumActive ? (
              <Badge
                variant="default"
                className="border-yellow-500/30 bg-yellow-500/20 font-mono text-[10px] uppercase text-yellow-200"
                data-testid="badge-premium-active"
              >
                <Crown className="h-3 w-3 mr-1" />
                Active
              </Badge>
            ) : rewardedScoutBoostActive ? (
              <Badge className="border-amber-500/30 bg-amber-500/20 font-mono text-[10px] uppercase text-amber-200">
                <Zap className="h-3 w-3 mr-1" />
                Scout Boost
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="terminal-shell p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="terminal-label">Premium Shares Owned</div>
                      {!androidBuild ? (
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
                      ) : (
                        <Button
                          variant="terminalOutline"
                          size="sm"
                          onClick={handleRestoreGooglePlayPurchases}
                          disabled={playRestoreLoading || playPurchaseLoading}
                          data-testid="button-sync-google-play"
                          className="h-6 px-2 text-xs"
                          title="Sync purchases from Google Play"
                        >
                          {playRestoreLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          <span className="ml-1">Sync</span>
                        </Button>
                      )}
                    </div>
                    <div className="text-3xl font-bold" data-testid="text-premium-shares">
                      {ownedPremiumShares}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Worth ${(ownedPremiumShares * PRICE_PER_SHARE).toFixed(2)}
                    </div>
                  </div>

                  <div className="terminal-shell p-4">
                    <div className="terminal-label mb-1">Access Status</div>
                    {premiumActive ? (
                      <>
                        <div className="text-lg font-semibold text-green-500">Premium Active</div>
                        {premiumStatus?.premiumExpiresAt ? (
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            Expires{" "}
                            {formatDistanceToNow(new Date(premiumStatus.premiumExpiresAt), {
                              addSuffix: true,
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : rewardedScoutBoostActive ? (
                      <>
                        <div className="text-lg font-semibold text-amber-500">Scout Boost Live</div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Boosted scouts stay active until {rewardedScoutBoostCountdown}.
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-semibold text-muted-foreground">Inactive</div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {androidBuild
                            ? "Buy or redeem a Premium Share, or watch a rewarded ad to boost scouts."
                            : "Redeem a share to activate premium."}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {(androidBuild || rewardedScoutBoostActive) && (
                  <div className="terminal-shell p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="terminal-label">Rewarded Scout Boost</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Current scout cap:{" "}
                          <span className="font-semibold text-foreground">{effectiveScoutCap}</span>
                        </div>
                      </div>
                      {rewardedScoutBoostActive ? (
                        <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-200">
                          10 Scouts
                        </Badge>
                      ) : null}
                    </div>

                    {rewardedScoutBoostActive ? (
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          Your Android-earned scout boost is active until{" "}
                          <span className="font-medium text-foreground">
                            {rewardedScoutBoostCountdown}
                          </span>
                          .{" "}
                          {premiumActive
                            ? "Premium already caps scouts at 10, so rewarded ads stay hidden while premium is active."
                            : "You can watch another rewarded ad to add 12 more hours."}
                        </div>
                        {!premiumActive && androidBuild && (
                          <Button
                            variant="terminal"
                            onClick={handleRewardedScoutBoost}
                            disabled={
                              rewardedAdLoading ||
                              rewardedVerificationPending ||
                              !rewardedAdAvailable
                            }
                            className="border-amber-500/40 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 disabled:text-amber-900/60 dark:text-amber-100 dark:disabled:text-amber-100/60"
                            data-testid="button-watch-rewarded-scout-boost"
                          >
                            {rewardedAdLoading || rewardedVerificationPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Zap className="h-4 w-4 mr-2" />
                            )}
                            {rewardedVerificationPending
                              ? "Verifying Scout Boost"
                              : "Watch Ad for +12h Scout Boost"}
                          </Button>
                        )}
                      </div>
                    ) : premiumActive ? (
                      <div className="text-sm text-muted-foreground">
                        Premium already gives you the full 10-scout cap, so the rewarded scout ad
                        stays hidden on Android while premium is active.
                      </div>
                    ) : showAndroidRewardedCta ? (
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          Watch one rewarded ad to add 12 hours of 10-scout capacity on this
                          account. Boost time stacks when you watch more.
                        </div>
                        <Button
                          variant="terminal"
                          onClick={handleRewardedScoutBoost}
                          disabled={
                            rewardedAdLoading || rewardedVerificationPending || !rewardedAdAvailable
                          }
                          className="border-amber-500/40 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 disabled:text-amber-900/60 dark:text-amber-100 dark:disabled:text-amber-100/60"
                          data-testid="button-watch-rewarded-scout-boost"
                        >
                          {rewardedAdLoading || rewardedVerificationPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4 mr-2" />
                          )}
                          {rewardedVerificationPending
                            ? "Verifying Scout Boost"
                            : "Watch Ad for +12h Scout Boost"}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Rewarded ads are not available in this Android build yet.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {ownedPremiumShares > 0 && (
              <div className="flex justify-center">
                <Button
                  variant="terminal"
                  onClick={() => redeemMutation.mutate()}
                  disabled={redeemMutation.isPending || premiumActive}
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

        {androidBuild && (
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <ShoppingCart className="h-5 w-5" />
                Buy Premium Share (Google Play)
              </CardTitle>
              <CardDescription>
                One-time Google Play purchase. Each completed purchase credits 1 Premium Share.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {playProductLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="terminal-shell p-4">
                    <div className="terminal-label mb-1">Google Play Product</div>
                    <div className="text-base font-semibold">
                      {playProduct?.title || "Premium Share"}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Product ID: {ANDROID_PREMIUM_PRODUCT_ID}
                    </div>
                    <div className="mt-2 text-2xl font-bold">{androidPurchasePrice}</div>
                  </div>

                  <Button
                    variant="terminal"
                    className="w-full"
                    size="lg"
                    onClick={handleGooglePlayPurchase}
                    disabled={
                      playPurchaseLoading ||
                      playRestoreLoading ||
                      !playBillingAvailable ||
                      !playProduct
                    }
                    data-testid="button-google-play-purchase"
                  >
                    {playPurchaseLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ShoppingCart className="h-4 w-4 mr-2" />
                    )}
                    {playPurchaseLoading ? "Processing Purchase" : "Buy with Google Play"}
                  </Button>

                  <Button
                    variant="terminalOutline"
                    className="w-full"
                    onClick={handleRestoreGooglePlayPurchases}
                    disabled={playRestoreLoading || playPurchaseLoading}
                    data-testid="button-google-play-restore"
                  >
                    {playRestoreLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Restore Existing Purchases
                  </Button>

                  {!playBillingAvailable && (
                    <div className="terminal-empty text-center text-sm text-muted-foreground p-3">
                      Google Play Billing is currently unavailable on this build.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!androidBuild && (
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <ShoppingCart className="h-5 w-5" />
                Buy Premium Shares
              </CardTitle>
              <CardDescription>
                $5 per share, tradeable on the marketplace or redeemable for premium access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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

              <div className="text-center">
                <div className="terminal-value text-2xl" data-testid="text-total-price">
                  ${(quantity * PRICE_PER_SHARE).toFixed(2)}
                </div>
                <div className="terminal-label mt-1">Total</div>
              </div>

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
                    onClick={() => void invalidateEntitlementQueries()}
                    data-testid="button-refresh-status"
                  >
                    Refresh status
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-sm">
              {androidBuild ? "Android Benefits" : "Premium Benefits"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {benefits.map((benefit) => (
                <div key={benefit.title} className="terminal-shell flex items-start gap-3 p-3">
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

        {androidBuild && (
          <div className="flex justify-center">
            <Button variant="terminalOutline" onClick={() => setLocation("/portfolio")}>
              Back to Portfolio
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
