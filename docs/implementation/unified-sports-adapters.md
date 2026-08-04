# Unified Sports Adapters

Sportfolio now has internal adapters for MLB, NHL, and NASCAR that normalize existing provider clients into the neutral sports contracts. The adapters are dependency-injected for deterministic testing and register through one fail-closed default registry.

MLB wraps the existing official StatsAPI client. NHL wraps the existing credential-free NHL web API client. NASCAR wraps the existing schedule and live-feed client and uses canonical series identifiers. No new provider, database, public tool, scheduler, or market behavior is introduced by this release.

Concrete consumer migration and compact public sports tools remain separate releases so rollback can occur per surface.
