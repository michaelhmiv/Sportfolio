export const NASCAR_SERIES = {
  cup: { id: "1", code: "NCS", name: "Cup Series" },
  xfinity: { id: "2", code: "NXS", name: "Xfinity Series" },
  trucks: { id: "3", code: "NCTS", name: "Craftsman Truck Series" },
} as const;

export type NascarSeriesKey = keyof typeof NASCAR_SERIES;

const aliases = new Map<string, NascarSeriesKey>([
  ["1", "cup"],
  ["ncs", "cup"],
  ["cup", "cup"],
  ["cup series", "cup"],
  ["2", "xfinity"],
  ["nxs", "xfinity"],
  ["xfinity", "xfinity"],
  ["xfinity series", "xfinity"],
  ["3", "trucks"],
  ["ncts", "trucks"],
  ["truck", "trucks"],
  ["trucks", "trucks"],
  ["craftsman truck series", "trucks"],
]);

export function normalizeNascarSeries(
  value: string | number,
): (typeof NASCAR_SERIES)[NascarSeriesKey] {
  const normalized = String(value).trim().toLowerCase();
  const key = aliases.get(normalized);
  if (!key) throw new Error(`Unsupported NASCAR series: ${value}`);
  return NASCAR_SERIES[key];
}
