/**
 * The review queue's decision logic, as a pure reducer. Keeping it here — out of
 * the React component — is what lets the sprint's headline guarantee be tested
 * without a browser: that a sequence of keystrokes clears the queue, that undo
 * restores exactly what an action removed, and that bulk confirm targets the
 * selection. The component (app/review/review-queue.tsx) owns only rendering,
 * focus, and running the effects this reducer emits.
 *
 * Effects are the database writes an action implies. The reducer never performs
 * them — it stays pure — it records them on `state.effects`; the component
 * flushes them through the server actions and dispatches `flushEffects`.
 */
import type { QueueEvent } from "@/lib/events/queue";

export type QueueEffect =
  | { kind: "confirm"; eventGroupIds: string[] }
  | { kind: "ignore"; eventGroupIds: string[] }
  | { kind: "revert"; eventGroupIds: string[] }
  | { kind: "setCategory"; eventGroupId: string; categoryId: string };

export interface UndoEntry {
  kind: "confirm" | "ignore";
  events: QueueEvent[];
}

export interface QueueState {
  events: QueueEvent[];
  activeIndex: number;
  selected: string[];
  expanded: string[];
  undoStack: UndoEntry[];
  effects: QueueEffect[];
}

export type QueueAction =
  | { type: "move"; delta: number }
  | { type: "setActive"; index: number }
  | { type: "confirm" }
  | { type: "ignore" }
  | { type: "toggleSelect"; eventGroupId?: string }
  | { type: "toggleExpand"; eventGroupId?: string }
  | { type: "assignCategory"; eventGroupId: string; categoryId: string }
  | { type: "undo" }
  | { type: "flushEffects" };

export function sortEvents(events: QueueEvent[]): QueueEvent[] {
  return [...events].sort((a, b) =>
    a.bookedAt !== b.bookedAt
      ? b.bookedAt.localeCompare(a.bookedAt)
      : a.eventGroupId.localeCompare(b.eventGroupId),
  );
}

export function initQueue(events: QueueEvent[]): QueueState {
  return {
    events: sortEvents(events),
    activeIndex: 0,
    selected: [],
    expanded: [],
    undoStack: [],
    effects: [],
  };
}

function clampIndex(i: number, len: number): number {
  if (len === 0) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

/** The active event's id, or the ids of the current selection if any. */
function targets(state: QueueState): string[] {
  if (state.selected.length > 0) return state.selected;
  const active = state.events[state.activeIndex];
  return active ? [active.eventGroupId] : [];
}

function resolve(
  state: QueueState,
  kind: "confirm" | "ignore",
): QueueState {
  const ids = targets(state);
  if (ids.length === 0) return state;
  const idSet = new Set(ids);
  const removed = state.events.filter((e) => idSet.has(e.eventGroupId));
  if (removed.length === 0) return state;
  const events = state.events.filter((e) => !idSet.has(e.eventGroupId));
  return {
    ...state,
    events,
    activeIndex: clampIndex(state.activeIndex, events.length),
    selected: [],
    undoStack: [...state.undoStack, { kind, events: removed }],
    effects: [...state.effects, { kind, eventGroupIds: ids }],
  };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "move":
      return {
        ...state,
        activeIndex: clampIndex(state.activeIndex + action.delta, state.events.length),
      };

    case "setActive":
      return { ...state, activeIndex: clampIndex(action.index, state.events.length) };

    case "confirm":
      return resolve(state, "confirm");

    case "ignore":
      return resolve(state, "ignore");

    case "toggleSelect": {
      const id = action.eventGroupId ?? state.events[state.activeIndex]?.eventGroupId;
      if (!id) return state;
      return {
        ...state,
        selected: toggle(state.selected, id),
        // Selecting the active row advances, so a run of `x` builds a selection.
        activeIndex: action.eventGroupId
          ? state.activeIndex
          : clampIndex(state.activeIndex + 1, state.events.length),
      };
    }

    case "toggleExpand": {
      const id = action.eventGroupId ?? state.events[state.activeIndex]?.eventGroupId;
      if (!id) return state;
      return { ...state, expanded: toggle(state.expanded, id) };
    }

    case "assignCategory": {
      const events = state.events.map((e) =>
        e.eventGroupId === action.eventGroupId
          ? { ...e, categoryId: action.categoryId }
          : e,
      );
      return {
        ...state,
        events,
        effects: [
          ...state.effects,
          {
            kind: "setCategory",
            eventGroupId: action.eventGroupId,
            categoryId: action.categoryId,
          },
        ],
      };
    }

    case "undo": {
      if (state.undoStack.length === 0) return state;
      const last = state.undoStack[state.undoStack.length - 1]!;
      const events = sortEvents([...state.events, ...last.events]);
      return {
        ...state,
        events,
        undoStack: state.undoStack.slice(0, -1),
        activeIndex: clampIndex(state.activeIndex, events.length),
        effects: [
          ...state.effects,
          { kind: "revert", eventGroupIds: last.events.map((e) => e.eventGroupId) },
        ],
      };
    }

    case "flushEffects":
      return state.effects.length === 0 ? state : { ...state, effects: [] };
  }
}
