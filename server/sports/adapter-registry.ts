import type { Athlete, Game, LiveState, Sport, StatLine, Team } from "./contracts";

export interface SportsAdapter {
  readonly sport: Sport;
  searchAthletes?(query: string): Promise<Athlete[]>;
  getAthlete?(id: string): Promise<Athlete | null>;
  getTeams?(): Promise<Team[]>;
  getSchedule?(from: Date, to: Date): Promise<Game[]>;
  getStats?(athleteIds: string[], from?: Date, to?: Date): Promise<StatLine[]>;
  getLiveState?(gameId: string): Promise<LiveState | null>;
}

export class SportsAdapterRegistry {
  private readonly adapters = new Map<Sport, SportsAdapter>();

  register(adapter: SportsAdapter): void {
    if (this.adapters.has(adapter.sport)) {
      throw new Error(`Sports adapter already registered for ${adapter.sport}`);
    }
    this.adapters.set(adapter.sport, adapter);
  }

  get(sport: Sport): SportsAdapter {
    const adapter = this.adapters.get(sport);
    if (!adapter) throw new Error(`No sports adapter registered for ${sport}`);
    return adapter;
  }

  supports(sport: Sport, capability: keyof SportsAdapter): boolean {
    const adapter = this.adapters.get(sport);
    return Boolean(adapter && typeof adapter[capability] === "function");
  }

  list(): Sport[] {
    return [...this.adapters.keys()].sort();
  }
}
