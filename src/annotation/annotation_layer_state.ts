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

import {
  AnnotationPropertySpec,
  AnnotationSource,
  propertyTypeDataType,
} from "#/annotation";
import { MultiscaleAnnotationSource } from "#/annotation/frontend_source";
import { LayerDataSource } from "#/layer_data_source";
import {
  ChunkTransformParameters,
  getChunkTransformParameters,
  RenderLayerTransformOrError,
} from "#/render_coordinate_transform";
import { RenderLayerRole } from "#/renderlayer";
import { SegmentationDisplayState } from "#/segmentation_display_state/frontend";
import { TrackableBoolean } from "#/trackable_boolean";
import {
  makeCachedLazyDerivedWatchableValue,
  registerNested,
  WatchableValue,
  WatchableValueInterface,
} from "#/trackable_value";
import { TrackableRGB } from "#/util/color";
import { Owned, RefCounted } from "#/util/disposable";
import { makeValueOrError, ValueOrError, valueOrThrow } from "#/util/error";
import { vec3 } from "#/util/geom";
import { WatchableMap } from "#/util/watchable_map";
import {
  makeTrackableFragmentMain,
  makeWatchableShaderError,
} from "#/webgl/dynamic_shader";
import {
  getFallbackBuilderState,
  parseShaderUiControls,
  ShaderControlState,
} from "#/webgl/shader_ui_controls";
/* BRAINSHARE STARTS */
// import { DataType } from "../util/data_type";
import { DataType } from "#/util/data_type";
/* BRAINSHARE ENDS */

export class AnnotationHoverState extends WatchableValue<
  | {
      id: string;
      partIndex: number;
      annotationLayerState: AnnotationLayerState;
    }
  | undefined
> {}

// null means loading
// undefined means no attached layer
export type OptionalSegmentationDisplayState =
  | SegmentationDisplayState
  | null
  | undefined;

export interface AnnotationRelationshipState {
  segmentationState: WatchableValueInterface<OptionalSegmentationDisplayState>;
  showMatches: TrackableBoolean;
}

export class WatchableAnnotationRelationshipStates extends WatchableMap<
  string,
  AnnotationRelationshipState
> {
  constructor() {
    super((context, { showMatches, segmentationState }) => {
      context.registerDisposer(showMatches.changed.add(this.changed.dispatch));
      context.registerDisposer(
        segmentationState.changed.add(this.changed.dispatch),
      );
      context.registerDisposer(
        registerNested((nestedContext, segmentationState) => {
          if (segmentationState == null) return;
          const { segmentationGroupState } = segmentationState;
          nestedContext.registerDisposer(
            segmentationGroupState.changed.add(this.changed.dispatch),
          );
          nestedContext.registerDisposer(
            registerNested((groupContext, groupState) => {
              const { visibleSegments } = groupState;
              let wasEmpty = visibleSegments.size === 0;
              groupContext.registerDisposer(
                visibleSegments.changed.add(() => {
                  const isEmpty = visibleSegments.size === 0;
                  if (isEmpty !== wasEmpty) {
                    wasEmpty = isEmpty;
                    this.changed.dispatch();
                  }
                }),
              );
            }, segmentationGroupState),
          );
        }, segmentationState),
      );
    });
  }

  get(name: string): AnnotationRelationshipState {
    let value = super.get(name);
    if (value === undefined) {
      value = {
        segmentationState: new WatchableValue(undefined),
        showMatches: new TrackableBoolean(false),
      };
      super.set(name, value);
    }
    return value;
  }
}

/* BRAINSHARE STARTS */
// const DEFAULT_FRAGMENT_MAIN = `
// void main() {
//   setColor(defaultColor());
// }
// `;
const DEFAULT_FRAGMENT_MAIN = `
#uicontrol float cell_vertex_size slider(min=0, max=10, default=1)
#uicontrol float cell_vertex_border_width slider(min=0, max=5, default=1)
#uicontrol float cell_opacity slider(min=0, max=1, default=1)
#uicontrol float com_vertex_size slider(min=0, max=10, default=1)
#uicontrol float com_vertex_border_width slider(min=0, max=5, default=1)
#uicontrol float com_opacity slider(min=0, max=1, default=1)
#uicontrol float polygon_vertex_size slider(min=0, max=10, default=7)
#uicontrol float polygon_vertex_border_width slider(min=0, max=5, default=3)
#uicontrol float polygon_opacity slider(min=0, max=1, default=1)
#uicontrol float polygon_line_width slider(min=0, max=5, default=1)

void main() {
  setColor(defaultColor());
  // setColor(prop_color());
  // setVisibility(prop_visibility());
  // setEndpointVisibility(prop_visibility());
  // setComVisibility(prop_visibility());
  // setCellVisibility(prop_visibility());

  setCellMarkerSize(cell_vertex_size);
  setCellMarkerBorderWidth(cell_vertex_border_width);
  setCellOpacity(cell_opacity);
  setComMarkerSize(com_vertex_size);
  setComMarkerBorderWidth(com_vertex_border_width);
  setComOpacity(com_opacity);
  setEndpointMarkerSize(polygon_vertex_size);
  setEndpointMarkerBorderWidth(polygon_vertex_border_width);
  setEndpointOpacity(polygon_opacity);
  setLineOpacity(polygon_opacity);
  setLineWidth(polygon_line_width);
}
`;
/* BRAINSHARE ENDS */

