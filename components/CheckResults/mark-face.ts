import { Barlow_Condensed } from "next/font/google";

/**
 * One of the app's webfonts, and it sets nothing but marks: the vitals and
 * the hero's class. The others are the summary's, in `summary-face.ts`, and
 * the page's sans, loaded in `app/layout.tsx`.
 *
 * Every mark in the strip is meant to be the same height, and a system face is
 * too wide for that: at the size the strip wants, a domain or a country name
 * outgrows its cell and has to wrap mid-word. A condensed face keeps them
 * whole. `next/font` serves it from this app's own origin, so the page still
 * makes no request to anyone else, and it is loaded here rather than in the
 * layout so only the pages that draw a mark pay for it.
 */
export const markFace = Barlow_Condensed({ weight: "700", subsets: ["latin"], display: "swap" });
