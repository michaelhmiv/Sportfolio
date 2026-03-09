export function getUserActivitySourceFetchWindow(limit: number, offset: number) {
  return Math.max(limit + offset + 24, 80);
}
