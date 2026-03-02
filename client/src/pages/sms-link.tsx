import { useMemo } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2, MessageSquareText } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SmsLinkCompleteResponse = {
  link: {
    phoneE164: string;
    linkedAt: string;
  };
};

export default function SmsLinkPage() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token")?.trim() || "",
    [],
  );

  const completeLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sms/link/complete", {
        token,
      });
      return (await response.json()) as SmsLinkCompleteResponse;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/sms"] });
      toast({
        title: "Phone linked",
        description: `${result.link.phoneE164} is now connected to your SMS agent.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not complete SMS link",
        description: error?.message || "The link is invalid or expired.",
        variant: "destructive",
      });
    },
  });

  if (!token) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MessageSquareText className="h-5 w-5 text-primary" />
              Invalid SMS Link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This SMS link is missing its token. Request a new link from your profile or by texting
              the Sportfolio agent again.
            </p>
            <Link href="/profile">
              <Button variant="outline">Open Profile</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Link2 className="h-5 w-5 text-primary" />
              Finish Linking Your Phone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in first, then come back to this link to connect your phone number to the
              Sportfolio SMS agent.
            </p>
            <Link href="/login">
              <Button>Log In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MessageSquareText className="h-5 w-5 text-primary" />
            Link SMS Agent
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {completeLinkMutation.data?.link ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <CheckCircle2 className="h-4 w-4" />
                {completeLinkMutation.data.link.phoneE164} is now linked.
              </div>
              <p className="text-sm text-muted-foreground">
                You can text the Sportfolio agent now for setup help, account reads, and supported
                in-game actions.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/profile">
                  <Button>Open Profile</Button>
                </Link>
                <Link href="/agent">
                  <Button variant="outline">Open Agent</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Confirm this secure link to attach the current phone number to your account. This
                does not enable purchases by SMS. It only enables the Sportfolio agent channel.
              </p>
              <Button
                onClick={() => completeLinkMutation.mutate()}
                disabled={completeLinkMutation.isPending}
                data-testid="button-complete-sms-link"
              >
                {completeLinkMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Linking
                  </>
                ) : (
                  "Complete Link"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
