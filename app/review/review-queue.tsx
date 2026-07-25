"use client";

import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { formatMYR, signedCents } from "@/lib/money";
import { formatDayMonth } from "@/lib/ui/format";
import type { QueueEvent } from "@/lib/events/queue";
import type { EventState } from "@/lib/events/types";
import {
  initQueue,
  queueReducer,
  type QueueEffect,
} from "@/lib/review/queue-reducer";
import {
  confirmEventsAction,
  ignoreEventsAction,
  revertEventsAction,
  setCategoryAction,
} from "./actions";

export interface CategoryOption {
  id: string;
  name: string;
  kind: "expense" | "income" | "transfer";
}

function runEffect(effect: QueueEffect): void {
  switch (effect.kind) {
    case "confirm":
      void confirmEventsAction(effect.eventGroupIds);
      break;
    case "ignore":
      void ignoreEventsAction(effect.eventGroupIds);
      break;
    case "revert":
      void revertEventsAction(effect.eventGroupIds);
      break;
    case "setCategory":
      void setCategoryAction(effect.eventGroupId, effect.categoryId);
      break;
  }
}

export function ReviewQueue({
  initialEvents,
  categories,
}: {
  initialEvents: QueueEvent[];
  categories: CategoryOption[];
}) {
  const [state, dispatch] = useReducer(queueReducer, initialEvents, initQueue);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [, startTransition] = useTransition();

  const { events, activeIndex, selected, expanded, undoStack } = state;

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  // Flush the writes the reducer recorded, then clear them. The reducer stays
  // pure; this is the only place the queue touches the database.
  useEffect(() => {
    if (state.effects.length === 0) return;
    const effects = state.effects;
    startTransition(() => {
      for (const effect of effects) runEffect(effect);
    });
    dispatch({ type: "flushEffects" });
  }, [state.effects]);

  // Global keyboard model. Suspended while a picker or help overlay owns input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pickerFor || helpOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "move", delta: 1 });
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          dispatch({ type: "move", delta: -1 });
          break;
        case "c":
          e.preventDefault();
          dispatch({ type: "confirm" });
          break;
        case "e":
        case "Enter": {
          e.preventDefault();
          const active = events[activeIndex];
          if (active) setPickerFor(active.eventGroupId);
          break;
        }
        case "i":
          e.preventDefault();
          dispatch({ type: "ignore" });
          break;
        case "x":
        case " ":
          e.preventDefault();
          dispatch({ type: "toggleSelect" });
          break;
        case "o":
          e.preventDefault();
          dispatch({ type: "toggleExpand" });
          break;
        case "u":
          e.preventDefault();
          dispatch({ type: "undo" });
          break;
        case "?":
          e.preventDefault();
          setHelpOpen(true);
          break;
        case "Escape":
          if (selected.length > 0) {
            e.preventDefault();
            // Clearing selection: toggle each off. Simpler to re-init selection.
            for (const id of selected) dispatch({ type: "toggleSelect", eventGroupId: id });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, events, pickerFor, helpOpen, selected]);

  const activeEventForPicker = events.find((e) => e.eventGroupId === pickerFor) ?? null;

  if (events.length === 0) {
    return (
      <EmptyQueue
        canUndo={undoStack.length > 0}
        onUndo={() => dispatch({ type: "undo" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted">
          <span className="tnum font-medium text-ink">{events.length}</span>{" "}
          {events.length === 1 ? "event" : "events"} to review
          {selected.length > 0 && (
            <>
              {" · "}
              <span className="tnum font-medium text-accent">{selected.length}</span>{" "}
              selected
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-border-strong hover:text-ink"
        >
          Keys <kbd className="ml-1 font-sans">?</kbd>
        </button>
      </div>

      <ol className="flex flex-col gap-1.5">
        {events.map((event, index) => (
          <EventCard
            key={event.eventGroupId}
            event={event}
            active={index === activeIndex}
            selected={selected.includes(event.eventGroupId)}
            expanded={expanded.includes(event.eventGroupId)}
            categoryName={
              event.categoryId ? categoryById.get(event.categoryId)?.name ?? null : null
            }
            onActivate={() => dispatch({ type: "setActive", index })}
            onConfirm={() => {
              dispatch({ type: "setActive", index });
              dispatch({ type: "confirm" });
            }}
            onIgnore={() => {
              dispatch({ type: "setActive", index });
              dispatch({ type: "ignore" });
            }}
            onEditCategory={() => setPickerFor(event.eventGroupId)}
            onToggleSelect={() =>
              dispatch({ type: "toggleSelect", eventGroupId: event.eventGroupId })
            }
            onToggleExpand={() =>
              dispatch({ type: "toggleExpand", eventGroupId: event.eventGroupId })
            }
          />
        ))}
      </ol>

      {/* Bulk action bar — also the primary confirm affordance on a phone. */}
      {selected.length > 0 && (
        <div className="sticky bottom-4 z-10 mx-auto flex items-center gap-3 rounded-full border border-border-strong bg-surface px-4 py-2 shadow-lg">
          <span className="text-sm text-muted">
            <span className="tnum font-medium text-ink">{selected.length}</span> selected
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "confirm" })}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
          >
            Confirm selected
          </button>
          <button
            type="button"
            onClick={() => {
              for (const id of selected) dispatch({ type: "toggleSelect", eventGroupId: id });
            }}
            className="text-sm text-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}

      {undoStack.length > 0 && selected.length === 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            Undo last {undoStack[undoStack.length - 1]!.kind}
          </button>
        </div>
      )}

      {activeEventForPicker && (
        <CategoryPicker
          event={activeEventForPicker}
          categories={categories}
          onPick={(categoryId) => {
            dispatch({
              type: "assignCategory",
              eventGroupId: activeEventForPicker.eventGroupId,
              categoryId,
            });
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function EmptyQueue({ canUndo, onUndo }: { canUndo: boolean; onUndo: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
      <p className="text-lg font-medium">Queue clear</p>
      <p className="mt-1 text-sm text-muted">
        Every draft is reviewed. Import a capture to bring in more.
      </p>
      {canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="mt-4 text-xs text-muted underline underline-offset-2 hover:text-ink"
        >
          Undo last action
        </button>
      )}
    </div>
  );
}

const STATE_CHIP: Partial<Record<EventState, { label: string; className: string }>> = {
  pending: { label: "Pending", className: "bg-warning-soft text-warning" },
  orphan: { label: "Orphan", className: "bg-warning-soft text-warning" },
  cancelled: { label: "Cancelled", className: "bg-surface-2 text-muted" },
};

function EventCard({
  event,
  active,
  selected,
  expanded,
  categoryName,
  onActivate,
  onConfirm,
  onIgnore,
  onEditCategory,
  onToggleSelect,
  onToggleExpand,
}: {
  event: QueueEvent;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  categoryName: string | null;
  onActivate: () => void;
  onConfirm: () => void;
  onIgnore: () => void;
  onEditCategory: () => void;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const signed = signedCents(event.amountCents, event.direction);
  const chip = STATE_CHIP[event.state];
  const zero = event.amountCents === 0;

  return (
    <li>
      <div
        onClick={onActivate}
        className={
          "group relative flex items-center gap-3 rounded-xl border bg-surface px-3 py-3 transition-colors sm:px-4 " +
          (active
            ? "border-accent/60 ring-1 ring-accent/40"
            : "border-border hover:border-border-strong")
        }
      >
        {/* Accent rail marks the keyboard-active row. */}
        <span
          aria-hidden
          className={
            "absolute inset-y-2 left-0 w-0.5 rounded-full " +
            (active ? "bg-accent" : "bg-transparent")
          }
        />

        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select event"
          className="size-4 shrink-0 accent-[var(--accent)]"
        />

        <div className="w-12 shrink-0 text-xs text-muted tnum">
          {formatDayMonth(event.bookedAt)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {event.merchant || event.descriptionRaw}
            </span>
            {event.isAdjustment && (
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
                Adjustment
              </span>
            )}
            {chip && (
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium " +
                  chip.className
                }
              >
                {chip.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
            {event.rail && <span className="truncate">{event.rail}</span>}
            {event.rows.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="shrink-0 text-muted underline-offset-2 hover:underline"
              >
                {event.rows.length} rows {expanded ? "▲" : "▼"}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditCategory();
          }}
          className={
            "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors " +
            (categoryName
              ? "border-border text-ink hover:border-accent"
              : "border-dashed border-border-strong text-muted hover:border-accent hover:text-accent")
          }
        >
          {categoryName ?? "Categorise"}
        </button>

        <div
          className={
            "w-24 shrink-0 text-right text-sm font-medium tnum sm:w-28 " +
            (zero
              ? "text-faint"
              : event.direction === "credit"
                ? "text-credit"
                : "text-ink")
          }
        >
          {formatMYR(signed)}
        </div>

        {/* Row actions — visible on touch, and on hover elsewhere. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            aria-label="Confirm"
            title="Confirm (c)"
            className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:bg-accent hover:text-accent-contrast"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIgnore();
            }}
            aria-label="Ignore"
            title="Ignore (i)"
            className="rounded-md px-1.5 py-1 text-xs text-muted hover:text-danger"
          >
            Ignore
          </button>
        </div>
      </div>

      {expanded && event.rows.length > 1 && (
        <ul className="ml-9 mt-1 flex flex-col gap-1 border-l border-border pl-4 text-xs text-muted">
          {event.rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="truncate">
                <span className="text-faint">{formatDayMonth(row.bookedAt)}</span>{" "}
                {row.rail ? `${row.rail} · ` : ""}
                {row.eventRole.replace(/_/g, " ")}
              </span>
              <span className="tnum shrink-0">
                {formatMYR(signedCents(row.amountCents, row.direction))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoryPicker({
  event,
  categories,
  onPick,
  onClose,
}: {
  event: QueueEvent;
  categories: CategoryOption[];
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) onPick(pick.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="truncate text-sm font-medium">
            {event.merchant || event.descriptionRaw}
          </p>
          <p className="text-xs text-muted">Choose a category</p>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type to filter…"
          className="w-full border-b border-border bg-transparent px-4 py-2.5 text-sm outline-none"
        />
        <ul className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">No matching category.</li>
          ) : (
            filtered.map((category, i) => (
              <li key={category.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => onPick(category.id)}
                  className={
                    "flex w-full items-center justify-between px-4 py-2 text-left text-sm " +
                    (i === highlight ? "bg-accent-soft text-accent" : "hover:bg-surface-2")
                  }
                >
                  <span>{category.name}</span>
                  <span className="text-xs text-faint">{category.kind}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

const KEYS: Array<[string, string]> = [
  ["j / ↓", "Next event"],
  ["k / ↑", "Previous event"],
  ["c", "Confirm (or confirm selected)"],
  ["e / ⏎", "Change category"],
  ["i", "Ignore"],
  ["x / space", "Select, and move on"],
  ["o", "Expand constituent rows"],
  ["u", "Undo last action"],
  ["esc", "Clear selection"],
  ["?", "This help"],
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border-strong bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink"
          >
            Close
          </button>
        </div>
        <dl className="flex flex-col gap-2">
          {KEYS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted">{label}</dt>
              <dd>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs">
                  {key}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
