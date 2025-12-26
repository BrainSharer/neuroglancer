// patch.ts
import { applyPatch, compare, Operation } from "fast-json-patch";

export function createPatch(
  oldObj: any,
  newObj: any
): Operation[] {
  return compare(oldObj, newObj);
}

export function applyPatches(
  obj: any,
  patches: Operation[]
): any {
  const cloned = structuredClone(obj);
  applyPatch(cloned, patches);
  return cloned;
}
