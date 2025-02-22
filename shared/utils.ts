export const isFn = (fn: any): boolean => typeof fn === "function";

export function getCurrentTime(): number {
  return performance.now();
}
