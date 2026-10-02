// Which highlight ids belong to comments already on the server (hosted mode).
// App provides it; AnnotationLayer and ScriptViewer read it to stamp
// data-kind="sent" on their marks — so no view has to thread a flag through
// its own annotation filtering/mapping.
import { createContext } from "react";

export const SentIdsContext = createContext<ReadonlySet<string>>(new Set());
