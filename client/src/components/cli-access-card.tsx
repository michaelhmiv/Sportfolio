import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Terminal, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type TokenView = {
  id: string;
  label: string;
  preview: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type TokensResponse = {
  tokens: TokenView[];
  maxActiveTokens: number;
};

type CreatedTokenResponse = {
  token: TokenView & {
    plaintextToken: string;
  };
};

export function CliAccessCard() {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const { data, isLoading } = useQuery<TokensResponse>({
    queryKey: ["/api/account/tokens"],
  });

  const activeTokenCount = useMemo(
    () => (data?.tokens || []).filter((token) => !token.revokedAt).length,
    [data?.tokens],
  );

  const createTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/account/tokens", { label });
      return (await response.json()) as CreatedTokenResponse;
    },
    onSuccess: (result) => {
      setCreatedToken(result.token.plaintextToken);
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/account/tokens"] });
      toast({
        title: "CLI token created",
        description: "Copy the token now. It is only shown once.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not create token",
        description: error?.message || "The API token could not be created.",
        variant: "destructive",
      });
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      await apiRequest("DELETE", `/api/account/tokens/${tokenId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/tokens"] });
      toast({
        title: "Token revoked",
        description: "The selected CLI token is no longer valid.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not revoke token",
        description: error?.message || "The API token could not be revoked.",
        variant: "destructive",
      });
    },
  });

  const handleCopyToken = async () => {
    if (!createdToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdToken);
      toast({
        title: "Token copied",
        description: "The CLI token is now in your clipboard.",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard access is unavailable in this browser.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card variant="terminal" data-testid="card-cli-access">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="terminal-kicker">Developer Access</p>
              <CardTitle className="terminal-heading mt-2 flex items-center gap-2 text-base">
                <Terminal className="h-5 w-5 text-primary" />
                CLI Access
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage API tokens for the Sportfolio CLI. Tokens are scoped to your account and
                should be treated like passwords.
              </p>
            </div>
            <Button
              variant="terminal"
              onClick={() => {
                setCreatedToken(null);
                setCreateDialogOpen(true);
              }}
              data-testid="button-open-create-cli-token"
            >
              Create Token
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              {activeTokenCount}/{data?.maxActiveTokens || 0} active
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              Prefer one token per device or automation workflow so you can revoke cleanly.
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-sm border border-border bg-[hsl(var(--sidebar)/0.25)] p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Login command
            </p>
            <p className="mt-2 text-xs text-foreground">
              <code className="font-mono">sportfolio auth login --token &lt;your-token&gt;</code>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Working directly in this repo? Use{" "}
              <span className="font-mono">
                node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token
                &lt;your-token&gt;
              </span>
              .
            </p>
          </div>
          {isLoading ? (
            <div className="terminal-empty px-4 py-4 text-sm text-muted-foreground">
              Loading CLI tokens...
            </div>
          ) : data?.tokens?.length ? (
            <div className="space-y-3">
              {data.tokens.map((token) => (
                <div
                  key={token.id}
                  className="terminal-shell p-4"
                  data-testid={`cli-token-${token.id}`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{token.label}</span>
                        {token.revokedAt ? (
                          <Badge variant="outline" className="font-mono text-[10px] uppercase">
                            Revoked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="font-mono text-[10px] uppercase">
                            Active
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-sm text-muted-foreground">
                        {token.preview}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Created {new Date(token.createdAt).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last used{" "}
                        {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "never"}
                      </div>
                    </div>
                    {!token.revokedAt && (
                      <Button
                        variant="terminalOutline"
                        size="sm"
                        className="gap-2"
                        onClick={() => revokeTokenMutation.mutate(token.id)}
                        disabled={revokeTokenMutation.isPending}
                        data-testid={`button-revoke-token-${token.id}`}
                      >
                        {revokeTokenMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="terminal-empty border border-dashed border-border p-6 text-sm text-muted-foreground">
              No CLI tokens yet. Create one when you are ready to use the Sportfolio CLI.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="rounded-sm border border-border bg-card">
          <DialogHeader>
            <DialogTitle className="terminal-heading flex items-center gap-2 text-base">
              <KeyRound className="h-5 w-5" />
              Create CLI Token
            </DialogTitle>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This token is shown once. Store it in a password manager or paste it into
                `sportfolio auth login --token ...`.
              </p>
              <Input
                variant="terminal"
                value={createdToken}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="terminalOutline" className="w-full gap-2" onClick={handleCopyToken}>
                <Copy className="h-4 w-4" />
                Copy Token
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use a specific label like `laptop`, `ci-bot`, or `home-server`.
              </p>
              <Input
                variant="terminal"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Token label"
                maxLength={80}
                data-testid="input-cli-token-label"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="terminalOutline" onClick={() => setCreateDialogOpen(false)}>
              Close
            </Button>
            {!createdToken && (
              <Button
                variant="terminal"
                onClick={() => createTokenMutation.mutate()}
                disabled={createTokenMutation.isPending || label.trim().length === 0}
                data-testid="button-create-cli-token"
              >
                {createTokenMutation.isPending ? "Creating..." : "Create Token"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