export class AnnotationDisplayState extends RefCounted {
  annotationProperties = new WatchableValue<
    AnnotationPropertySpec[] | undefined
  >(undefined);
  shader = makeTrackableFragmentMain(DEFAULT_FRAGMENT_MAIN);
  shaderControls = new ShaderControlState(
    this.shader,
    makeCachedLazyDerivedWatchableValue((annotationProperties) => {
      const properties = new Map<string, DataType>();
      if (annotationProperties === undefined) {
        return null;
      }
      for (const property of annotationProperties) {
        const dataType = propertyTypeDataType[property.type];
        if (dataType === undefined) continue;
        properties.set(property.identifier, dataType);
      }
      return { properties };
    }, this.annotationProperties),
  );
  fallbackShaderControls = new WatchableValue(
    getFallbackBuilderState(parseShaderUiControls(DEFAULT_FRAGMENT_MAIN)),
  );
  shaderError = makeWatchableShaderError();
  color = new TrackableRGB(vec3.fromValues(1, 1, 0));
  relationshipStates = this.registerDisposer(
    new WatchableAnnotationRelationshipStates(),
  );
  ignoreNullSegmentFilter = new TrackableBoolean(true);
  disablePicking = new WatchableValue(false);
  displayUnfiltered = makeCachedLazyDerivedWatchableValue(
    (map, ignoreNullSegmentFilter) => {
      for (const state of map.values()) {
        if (state.showMatches.value) {
          if (!ignoreNullSegmentFilter) return false;
          const segmentationState = state.segmentationState.value;
          if (segmentationState != null) {
            if (
              segmentationState.segmentationGroupState.value.visibleSegments
                .size > 0
            ) {
              return false;
            }
          }
        }
      }
      return true;
    },
    this.relationshipStates,
    this.ignoreNullSegmentFilter,
  );
  hoverState = new AnnotationHoverState(undefined);
}

export class AnnotationLayerState extends RefCounted {
  transform: WatchableValueInterface<RenderLayerTransformOrError>;
  localPosition: WatchableValueInterface<Float32Array>;
  source: Owned<AnnotationSource | MultiscaleAnnotationSource>;
  role: RenderLayerRole;
  dataSource: LayerDataSource;
  subsourceId: string;
  subsourceIndex: number;
  displayState: AnnotationDisplayState;
  subsubsourceId?: string;

  readonly chunkTransform: WatchableValueInterface<
    ValueOrError<ChunkTransformParameters>
  >;

  constructor(options: {
    transform: WatchableValueInterface<RenderLayerTransformOrError>;
    localPosition: WatchableValueInterface<Float32Array>;
    source: Owned<AnnotationSource | MultiscaleAnnotationSource>;
    displayState: AnnotationDisplayState;
    dataSource: LayerDataSource;
    subsourceId: string;
    subsourceIndex: number;
    subsubsourceId?: string;
    role?: RenderLayerRole;
  }) {
    super();
    const {
      transform,
      localPosition,
      source,
      role = RenderLayerRole.ANNOTATION,
    } = options;
    this.transform = transform;
    this.localPosition = localPosition;
    this.source = this.registerDisposer(source);
    this.role = role;
    this.displayState = options.displayState;
    this.chunkTransform = this.registerDisposer(
      makeCachedLazyDerivedWatchableValue(
        (modelTransform) =>
          makeValueOrError(() =>
            getChunkTransformParameters(valueOrThrow(modelTransform)),
          ),
        this.transform,
      ),
    );
    this.dataSource = options.dataSource;
    this.subsourceId = options.subsourceId;
    this.subsourceIndex = options.subsourceIndex;
    this.subsubsourceId = options.subsubsourceId;
  }

  get sourceIndex() {
    const { dataSource } = this;
    return dataSource.layer.dataSources.indexOf(dataSource);
  }
}
