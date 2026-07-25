import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoryKind = "expense" | "income" | "transfer";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  color: string | null;
  sortOrder: number;
}

type Raw = {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string | null;
  sort_order: number;
};

function toCategory(r: Raw): Category {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    parentId: r.parent_id,
    color: r.color,
    sortOrder: r.sort_order,
  };
}

/** The owner's active categories, in display order. */
export async function listCategories(
  supabase: SupabaseClient,
): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, kind, parent_id, color, sort_order")
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listCategories: ${error.message}`);
  return ((data ?? []) as Raw[]).map(toCategory);
}

/** The reconciliation category adjustments land in (D21). */
export async function getUnaccountedCategory(
  supabase: SupabaseClient,
): Promise<Category | null> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, kind, parent_id, color, sort_order")
    .eq("name", "Unaccounted")
    .is("parent_id", null)
    .maybeSingle();
  if (error) throw new Error(`getUnaccountedCategory: ${error.message}`);
  return data ? toCategory(data as Raw) : null;
}
