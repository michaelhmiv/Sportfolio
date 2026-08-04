import { SportsAdapterRegistry } from "./adapter-registry";
import { createMlbAdapter } from "./mlb-adapter";
import { createNascarAdapter } from "./nascar-adapter";
import { createNhlAdapter } from "./nhl-adapter";

export function createDefaultSportsAdapterRegistry(): SportsAdapterRegistry {
  const registry = new SportsAdapterRegistry();
  registry.register(createMlbAdapter());
  registry.register(createNhlAdapter());
  registry.register(createNascarAdapter());
  return registry;
}
