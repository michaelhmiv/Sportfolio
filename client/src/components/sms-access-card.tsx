import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MessageSquareText, Smartphone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type SmsLinkView = {
  id: string;
  phoneE164: string;
  verifiedAt: string | null;
  linkedAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  smsEnabled: boolean;
  smsOptInStatus: string;
  smsOptInSource: string | null;
};

type SmsSettingsResponse = {
  link: SmsLinkView | null;
};

type SmsLinkStartResponse = {
  phoneE164: string;
  expiresAt: string;
};

export function SmsAccessCard() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [latestLinkStart, setLatestLinkStart] = useState<SmsLinkStartResponse | null>(null);

  const { data, isLoading } = useQuery<SmsSettingsResponse>({
    queryKey: ["/api/account/sms"],
  });

  const linkStartMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sms/link/start", {
        phone,
      });
      return (await response.json()) as SmsLinkStartResponse;
    },
    onSuccess: (result) => {
      setLatestLinkStart(result);
      setPhone("");
      toast({
        title: "Verification text sent",
        description: `A link was sent to ${result.phoneE164}. Finish linking from that phone.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not start SMS linking",
        description: error?.message || "The phone number could not be linked.",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (smsEnabled: boolean) => {
      const response = await apiRequest("PUT", "/api/account/sms", {
        smsEnabled,
      });
      return (await response.json()) as SmsSettingsResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/sms"] });
      toast({
        title: "SMS settings updated",
        description: "Your SMS preference was saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update SMS settings",
        description: error?.message || "The SMS setting could not be updated.",
        variant: "destructive",
      });
    },
  });

  const link = data?.link || null;

  return (
    <Card variant="terminal" data-testid="card-sms-access">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="terminal-kicker">SMS Access</p>
            <CardTitle className="terminal-heading mt-2 flex items-center gap-2 text-base">
              <MessageSquareText className="h-5 w-5 text-primary" />
              SMS Channel
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Link one phone number so you can use the Sportfolio SMS channel. Unknown numbers can
              start a conversation, but account-specific reads and actions still require linking
              first.
            </p>
          </div>
          <Badge
            variant={link ? "secondary" : "outline"}
            className="font-mono text-[10px] uppercase"
          >
            {link ? "Linked" : "Not linked"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="terminal-empty px-4 py-4 text-sm text-muted-foreground">
            Loading SMS settings...
          </div>
        ) : link ? (
          <div className="space-y-4">
            <div className="terminal-shell p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Smartphone className="h-4 w-4 text-primary" />
                    {link.phoneE164}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Linked {new Date(link.linkedAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Opt-in status: {link.smsOptInStatus}
                  </div>
                  {link.lastInboundAt && (
                    <div className="text-xs text-muted-foreground">
                      Last inbound {new Date(link.lastInboundAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Enabled</span>
                  <Switch
                    checked={link.smsEnabled}
                    onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                    disabled={toggleMutation.isPending}
                    data-testid="switch-sms-enabled"
                  />
                </div>
              </div>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              Text normal questions, setup requests, and supported in-game commands. Premium and
              purchase flows remain web-only.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="terminal-empty border border-dashed border-border p-4 text-sm text-muted-foreground">
              Enter the phone number you want to use. We will text a secure link to that device,
              then you finish linking in the browser.
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                variant="terminal"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 555 123 4567"
                data-testid="input-sms-phone"
              />
              <Button
                variant="terminal"
                onClick={() => linkStartMutation.mutate()}
                disabled={linkStartMutation.isPending || phone.trim().length === 0}
                data-testid="button-start-sms-link"
              >
                {linkStartMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending
                  </>
                ) : (
                  "Send Link"
                )}
              </Button>
            </div>
            {latestLinkStart && (
              <p className="text-xs text-muted-foreground">
                Link sent to {latestLinkStart.phoneE164}. It expires{" "}
                {new Date(latestLinkStart.expiresAt).toLocaleString()}.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
