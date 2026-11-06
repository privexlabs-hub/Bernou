/**
 * The prompter text's layout. The Prompter tab and the floating window each
 * keep their own: a layout that suits a tall side panel puts the words too
 * far below the camera when it's floated beside it.
 */
import type { TeleprompterSettings } from "@/db/dexie";

export interface TextLayout {
  fontSize: number;
  readingLine: number;
  readingZone: number;
  align: "left" | "center";
}

/**
 * Reading line near the top, so the words sit right under the lens with no
 * empty band in between. Smaller and centred, so the eyes sweep less.
 */
export const CAMERA_LAYOUT = { floatFontSize: 22, floatReadingLine: 0.1, floatReadingZone: 0.5, floatAlign: "center" } as const satisfies Partial<TeleprompterSettings>;

export function textLayout(s: TeleprompterSettings, floating: boolean): TextLayout {
  return floating
    ? { fontSize: s.floatFontSize, readingLine: s.floatReadingLine, readingZone: s.floatReadingZone, align: s.floatAlign }
    : { fontSize: s.fontSize, readingLine: s.readingLine, readingZone: s.readingZone, align: s.align };
}

/** The settings change that edits one place's layout. */
export function layoutPatch(p: Partial<TextLayout>, floating: boolean): Partial<TeleprompterSettings> {
  if (!floating) return { ...p };
  const out: Partial<TeleprompterSettings> = {};
  if (p.fontSize !== undefined) out.floatFontSize = p.fontSize;
  if (p.readingLine !== undefined) out.floatReadingLine = p.readingLine;
  if (p.readingZone !== undefined) out.floatReadingZone = p.readingZone;
  if (p.align !== undefined) out.floatAlign = p.align;
  return out;
}
