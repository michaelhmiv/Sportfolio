import { Link } from "wouter";
import { AlertTriangle, ExternalLink, Mail, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SUPPORT_EMAIL = "sportfolioholdings@gmail.com";
const MAILTO_HREF =
  "mailto:sportfolioholdings@gmail.com?subject=Sportfolio%20Account%20Deletion%20Request";

const deletionSteps = [
  "Send your request from the email address tied to your Sportfolio account, or include your Sportfolio username in the message.",
  "Use the subject line 'Sportfolio Account Deletion Request' so the request can be routed quickly.",
  "If you have a linked SMS number or a Premium entitlement, mention that in the email so we can verify and close those services at the same time.",
];

const deletedData = [
  "Sportfolio account profile and sign-in access",
  "Linked SMS settings and phone-link configuration",
  "Saved app preferences and scouting configuration tied to the account",
  "In-app agent chat history and related user conversation threads",
];

const retainedData = [
  "Trade, portfolio, and reward ledger records that may be needed for fraud prevention, security review, dispute handling, or legal compliance",
  "Operational logs and backup data retained for a limited period while the deletion request is processed",
];

export default function AccountDeletion() {
  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Account Controls</div>
          <h1
            className="terminal-heading mt-4 text-3xl md:text-4xl"
            data-testid="heading-account-deletion"
          >
            Delete Your Sportfolio Account
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            This page explains how to request account deletion for Sportfolio and what happens to
            your data after the request is submitted.
          </p>
        </div>

        <div className="space-y-6">
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Trash2 className="h-5 w-5 text-primary" />
                Request Deletion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                To request deletion of your Sportfolio account and associated data, email{" "}
                <a className="text-primary underline underline-offset-4" href={MAILTO_HREF}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
              <ul className="space-y-2">
                {deletionSteps.map((step) => (
                  <li key={step} className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                    {step}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="terminal"
                  className="gap-2"
                  onClick={() => window.open(MAILTO_HREF, "_self")}
                  data-testid="button-request-account-deletion"
                >
                  <Mail className="h-4 w-4" />
                  Email Deletion Request
                </Button>
                <Button asChild variant="terminalOutline" className="gap-2">
                  <Link href="/contact">
                    <ExternalLink className="h-4 w-4" />
                    Contact Page
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <ShieldCheck className="h-5 w-5 text-primary" />
                What We Delete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                After we verify and process your request, we will remove the following account data
                from active Sportfolio systems:
              </p>
              <ul className="space-y-2">
                {deletedData.map((item) => (
                  <li key={item} className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Data We May Retain Temporarily
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Some records may be retained for up to 90 days after your request is processed, or
                longer where required by law or legitimate security obligations.
              </p>
              <ul className="space-y-2">
                {retainedData.map((item) => (
                  <li key={item} className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                If a longer retention period applies to your request, we will explain that in the
                response to your deletion email.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="terminal-subtle mt-8">Last updated: March 29, 2026</p>
      </div>
    </div>
  );
}
