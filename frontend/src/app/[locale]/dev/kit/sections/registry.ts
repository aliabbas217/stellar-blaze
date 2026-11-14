import type { ComponentType } from "react";
import { LevelScaleSection } from "./level-scale";
import { LevelSignSection } from "./level-sign";
import { PictogramsSection } from "./pictograms";
import { StampsSection } from "./stamps";
import { StatesSection } from "./states";

/**
 * The sections of the kit page, in reading order. To add a component's section (Tasks 5, 6 and 7 do): write
 * `sections/<name>.tsx` exporting one component, add its id to `KitSectionId`, its `title` and `note` under
 * `common.kit.sections.<id>` in messages, and one entry below. The page owns the heading, the anchor and the layout.
 */
export type KitSectionId = "levelSign" | "levelScale" | "pictograms" | "states" | "stamps";

export interface KitSection {
  readonly id: KitSectionId;
  readonly Content: ComponentType;
}

export const KIT_SECTIONS: readonly KitSection[] = [
  { id: "levelSign", Content: LevelSignSection },
  { id: "levelScale", Content: LevelScaleSection },
  { id: "pictograms", Content: PictogramsSection },
  { id: "states", Content: StatesSection },
  { id: "stamps", Content: StampsSection },
];
