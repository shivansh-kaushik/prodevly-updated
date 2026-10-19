/**
 * A pricing card's button names the plan the visitor chose; the contact form
 * reads it when it renders. A tiny external store (no context needed across the
 * page's islands), subscribed with useSyncExternalStore.
 */
let plan = '';
const listeners = new Set<() => void>();

export const getPrefillPlan = () => plan;
export const getServerPrefillPlan = () => '';

export function setPrefillPlan(key: string) {
  plan = key;
  listeners.forEach((fn) => fn());
}

export function subscribePrefill(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
