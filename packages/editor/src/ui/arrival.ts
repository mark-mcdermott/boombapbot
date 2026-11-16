/**
 * Reads the named parameters another page left in the address (a link in an
 * email, the way back from checkout) and takes them out again, so a reload
 * does not act on them twice.
 */
export function takeParams<Name extends string>(names: readonly Name[]): Record<Name, string | null> {
  const url = new URL(window.location.href);
  const found = Object.fromEntries(names.map((name) => [name, url.searchParams.get(name)])) as Record<
    Name,
    string | null
  >;
  if (names.some((name) => url.searchParams.has(name))) {
    for (const name of names) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', url);
  }
  return found;
}
