import { appRoot } from "../app/root.js";
import { dataClient } from "../data/client.js";
import { feature } from "../features/feature.js";
import { uiPrimitive } from "../shared/ui/primitives.js";

export const testAllowed = [appRoot, dataClient, feature, uiPrimitive];
