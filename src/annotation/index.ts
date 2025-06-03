/**
 * @license
 * Copyright 2018 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Basic annotation data structures.
 */

import type {
  BoundingBox,
  CoordinateSpace,
  CoordinateSpaceTransform,
  WatchableCoordinateSpaceTransform,
} from "#src/coordinate_transform.js";
import { arraysEqual } from "#src/util/array.js";
import {
  packColor,
  parseRGBAColorSpecification,
  parseRGBColorSpecification,
  serializeColor,
  unpackRGB,
  unpackRGBA,
} from "#src/util/color.js";
import { DataType } from "#src/util/data_type.js";
import type { Borrowed } from "#src/util/disposable.js";
import { RefCounted } from "#src/util/disposable.js";
import { Endianness, ENDIANNESS } from "#src/util/endian.js";
import {
  expectArray,
  parseArray,
  parseFixedLengthArray,
  parseUint64,
  verifyEnumString,
  verifyFiniteFloat,
  verifyFiniteNonNegativeFloat,
  verifyFloat,
  verifyInt,
  verifyObject,
  verifyObjectProperty,
  verifyOptionalObjectProperty,
  verifyOptionalString,
  verifyString,
  /* BRAINSHARE STARTS */
  verifyBoolean,
  verifyStringArray,
  /* BRAINSHARE ENDS */
} from "#src/util/json.js";
import { parseDataTypeValue } from "#src/util/lerp.js";
import { getRandomHexString } from "#src/util/random.js";
import { NullarySignal, Signal } from "#src/util/signal.js";
/* BRAINSHARE STARTS */
import * as vector from "#src/util/vector.js";
import { MultiscaleAnnotationSource } from "#src/annotation/frontend_source.js";
/* BRAINSHARE ENDS */

export type AnnotationId = string;

export class AnnotationReference extends RefCounted {
  changed = new NullarySignal();

  /**
   * If `undefined`, we are still waiting to look up the result.  If `null`, annotation has been
   * deleted.
   */
  value: Annotation | null | undefined;

  constructor(public id: AnnotationId) {
    super();
  }
}

export enum AnnotationType {
  POINT = 0,
  LINE = 1,
  AXIS_ALIGNED_BOUNDING_BOX = 2,
  ELLIPSOID = 3,
  /* BRAINSHARE STARTS */
  POLYGON,
  VOLUME,
  CLOUD,
  /* BRAINSHARE ENDS */
}

export const annotationTypes = [
  AnnotationType.POINT,
  AnnotationType.LINE,
  AnnotationType.AXIS_ALIGNED_BOUNDING_BOX,
  AnnotationType.ELLIPSOID,
    /* BRAINSHARE STARTS */
  AnnotationType.POLYGON,
  AnnotationType.VOLUME,
  AnnotationType.CLOUD,
  /* BRAINSHARE ENDS */
];

export interface AnnotationPropertySpecBase {
  identifier: string;
  description: string | undefined;
}

export interface AnnotationColorPropertySpec
  extends AnnotationPropertySpecBase {
  type: "rgb" | "rgba";
  default: number;
}

