import { Mail, MessageCircle } from "lucide-react";
import { SiDiscord } from "react-icons/si";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const supportTopics = [
  "Account issues and technical support",
  "Trading questions and platform features",
  "Boost, scout, and leaderboard clarifications",
  "Feature requests and feedback",
  "Bug reports and platform improvements",
];

export default function Contact() {
  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-3xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Support Desk</div>
          <h1 className="terminal-heading mt-4 text-3xl md:text-4xl" data-testid="heading-contact">
            Contact Us
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Get in touch with the Sportfolio team.
          </p>
        </div>

        <div className="space-y-6">
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <SiDiscord className="h-5 w-5 text-primary" />
                Discord Community
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                The fastest way to get support, ask questions, or connect with other Sportfolio
                users is through the Discord community. The team and experienced community members
                are active there daily.
              </p>
              <Button
                variant="terminal"
                onClick={() => window.open("https://discord.gg/sportfolio", "_blank")}
                className="gap-2"
                data-testid="button-join-discord"
              >
                <SiDiscord className="h-4 w-4" />
                Join Discord Server
              </Button>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <MessageCircle className="h-5 w-5 text-primary" />
                Support Topics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">The team and community can help with:</p>
              <ul className="space-y-2">
                {supportTopics.map((topic) => (
                  <li
                    key={topic}
                    className="terminal-shell px-3 py-2 text-sm text-muted-foreground"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Mail className="h-5 w-5 text-primary" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                <span className="terminal-label">Primary Channel</span>
                <br />
                Discord Community Server
              </p>
              <p className="text-muted-foreground">
                <span className="terminal-label">Email Inquiries</span>
                <br />
                For business partnerships, press inquiries, or formal communication, start in the
                Discord server and the team will direct you to the correct channel.
              </p>
              <p className="text-muted-foreground">
                <span className="terminal-label">Service Location</span>
                <br />
                Sportfolio is a digital platform operating online. Support is handled through online
                channels only.
              </p>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading text-sm">Response Times</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                We aim to respond to inquiries within 24 to 48 hours. For urgent issues, Discord is
                the fastest route for direct support from the team and community.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
