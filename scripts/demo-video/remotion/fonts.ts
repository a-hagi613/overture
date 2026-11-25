import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export function loadDemoFonts() {
  void loadFont({
    family: "Instrument Serif",
    style: "normal",
    url: staticFile("fonts/instrument-serif-normal.woff2"),
    weight: "400",
  });

  void loadFont({
    family: "Instrument Serif",
    style: "italic",
    url: staticFile("fonts/instrument-serif-italic.woff2"),
    weight: "400",
  });

  void loadFont({
    family: "Plus Jakarta Sans",
    url: staticFile("fonts/plus-jakarta-sans.woff2"),
    weight: "400 700",
  });
}
