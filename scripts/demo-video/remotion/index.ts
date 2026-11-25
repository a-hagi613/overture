import { registerRoot } from "remotion";

import { loadDemoFonts } from "./fonts.ts";
import { RemotionRoot } from "./root.tsx";

loadDemoFonts();

registerRoot(RemotionRoot);
