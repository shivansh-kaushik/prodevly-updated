/**
 * What the page tells the 3D stage about its content, and what the DOM tells it
 * while the visitor interacts. Both are plain data in a module with NO three
 * import, so the initial route chunk can write them.
 *
 * - `StageData` is read once when a direction is built: how many pieces each
 *   data-driven station needs (one per project, per plan, per person). The page
 *   computes it from the records it rendered, so the 3D and the DOM always agree.
 * - `stageInput` is mutable state the DOM writes on rare events (a card
 *   scrolled into focus, a row hovered, the form sent). The frame loop reads it.
 */
export const MAX_PROJECTS = 6;
export const MAX_PLANS = 4;
export const MAX_PEOPLE = 8;

export interface StageData {
  /** Showcase projects rendered, 0..6. */
  projects: number;
  /** Pricing plans rendered, 0..4. */
  plans: number;
  /** One initial per developer rendered, 0..8 entries (the maker's mark on a piece). */
  people: readonly string[];
}

export const EMPTY_STAGE_DATA: StageData = { projects: 0, plans: 0, people: [] };

/** Pieces are drawn for at most this many records; the DOM list shows all of them. */
export function clampStageData(data: StageData): StageData {
  return {
    projects: Math.max(0, Math.min(MAX_PROJECTS, Math.floor(data.projects))),
    plans: Math.max(0, Math.min(MAX_PLANS, Math.floor(data.plans))),
    people: data.people.slice(0, MAX_PEOPLE).map(initialOf),
  };
}

/** First letter of a name, upper-cased; a record with no usable name gets a dot. */
export function initialOf(name: string): string {
  const letter = Array.from(name.trim())[0];
  return letter ? letter.toLocaleUpperCase('en') : '.';
}

export interface StageInput {
  /** Service row hovered, focused or nearest the viewport centre on touch. -1 for none. */
  service: number;
  /** Project card in focus (the featured sleeve). */
  project: number;
  /** Plan card hovered or focused. -1 for none. */
  plan: number;
  /** Developer card hovered or focused. -1 for none. */
  person: number;
  /** Counts successful contact submissions; the direction plays its send gesture once per change. */
  sent: number;
}

export const stageInput: StageInput = { service: -1, project: 0, plan: -1, person: -1, sent: 0 };

/** The only way the DOM writes `stageInput` (an event handler, never a render). */
export function setInput<K extends keyof StageInput>(field: K, value: StageInput[K]) {
  stageInput[field] = value;
}

/** The contact form was sent: the direction plays its send gesture once. */
export function signalSent() {
  stageInput.sent += 1;
}

/** Test helper. */
export function resetStageInput() {
  stageInput.service = -1;
  stageInput.project = 0;
  stageInput.plan = -1;
  stageInput.person = -1;
  stageInput.sent = 0;
}
