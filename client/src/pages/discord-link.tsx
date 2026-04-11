import { useMemo } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DiscordLinkStateResponse = {
  valid: boolean;
  message?: string;
  discordUserId?: string;
  discordUsername?: string | null;
  discordGlobalName?: string | null;
  guildId?: string | null;
  expiresAt?: string;
};

type DiscordLinkCompleteResponse = {
  link: {
    userId: string;
    discordUserId: string;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    linkedAt: string;
  };
};

function normalizeRedirectPath(input: string): string {
  if (!input.startsWith("/") || input.startsWith("//")) {
    return "/";
  }

  return input;
}

export default function DiscordLinkPage() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const state = useMemo(
    () => new URLSearchParams(window.location.search).get("state")?.trim() || "",
    [],
  );

  const redirectPath = useMemo(
    () => normalizeRedirectPath(`/discord/link?state=${encodeURIComponent(state)}`),
    [state],
  );
  const loginHref = useMemo(
    () => `/login?redirect=${encodeURIComponent(redirectPath)}`,
    [redirectPath],
  );

  const stateQuery = useQuery({
    queryKey: ["/api/discord/link/state", state],
    enabled: Boolean(state),
    queryFn: async () => {
      const response = await fetch(`/api/discord/link/state?state=${encodeURIComponent(state)}`, {
        credentials: "include",
      });
      return (await response.json()) as DiscordLinkStateResponse;
    },
    retry: false,
  });

  const completeLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/discord/link/complete", { state });
      return (await response.json()) as DiscordLinkCompleteResponse;
    },
    onSuccess: (payload) => {
      const username =
        payload.link.discordGlobalName ||
        payload.link.discordUsername ||
        payload.link.discordUserId;
      toast({
        title: "Discord linked",
        description: `${username} is now linked to your Sportfolio account.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not link Discord account",
        description: error?.message || "The link has expired or is invalid.",
        variant: "destructive",
      });
    },
  });

  if (!state) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Link2 className="h-5 w-5 text-primary" />
              Invalid Discord Link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This Discord link is missing its secure state token. Run `/link` in Discord to request
              a new one.
            </p>
            <Link href="/news">
              <Button variant="outline">Open Sportfolio</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stateQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Checking Link Token
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!stateQuery.data?.valid) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Link2 className="h-5 w-5 text-primary" />
              Link Expired
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {stateQuery.data?.message ||
                "This Discord link is invalid or expired. Run `/link` in Discord again."}
            </p>
            <Link href="/news">
              <Button variant="outline">Back to Sportfolio</Button>
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
              Finish Discord Linking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in to your Sportfolio account to complete Discord linking.
            </p>
            <a href={loginHref}>
              <Button>Sign In</Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (completeLinkMutation.data?.link) {
    const username =
      completeLinkMutation.data.link.discordGlobalName ||
      completeLinkMutation.data.link.discordUsername ||
      completeLinkMutation.data.link.discordUserId;

    return (
      <div className="mx-auto flex max-w-2xl justify-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Discord Linked
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {username} is now linked to your Sportfolio account. Return to Discord and run
              `/portfolio`, `/buy`, `/sell`, or `/market`.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/portfolio">
                <Button>Open Portfolio</Button>
              </Link>
              <Link href="/news">
                <Button variant="outline">Open News</Button>
              </Link>
            </div>
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
            <Link2 className="h-5 w-5 text-primary" />
            Connect Discord
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Confirm linking your Discord user to this Sportfolio account. This does not create a
            second account. It connects Discord commands to your existing balance and portfolio.
          </p>
          <Button
            onClick={() => completeLinkMutation.mutate()}
            disabled={completeLinkMutation.isPending}
            data-testid="button-complete-discord-link"
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
        </CardContent>
      </Card>
    </div>
  );
}
