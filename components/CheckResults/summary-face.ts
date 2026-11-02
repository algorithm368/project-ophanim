import { IBM_Plex_Serif } from "next/font/google";

/**
 * The face of the summary paragraph, on the check page and the scan page.
 *
 * Everything else on the page is a label, a value, or a mark; the summary is
 * the one place the app writes prose, and a serif sets it apart as the written
 * assessment rather than another readout. Like the mark face, `next/font`
 * serves it from this app's own origin, and it is loaded here rather than in
 * the layout so only the pages that show a summary pay for it.
 */
export const summaryFace = IBM_Plex_Serif({ weight: "400", subsets: ["latin"], display: "swap" });
