// lib/categories.ts
// Shared utilities for category data.

type CategoryLike = { name: string }

/** Sort categories alphabetically by name (returns a new array). */
export const sortCategoriesByName = <T extends CategoryLike>(categories: T[]): T[] =>
    [...categories].sort((a, b) => a.name.localeCompare(b.name))
