/**
 * PPTX in the MVP: detect, explain, and guide to PDF export.
 *
 * Honest status: no in-browser PPTX renderer is faithful enough to trust for
 * a lecture (fonts, SmartArt, charts, animations all degrade). Rather than
 * ship a renderer that silently mangles slides, the MVP asks the user to
 * export to PDF from PowerPoint/Keynote/LibreOffice, which is pixel-faithful.
 * An experimental in-browser renderer is scheduled for Stage FOURTH.
 */
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function isPptx(file: File): boolean {
  return file.type === PPTX_MIME || /\.pptx?$/i.test(file.name);
}

export const PPTX_EXPORT_STEPS: ReadonlyArray<{ app: string; steps: string }> = [
  { app: "PowerPoint (Windows/Mac)", steps: "File → Export → Create PDF/XPS (or Save As → PDF). Choose “Slides”, not “Notes Pages”." },
  { app: "PowerPoint for the web", steps: "File → Save As → Download as PDF." },
  { app: "Keynote", steps: "File → Export To → PDF. Untick “Include presenter notes”." },
  { app: "Google Slides", steps: "File → Download → PDF Document." },
  { app: "LibreOffice Impress", steps: "File → Export As → Export as PDF. Leave “Export notes pages” unticked." },
];

export const PPTX_GUIDANCE_TITLE = "PowerPoint files need a quick export first";
export const PPTX_GUIDANCE_BODY =
  "Bernou renders slides from PDF so that what the audience sees matches your original exactly. Export the deck to PDF (slides only — not notes pages) and import that.";
