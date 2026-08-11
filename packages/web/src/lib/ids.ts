/** Derive a URL/JSON-safe id from a display name. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** Make a slug unique against existing ids by appending -2, -3, … */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
