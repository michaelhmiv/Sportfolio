import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Trophy, Clock, BarChart3, Users, CheckCircle2 } from "lucide-react";
import { SchemaOrg, schemas } from "@/components/schema-org";

const faqs = [
  {
    question: "How does trading player shares work on Sportfolio?",
    answer:
      "NBA players on Sportfolio are represented as tradable shares, similar to stocks. Each player has an AMM (Automated Market Maker) pool with transparent pricing. You can buy or sell instantly against the pool with real-time quote previews. Prices adjust based on buying and selling activity.",
  },
  {
    question: "What is the Scout System and how do I earn free shares?",
    answer:
      "Scouts are your agents who earn you free shares every hour. Click the scout widget in the header to assign up to 5 scouts (10 for premium users) to your favorite players. Scouts earn shares based on the Scout-Minute formula. You must log in at least every 24 hours to keep scouts active.",
  },
  {
    question: "How do fantasy contests work?",
    answer:
      "Compete in daily 50/50 contests by creating lineups of NBA players. Your lineup earns fantasy points based on real player performance. The top half of contestants win prizes, doubling their entry fee. Prizes are automatically distributed when games complete.",
  },
  {
    question: "How are fantasy points calculated in contests?",
    answer:
      "Fantasy points are based on real NBA player statistics including points scored, rebounds, assists, steals, blocks, and other performance metrics from actual NBA games.",
  },
  {
    question: "What happens to my shares when I enter a contest?",
    answer:
      "When you enter a contest, you draft players from a specific game date and pay an entry fee from your cash balance. Your existing portfolio shares are separate from contest lineups - entering contests doesn't consume your portfolio shares. Contest prizes create new money in the economy, balanced by the share flow from scouting.",
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-background">
      <SchemaOrg schema={schemas.faqPage(faqs)} />
      <div className="max-w-4xl mx-auto p-6 md:p-12">
        <h1 className="text-4xl font-bold mb-4" data-testid="heading-how-it-works">
          How Sportfolio Works
        </h1>
        <p className="text-lg text-muted-foreground mb-12">
          Learn how to trade NBA player shares and compete in fantasy contests
        </p>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                1. Trading Player Shares
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                NBA players on Sportfolio are represented as tradable shares, similar to stocks.
                Each player has a market price that changes based on trading activity - when more
                users want to buy a player, the price goes up; when more want to sell, it goes down.
              </p>
              <p className="text-muted-foreground">
                Browse player pools to find players to trade. Execute instant buys and sells
                directly against each player’s AMM pool with quote previews and slippage protection.
                Your portfolio value changes as player prices fluctuate.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                2. Scouting Free Shares
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Sportfolio features a Scout System that rewards active users with free player
                shares. Assign up to 5 scouts (10 for premium users) to players you believe in. Each
                hour, shares are distributed to scouts based on the Scout-Minute formula.
              </p>
              <p className="text-muted-foreground">
                Click the scout widget in the navbar to see your assigned scouts and estimated
                hourly earnings. The more scouts you assign to a player, the larger your portion of
                that player's hourly share pool. Scouting is a great way to build your portfolio
                passively!
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                3. Fantasy Contests
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Compete in daily 50/50 contests by creating lineups of NBA players. Contests are
                tied to specific game dates - you draft players from that day's NBA games. Your
                lineup earns fantasy points based on real player performance (points, rebounds,
                assists, etc.).
              </p>
              <p className="text-muted-foreground">
                The top half of contestants win prizes, doubling their entry fee. Browse available
                contests, pay the entry fee from your balance, draft your optimal lineup, and watch
                your players perform. Prizes are automatically distributed when games complete and
                contests settle.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                4. Building Your Strategy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Success on Sportfolio combines market knowledge with basketball expertise. Track
                player performance stats, monitor market trends, and diversify your portfolio across
                different teams and positions. Use player stats and recent game logs to make
                informed trading decisions.
              </p>
              <p className="text-muted-foreground">
                For contests, research player matchups, consider game pace and playing time, and
                balance star players with value picks. The platform provides all the data you need
                including season averages, recent games, and real-time market information.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                5. Compete on Leaderboards
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Track your performance against other Sportfolio users on global leaderboards.
                Rankings are available for portfolio net worth, total shares earned via scouting,
                and trading activity. See where you stand and compete for bragging rights in the
                community.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Getting Started
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Ready to start trading and competing? Here's your quick start guide:
              </p>
              <ol className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  <span>
                    Create an account - you'll start with virtual currency to begin trading
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground">2.</span>
                  <span>Browse player pools and buy shares of your favorite NBA players</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground">3.</span>
                  <span>Enter a contest to test your fantasy basketball skills</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground">4.</span>
                  <span>Watch your portfolio grow and climb the leaderboards</span>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
