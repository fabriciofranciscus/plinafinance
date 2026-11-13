export const RIBBON_ENTRANCE_SECONDS: number;
export interface RibbonHandle {
  setPaused(paused: boolean): void;
  destroy(): void;
}
export function mountRibbon(
  canvas: HTMLCanvasElement,
  options?: { stage?: HTMLElement | null; paused?: boolean },
): RibbonHandle;
