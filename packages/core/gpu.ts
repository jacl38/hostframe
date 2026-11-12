import { getProcessGPU } from "../native/bridge.ts";

/** Shared Dawn GPU, independent of GLFW and Application lifetimes. */
export const gpu = getProcessGPU();
