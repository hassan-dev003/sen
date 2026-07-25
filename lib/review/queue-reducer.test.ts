import { describe, expect, it } from "vitest";
import type { QueueEvent } from "@/lib/events/queue";
import {
  initQueue,
  queueReducer,
  type QueueAction,
  type QueueState,
} from "./queue-reducer";

function event(n: number): QueueEvent {
  const day = String((n % 28) + 1).padStart(2, "0");
  return {
    eventGroupId: `g${String(n).padStart(3, "0")}`,
    state: "resolved",
    reviewState: "draft",
    bookedAt: `2026-07-${day}`,
    amountCents: 100 + n,
    direction: "debit",
    descriptionRaw: `MERCHANT ${n}`,
    merchant: `MERCHANT ${n}`,
    rail: "DUITNOW QR",
    categoryId: null,
    batchId: "batch-1",
    note: null,
    isAdjustment: false,
    rows: [
      {
        id: `r${n}`,
        eventGroupId: `g${String(n).padStart(3, "0")}`,
        eventRole: "single",
        eventState: "resolved",
        reviewState: "draft",
        bookedAt: `2026-07-${day}`,
        amountCents: 100 + n,
        direction: "debit",
        descriptionRaw: `MERCHANT ${n}`,
        merchant: `MERCHANT ${n}`,
        rail: "DUITNOW QR",
        categoryId: null,
        batchId: "batch-1",
        note: null,
        isAdjustment: false,
      },
    ],
  };
}

function run(state: QueueState, actions: QueueAction[]): QueueState {
  return actions.reduce(queueReducer, state);
}

describe("queueReducer — clearing the queue by keyboard", () => {
  it("clears an 80-event queue with 80 confirms, and records 80 confirm effects", () => {
    const events = Array.from({ length: 80 }, (_, i) => event(i));
    let state = initQueue(events);

    let confirmEffects = 0;
    for (let i = 0; i < 80; i++) {
      state = queueReducer(state, { type: "confirm" });
      // Flush as the component would, counting the confirmed groups.
      confirmEffects += state.effects.filter((e) => e.kind === "confirm").length;
      state = queueReducer(state, { type: "flushEffects" });
    }

    expect(state.events).toHaveLength(0);
    expect(confirmEffects).toBe(80);
    // One more confirm on an empty queue is a no-op.
    expect(queueReducer(state, { type: "confirm" }).events).toHaveLength(0);
  });

  it("confirms the active row and advances naturally", () => {
    const state = initQueue([event(1), event(2), event(3)]);
    // Newest first: g003, g002, g001. Confirm the first.
    const after = queueReducer(state, { type: "confirm" });
    expect(after.events.map((e) => e.eventGroupId)).toEqual(["g002", "g001"]);
    expect(after.effects).toEqual([{ kind: "confirm", eventGroupIds: ["g003"] }]);
    expect(after.activeIndex).toBe(0);
  });
});

describe("queueReducer — selection and bulk confirm", () => {
  it("builds a selection with toggleSelect and confirms all of it at once", () => {
    let state = initQueue([event(1), event(2), event(3)]); // g003, g002, g001
    // Select active (g003) and advance, then select g002 and advance.
    state = run(state, [{ type: "toggleSelect" }, { type: "toggleSelect" }]);
    expect(state.selected).toEqual(["g003", "g002"]);
    expect(state.activeIndex).toBe(2);

    state = queueReducer(state, { type: "flushEffects" });
    state = queueReducer(state, { type: "confirm" });
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g001"]);
    expect(state.effects).toEqual([{ kind: "confirm", eventGroupIds: ["g003", "g002"] }]);
    expect(state.selected).toEqual([]);
  });

  it("toggling the same row twice deselects it", () => {
    const state = initQueue([event(1)]);
    const after = run(state, [
      { type: "toggleSelect", eventGroupId: "g001" },
      { type: "toggleSelect", eventGroupId: "g001" },
    ]);
    expect(after.selected).toEqual([]);
  });
});

describe("queueReducer — undo", () => {
  it("restores a confirmed event and emits a revert effect", () => {
    let state = initQueue([event(1), event(2)]); // g002, g001
    state = queueReducer(state, { type: "confirm" }); // removes g002
    state = queueReducer(state, { type: "flushEffects" });
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g001"]);

    state = queueReducer(state, { type: "undo" });
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g002", "g001"]);
    expect(state.effects).toEqual([{ kind: "revert", eventGroupIds: ["g002"] }]);
    expect(state.undoStack).toHaveLength(0);
  });

  it("undo on an empty stack is a no-op", () => {
    const state = initQueue([event(1)]);
    expect(queueReducer(state, { type: "undo" })).toEqual(state);
  });

  it("unwinds multiple actions in reverse order", () => {
    let state = initQueue([event(1), event(2), event(3)]); // g003, g002, g001
    state = queueReducer(state, { type: "confirm" }); // -g003
    state = queueReducer(state, { type: "flushEffects" });
    state = queueReducer(state, { type: "ignore" }); // -g002
    state = queueReducer(state, { type: "flushEffects" });
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g001"]);

    state = queueReducer(state, { type: "undo" }); // restores g002 (last)
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g002", "g001"]);
    state = queueReducer(state, { type: "flushEffects" });
    state = queueReducer(state, { type: "undo" }); // restores g003
    expect(state.events.map((e) => e.eventGroupId)).toEqual(["g003", "g002", "g001"]);
  });
});

describe("queueReducer — navigation, category, expand", () => {
  it("clamps navigation at both ends", () => {
    const state = initQueue([event(1), event(2)]);
    expect(queueReducer(state, { type: "move", delta: -1 }).activeIndex).toBe(0);
    const end = run(state, [{ type: "move", delta: 1 }, { type: "move", delta: 1 }]);
    expect(end.activeIndex).toBe(1);
  });

  it("assigns a category to one event and emits the effect", () => {
    const state = initQueue([event(1), event(2)]);
    const after = queueReducer(state, {
      type: "assignCategory",
      eventGroupId: "g001",
      categoryId: "cat-food",
    });
    expect(after.events.find((e) => e.eventGroupId === "g001")!.categoryId).toBe("cat-food");
    expect(after.events.find((e) => e.eventGroupId === "g002")!.categoryId).toBeNull();
    expect(after.effects).toEqual([
      { kind: "setCategory", eventGroupId: "g001", categoryId: "cat-food" },
    ]);
  });

  it("toggles expand state without emitting an effect", () => {
    const state = initQueue([event(1)]);
    const after = queueReducer(state, { type: "toggleExpand" });
    expect(after.expanded).toEqual(["g001"]);
    expect(after.effects).toEqual([]);
  });
});
