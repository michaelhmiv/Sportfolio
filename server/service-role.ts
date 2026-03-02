export function isHermesSidecarMode(): boolean {
  const normalized = (process.env.SPORTFOLIO_SERVICE_ROLE || "").trim().toLowerCase();
  return normalized === "hermes" || normalized === "hermes-sidecar";
}
