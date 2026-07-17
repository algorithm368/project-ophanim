/**
 * Pick the active section id from each section's viewport-relative top.
 *
 * `sections` are in document order, so their `top` values increase down the
 * list. The active section is the last one whose top has crossed `offset` (the
 * sticky-nav line); before any has crossed, the first section stays active.
 *
 * Pure and DOM-free so the selection rule can be unit-tested without a browser;
 * the live scroll wiring lives in SectionNav.
 */
export function pickActiveId(
    sections: { id: string; top: number }[],
    offset: number,
): string | null {
    if (sections.length === 0) return null;
    let active = sections[0].id;
    for (const s of sections) {
        if (s.top <= offset) active = s.id;
        else break;
    }
    return active;
}
