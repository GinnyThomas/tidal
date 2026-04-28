// lib/categories.ts
// Shared utilities for category data.

type CategoryLike = { name: string }

/** Sort categories alphabetically by name (returns a new array). */
export const sortCategoriesByName = <T extends CategoryLike>(categories: T[]): T[] =>
    [...categories].sort((a, b) => a.name.localeCompare(b.name))

// --- Hierarchical dropdown options ---

type HierarchyCategory = {
    id: string
    name: string
    parent_category_id?: string | null
}

type CategoryOption = {
    id: string
    label: string
    parentId: string | null
}

/**
 * Build a flat array of { id, label, parentId } sorted as:
 *   - Parent categories alphabetically
 *   - Each parent's children immediately after, indented with "  → ", alphabetically
 *   - Orphaned children (parent not in list) promoted to top-level
 *
 * Used by category <select> dropdowns across all forms.
 */
export function buildCategoryOptions(categories: HierarchyCategory[]): CategoryOption[] {
    const idSet = new Set(categories.map(c => c.id))
    const parents = categories
        .filter(c => !c.parent_category_id || !idSet.has(c.parent_category_id))
        .sort((a, b) => a.name.localeCompare(b.name))
    const childrenOf = (parentId: string) =>
        categories
            .filter(c => c.parent_category_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name))

    const result: CategoryOption[] = []
    for (const p of parents) {
        result.push({
            id: p.id,
            label: p.name,
            // Orphaned children (parent not in the list) are promoted to
            // top-level — set parentId to null so consumers don't reference
            // a missing parent id.
            parentId: p.parent_category_id && idSet.has(p.parent_category_id)
                ? p.parent_category_id
                : null,
        })
        for (const c of childrenOf(p.id)) {
            result.push({ id: c.id, label: `  → ${c.name}`, parentId: c.parent_category_id ?? null })
        }
    }
    return result
}
