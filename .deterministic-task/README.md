# Persistent player lifecycle task

Implement the approved platform invariant: only currently active/rostered eligible athletes are newly admitted, but once admitted the Sportfolio asset is permanent. `isActive` is reversible sporting/scouting status only. Inactive assets remain searchable by explicit search/direct lookup, visible in holdings/watchlists, and tradeable. Scouting must be blocked and existing scout assignments released when a player becomes inactive. Reactivation must reuse the same player identity. Apply consistently to MLB, NHL, NFL and NASCAR, with regression tests.
