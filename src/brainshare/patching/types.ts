// types.ts
export type JsonValue = any;

export interface BaseDoc {
  _id: string;
  _rev?: string;
  type: "base";
  data: JsonValue;
  version: number;
}

export interface PatchDoc {
  _id: string;
  _rev?: string;
  type: "patch";
  baseVersion: number;
  patch: any[];
  timestamp: number;
}
