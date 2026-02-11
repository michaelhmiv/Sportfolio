import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { useState } from "react";

export function HelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        data-testid="button-help"
        className="hover-elevate active-elevate-2"
      >
        <HelpCircle className="w-5 h-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              Welcome to Sportfolio: The Persistent Fantasy Sports Market
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 text-sm">
            <p>
              Sportfolio is a fantasy sports game where your progress and investments last for a
              player's entire career, not just one season.
            </p>

            <p>
              The main goal is to create an engaging community built around a{" "}
              <strong>free market economy</strong>. Instead of developers setting player values, the
              market does. Your sports knowledge and ability to predict player performance are
              rewarded in a system where you—and all other users—determine the true value of every
              athlete.
            </p>

            <hr className="border-border" />

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Understanding the Core Loop: What You Do
              </h3>
              <p className="mb-4">
                The entire game revolves around "Player Shares," the core asset representing
                ownership of a specific player. Here is the basic lifecycle of the game:
              </p>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">1. Scout Players (Earn Free Shares)</h4>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>
                      <strong>What it is:</strong> Scouting is the <em>primary</em> way to earn free
                      player shares without spending cash.
                    </li>
                    <li>
                      <strong>How it works:</strong> You have a limited number of "Scouts" (5 for
                      free users, 10 for premium). Click the scout widget in the header to assign
                      scouts to real-life players you believe in.
                    </li>
                    <li>
                      <strong>The Reward:</strong> Every hour, your scouts earn shares for you based
                      on the "Scout-Minute" formula. The more scouts assigned to a player, the more
                      shares you earn. Scouts must be active (log in every 24 hours) to keep
                      earning.
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">2. Manage Your Scouts</h4>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>
                      <strong>Flexibility:</strong> You can reassign scouts at any time. If a player
                      gets injured or you lose faith in them, move your scout to someone else
                      through the Scout Dashboard.
                    </li>
                    <li>
                      <strong>Strategy:</strong> Do you stack all scouts on one superstar to
                      maximize earnings, or spread them out to diversify?
                    </li>
                    <li>
                      <strong>Activity Required:</strong> To keep earning, you must log in at least
                      once every 24 hours. Inactive scouts stop producing shares.
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">3. Trade Shares (AMM Pool)</h4>
                  <p className="mb-2">
                    Once you've earned shares through scouting, you can trade them instantly:
                  </p>

                  <div className="pl-4 space-y-3">
                    <div>
                      <p className="font-medium mb-1">Option A: Trade in the AMM Pool</p>
                      <p className="text-muted-foreground">
                        Trade instantly against the AMM (Automated Market Maker) pool with
                        transparent pricing. Buy or sell shares at the current market price with
                        real-time quote previews. The price changes based on pool activity - buy
                        pressure increases price, sell pressure decreases it.
                      </p>
                    </div>

                    <div>
                      <p className="font-medium mb-1">Option B: Enter Contests</p>
                      <p className="text-muted-foreground">
                        Use your shares to enter daily 50/50 contests. Draft players from that day's
                        games and earn fantasy points based on real NBA performance. Top half of
                        contestants win prizes.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">4. The "Burn" Mechanic</h4>
                  <p className="mb-2">This keeps the economy balanced:</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>
                      When you enter a contest, your entry fee is used to create new "money" in the
                      game (prizes for winners).
                    </li>
                    <li>
                      This creation is balanced by the continuous flow of shares through scouting,
                      keeping the economy stable and shares valuable.
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <hr className="border-border" />

            <div>
              <h3 className="text-lg font-semibold mb-3">Key Things to Know as a New User</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong>It's a Virtual Economy:</strong> Sportfolio is a game based on virtual
                  currency. There are <strong>no cash-out options</strong>.
                </li>
                <li>
                  <strong>Persistence is Key:</strong> Unlike seasonal fantasy, you don't have to
                  redraft your players every year. If you scout a player early and they become a
                  star, you can benefit from that investment for their <em>entire career</em>.
                </li>
                <li>
                  <strong>You Control the Market:</strong> A player's share supply is determined by
                  how many users scout them. The more popular a player is, the more shares enter the
                  economy. Their value is determined by the AMM pool and trading activity.
                </li>
              </ul>
            </div>

            <p className="text-center font-medium pt-4">
              In short, your goal is to <strong>Accumulate</strong> shares through scouting,{" "}
              <strong>Trade</strong> them for profit, or <strong>Compete</strong> with them in
              contests to win prizes.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
