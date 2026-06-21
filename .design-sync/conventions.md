# Ophanim UI — how to build with this design system

Ophanim is the design system for a threat-intelligence indicator checker. The look is
**military-grade, monochrome minimal**: grayscale surfaces, hairline borders, flat
elevation, system fonts. **Color is reserved for the threat verdict only** — use the
`destructive` (red) token for malicious/danger; keep everything else neutral.

## Setup and wrapping
- **No provider or theme wrapper is required.** Components read design tokens from CSS
  variables defined globally (`:root`). Just render a component and it is styled.
- **Dark mode:** add `class="dark"` to any ancestor (e.g. `<body class="dark">`). All
  tokens have light and dark values; nothing else changes.
- Components are React, imported from the bundle global (the cards show the exact import).

## Styling idiom: Tailwind utility classes over semantic tokens
This is a Tailwind CSS v4 system. Style in two layers:

**1. Carry the design language through component props** (don't restyle the primitives):
- `Button` — `variant`: `default | outline | secondary | ghost | destructive | link`;
  `size`: `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`.
- `Badge` — `variant`: `default | secondary | destructive | outline | ghost | link`.
- `Card` — `size`: `default | sm`; compose with `CardHeader`, `CardTitle`,
  `CardDescription`, `CardAction`, `CardContent`, `CardFooter`.
- `Input` — native input props; set `aria-invalid` to show the error (red) ring.

**2. For your own layout, use Tailwind utilities built on these semantic tokens**
(each works as `bg-*`, `text-*`, `border-*`, `ring-*`):
`background, foreground, primary, primary-foreground, secondary, secondary-foreground,`
`muted, muted-foreground, accent, accent-foreground, card, card-foreground, popover,`
`popover-foreground, destructive, border, input, ring`.
- Surfaces: `bg-background` (page), `bg-card` (panels), `bg-muted` (subtle fills).
- Text: `text-foreground`, secondary `text-muted-foreground`.
- Borders are hairlines: `border border-border`, or card-style `ring-1 ring-foreground/10`.
- **Radius is sharp/technical:** `rounded-sm` 3px, `rounded-md` 4px, `rounded-lg` 6px,
  `rounded-xl` 8px, `rounded-2xl` 10px.
- **Fonts:** `font-sans` (UI/prose, system stack), `font-mono` for data tokens — IPs,
  hashes, scores, timings (system mono stack). `font-heading` = sans.
- Flat elevation only: the `sketch-shadow` utility is a single whisper-soft shadow;
  prefer borders for separation. Do not add heavy drop shadows.

## Where the truth lives
- The full stylesheet (tokens + every utility) is `styles.css` → `_ds_bundle.css`. Read it
  to confirm a class or token before using it.
- Each component has a `.d.ts` (its prop contract) and a `.prompt.md` (usage) — read those
  for exact props.

## Idiomatic example — a source-finding card
```jsx
<Card className="max-w-sm">
  <CardHeader>
    <CardTitle>AbuseIPDB</CardTitle>
    <CardDescription>Crowd-sourced IP abuse reports</CardDescription>
    <CardAction><Badge variant="destructive">Malicious</Badge></CardAction>
  </CardHeader>
  <CardContent>
    <p className="font-mono text-sm">185.220.101.4</p>
    <p className="mt-1 text-muted-foreground">Reported 1,204 times in 90 days.</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">View report</Button>
  </CardFooter>
</Card>
```
