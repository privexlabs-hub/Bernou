import { slideContentRect } from "@bernou/composition-engine";

/** Where a slide of this size sits in the output: the same rectangle the engine draws it in. */
export function fitSlide(slideW: number, slideH: number, outputW: number, outputH: number) {
  return slideContentRect({ output: { width: outputW, height: outputH }, layout: "slide-full", slide: { width: slideW, height: slideH } })!;
}