export interface AnnotationNumericPropertySpec
  extends AnnotationPropertySpecBase {
  type: "float32" | "uint32" | "int32" | "uint16" | "int16" | "uint8" | "int8";
  default: number;
  enumValues?: number[];
  enumLabels?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export function isAnnotationNumericPropertySpec(
  spec: AnnotationPropertySpec,
): spec is AnnotationNumericPropertySpec {
  return spec.type !== "rgb" && spec.type !== "rgba";
}

export const propertyTypeDataType: Record<
  AnnotationPropertySpec["type"],
  DataType | undefined
> = {
  float32: DataType.FLOAT32,
  uint32: DataType.UINT32,
  int32: DataType.INT32,
  uint16: DataType.UINT16,
  int16: DataType.INT16,
  uint8: DataType.UINT8,
  int8: DataType.INT8,
  rgb: undefined,
  rgba: undefined,
};

export type AnnotationPropertySpec =
  | AnnotationColorPropertySpec
  | AnnotationNumericPropertySpec;

export interface AnnotationPropertyTypeHandler {
  serializedBytes(rank: number): number;
  alignment(rank: number): number;
  serializeCode(property: string, offset: string, rank: number): string;
  deserializeCode(property: string, offset: string, rank: number): string;
  deserializeJson(obj: unknown): number;
  serializeJson(value: number): any;
}

export const annotationPropertyTypeHandlers: {
  [K in AnnotationPropertySpec["type"]]: AnnotationPropertyTypeHandler;
} = {
  rgb: {
    serializedBytes() {
      return 3;
    },
    alignment() {
      return 1;
    },
    serializeCode(property: string, offset: string) {
      return (
        `dv.setUint16(${offset}, ${property}, true);` +
        `dv.setUint8(${offset} + 2, ${property} >>> 16);`
      );
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getUint16(${offset}, true) | (dv.getUint8(${offset} + 2) << 16);`;
    },
    deserializeJson(obj: unknown) {
      return packColor(parseRGBColorSpecification(obj));
    },
    serializeJson(value: number) {
      return serializeColor(unpackRGB(value));
    },
  },
  rgba: {
    serializedBytes() {
      return 4;
    },
    alignment() {
      return 1;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setUint32(${offset}, ${property}, true);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getUint32(${offset}, true);`;
    },
    deserializeJson(obj: unknown) {
      return packColor(parseRGBAColorSpecification(obj));
    },
    serializeJson(value: number) {
      return serializeColor(unpackRGBA(value));
    },
  },
  float32: {
    serializedBytes() {
      return 4;
    },
    alignment() {
      return 4;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setFloat32(${offset}, ${property}, isLittleEndian);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getFloat32(${offset}, isLittleEndian);`;
    },
    deserializeJson(obj: unknown) {
      return verifyFloat(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  uint32: {
    serializedBytes() {
      return 4;
    },
    alignment() {
      return 4;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setUint32(${offset}, ${property}, isLittleEndian);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getUint32(${offset}, isLittleEndian);`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  int32: {
    serializedBytes() {
      return 4;
    },
    alignment() {
      return 4;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setInt32(${offset}, ${property}, isLittleEndian);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getInt32(${offset}, isLittleEndian);`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  uint16: {
    serializedBytes() {
      return 2;
    },
    alignment() {
      return 2;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setUint16(${offset}, ${property}, isLittleEndian);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getUint16(${offset}, isLittleEndian);`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  int16: {
    serializedBytes() {
      return 2;
    },
    alignment() {
      return 2;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setInt16(${offset}, ${property}, isLittleEndian);`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getInt16(${offset}, isLittleEndian);`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  uint8: {
    serializedBytes() {
      return 1;
    },
    alignment() {
      return 1;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setUint8(${offset}, ${property});`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getUint8(${offset});`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
  int8: {
    serializedBytes() {
      return 2;
    },
    alignment() {
      return 1;
    },
    serializeCode(property: string, offset: string) {
      return `dv.setInt8(${offset}, ${property});`;
    },
    deserializeCode(property: string, offset: string) {
      return `${property} = dv.getInt8(${offset});`;
    },
    deserializeJson(obj: unknown) {
      return verifyInt(obj);
    },
    serializeJson(value: number) {
      return value;
    },
  },
};

// Maximum stride value supported by WebGL.
const MAX_BUFFER_STRIDE = 255;

export function getPropertyOffsets(
  rank: number,
  firstGroupInitialOffset: number,
  propertySpecs: readonly Readonly<AnnotationPropertySpec>[],
): {
  serializedBytes: number;
  offsets: { group: number; offset: number }[];
  propertyGroupBytes: number[];
} {
  let serializedBytes = 0;
  const numProperties = propertySpecs.length;
  const permutation = new Array<number>(numProperties);
  const propertyGroupBytes: number[] = [];
  for (let i = 0; i < numProperties; ++i) {
    permutation[i] = i;
  }
  const getAlignment = (i: number) =>
    annotationPropertyTypeHandlers[propertySpecs[i].type].alignment(rank);
  permutation.sort((i, j) => getAlignment(j) - getAlignment(i));
  let propertyGroupIndex = 0;
  const offsets = new Array<{ group: number; offset: number }>(numProperties);
  let propertyGroupOffset = firstGroupInitialOffset;
  const nextPropertyGroup = () => {
    propertyGroupOffset += (4 - (propertyGroupOffset % 4)) % 4;
    serializedBytes += propertyGroupOffset;
    propertyGroupBytes[propertyGroupIndex] = propertyGroupOffset;
    propertyGroupOffset = 0;
    ++propertyGroupIndex;
  };
  for (let outputIndex = 0; outputIndex < numProperties; ++outputIndex) {
    const propertyIndex = permutation[outputIndex];
    const spec = propertySpecs[propertyIndex];
    const handler = annotationPropertyTypeHandlers[spec.type];
    const numBytes = handler.serializedBytes(rank);
    const alignment = handler.alignment(rank);
    // Check if the property fits in the current property group.
    const alignmentOffset =
      (alignment - (propertyGroupOffset % alignment)) % alignment;
    const newStartOffset = propertyGroupOffset + alignmentOffset;
    const newEndOffset = newStartOffset + numBytes;
    const newAlignedEndOffset = newEndOffset + ((4 - (newEndOffset % 4)) % 4);
    if (newAlignedEndOffset <= MAX_BUFFER_STRIDE) {
      // Property fits
      propertyGroupOffset += alignmentOffset;
    } else {
      // Property does not fit.
      nextPropertyGroup();
    }
    offsets[propertyIndex] = {
      offset: propertyGroupOffset,
      group: propertyGroupIndex,
    };
    propertyGroupOffset += numBytes;
  }
  nextPropertyGroup();
  return { serializedBytes, offsets, propertyGroupBytes };
}

export class AnnotationPropertySerializer {
  serializedBytes: number;
  serialize: (
    buffer: DataView,
    offset: number,
    annotationIndex: number,
    annotationCount: number,
    isLittleEndian: boolean,
    properties: any[],
  ) => void;
  deserialize: (
    buffer: DataView,
    offset: number,
    annotationIndex: number,
    annotationCount: number,
    isLittleEndian: boolean,
    properties: any[],
  ) => void;
  propertyGroupBytes: number[];
  constructor(
    public rank: number,
    public firstGroupInitialOffset: number,
    public propertySpecs: readonly Readonly<AnnotationPropertySpec>[],
  ) {
    if (propertySpecs.length === 0) {
      this.serializedBytes = firstGroupInitialOffset;
      this.serialize = this.deserialize = () => {};
      this.propertyGroupBytes = [firstGroupInitialOffset];
      return;
    }
    const { serializedBytes, offsets, propertyGroupBytes } = getPropertyOffsets(
      rank,
      firstGroupInitialOffset,
      propertySpecs,
    );
    this.propertyGroupBytes = propertyGroupBytes;
    let groupOffsetCode = "let groupOffset0 = offset;";
    for (
      let groupIndex = 1;
      groupIndex < propertyGroupBytes.length;
      ++groupIndex
    ) {
      groupOffsetCode += `let groupOffset${groupIndex} = groupOffset${
        groupIndex - 1
      } + ${propertyGroupBytes[groupIndex - 1]}*annotationCount;`;
    }
    for (
      let groupIndex = 0;
      groupIndex < propertyGroupBytes.length;
      ++groupIndex
    ) {
      groupOffsetCode += `groupOffset${groupIndex} += ${propertyGroupBytes[groupIndex]}*annotationIndex;`;
    }
    let serializeCode = groupOffsetCode;
    let deserializeCode = groupOffsetCode;
    const numProperties = propertySpecs.length;
    for (
      let propertyIndex = 0;
      propertyIndex < numProperties;
      ++propertyIndex
    ) {
      const { group, offset } = offsets[propertyIndex];
      const spec = propertySpecs[propertyIndex];
      const handler = annotationPropertyTypeHandlers[spec.type];
      const propId = `properties[${propertyIndex}]`;
      const offsetExpr = `groupOffset${group} + ${offset}`;
      serializeCode += handler.serializeCode(propId, offsetExpr, rank);
      deserializeCode += handler.deserializeCode(propId, offsetExpr, rank);
    }
    this.serializedBytes = serializedBytes;
    this.serialize = new Function(
      "dv",
      "offset",
      "annotationIndex",
      "annotationCount",
      "isLittleEndian",
      "properties",
      serializeCode,
    ) as any;
    this.deserialize = new Function(
      "dv",
      "offset",
      "annotationIndex",
      "annotationCount",
      "isLittleEndian",
      "properties",
      deserializeCode,
    ) as any;
  }
}

export function makeAnnotationPropertySerializers(
  rank: number,
  propertySpecs: readonly Readonly<AnnotationPropertySpec>[],
) {
  const serializers: AnnotationPropertySerializer[] = [];
  for (const annotationType of annotationTypes) {
    const handler = annotationTypeHandlers[annotationType];
    serializers[annotationType] = new AnnotationPropertySerializer(
      rank,
      handler.serializedBytes(rank),
      propertySpecs,
    );
  }
  return serializers;
}

export function formatNumericProperty(
  property: AnnotationNumericPropertySpec,
  value: number,
): string {
  const formattedValue =
    property.type === "float32" ? value.toPrecision(6) : value.toString();
  const { enumValues, enumLabels } = property;
  if (enumValues !== undefined) {
    const enumIndex = enumValues.indexOf(value);
    if (enumIndex !== -1) {
      return `${enumLabels![enumIndex]} (${formattedValue})`;
    }
  }
  return formattedValue;
}

export function formatAnnotationPropertyValue(
  property: AnnotationPropertySpec,
  value: any,
): string {
  switch (property.type) {
    case "rgb":
      return serializeColor(unpackRGB(value));
    case "rgba":
      return serializeColor(unpackRGBA(value));
    default:
      return formatNumericProperty(property, value);
  }
}

export function parseAnnotationPropertyId(obj: unknown) {
  const s = verifyString(obj);
  if (s.match(/^[a-z][a-zA-Z0-9_]*$/) === null) {
    throw new Error(`Invalid property identifier: ${JSON.stringify(obj)}`);
  }
  return s;
}

export function parseAnnotationPropertyType(obj: unknown) {
  verifyString(obj);
  if (
    !Object.prototype.hasOwnProperty.call(annotationPropertyTypeHandlers, obj)
  ) {
    throw new Error("Unsupported property type: $JSON.stringify(obj)}");
  }
  return obj as AnnotationPropertySpec["type"];
}

export function ensureUniqueAnnotationPropertyIds(
  properties: AnnotationPropertySpec[],
) {
  const ids = new Set<string>();
  for (const p of properties) {
    if (ids.has(p.identifier)) {
      throw new Error(`Duplicate property identifier: ${p.identifier}`);
    }
    ids.add(p.identifier);
  }
}

function parseAnnotationPropertySpec(obj: unknown): AnnotationPropertySpec {
  verifyObject(obj);
  const identifier = verifyObjectProperty(obj, "id", parseAnnotationPropertyId);
  const type = verifyObjectProperty(obj, "type", parseAnnotationPropertyType);
  const description = verifyOptionalObjectProperty(
    obj,
    "description",
    verifyString,
  );
  const defaultValue = verifyOptionalObjectProperty(
    obj,
    "default",
    (x) => annotationPropertyTypeHandlers[type].deserializeJson(x),
    0,
  );
  let enumValues: number[] | undefined;
  let enumLabels: string[] | undefined;
  switch (type) {
    case "rgb":
    case "rgba":
      break;
    default: {
      const dataType: DataType = DataType[type.toUpperCase() as any] as any;
      enumValues = verifyOptionalObjectProperty(
        obj,
        "enum_values",
        (valuesObj) =>
          parseArray(
            valuesObj,
            (x) => parseDataTypeValue(dataType, x) as number,
          ),
      );
      if (enumValues !== undefined) {
        enumLabels = verifyObjectProperty(obj, "enum_labels", (labelsObj) =>
          parseFixedLengthArray(
            new Array<string>(enumValues!.length),
            labelsObj,
            verifyString,
          ),
        );
      }
    }
  }
  return {
    type,
    identifier,
    description,
    default: defaultValue,
    enumValues,
    enumLabels,
  } as AnnotationPropertySpec;
}

function annotationPropertySpecToJson(spec: AnnotationPropertySpec) {
  const defaultValue = spec.default;
  const handler = annotationPropertyTypeHandlers[spec.type];
  const isNumeric = isAnnotationNumericPropertySpec(spec);
  const enumValues =
    isNumeric && spec.enumValues
      ? spec.enumValues.map(handler.serializeJson)
      : undefined;
  const enumLabels = isNumeric ? spec.enumLabels : undefined;
  return {
    id: spec.identifier,
    description: spec.description,
    type: spec.type,
    default:
      defaultValue === 0 ? undefined : handler.serializeJson(defaultValue),
    enum_labels: enumLabels,
    enum_values: enumValues,
  };
}

export function annotationPropertySpecsToJson(
  specs: AnnotationPropertySpec[] | undefined,
) {
  if (specs === undefined || specs.length === 0) return undefined;
  return specs.map(annotationPropertySpecToJson);
}

export function parseAnnotationPropertySpecs(obj: unknown) {
  if (obj === undefined) return [];
  const properties = parseArray(obj, parseAnnotationPropertySpec);
  ensureUniqueAnnotationPropertyIds(properties);
  return properties;
}

export interface AnnotationBase {
  /**
   * If equal to `undefined`, then the description is unknown (possibly still being loaded).  If
   * equal to `null`, then there is no description.
   */
  description?: string | undefined | null;

  id: AnnotationId;
  type: AnnotationType;

  relatedSegments?: BigUint64Array[];
  properties: any[];
  /* BRAINSHARE STARTS */
  parentAnnotationId?: string;
  // childrenVisible?: boolean;
  childAnnotationIds?: string[];
  sessionID?: number;
  /* BRAINSHARE ENDS */
}

export interface Line extends AnnotationBase {
  pointA: Float32Array;
  pointB: Float32Array;
  type: AnnotationType.LINE;
}

export interface Point extends AnnotationBase {
  point: Float32Array;
  type: AnnotationType.POINT;
}

export interface AxisAlignedBoundingBox extends AnnotationBase {
  pointA: Float32Array;
  pointB: Float32Array;
  type: AnnotationType.AXIS_ALIGNED_BOUNDING_BOX;
}

export interface Ellipsoid extends AnnotationBase {
  center: Float32Array;
  radii: Float32Array;
  type: AnnotationType.ELLIPSOID;
}

/* BRAINSHARE STARTS */
//export type Annotation = Line | Point | AxisAlignedBoundingBox | Ellipsoid;
export type Annotation = Line | Point | AxisAlignedBoundingBox | Ellipsoid | Polygon | Volume | Cloud;
/* BRAINSHARE ENDS */

export interface AnnotationTypeHandler<T extends Annotation = Annotation> {
  icon: string;
  description: string;
  toJSON: (annotation: T, rank: number) => any;
  restoreState: (annotation: T, obj: any, rank: number) => void;
  serializedBytes: (rank: number) => number;
  serialize: (
    buffer: DataView,
    offset: number,
    isLittleEndian: boolean,
    rank: number,
    annotation: T,
  ) => void;
  deserialize: (
    buffer: DataView,
    offset: number,
    isLittleEndian: boolean,
    rank: number,
    id: string,
  ) => T;
  visitGeometry: (
    annotation: T,
    callback: (vec: Float32Array, isVector: boolean) => void,
  ) => void;
}

function serializeFloatVector(
  buffer: DataView,
  offset: number,
  isLittleEndian: boolean,
  rank: number,
  vec: Float32Array,
) {
  for (let i = 0; i < rank; ++i) {
    buffer.setFloat32(offset, vec[i], isLittleEndian);
    offset += 4;
  }
  return offset;
}

function serializeTwoFloatVectors(
  buffer: DataView,
  offset: number,
  isLittleEndian: boolean,
  rank: number,
  vecA: Float32Array,
  vecB: Float32Array,
) {
  offset = serializeFloatVector(buffer, offset, isLittleEndian, rank, vecA);
  offset = serializeFloatVector(buffer, offset, isLittleEndian, rank, vecB);
  return offset;
}

function deserializeFloatVector(
  buffer: DataView,
  offset: number,
  isLittleEndian: boolean,
  rank: number,
  vec: Float32Array,
) {
  for (let i = 0; i < rank; ++i) {
    vec[i] = buffer.getFloat32(offset, isLittleEndian);
    offset += 4;
  }
  return offset;
}

function deserializeTwoFloatVectors(
  buffer: DataView,
  offset: number,
  isLittleEndian: boolean,
  rank: number,
  vecA: Float32Array,
  vecB: Float32Array,
) {
  offset = deserializeFloatVector(buffer, offset, isLittleEndian, rank, vecA);
  offset = deserializeFloatVector(buffer, offset, isLittleEndian, rank, vecB);
  return offset;
}

export const annotationTypeHandlers: Record<
  AnnotationType,
  AnnotationTypeHandler
> = {
  [AnnotationType.LINE]: {
    icon: "ꕹ",
    description: "Line",
    toJSON(annotation: Line) {
      return {
        pointA: Array.from(annotation.pointA),
        pointB: Array.from(annotation.pointB),
      };
    },
    restoreState(annotation: Line, obj: any, rank: number) {
      annotation.pointA = verifyObjectProperty(obj, "pointA", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
      annotation.pointB = verifyObjectProperty(obj, "pointB", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
    },
    serializedBytes(rank: number) {
      return 2 * 4 * rank;
    },
    serialize(
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      annotation: Line
    ) {
      serializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        annotation.pointA,
        annotation.pointB
      );
    },
    deserialize: (
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      id: string
    ): Line => {
      const pointA = new Float32Array(rank);
      const pointB = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        pointA,
        pointB
      );
      return { type: AnnotationType.LINE, pointA, pointB, id, properties: [] };
    },
    visitGeometry(annotation: Line, callback) {
      callback(annotation.pointA, false);
      callback(annotation.pointB, false);
    },
  },
  [AnnotationType.POINT]: {
    icon: "⚬",
    description: "Point",
    toJSON: (annotation: Point) => {
      return {
        point: Array.from(annotation.point),
      };
    },
    restoreState: (annotation: Point, obj: any, rank: number) => {
      annotation.point = verifyObjectProperty(obj, "point", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
    },
    serializedBytes: (rank) => rank * 4,
    serialize: (
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      annotation: Point
    ) => {
      serializeFloatVector(
        buffer,
        offset,
        isLittleEndian,
        rank,
        annotation.point
      );
    },
    deserialize: (
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      id: string
    ): Point => {
      const point = new Float32Array(rank);
      deserializeFloatVector(buffer, offset, isLittleEndian, rank, point);
      return { type: AnnotationType.POINT, point, id, properties: [] };
    },
    visitGeometry(annotation: Point, callback) {
      callback(annotation.point, false);
    },
  },
  [AnnotationType.AXIS_ALIGNED_BOUNDING_BOX]: {
    icon: "❑",
    description: "Bounding Box",
    toJSON: (annotation: AxisAlignedBoundingBox) => {
      return {
        pointA: Array.from(annotation.pointA),
        pointB: Array.from(annotation.pointB),
      };
    },
    restoreState: (
      annotation: AxisAlignedBoundingBox,
      obj: any,
      rank: number
    ) => {
      annotation.pointA = verifyObjectProperty(obj, "pointA", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
      annotation.pointB = verifyObjectProperty(obj, "pointB", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
    },
    serializedBytes: (rank) => 2 * 4 * rank,
    serialize(
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      annotation: AxisAlignedBoundingBox
    ) {
      serializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        annotation.pointA,
        annotation.pointB
      );
    },
    deserialize: (
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      id: string
    ): AxisAlignedBoundingBox => {
      const pointA = new Float32Array(rank);
      const pointB = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        pointA,
        pointB
      );
      return {
        type: AnnotationType.AXIS_ALIGNED_BOUNDING_BOX,
        pointA,
        pointB,
        id,
        properties: [],
      };
    },
    visitGeometry(annotation: AxisAlignedBoundingBox, callback) {
      callback(annotation.pointA, false);
      callback(annotation.pointB, false);
    },
  },
  [AnnotationType.ELLIPSOID]: {
    icon: "◎",
    description: "Ellipsoid",
    toJSON: (annotation: Ellipsoid) => {
      return {
        center: Array.from(annotation.center),
        radii: Array.from(annotation.radii),
      };
    },
    restoreState: (annotation: Ellipsoid, obj: any, rank: number) => {
      annotation.center = verifyObjectProperty(obj, "center", (x) => parseFixedLengthArray(new Float32Array(rank), x, verifyFiniteFloat)
      );
      annotation.radii = verifyObjectProperty(obj, "radii", (x) => parseFixedLengthArray(
        new Float32Array(rank),
        x,
        verifyFiniteNonNegativeFloat
      )
      );
    },
    serializedBytes: (rank) => 2 * 4 * rank,
    serialize(
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      annotation: Ellipsoid
    ) {
      serializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        annotation.center,
        annotation.radii
      );
    },
    deserialize: (
      buffer: DataView,
      offset: number,
      isLittleEndian: boolean,
      rank: number,
      id: string
    ): Ellipsoid => {
      const center = new Float32Array(rank);
      const radii = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        center,
        radii
      );
      return {
        type: AnnotationType.ELLIPSOID,
        center,
        radii,
        id,
        properties: [],
      };
    },
    visitGeometry(annotation: Ellipsoid, callback) {
      callback(annotation.center, false);
      callback(annotation.radii, true);
    },
  },
    /* BRAINSHARE STARTS */
  // Main parts for adding polygon, volume, cloud
  [AnnotationType.POLYGON]: {
    icon: "△",
    description: "Polygon",
    toJSON: (annotation: Polygon) => {
      return {
        source: Array.from(annotation.source),
        centroid: Array.from(annotation.centroid),
        childAnnotationIds: annotation.childAnnotationIds,
        childrenVisible: annotation.childrenVisible,
      }
    },
    restoreState: (annotation: Polygon, obj: any, rank: number) => {
      annotation.source = verifyObjectProperty(
        obj, "source", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.centroid = verifyObjectProperty(
        obj, "centroid", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.childAnnotationIds = [];
      if (obj.hasOwnProperty("childAnnotationIds")) {
        annotation.childAnnotationIds = verifyObjectProperty(
          obj, "childAnnotationIds", verifyStringArray
        );
      }
      annotation.childrenVisible = true;
      if (obj.hasOwnProperty("childrenVisible")) {
        const value = verifyObjectProperty(
          obj, "childrenVisible", verifyBoolean
        );
        annotation.childrenVisible = value;
      }
    },
    serializedBytes: (rank) => 2 * 4 * rank,
    serialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      annotation: Polygon
    ) => {
      serializeTwoFloatVectors(
        buffer, 
        offset, 
        isLittleEndian, 
        rank, 
        annotation.source,
        annotation.centroid,
      );
    },
    deserialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      id: string
    ): Polygon => {
      const source = new Float32Array(rank);
      const centroid = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        source,
        centroid,
      );
      return {
        type: AnnotationType.POLYGON, 
        source, 
        centroid,
        id, 
        properties: [], 
        childAnnotationIds: [], 
        childrenVisible: false
      };
    },
    visitGeometry(annotation: Polygon, callback) {
      callback(annotation.centroid, false);
    },
  },
  [AnnotationType.VOLUME]: {
    icon: "▣",
    description: "Volume",
    toJSON: (annotation: Volume) => {
      return {
        source: Array.from(annotation.source),
        centroid: Array.from(annotation.centroid),
        childAnnotationIds: annotation.childAnnotationIds,
        childrenVisible: annotation.childrenVisible,
      }
    },
    restoreState: (annotation: Volume, obj: any, rank: number) => {
      annotation.source = verifyObjectProperty(
        obj, "source", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.centroid = verifyObjectProperty(
        obj, "centroid", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.childAnnotationIds = [];
      if (obj.hasOwnProperty("childAnnotationIds")) {
        annotation.childAnnotationIds = verifyObjectProperty(
          obj, "childAnnotationIds", verifyStringArray
        );
      }
      annotation.childrenVisible = true;
      if (obj.hasOwnProperty("childrenVisible")) {
        const value = verifyObjectProperty(
          obj, "childrenVisible", verifyBoolean
        );
        annotation.childrenVisible = value;
      }
    },
    serializedBytes: (rank) => 2 * 4 * rank,
    serialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      annotation: Volume
    ) => {
      serializeTwoFloatVectors(
        buffer, 
        offset, 
        isLittleEndian, 
        rank, 
        annotation.source,
        annotation.centroid,
      );
    },
    deserialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      id: string
    ): Volume => {
      const source = new Float32Array(rank);
      const centroid = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        source,
        centroid,
      );
      return {
        type: AnnotationType.VOLUME, 
        source, 
        centroid,
        id, 
        properties: [], 
        childAnnotationIds: [], 
        childrenVisible: false
      };
    },
    visitGeometry(annotation: Volume, callback) {
      callback(annotation.centroid, false);
    },
  },
  [AnnotationType.CLOUD]: {
    icon: "☁",
    description: "Cloud",
    toJSON: (annotation: Cloud) => {
      return {
        source: Array.from(annotation.source),
        centroid: Array.from(annotation.centroid),
        childAnnotationIds: annotation.childAnnotationIds,
        childrenVisible: annotation.childrenVisible,
      }
    },
    restoreState: (annotation: Cloud, obj: any, rank: number) => {
      annotation.source = verifyObjectProperty(
        obj, "source", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.centroid = verifyObjectProperty(
        obj, "centroid", x => parseFixedLengthArray(
          new Float32Array(rank), x, verifyFiniteFloat
        )
      );
      annotation.childAnnotationIds = [];
      if (obj.hasOwnProperty("childAnnotationIds")) {
        annotation.childAnnotationIds = verifyObjectProperty(
          obj, "childAnnotationIds", verifyStringArray
        );
      }
      annotation.childrenVisible = true;
      if (obj.hasOwnProperty("childrenVisible")) {
        const value = verifyObjectProperty(
          obj, "childrenVisible", verifyBoolean
        );
        annotation.childrenVisible = value;
      }
    },
    serializedBytes: (rank) => 2 * 4 * rank,
    serialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      annotation: Cloud
    ) => {
      serializeTwoFloatVectors(
        buffer, 
        offset, 
        isLittleEndian, 
        rank, 
        annotation.source,
        annotation.centroid,
      );
    },
    deserialize: (
      buffer: DataView, 
      offset: number, 
      isLittleEndian: boolean, 
      rank: number, 
      id: string
    ): Cloud => {
      const source = new Float32Array(rank);
      const centroid = new Float32Array(rank);
      deserializeTwoFloatVectors(
        buffer,
        offset,
        isLittleEndian,
        rank,
        source,
        centroid,
      );
      return {
        type: AnnotationType.CLOUD, 
        source, 
        centroid,
        id, 
        properties: [], 
        childAnnotationIds: [], 
        childrenVisible: false
      };
    },
    visitGeometry(annotation: Cloud, callback) {
      callback(annotation.centroid, false);
    },
  },
  /* BRAINSHARE ENDS */

  
};

export interface AnnotationSchema {
  rank: number;
  relationships: readonly string[];
  properties: readonly AnnotationPropertySpec[];
}

export function annotationToJson(
  annotation: Annotation,
  schema: AnnotationSchema,
) {
  const result = annotationTypeHandlers[annotation.type].toJSON(
    annotation,
    schema.rank,
  );
  result.type = AnnotationType[annotation.type].toLowerCase();
  result.id = annotation.id;
  result.description = annotation.description || undefined;
  const { relatedSegments } = annotation;
  if (relatedSegments?.some((x) => x.length !== 0)) {
    result.segments = relatedSegments.map((segments) =>
      Array.from(segments, (x) => x.toString()),
    );
  }
  if (schema.properties.length !== 0) {
    const propertySpecs = schema.properties;
    result.props = annotation.properties.map((prop, i) =>
      annotationPropertyTypeHandlers[propertySpecs[i].type].serializeJson(prop),
    );
  }
  return result;
}

function restoreAnnotation(
  obj: any,
  schema: AnnotationSchema,
  allowMissingId = false,
): Annotation {
  verifyObject(obj);
  const type = verifyObjectProperty(obj, "type", (x) =>
    verifyEnumString(x, AnnotationType),
  );
  const id =
    verifyObjectProperty(
      obj,
      "id",
      allowMissingId ? verifyOptionalString : verifyString,
    ) || makeAnnotationId();
  const relatedSegments = verifyObjectProperty(obj, "segments", (relObj) => {
    if (relObj === undefined) {
      return schema.relationships.map(() => []);
    }
    const a = expectArray(relObj);
    if (a.length === 0) {
      return schema.relationships.map(() => []);
    }
    if (schema.relationships.length === 1 && !Array.isArray(a[0])) {
      return [
        parseFixedLengthArray(new BigUint64Array(a.length), a, parseUint64),
      ];
    }
    return parseArray(
      expectArray(relObj, schema.relationships.length),
      (segments) => {
        segments = expectArray(segments);
        return parseFixedLengthArray(
          new BigUint64Array(segments.length),
          segments,
          parseUint64,
        );
      },
    );
  });
  const properties = verifyObjectProperty(obj, "props", (propsObj) => {
    const propSpecs = schema.properties;
    if (propsObj === undefined) return propSpecs.map((x) => x.default);
    return parseArray(expectArray(propsObj, schema.properties.length), (x, i) =>
      annotationPropertyTypeHandlers[propSpecs[i].type].deserializeJson(x),
    );
  });
  const result: Annotation = {
    id,
    description: verifyObjectProperty(obj, "description", verifyOptionalString),
    relatedSegments,
    properties,
    type,
  } as Annotation;
  annotationTypeHandlers[type].restoreState(result, obj, schema.rank);
  return result;
}

export interface AnnotationSourceSignals {
  changed: NullarySignal;
  childAdded: Signal<(annotation: Annotation) => void>;
  childUpdated: Signal<(annotation: Annotation) => void>;
  childCommitted: Signal<(annotationId: string) => void>;
  childDeleted: Signal<(annotationId: string) => void>;
}

export class AnnotationSource
  extends RefCounted
  implements AnnotationSourceSignals
{
  protected annotationMap = new Map<AnnotationId, Annotation>();
  changed = new NullarySignal();
  readonly = false;
  childAdded = new Signal<(annotation: Annotation) => void>();
  childUpdated = new Signal<(annotation: Annotation) => void>();
  childCommitted = new Signal<(annotationId: string) => void>();
  childDeleted = new Signal<(annotationId: string) => void>();

  public pending = new Set<AnnotationId>();

  protected rank_: number;

  get rank() {
    return this.rank_;
  }

  annotationPropertySerializers: AnnotationPropertySerializer[];

  constructor(
    rank: number,
    public readonly relationships: readonly string[] = [],
    public readonly properties: Readonly<AnnotationPropertySpec>[] = [],
  ) {
    super();
    this.rank_ = rank;
    this.annotationPropertySerializers = makeAnnotationPropertySerializers(
      rank,
      properties,
    );
  }

  hasNonSerializedProperties() {
    return true;
  }

    /* BRAINSHARE STARTS */
  add(annotation: Annotation, commit = true, parentRef?: AnnotationReference, index?: number): AnnotationReference {
    this.ensureUpdated();
    annotation = this.roundZCoordinateBasedOnAnnotation(annotation);
    if (!annotation.id) {
      annotation.id = makeAnnotationId();
    } else if (this.annotationMap.has(annotation.id)) {
      throw new Error(
        `Annotation id already exists: ${JSON.stringify(annotation.id)}.`,
      );
    }

    // Set parent Id
    if (parentRef && isTypeCollection(parentRef.value!)) {
      annotation.parentAnnotationId = parentRef.id;
    }

    this.annotationMap.set(annotation.id, annotation);
    if (!commit) {
      this.pending.add(annotation.id);
    }
    this.changed.dispatch();
    this.childAdded.dispatch(annotation);
    if (commit) {
      this.childCommitted.dispatch(annotation.id);
    }
    if (parentRef && isTypeCollection(parentRef.value!)) {
      const parAnnotation = <Collection> parentRef.value!;
      if (index === undefined) index = parAnnotation.childAnnotationIds.length;
      parAnnotation.childAnnotationIds.splice(index, 0, annotation.id);
      this.updateCollectionSource(parAnnotation);
      this.updateCollectionCentroid(parAnnotation);
      this.update(parentRef, <Annotation>parAnnotation);
    }
    return this.getReference(annotation.id);
  }
    /* BRAINSHARE ENDS */

  /*
  add(annotation: Annotation, commit = true): AnnotationReference {
    this.ensureUpdated();
    if (!annotation.id) {
      annotation.id = makeAnnotationId();
    } else if (this.annotationMap.has(annotation.id)) {
      throw new Error(
        `Annotation id already exists: ${JSON.stringify(annotation.id)}.`,
      );
    }
    this.annotationMap.set(annotation.id, annotation);
    if (!commit) {
      this.pending.add(annotation.id);
    }
    this.changed.dispatch();
    this.childAdded.dispatch(annotation);
    if (commit) {
      this.childCommitted.dispatch(annotation.id);
    }
    return this.getReference(annotation.id);
  }
  */

  commit(reference: AnnotationReference): void {
    this.ensureUpdated();
    const id = reference.id;
    this.pending.delete(id);
    /* BRAINSHARE STARTS */
    if(reference.value!.type == AnnotationType.POLYGON) {
      const ann = <Polygon> reference.value!;
      ann.childAnnotationIds.forEach((childAnnotationId) => {
        this.pending.delete(childAnnotationId);
      });
    }
    /* BRAINSHARE ENDS */

    this.changed.dispatch();
    this.childCommitted.dispatch(id);
  }

  update(reference: AnnotationReference, annotation: Annotation) {
    this.ensureUpdated();
    if (reference.value === null) {
      throw new Error("Annotation already deleted.");
    }
    /* BRAINSHARE STARTS */
    annotation = this.roundZCoordinateBasedOnAnnotation(annotation);
    /* BRAINSHARE ENDS */
    reference.value = annotation;
    this.annotationMap.set(annotation.id, annotation);
    /* BRAINSHARE STARTS */
    // Update parent annotation
    if (annotation.parentAnnotationId) {
      const parentRef = this.getReference(annotation.parentAnnotationId);
      if (parentRef.value && isTypeCollection(parentRef.value)) {
        const parAnnotation = <Collection> parentRef.value;
        this.updateCollectionSource(parAnnotation);
        this.updateCollectionCentroid(parAnnotation);
        this.update(parentRef, <Annotation> parAnnotation);
      }
      parentRef.dispose();
    }
    /* BRAINSHARE ENDS */

    reference.changed.dispatch();
    this.changed.dispatch();
    this.childUpdated.dispatch(annotation);
  }

  [Symbol.iterator]() {
    this.ensureUpdated();
    return this.annotationMap.values();
  }

  get(id: AnnotationId) {
    this.ensureUpdated();
    return this.annotationMap.get(id);
  }

  delete(reference: AnnotationReference) {
    if (reference.value === null) {
      return;
    }
    /* BRAINSHARE STARTS */
    // Delete child annotations
    if(isTypeCollection(reference.value!)) {
      const annotation = <Collection>reference.value;
      const childAnnotationIds = Object.assign([], annotation.childAnnotationIds);
      childAnnotationIds.forEach((childId) => {
        this.delete(this.getReference(childId));
      });
    }

    // Update parent annotation
    if (reference.value!.parentAnnotationId) {
      const parentRef = this.getReference(reference.value!.parentAnnotationId);

      if (parentRef.value && isTypeCollection(parentRef.value)) {
        let parAnnotation = <Collection> parentRef.value;
        const index = parAnnotation.childAnnotationIds.indexOf(
          reference.value!.id, 0
        );
        if (index > -1) {
          parAnnotation.childAnnotationIds.splice(index, 1);
        }
        this.updateCollectionSource(parAnnotation);
        this.updateCollectionCentroid(parAnnotation);
        this.update(parentRef, <Annotation> parAnnotation);
      }
      parentRef.dispose();
    }
    /* BRAINSHARE ENDS */

    reference.value = null;
    this.annotationMap.delete(reference.id);
    this.pending.delete(reference.id);
    reference.changed.dispatch();
    this.changed.dispatch();
    this.childDeleted.dispatch(reference.id);
  }

  getReference(id: AnnotationId): AnnotationReference {
    let existing = this.references.get(id);
    if (existing !== undefined) {
      return existing.addRef();
    }
    existing = new AnnotationReference(id);
    existing.value = this.annotationMap.get(id) || null;
    this.references.set(id, existing);
    existing.registerDisposer(() => {
      this.references.delete(id);
    });
    return existing;
  }

  references = new Map<AnnotationId, Borrowed<AnnotationReference>>();

  protected ensureUpdated() {}

  toJSON() {
    this.ensureUpdated();
    const result: any[] = [];
    const { pending } = this;
    for (const annotation of this) {
      if (pending.has(annotation.id)) {
        // Don't serialize uncommitted annotations.
        continue;
      }
      result.push(annotationToJson(annotation, this));
    }
    return result;
  }

  clear() {
    this.annotationMap.clear();
    this.pending.clear();
    this.changed.dispatch();
  }

  restoreState(obj: any) {
    this.ensureUpdated();
    const { annotationMap } = this;
    annotationMap.clear();
    this.pending.clear();
    if (obj !== undefined) {
      parseArray(obj, (x) => {
        const annotation = restoreAnnotation(x, this);
        annotationMap.set(annotation.id, annotation);
      });
    }
    for (const reference of this.references.values()) {
      const { id } = reference;
      const value = annotationMap.get(id);
      reference.value = value || null;
      reference.changed.dispatch();
    }
    this.changed.dispatch();
  }

  reset() {
    this.clear();
  }


  /* BRAINSHARE STARTS */
  roundZCoordinateBasedOnAnnotation(ann: Annotation): Annotation {
    switch (ann.type) {
      case AnnotationType.LINE:
        return {
          ...ann, 
          pointA: this.roundZCoordinate(ann.pointA), 
          pointB: this.roundZCoordinate(ann.pointB)
        };
      case AnnotationType.POINT:
        return {...ann, point: this.roundZCoordinate(ann.point)};
      case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
        return {
          ...ann, 
          pointA: this.roundZCoordinate(ann.pointA), 
          pointB: this.roundZCoordinate(ann.pointB)
        };
      case AnnotationType.ELLIPSOID:
        return {...ann, center: this.roundZCoordinate(ann.center)};
      case AnnotationType.POLYGON:
        return {...ann, source: this.roundZCoordinate(ann.source)};
      //TODO case AnnotationType.VOLUME:
      //  return {...ann, source: this.roundZCoordinate(ann.source)};
    }
    return ann;
  }

  /**
   * Takes a point (x,y,z) coordinate as input and assigns the z value to 
   * integral part of z + 0.5
   * This is required for fixing the bug: 
   * https://github.com/ActiveBrainAtlas2/activebrainatlasadmin/issues/130
   * @param point Input point to be rounded off
   * @returns Rounded point
   */
  roundZCoordinate(point: Float32Array): Float32Array {
    if (point.length == 3) {
      point[2] = Math.floor(point[2]) + 0.5;
    } else if (point.length == 4) {
      point[3] = Math.floor(point[3]) + 0.5;
    }
    return point;
  }

  /**
   * Takes an annotation id as input and returns the parent if the annotation 
   * type is line and parent is polygon.
   * @param id annotation id
   * @returns Returns parent annotation id if annotation type is line otherwise 
   * returns the current id.
   */
  getNonDummyAnnotationReference(id: AnnotationId): AnnotationReference {
    const reference = this.getReference(id);
    if (!reference.value) return reference;

    const annotation = reference.value;
    if (annotation.parentAnnotationId) {
      const parentRef = this.getReference(annotation.parentAnnotationId);
      if (parentRef.value && isChildDummyAnnotation(parentRef.value)) {
        reference.dispose();
        parentRef.dispose();
        return this.getNonDummyAnnotationReference(annotation.parentAnnotationId);
      }
      parentRef.dispose();
    }
    
    return reference;
  }

  /**
   * Takes an annotation id as input and finds the top most ancestor of it.
   * @param id annotation id input
   * @returns Reference to the top most ancestor of it.
   */
  getTopMostAnnotationReference(id: AnnotationId): AnnotationReference {
    const reference = this.getReference(id);
    if (!reference.value) return reference;

    const annotation = reference.value;
    if (annotation.parentAnnotationId) {
      const parentId = annotation.parentAnnotationId;
      reference.dispose();
      return this.getTopMostAnnotationReference(parentId);
    }
    
    return reference;
  }

  updateCollectionSource(annotation: Collection): void {
    if (annotation.childAnnotationIds.length === 0) return;
    const reference = this.getReference(annotation.childAnnotationIds[0]);

    if (!annotation.source) return;
    if (annotation.type === AnnotationType.POLYGON) {
      const line = <Line>reference.value;
      if (!line) {
        reference.dispose();
        return;
      }
      annotation.source = line.pointA;
    } 
    /*TODO
    else if (annotation.type === AnnotationType.VOLUME) {
      const polygon = <Polygon>reference.value;
      if (!polygon) {
        reference.dispose();
        return;
      }
      annotation.source = polygon.source;
    }
    */
    else if (annotation.type === AnnotationType.CLOUD) {
      const point = <Point>reference.value;
      if (!point) {
        reference.dispose();
        return;
      }
      annotation.source = point.point;
    }
    else {
      return;
    }
    reference.dispose();
  }

  updateCollectionCentroid(annotation: Collection): void {
    if (annotation.childAnnotationIds.length === 0) return;
    const childRefs = annotation.childAnnotationIds.map(
      (childId) => this.getReference(childId)
    )
    
    if (!annotation.centroid) return;
    const rank = annotation.centroid.length;
    if (annotation.type === AnnotationType.POLYGON) {
      const centroid = new Float32Array(rank);
      childRefs.forEach((childRef) => {
        const line = <Line>childRef.value;
        for (let i = 0; i < rank; i++) {
          centroid[i] += line.pointA[i];
        }
      });
      for (let i = 0; i < rank; i++) centroid[i] /= childRefs.length;
      annotation.centroid = centroid;
    }
    /*TODO
    else if (annotation.type === AnnotationType.VOLUME) {
      const centroids = childRefs.map(
        childRef => (<Polygon>childRef.value).centroid
      );
      centroids.sort((a, b) => {
        const z0 = getZCoordinate(a);
        const z1 = getZCoordinate(b);
        if (z0 == undefined) return -1;
        if (z1 == undefined) return 1;
        return z1 - z0;
      });
      annotation.centroid = centroids[Math.floor(centroids.length / 2)]
    }
      */

    else if (annotation.type === AnnotationType.CLOUD) {
      const centroid = new Float32Array(rank);
      
      const points: Float32Array[] = [];
      childRefs.forEach((childRef) => {
        const point = <Point>childRef.value;
        points.push(point.point);
        for (let i = 0; i < rank; i++) {
          centroid[i] += point.point[i];
        }
      });
      for (let i = 0; i < rank; i++) centroid[i] /= childRefs.length;
      
      let minDist = Infinity;
      let center = centroid;
      for (let i = 0; i < points.length; i++) {
        let dist = 0;
        for (let j = 0; j < rank; j++) {
          dist += Math.abs(points[i][j] - centroid[j]);
        }
        if (dist < minDist) {
          center = new Float32Array(points[i]); // Copy to ensure correct buffer type
          minDist = dist;
        }
      }
      annotation.centroid = center;
    }
    else {
      return;
    }
  }

  /**
   * Update the source vertex if child's source vertex gets updated.
   * @param annotation Annotation which needs to be updated.
   * @returns a new annotation with updated source vertex.
   */
  getUpdatedSourceVertex(annotation: Collection): Collection {
    if (annotation.childAnnotationIds.length === 0) return annotation;
    const reference = this.getReference(annotation.childAnnotationIds[0]);
    if (annotation.type === AnnotationType.POLYGON) {
      const line = <Line> reference.value;
      if (!line) {
        reference.dispose();
        return annotation;
      }
      const newAnn = {...annotation, source: line.pointA};
      return newAnn;
    } 
    else {
      const polygon = <Polygon>reference.value;
      if (!polygon) {
        reference.dispose();
        return annotation;
      }
      const newAnn = {...annotation, source: polygon.source};
      return newAnn;
    }
    reference.dispose();
  }

  /**
   * Takes a annotation reference and update the color of that annotation.
   * @param reference 
   * @param color 
   * @returns void
   */
  updateColor(reference: AnnotationReference, color: number) {
    if (!reference.value) return;
    const newAnn = {...reference.value};
    const colorIdx = this.properties.findIndex(x => x.identifier === "color");
    if (newAnn.properties.length <= colorIdx) return;
    newAnn.properties[colorIdx] = color;
    this.update(reference, newAnn);

    if (isTypeCollection(newAnn)) {
      const collection = <Collection>newAnn;
      for (let i = 0; i < collection.childAnnotationIds.length; i++) {
        const childRef = this.getReference(collection.childAnnotationIds[i]);
        this.updateColor(childRef, color);
        childRef.dispose();
      }
    }
  }

  /**
   * Takes a annotation reference and update the visibility of that annotation.
   * @param reference 
   * @param visibility 
   * @returns void
   */
   updateVisibility(reference: AnnotationReference, visibility: number) {
    if (!reference.value) return;
    const newAnn = {...reference.value};
    const visibilityIdx = this.properties.findIndex(
      x => x.identifier === "visibility"
    );
    if (newAnn.properties.length <= visibilityIdx) return;
    newAnn.properties[visibilityIdx] = visibility;
    this.update(reference, newAnn);

    if (isTypeCollection(newAnn)) {
      const collection = <Collection>newAnn;
      for (let i = 0; i < collection.childAnnotationIds.length; i++) {
        const childRef = this.getReference(collection.childAnnotationIds[i]);
        this.updateVisibility(childRef, visibility);
        childRef.dispose();
      }
    }
  }

  /**
   * Takes a annotation reference and update a property of that annotation.
   * @param reference 
   * @param visibility 
   * @returns void
   */
  updateProperty(reference: AnnotationReference, id: string, value: number) {
    if (!reference.value) return;
    const newAnn = {...reference.value};
    const propertyIndex = this.properties.findIndex(
      x => x.identifier === id
    );
    if (newAnn.properties.length <= propertyIndex) return;
    newAnn.properties[propertyIndex] = value;
    this.update(reference, newAnn);

    if (isTypeCollection(newAnn)) {
      const collection = <Collection> newAnn;
      for (let i = 0; i < collection.childAnnotationIds.length; i++) {
        const childRef = this.getReference(collection.childAnnotationIds[i]);
        this.updateProperty(childRef, id, value);
        childRef.dispose();
      }
    }
  }

  /**
   * Takes a annotation id and finds the visibility of that annotation.
   * @param annotationId 
   * @returns void
   */
   getVisibility(annotationId: string): number {
    const reference = this.getReference(annotationId);
    if (!reference.value) {
      reference.dispose();
      return 1.0;
    }
    const ann = reference.value;
    const visibilityIdx = this.properties.findIndex(
      x => x.identifier === "visibility"
    );
    if (ann.properties.length <= visibilityIdx) {
      reference.dispose();
      return 1.0;
    }
    return ann.properties[visibilityIdx];
  }

  /**
   * Takes the annotation reference and updates its description with new string.
   * @param reference 
   * @param description 
   * @returns 
   */
  updateDescription(reference: AnnotationReference, description: string|undefined) {
    if (!reference.value) return;
    const newAnn = {...reference.value, description};
    this.update(reference, newAnn);
  }

  /**
   * Makes sure that all descendants under this annotation which need to be visible
   * added to the annotations tab.
   * @param annotationId annotation id of the input annotation
   * @param visible if the current annotation is visible or not, default is false.
   * @returns void
   */
  private getAllAnnsUnderRootToDisplay(
    annotationId: AnnotationId, 
    visible: boolean = false
  ) : void {
    const reference = this.getReference(annotationId);
    if (!reference.value) {
      reference.dispose();
      return;
    }
    let annotation : Annotation | undefined;
    annotation = reference.value;
    if (visible) {
      this.childAdded.dispatch(annotation);
    }
    if (isTypeCollection(annotation)) {
      const collection = <Collection>annotation;
      for (
        let i = 0; 
        annotation && i < collection.childAnnotationIds!.length; 
        i++
      ) {
        this.getAllAnnsUnderRootToDisplay(
          collection.childAnnotationIds[i], 
          collection.childrenVisible);
      }
    }
    reference.dispose();
    return;
  }
  /**
   * Make all ancestors of the current annotation to be visible 
   * in the annotations tab.
   * @param annotationId 
   * @returns void
   */
  makeAllParentsVisible(annotationId: AnnotationId) : void {
    const reference = this.getReference(annotationId);
    if (!reference.value) {
      reference.dispose();
      return;
    }
    const annotation = reference.value;
    if (annotation.parentAnnotationId) {
      this.makeAllParentsVisible(annotation.parentAnnotationId);
      const parentRef = this.getReference(annotation.parentAnnotationId);
      if (parentRef.value && isTypeCollection(parentRef.value)) {
        const newParentAnn = <Collection>{...parentRef.value};
        newParentAnn.childrenVisible = true;
        parentRef.value = <Annotation>newParentAnn;
        this.annotationMap.set(newParentAnn.id, <Annotation>newParentAnn);
        parentRef.changed.dispatch();
        for (let childId of newParentAnn.childAnnotationIds) {
          this.getAllAnnsUnderRootToDisplay(childId, true);
        }
      }
      parentRef.dispose();
    }
    reference.dispose();
  }
  /* BRAINSHARE ENDS */



}

export class LocalAnnotationSource extends AnnotationSource {
  private curCoordinateTransform: CoordinateSpaceTransform;

  get rank() {
    this.ensureUpdated();
    return this.rank_;
  }

  constructor(
    public watchableTransform: WatchableCoordinateSpaceTransform,
    properties: AnnotationPropertySpec[],
    relationships: string[],
  ) {
    super(watchableTransform.value.sourceRank, relationships, properties);
    this.curCoordinateTransform = watchableTransform.value;
    this.registerDisposer(
      watchableTransform.changed.add(() => this.ensureUpdated()),
    );
  }

  ensureUpdated() {
    const transform = this.watchableTransform.value;
    const { curCoordinateTransform } = this;
    if (transform === curCoordinateTransform) return;
    this.curCoordinateTransform = transform;
    const sourceRank = transform.sourceRank;
    const oldSourceRank = curCoordinateTransform.sourceRank;
    if (
      oldSourceRank === sourceRank &&
      (curCoordinateTransform.inputSpace === transform.inputSpace ||
        arraysEqual(
          curCoordinateTransform.inputSpace.ids.slice(0, sourceRank),
          transform.inputSpace.ids.slice(0, sourceRank),
        ))
    ) {
      return;
    }
    const { ids: newIds } = transform.inputSpace;
    const oldIds = curCoordinateTransform.inputSpace.ids;
    const newToOldDims: number[] = [];
    for (let newDim = 0; newDim < sourceRank; ++newDim) {
      let oldDim = oldIds.indexOf(newIds[newDim]);
      if (oldDim >= oldSourceRank) {
        oldDim = -1;
      }
      newToOldDims.push(oldDim);
    }
    const mapVector = (radii: Float32Array) => {
      const newRadii = new Float32Array(sourceRank);
      for (let i = 0; i < sourceRank; ++i) {
        const oldDim = newToOldDims[i];
        newRadii[i] = oldDim === -1 ? 0 : radii[i];
      }
      return newRadii;
    };

    for (const annotation of this.annotationMap.values()) {
      switch (annotation.type) {
        case AnnotationType.POINT:
          annotation.point = mapVector(annotation.point);
          break;
        case AnnotationType.LINE:
        case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
          annotation.pointA = mapVector(annotation.pointA);
          annotation.pointB = mapVector(annotation.pointB);
          break;
        case AnnotationType.ELLIPSOID:
          annotation.center = mapVector(annotation.center);
          annotation.radii = mapVector(annotation.radii);
          break;
      }
    }
    if (this.rank_ !== sourceRank) {
      this.rank_ = sourceRank;
      this.annotationPropertySerializers = makeAnnotationPropertySerializers(
        this.rank_,
        this.properties,
      );
    }
    this.changed.dispatch();
  }
}

export const DATA_BOUNDS_DESCRIPTION = "Data Bounds";

export function makeAnnotationId() {
  return getRandomHexString(160);
}

export function makeDataBoundsBoundingBoxAnnotation(
  box: BoundingBox,
): AxisAlignedBoundingBox {
  return {
    type: AnnotationType.AXIS_ALIGNED_BOUNDING_BOX,
    id: "data-bounds",
    description: DATA_BOUNDS_DESCRIPTION,
    pointA: new Float32Array(box.lowerBounds),
    pointB: new Float32Array(box.upperBounds),
    properties: [],
  };
}

export function makeDataBoundsBoundingBoxAnnotationSet(
  box: BoundingBox,
): AnnotationSource {
  const annotationSource = new AnnotationSource(box.lowerBounds.length);
  annotationSource.readonly = true;
  annotationSource.add(makeDataBoundsBoundingBoxAnnotation(box));
  return annotationSource;
}

export interface SerializedAnnotations {
  data: Uint8Array<ArrayBuffer>;
  typeToIds: string[][];
  typeToOffset: number[];
  typeToIdMaps: Map<string, number>[];
}

function serializeAnnotations(
  allAnnotations: Annotation[][],
  propertySerializers: AnnotationPropertySerializer[],
): SerializedAnnotations {
  let totalBytes = 0;
  const typeToOffset: number[] = [];
  for (const annotationType of annotationTypes) {
    const propertySerializer = propertySerializers[annotationType];
    const serializedPropertiesBytes = propertySerializer.serializedBytes;
    typeToOffset[annotationType] = totalBytes;
    const annotations: Annotation[] = allAnnotations[annotationType];
    const count = annotations.length;
    totalBytes += serializedPropertiesBytes * count;
  }
  const typeToIds: string[][] = [];
  const typeToIdMaps: Map<string, number>[] = [];
  const data = new ArrayBuffer(totalBytes);
  const dataView = new DataView(data);
  const isLittleEndian = ENDIANNESS === Endianness.LITTLE;
  for (const annotationType of annotationTypes) {
    const propertySerializer = propertySerializers[annotationType];
    const { rank } = propertySerializer;
    const serializeProperties = propertySerializer.serialize;
    const annotations: Annotation[] = allAnnotations[annotationType];
    typeToIds[annotationType] = annotations.map((x) => x.id);
    typeToIdMaps[annotationType] = new Map(
      annotations.map((x, i) => [x.id, i]),
    );
    const handler = annotationTypeHandlers[annotationType];
    const serialize = handler.serialize;
    const offset = typeToOffset[annotationType];
    const geometryDataStride = propertySerializer.propertyGroupBytes[0];
    for (let i = 0, count = annotations.length; i < count; ++i) {
      const annotation = annotations[i];
      serialize(
        dataView,
        offset + i * geometryDataStride,
        isLittleEndian,
        rank,
        annotation,
      );
      serializeProperties(
        dataView,
        offset,
        i,
        count,
        isLittleEndian,
        annotation.properties,
      );
    }
  }
  return { data: new Uint8Array(data), typeToIds, typeToOffset, typeToIdMaps };
}

export class AnnotationSerializer {
/* BRAINSHARE STARTS */
  /*
  annotations: [Point[], Line[], AxisAlignedBoundingBox[], Ellipsoid[]] = [
    [],
    [],
    [],
    [],
  ];
  */
  annotations: [
    Point[], 
    Line[], 
    AxisAlignedBoundingBox[], 
    Ellipsoid[], 
    Polygon[], 
    Volume[],
    Cloud[],
  ] = [
    [],
    [], 
    [], 
    [], 
    [], 
    [], 
    [],
  ];
  /* BRAINSHARE ENDS */  
  constructor(public propertySerializers: AnnotationPropertySerializer[]) {}
  add(annotation: Annotation) {
    (<Annotation[]>this.annotations[annotation.type]).push(annotation);
  }
  serialize(): SerializedAnnotations {
    return serializeAnnotations(this.annotations, this.propertySerializers);
  }
}

/* BRAINSHARE STARTS */
/**
 * Function takes an annotation and returns True if the type of annotation is 
 * collection otherwise false
 * @param annotation Input annotation
 * @returns boolean indicating whether the annotation is of type collection or 
 * not.
 */
export function isTypeCollection(annotation: Annotation) : boolean {
  return annotation.type === AnnotationType.POLYGON 
    || annotation.type === AnnotationType.VOLUME
    || annotation.type === AnnotationType.CLOUD
}

/**
 * Returns if the annotation's children are dummy annotation. (Ex: In case of 
 * polygon annotation, the line segments are dummy annotation.) 
 * @param annotation Input annotation element.
 * @returns boolean indicating if the child annotations are dummy or not.
 */
export function isChildDummyAnnotation(annotation: Annotation) : boolean {
  return annotation.type === AnnotationType.POLYGON;
}

/**
 * Returns if the annotation is dummy annotation. (Ex: In case of polygon 
 * annotation, the line segments are dummy annotation.) 
 * @param annotation Input annotation element.
 * @returns boolean indicating if the annotation is dummy or not.
 */
export function isDummyAnnotation(annotation: Annotation) : boolean {
  return annotation.type === AnnotationType.LINE && (
    annotation.parentAnnotationId !== null 
    || annotation.parentAnnotationId !== undefined
  );
}
/**
 * An interface to indicate a collection annotation.
 * Collection annotation contains child collection of annotations.
 * Eg: Polygon (group of line segments), Volume (group of polygons)
 */
export interface Collection extends AnnotationBase {
  source: Float32Array;
  centroid: Float32Array;
  childAnnotationIds: string[];
  childrenVisible: boolean;
}

/**
 * An interface to indicate Polygon annotation. Inherits collection interface.
 */
export interface Polygon extends Collection {
  type: AnnotationType.POLYGON;
}

/**
 * An interface to indicate Volume annotation. Inherits collection interface.
 */
export interface Volume extends Collection {
  type: AnnotationType.VOLUME;
}


export interface Cloud extends Collection {
  type: AnnotationType.CLOUD;
}
export function getSortPoint(ann: Annotation): Float32Array {
  switch (ann.type) {
    case AnnotationType.LINE:
      return ann.pointA;
    case AnnotationType.POINT:
      return ann.point;
    case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
      return ann.pointA;
    case AnnotationType.ELLIPSOID:
      return ann.center;
    case AnnotationType.POLYGON:
      return ann.source;
    case AnnotationType.VOLUME:
     return ann.source;
    case AnnotationType.CLOUD:
      return ann.source;
  }
}


export function portableJsonToAnnotations(
  obj: any,
  annotationSouce: AnnotationSource | MultiscaleAnnotationSource,
  inputCoordinateSpace: CoordinateSpace,
  parentId?: string,
): Annotation[] {
  const { scales, units } = inputCoordinateSpace;
  if (!units.every((unit) => unit === "m")) {
    return [];
  }

  const annotation = restoreAnnotation(obj, annotationSouce, true);
  const scaledAnnotation = annotationPointsMetersToPixels(annotation, scales);
  if (parentId) {
    scaledAnnotation.parentAnnotationId = parentId;
  }

  let annotations: Annotation[] = [scaledAnnotation];
  if (obj.hasOwnProperty("childJsons") && Array.isArray(obj.childJsons)) {
    if (!scaledAnnotation.childAnnotationIds) {
      scaledAnnotation.childAnnotationIds = [];
    }
    for (const childJson of obj.childJsons) {
      const subAnnotations = portableJsonToAnnotations(
        childJson, 
        annotationSouce,
        inputCoordinateSpace,
        scaledAnnotation.id,
      );
      scaledAnnotation.childAnnotationIds.push(subAnnotations[0].id);
      annotations = annotations.concat(subAnnotations);
    }
  }
  return annotations;
}

/* TODO */
export function annotationToPortableJson(
  annotation: Annotation, 
  annotationSouce: AnnotationSource | MultiscaleAnnotationSource,
  inputCoordinateSpace: CoordinateSpace,
) {
  const { scales, units } = inputCoordinateSpace;
  const xyzUnits = units.slice(0, 3); // we only want to look at the first 3 units, not time
  if (!xyzUnits.every((unit) => unit === "m")) {
    return {};
  }
  
  const scaledAnnotation = annotationPointsPixelsToMeters(annotation, scales);
  const result = annotationToJson(scaledAnnotation, annotationSouce);
  delete result.id;
  if (result.hasOwnProperty("centroid")) {
    result.centroid = result.centroid.slice(0, 3);
  }
  if (result.hasOwnProperty("source")) {
    result.source = result.source.slice(0, 3);
  }

  if (annotation.childAnnotationIds) {
    result.childJsons = [];
    for (const childId of annotation.childAnnotationIds) {
      const childRef = annotationSouce.getReference(childId);
      if (!childRef || !childRef.value) continue;
      if (childRef.value.type === AnnotationType.LINE) {
        const line = <Line>childRef.value;
        const pointA = line.pointA.slice(0, 3);
        const pointB = line.pointB.slice(0, 3);
        childRef.value.pointA = pointA;
        childRef.value.pointB = pointB;
      }
      const childJson = annotationToPortableJson(
        childRef.value, 
        annotationSouce, 
        inputCoordinateSpace,
      );
      result.childJsons.push(childJson);
    }
    delete result.childAnnotationIds;
  }
  
  return result;
}

export function getAnnotationPoints(annotation: Annotation): any {
  switch (annotation.type) {
    case AnnotationType.POINT:
      return { point: annotation.point }
    case AnnotationType.LINE:
    case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
      return { pointA: annotation.pointA, pointB: annotation.pointB }
    case AnnotationType.ELLIPSOID:
      return { center: annotation.center, radii: annotation.radii }
    case AnnotationType.POLYGON:
    case AnnotationType.VOLUME:
    case AnnotationType.CLOUD:
      return { source: annotation.source, centroid: annotation.centroid }
  }
  return {};
}


export function annotationPointsPixelsToMeters(
  annotation: Annotation,
  scales: Float64Array,
): any {
  const rank = scales.length;
  const points = getAnnotationPoints(annotation);
  Object.keys(points).forEach((key) => {
    const point = new Float32Array(rank);
    vector.multiply(point, points[key], scales);
    points[key] = point;
  });
  
  return {...annotation, ...points};
}
export function annotationPointsMetersToPixels(
  annotation: Annotation,
  scales: Float64Array,
): any {
  const rank = scales.length;
  const points = getAnnotationPoints(annotation);
  Object.keys(points).forEach((key) => {
    const point = new Float32Array(rank);
    vector.divide(point, points[key], scales);
    points[key] = point;
  });
  
  return {...annotation, ...points};
}

export function translateAnnotationPoints(
  annotation: Annotation,
  translations: Float64Array,
): any {
  const rank = translations.length;
  const points = getAnnotationPoints(annotation);
  Object.keys(points).forEach((key) => {
    const point = new Float32Array(rank);
    vector.add(point, points[key], translations);
    points[key] = point;
  });
  
  return {...annotation, ...points};
}


/* BRAINSHARE ENDS */
