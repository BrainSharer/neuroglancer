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
 * @file User interface for display and editing annotations.
 */

import "./annotations.css";

import {
  Annotation,
  AnnotationId,
  AnnotationPropertySerializer,
  AnnotationReference,
  AnnotationSource,
  annotationToJson,
  AnnotationType,
  annotationTypeHandlers,
  AxisAlignedBoundingBox,
  Ellipsoid,
  formatNumericProperty,
  Line,
  /* BRAINSHARE STARTS */
  Polygon,
  Volume,
  annotationToPortableJson,
  portableJsonToAnnotations,
  translateAnnotationPoints,
  Cloud,
  /* BRAINSHARE ENDS */
} from "#/annotation";
import {
  AnnotationDisplayState,
  AnnotationLayerState,
} from "#/annotation/annotation_layer_state";
import { MultiscaleAnnotationSource } from "#/annotation/frontend_source";
import {
  AnnotationLayer,
  PerspectiveViewAnnotationLayer,
  SliceViewAnnotationLayer,
  SpatiallyIndexedPerspectiveViewAnnotationLayer,
  SpatiallyIndexedSliceViewAnnotationLayer,
} from "#/annotation/renderlayer";
import { CoordinateSpace } from "#/coordinate_transform";
import { MouseSelectionState, UserLayer } from "#/layer";
import { LoadedDataSubsource } from "#/layer_data_source";
import {
  ChunkTransformParameters,
  getChunkPositionFromCombinedGlobalLocalPositions,
} from "#/render_coordinate_transform";
import {
  RenderScaleHistogram,
  trackableRenderScaleTarget,
} from "#/render_scale_statistics";
import { RenderLayerRole } from "#/renderlayer";
import {
  bindSegmentListWidth,
  registerCallbackWhenSegmentationDisplayStateChanged,
  SegmentationDisplayState,
  SegmentWidgetFactory,
} from "#/segmentation_display_state/frontend";
/* BRAINSHARE STARTS */
/*
import { ElementVisibilityFromTrackableBoolean } from "#/trackable_boolean";
*/
/* BRAINSHARE ENDS */
import {
  AggregateWatchableValue,
  makeCachedLazyDerivedWatchableValue,
  registerNested,
  WatchableValue,
  WatchableValueInterface,
} from "#/trackable_value";
/* BRAINSHARE STARTS */
/*
import { getDefaultAnnotationListBindings } from "#/ui/default_input_event_bindings";
*/
import {
  getDefaultAnnotationListBindings, 
  setPolygonDrawModeInputEventBindings 
} from "#/ui/default_input_event_bindings";
/* BRAINSHARE ENDS */
import { LegacyTool, registerLegacyTool } from "#/ui/tool";
import { animationFrameDebounce } from "#/util/animation_frame_debounce";
import { arraysEqual, ArraySpliceOp } from "#/util/array";
import { setClipboard } from "#/util/clipboard";
import {
  serializeColor,
  unpackRGB,
  unpackRGBA,
  useWhiteBackground,
  /* BRAINSHARE STARTS */
  packColor, 
  parseRGBColorSpecification, 
  /* BRAINSHARE ENDS */
} from "#/util/color";
import { Borrowed, disposableOnce, RefCounted } from "#/util/disposable";
import { removeChildren } from "#/util/dom";
import { Endianness, ENDIANNESS } from "#/util/endian";
import { ValueOrError } from "#/util/error";
import { vec3 } from "#/util/geom";
import {
  EventActionMap,
  KeyboardEventBinder,
  registerActionListener,
} from "#/util/keyboard_bindings";
import * as matrix from "#/util/matrix";
import { MouseEventBinder } from "#/util/mouse_bindings";
import { formatScaleWithUnitAsString } from "#/util/si_units";
import { NullarySignal, Signal } from "#/util/signal";
import { Uint64 } from "#/util/uint64";
import * as vector from "#/util/vector";
import { makeAddButton } from "#/widget/add_button";
import { ColorWidget } from "#/widget/color";
import { makeCopyButton } from "#/widget/copy_button";
import { makeDeleteButton } from "#/widget/delete_button";
import {
  DependentViewContext,
  DependentViewWidget,
} from "#/widget/dependent_view_widget";
import { makeIcon } from "#/widget/icon";
import { makeMoveToButton } from "#/widget/move_to_button";
import { Tab } from "#/widget/tab_view";
import { VirtualList, VirtualListSource } from "#/widget/virtual_list";
/* BRAINSHARE STARTS */
import { StatusMessage } from '#/status';
import { 
  getZCoordinate, 
  isPointUniqueInPolygon, 
} from '#/annotation/polygon';
import { isSectionValid } from '#/annotation/volume';
import { getEndPointBasedOnPartIndex, isCornerPicked } from '#/annotation/line';
import svg_clipBoard from "ikonate/icons/clipboard.svg";
import svg_eye_crossed from 'ikonate/icons/eye-crossed.svg';
import svg_eye from 'ikonate/icons/eye.svg';
/* BRAINSHARE ENDS */

export class MergedAnnotationStates
  extends RefCounted
  implements WatchableValueInterface<readonly AnnotationLayerState[]>
{
  changed = new NullarySignal();
  isLoadingChanged = new NullarySignal();
  states: Borrowed<AnnotationLayerState>[] = [];
  relationships: string[] = [];
  private loadingCount = 0;

  get value() {
    return this.states;
  }

  get isLoading() {
    return this.loadingCount !== 0;
  }

  markLoading() {
    this.loadingCount++;
    return () => {
      if (--this.loadingCount === 0) {
        this.isLoadingChanged.dispatch();
      }
    };
  }

  private sort() {
    this.states.sort((a, b) => {
      const d = a.sourceIndex - b.sourceIndex;
      if (d !== 0) return d;
      return a.subsourceIndex - b.subsourceIndex;
    });
  }

  private updateRelationships() {
    const newRelationships = new Set<string>();
    for (const state of this.states) {
      for (const relationship of state.source.relationships) {
        newRelationships.add(relationship);
      }
    }
    this.relationships = Array.from(newRelationships);
  }

  add(state: Borrowed<AnnotationLayerState>) {
    this.states.push(state);
    this.sort();
    this.updateRelationships();
    this.changed.dispatch();
    return () => {
      const index = this.states.indexOf(state);
      this.states.splice(index, 1);
      this.updateRelationships();
      this.changed.dispatch();
    };
  }
}

function getCenterPosition(center: Float32Array, annotation: Annotation) {
  switch (annotation.type) {
    case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
    case AnnotationType.LINE:
      vector.add(center, annotation.pointA, annotation.pointB);
      vector.scale(center, center, 0.5);
      break;
    case AnnotationType.POINT:
      center.set(annotation.point);
      break;
    case AnnotationType.ELLIPSOID:
      center.set(annotation.center);
      break;
    /* BRAINSHARE STARTS */
    case AnnotationType.POLYGON:
    case AnnotationType.VOLUME:
      center.set(annotation.centroid);
      break
    /* BRAINSHARE ENDS */
  }
}

function setLayerPosition(
  layer: UserLayer,
  chunkTransform: ValueOrError<ChunkTransformParameters>,
  layerPosition: Float32Array,
) {
  if (chunkTransform.error !== undefined) return;
  layer.setLayerPosition(chunkTransform.modelTransform, layerPosition);
}

function visitTransformedAnnotationGeometry(
  annotation: Annotation,
  chunkTransform: ChunkTransformParameters,
  callback: (layerPosition: Float32Array, isVector: boolean) => void,
) {
  const { layerRank } = chunkTransform;
  const paddedChunkPosition = new Float32Array(layerRank);
  annotationTypeHandlers[annotation.type].visitGeometry(
    annotation,
    (chunkPosition, isVector) => {
      // Rank of "chunk" coordinate space may be less than rank of layer space if the annotations are
      // embedded in a higher-dimensional space.  The extra embedding dimensions always are last and
      // have a coordinate of 0.
      paddedChunkPosition.set(chunkPosition);
      const layerPosition = new Float32Array(layerRank);
      (isVector ? matrix.transformVector : matrix.transformPoint)(
        layerPosition,
        chunkTransform.chunkToLayerTransform,
        layerRank + 1,
        paddedChunkPosition,
        layerRank,
      );
      callback(layerPosition, isVector);
    },
  );
}

interface AnnotationLayerViewAttachedState {
  refCounted: RefCounted;
  annotations: Annotation[];
  idToIndex: Map<AnnotationId, number>;
  listOffset: number;
}

export class AnnotationLayerView extends Tab {
  private previousSelectedState:
    | {
        annotationId: string;
        annotationLayerState: AnnotationLayerState;
        pin: boolean;
      }
    | undefined = undefined;
  private previousHoverId: string | undefined = undefined;
  private previousHoverAnnotationLayerState: AnnotationLayerState | undefined =
    undefined;

  private virtualListSource: VirtualListSource = {
    length: 0,
    render: (index: number) => this.render(index),
    changed: new Signal<(splices: ArraySpliceOp[]) => void>(),
  };
  private virtualList = new VirtualList({ source: this.virtualListSource });
  private listElements: {
    state: AnnotationLayerState;
    annotation: Annotation;
  }[] = [];
  private updated = false;
  private mutableControls = document.createElement("div");
  private headerRow = document.createElement("div");

  get annotationStates() {
    return this.layer.annotationStates;
  }

  private attachedAnnotationStates = new Map<
    AnnotationLayerState,
    AnnotationLayerViewAttachedState
  >();

  private updateAttachedAnnotationLayerStates() {
    const states = this.annotationStates.states;
    const { attachedAnnotationStates } = this;
    const newAttachedAnnotationStates = new Map<
      AnnotationLayerState,
      AnnotationLayerViewAttachedState
    >();
    for (const [state, info] of attachedAnnotationStates) {
      if (!states.includes(state)) {
        attachedAnnotationStates.delete(state);
        info.refCounted.dispose();
      }
    }
    for (const state of states) {
      const info = attachedAnnotationStates.get(state);
      if (info !== undefined) {
        newAttachedAnnotationStates.set(state, info);
        continue;
      }
      const source = state.source;
      const refCounted = new RefCounted();
      if (source instanceof AnnotationSource) {
        refCounted.registerDisposer(
          source.childAdded.add((annotation) =>
            this.addAnnotationElement(annotation, state),
          ),
        );
        refCounted.registerDisposer(
          source.childUpdated.add((annotation) =>
            this.updateAnnotationElement(annotation, state),
          ),
        );
        refCounted.registerDisposer(
          source.childDeleted.add((annotationId) =>
            this.deleteAnnotationElement(annotationId, state),
          ),
        );
      }
      refCounted.registerDisposer(
        state.transform.changed.add(this.forceUpdateView),
      );
      newAttachedAnnotationStates.set(state, {
        refCounted,
        annotations: [],
        idToIndex: new Map(),
        listOffset: 0,
      });
    }
    this.attachedAnnotationStates = newAttachedAnnotationStates;
    attachedAnnotationStates.clear();
    this.updateCoordinateSpace();
    this.forceUpdateView();
  }

  private forceUpdateView = () => {
    this.updated = false;
    this.updateView();
  };

  private globalDimensionIndices: number[] = [];
  private localDimensionIndices: number[] = [];
  private curCoordinateSpaceGeneration = -1;
  private prevCoordinateSpaceGeneration = -1;
  private columnWidths: number[] = [];
  private gridTemplate = "";

  private updateCoordinateSpace() {
    const localCoordinateSpace = this.layer.localCoordinateSpace.value;
    const globalCoordinateSpace = this.layer.manager.root.coordinateSpace.value;
    const globalDimensionIndices: number[] = [];
    const localDimensionIndices: number[] = [];
    for (
      let globalDim = 0, globalRank = globalCoordinateSpace.rank;
      globalDim < globalRank;
      ++globalDim
    ) {
      if (
        this.annotationStates.states.some((state) => {
          const transform = state.transform.value;
          if (transform.error !== undefined) return false;
          return transform.globalToRenderLayerDimensions[globalDim] !== -1;
        })
      ) {
        globalDimensionIndices.push(globalDim);
      }
    }
    for (
      let localDim = 0, localRank = localCoordinateSpace.rank;
      localDim < localRank;
      ++localDim
    ) {
      if (
        this.annotationStates.states.some((state) => {
          const transform = state.transform.value;
          if (transform.error !== undefined) return false;
          return transform.localToRenderLayerDimensions[localDim] !== -1;
        })
      ) {
        localDimensionIndices.push(localDim);
      }
    }
    if (
      !arraysEqual(globalDimensionIndices, this.globalDimensionIndices) ||
      !arraysEqual(localDimensionIndices, this.localDimensionIndices)
    ) {
      this.localDimensionIndices = localDimensionIndices;
      this.globalDimensionIndices = globalDimensionIndices;
      ++this.curCoordinateSpaceGeneration;
    }
  }

  constructor(
    public layer: Borrowed<UserLayerWithAnnotations>,
    public displayState: AnnotationDisplayState,
  ) {
    super();
    this.element.classList.add("neuroglancer-annotation-layer-view");
    this.registerDisposer(this.visibility.changed.add(() => this.updateView()));
    this.registerDisposer(
      this.annotationStates.changed.add(() =>
        this.updateAttachedAnnotationLayerStates(),
      ),
    );
    this.headerRow.classList.add("neuroglancer-annotation-list-header");

    const toolbox = document.createElement("div");
    toolbox.className = "neuroglancer-annotation-toolbox";

    layer.initializeAnnotationLayerViewTab(this);
    /* BRAINSHARE STARTS */
    const pasteButton = makeIcon({ 
      svg: svg_clipBoard,
      title: "Paste annotation from the system's clipboard",
      onClick: () => {
        let annotationLayerState: AnnotationLayerState | undefined = undefined;
        for (const state of this.layer.annotationStates.states) {
          if (!state.source.readonly) {
            annotationLayerState = state;
            break;
          }
        }
        const coordinateSpace = this.layer.manager.root.coordinateSpace.value;
        const position = this.layer.manager.root.globalPosition.value;
        navigator.clipboard.readText().then((text) => {
          if (annotationLayerState !== undefined) {
            try {
              const json = JSON.parse(text);
              const annotations = portableJsonToAnnotations(
                json,
                annotationLayerState.source,
                coordinateSpace,
              );
              const center = new Float32Array(position.length);
              const translations = new Float64Array(position.length);
              getCenterPosition(center, annotations[0]);
              vector.subtract(translations, position, center);
              for (const annotation of annotations) {
                const translatedAnnotation = translateAnnotationPoints(
                  annotation,
                  translations
                );
                annotationLayerState.source.add(
                  translatedAnnotation,
                  /*commit=*/ true,
                );
              }
              if (annotations[0] !== undefined) {
                this.layer.selectAnnotation(
                  annotationLayerState,
                  annotations[0].id,
                  true
                );
              }
            }
            catch (e) {
              StatusMessage.showTemporaryMessage(
                "The annotation to paste is invalid."
              );
            }
          }
        });
      },
    });
    toolbox.appendChild(pasteButton);
    /* BRAINSHARE ENDS */
    const colorPicker = this.registerDisposer(
      new ColorWidget(this.displayState.color),
    );
    colorPicker.element.title = "Change annotation display color";
    /* BRAINSHARE STARTS */
    // Always show colorPicker since we have added props
    /*
    this.registerDisposer(
      new ElementVisibilityFromTrackableBoolean(
        makeCachedLazyDerivedWatchableValue(
          (shader) => shader.match(/\bdefaultColor\b/) !== null,
          displayState.shaderControls.processedFragmentMain,
        ),
        colorPicker.element,
      ),
    );
    */
    /* BRAINSHARE ENDS */
    toolbox.appendChild(colorPicker.element);
    const { mutableControls } = this;
    const pointButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.POINT].icon,
      title: "Annotate point",
      onClick: () => {
        this.layer.tool.value = new PlacePointTool(this.layer, {});
      },
    });
    mutableControls.appendChild(pointButton);

    const boundingBoxButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.AXIS_ALIGNED_BOUNDING_BOX]
        .icon,
      title: "Annotate bounding box",
      onClick: () => {
        this.layer.tool.value = new PlaceBoundingBoxTool(this.layer, {});
      },
    });
    mutableControls.appendChild(boundingBoxButton);

    const lineButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.LINE].icon,
      title: "Annotate line",
      onClick: () => {
        this.layer.tool.value = new PlaceLineTool(this.layer, {});
      },
    });
    mutableControls.appendChild(lineButton);

    const ellipsoidButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.ELLIPSOID].icon,
      title: "Annotate ellipsoid",
      onClick: () => {
        this.layer.tool.value = new PlaceEllipsoidTool(this.layer, {});
      },
    });
    mutableControls.appendChild(ellipsoidButton);
    /* BRAINSHARE STARTS */
    const polygonButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.POLYGON].icon,
      title: 'Annotate polygon',
      onClick: () => {
        this.layer.tool.value = new PlacePolygonTool(this.layer, {});
      },
    });
    mutableControls.appendChild(polygonButton);

    const volumeButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.VOLUME].icon,
      title: 'Annotate volume',
      onClick: () => {
        this.layer.tool.value = new PlaceVolumeTool(this.layer, {});
      },
    });
    mutableControls.appendChild(volumeButton);

    const cloudButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.CLOUD].icon,
      title: 'Annotate cloud',
      onClick: () => {
        this.layer.tool.value = new PlaceCloudTool(this.layer, {});
      },
    });
    mutableControls.appendChild(cloudButton);
    /* BRAINSHARE ENDS */
    toolbox.appendChild(mutableControls);
    this.element.appendChild(toolbox);

    this.element.appendChild(this.headerRow);
    const { virtualList } = this;
    virtualList.element.classList.add("neuroglancer-annotation-list");
    this.element.appendChild(virtualList.element);
    this.virtualList.element.addEventListener("mouseleave", () => {
      this.displayState.hoverState.value = undefined;
    });

    const bindings = getDefaultAnnotationListBindings();
    this.registerDisposer(
      new MouseEventBinder(this.virtualList.element, bindings),
    );
    this.virtualList.element.title = bindings.describe();
    this.registerDisposer(
      this.displayState.hoverState.changed.add(() => this.updateHoverView()),
    );
    this.registerDisposer(
      this.selectedAnnotationState.changed.add(() =>
        this.updateSelectionView(),
      ),
    );
    this.registerDisposer(
      this.layer.localCoordinateSpace.changed.add(() => {
        this.updateCoordinateSpace();
        this.updateView();
      }),
    );
    this.registerDisposer(
      this.layer.manager.root.coordinateSpace.changed.add(() => {
        this.updateCoordinateSpace();
        this.updateView();
      }),
    );
    this.updateCoordinateSpace();
    this.updateAttachedAnnotationLayerStates();
    this.updateSelectionView();
  }

  private getRenderedAnnotationListElement(
    state: AnnotationLayerState,
    id: AnnotationId,
    scrollIntoView = false,
  ): HTMLElement | undefined {
    const attached = this.attachedAnnotationStates.get(state);
    if (attached === undefined) return undefined;
    const index = attached.idToIndex.get(id);
    if (index === undefined) return undefined;
    const listIndex = attached.listOffset + index;
    if (scrollIntoView) {
      this.virtualList.scrollItemIntoView(index);
    }
    return this.virtualList.getItemElement(listIndex);
  }

  private clearSelectionClass() {
    const { previousSelectedState: state } = this;
    if (state === undefined) return;
    this.previousSelectedState = undefined;
    const element = this.getRenderedAnnotationListElement(
      state.annotationLayerState,
      state.annotationId,
    );
    if (element !== undefined) {
      element.classList.remove("neuroglancer-annotation-selected");
    }
  }

  private clearHoverClass() {
    const { previousHoverId, previousHoverAnnotationLayerState } = this;
    if (previousHoverAnnotationLayerState !== undefined) {
      this.previousHoverAnnotationLayerState = undefined;
      this.previousHoverId = undefined;
      const element = this.getRenderedAnnotationListElement(
        previousHoverAnnotationLayerState,
        previousHoverId!,
      );
      if (element !== undefined) {
        element.classList.remove("neuroglancer-annotation-hover");
      }
    }
  }

  private selectedAnnotationState = makeCachedLazyDerivedWatchableValue(
    (selectionState, pin) => {
      if (selectionState === undefined) return undefined;
      const { layer } = this;
      const layerSelectionState = selectionState.layers.find(
        (s) => s.layer === layer,
      )?.state;
      if (layerSelectionState === undefined) return undefined;
      const { annotationId } = layerSelectionState;
      if (annotationId === undefined) return undefined;
      const annotationLayerState = this.annotationStates.states.find(
        (x) =>
          x.sourceIndex === layerSelectionState.annotationSourceIndex &&
          (layerSelectionState.annotationSubsource === undefined ||
            x.subsourceId === layerSelectionState.annotationSubsource),
      );
      if (annotationLayerState === undefined) return undefined;
      return { annotationId, annotationLayerState, pin };
    },
    this.layer.manager.root.selectionState,
    this.layer.manager.root.selectionState.pin,
  );

  private updateSelectionView() {
    const selectionState = this.selectedAnnotationState.value;
    const { previousSelectedState } = this;
    if (
      previousSelectedState === selectionState ||
      (previousSelectedState !== undefined &&
        selectionState !== undefined &&
        previousSelectedState.annotationId === selectionState.annotationId &&
        previousSelectedState.annotationLayerState ===
          selectionState.annotationLayerState &&
        previousSelectedState.pin === selectionState.pin)
    ) {
      return;
    }
    this.clearSelectionClass();
    this.previousSelectedState = selectionState;
    if (selectionState === undefined) return;
    const element = this.getRenderedAnnotationListElement(
      selectionState.annotationLayerState,
      selectionState.annotationId,
      /*scrollIntoView=*/ selectionState.pin,
    );
    if (element !== undefined) {
      element.classList.add("neuroglancer-annotation-selected");
    }
  }

  private updateHoverView() {
    const selectedValue = this.displayState.hoverState.value;
    let newHoverId: string | undefined;
    let newAnnotationLayerState: AnnotationLayerState | undefined;
    if (selectedValue !== undefined) {
      newHoverId = selectedValue.id;
      newAnnotationLayerState = selectedValue.annotationLayerState;
    }
    const { previousHoverId, previousHoverAnnotationLayerState } = this;
    if (
      newHoverId === previousHoverId &&
      newAnnotationLayerState === previousHoverAnnotationLayerState
    ) {
      return;
    }
    this.clearHoverClass();
    this.previousHoverId = newHoverId;
    this.previousHoverAnnotationLayerState = newAnnotationLayerState;
    if (newHoverId === undefined) return;
    const element = this.getRenderedAnnotationListElement(
      newAnnotationLayerState!,
      newHoverId,
    );
    if (element === undefined) return;
    element.classList.add("neuroglancer-annotation-hover");
  }

  private render(index: number) {
    const { annotation, state } = this.listElements[index];
    return this.makeAnnotationListElement(annotation, state);
  }

  private setColumnWidth(column: number, width: number) {
    // Padding
    width += 2;
    const { columnWidths } = this;
    if (columnWidths[column] > width) {
      // False if `columnWidths[column] === undefined`.
      return;
    }
    columnWidths[column] = width;
    this.element.style.setProperty(
      `--neuroglancer-column-${column}-width`,
      `${width}ch`,
    );
  }

  private updateView() {
    if (!this.visible) {
      return;
    }
    if (
      this.curCoordinateSpaceGeneration !== this.prevCoordinateSpaceGeneration
    ) {
      this.updated = false;
      const { columnWidths } = this;
      columnWidths.length = 0;
      const { headerRow } = this;
      const symbolPlaceholder = document.createElement("div");
      symbolPlaceholder.style.gridColumn = "symbol";

      const deletePlaceholder = document.createElement("div");
      deletePlaceholder.style.gridColumn = "delete";

      removeChildren(headerRow);
      headerRow.appendChild(symbolPlaceholder);
      let i = 0;
      let gridTemplate = "[symbol] 2ch";
      const addDimension = (
        coordinateSpace: CoordinateSpace,
        dimIndex: number,
      ) => {
        const dimWidget = document.createElement("div");
        dimWidget.classList.add("neuroglancer-annotations-view-dimension");
        const name = document.createElement("span");
        name.classList.add("neuroglancer-annotations-view-dimension-name");
        name.textContent = coordinateSpace.names[dimIndex];
        const scale = document.createElement("scale");
        scale.classList.add("neuroglancer-annotations-view-dimension-scale");
        scale.textContent = formatScaleWithUnitAsString(
          coordinateSpace.scales[dimIndex],
          coordinateSpace.units[dimIndex],
          { precision: 2 },
        );
        dimWidget.appendChild(name);
        dimWidget.appendChild(scale);
        dimWidget.style.gridColumn = `dim ${i + 1}`;
        this.setColumnWidth(
          i,
          scale.textContent.length + name.textContent.length + 3,
        );
        gridTemplate += ` [dim] var(--neuroglancer-column-${i}-width)`;
        ++i;
        headerRow.appendChild(dimWidget);
      };
      const globalCoordinateSpace =
        this.layer.manager.root.coordinateSpace.value;
      for (const globalDim of this.globalDimensionIndices) {
        addDimension(globalCoordinateSpace, globalDim);
      }
      const localCoordinateSpace = this.layer.localCoordinateSpace.value;
      for (const localDim of this.localDimensionIndices) {
        addDimension(localCoordinateSpace, localDim);
      }
      headerRow.appendChild(deletePlaceholder);
      gridTemplate += " [delete] 2ch";
      this.gridTemplate = gridTemplate;
      headerRow.style.gridTemplateColumns = gridTemplate;
      this.prevCoordinateSpaceGeneration = this.curCoordinateSpaceGeneration;
    }
    if (this.updated) {
      return;
    }

    let isMutable = false;
    const { listElements } = this;
    listElements.length = 0;
    for (const [state, info] of this.attachedAnnotationStates) {
      if (!state.source.readonly) isMutable = true;
      if (state.chunkTransform.value.error !== undefined) continue;
      const { source } = state;
      /* BRAINSHARE STARTS */
      // Only restore the non-child annotations 
      /*
      const annotations = Array.from(source);
      */
      let annotations = Array.from(source);
      annotations = annotations.filter(annotation => {
        return !annotation.parentAnnotationId;
      })
      /* BRAINSHARE ENDS */
      info.annotations = annotations;
      const { idToIndex } = info;
      idToIndex.clear();
      for (let i = 0, length = annotations.length; i < length; ++i) {
        idToIndex.set(annotations[i].id, i);
      }
      for (const annotation of annotations) {
        listElements.push({ state, annotation });
      }
    }
    const oldLength = this.virtualListSource.length;
    this.updateListLength();
    this.virtualListSource.changed!.dispatch([
      {
        retainCount: 0,
        deleteCount: oldLength,
        insertCount: listElements.length,
      },
    ]);
    this.mutableControls.style.display = isMutable ? "contents" : "none";
    this.resetOnUpdate();
  }

  private updateListLength() {
    let length = 0;
    for (const info of this.attachedAnnotationStates.values()) {
      info.listOffset = length;
      length += info.annotations.length;
    }
    this.virtualListSource.length = length;
  }

  private addAnnotationElement(
    annotation: Annotation,
    state: AnnotationLayerState,
  ) {
    if (!this.visible) {
      this.updated = false;
      return;
    }
    if (!this.updated) {
      this.updateView();
      return;
    }
    /* BRAINSHARE STARTS */
    // Do not add to list if annotaiton is a child annotation
    if (annotation.parentAnnotationId) return;
    /* BRAINSHARE ENDS */
    const info = this.attachedAnnotationStates.get(state);
    if (info !== undefined) {
      const index = info.annotations.length;
      info.annotations.push(annotation);
      info.idToIndex.set(annotation.id, index);
      const spliceStart = info.listOffset + index;
      this.listElements.splice(spliceStart, 0, { state, annotation });
      this.updateListLength();
      this.virtualListSource.changed!.dispatch([
        { retainCount: spliceStart, deleteCount: 0, insertCount: 1 },
      ]);
    }
    this.resetOnUpdate();
  }

  private updateAnnotationElement(
    annotation: Annotation,
    state: AnnotationLayerState,
  ) {
    if (!this.visible) {
      this.updated = false;
      return;
    }
    if (!this.updated) {
      this.updateView();
      return;
    }
    const info = this.attachedAnnotationStates.get(state);
    if (info !== undefined) {
      const index = info.idToIndex.get(annotation.id);
      if (index !== undefined) {
        const updateStart = info.listOffset + index;
        info.annotations[index] = annotation;
        this.listElements[updateStart].annotation = annotation;
        this.virtualListSource.changed!.dispatch([
          { retainCount: updateStart, deleteCount: 1, insertCount: 1 },
        ]);
      }
    }
    this.resetOnUpdate();
  }

  private deleteAnnotationElement(
    annotationId: string,
    state: AnnotationLayerState,
  ) {
    if (!this.visible) {
      this.updated = false;
      return;
    }
    if (!this.updated) {
      this.updateView();
      return;
    }
    const info = this.attachedAnnotationStates.get(state);
    if (info !== undefined) {
      const { idToIndex } = info;
      const index = idToIndex.get(annotationId);
      if (index !== undefined) {
        const spliceStart = info.listOffset + index;
        const { annotations } = info;
        annotations.splice(index, 1);
        idToIndex.delete(annotationId);
        for (let i = index, length = annotations.length; i < length; ++i) {
          idToIndex.set(annotations[i].id, i);
        }
        this.listElements.splice(spliceStart, 1);
        this.updateListLength();
        this.virtualListSource.changed!.dispatch([
          { retainCount: spliceStart, deleteCount: 1, insertCount: 0 },
        ]);
      }
    }
    this.resetOnUpdate();
  }

  private resetOnUpdate() {
    this.clearHoverClass();
    this.clearSelectionClass();
    this.updated = true;
    this.updateHoverView();
    this.updateSelectionView();
  }

  private makeAnnotationListElement(
    annotation: Annotation,
    state: AnnotationLayerState,
  ) {
    const chunkTransform = state.chunkTransform
      .value as ChunkTransformParameters;
    const element = document.createElement("div");
    element.classList.add("neuroglancer-annotation-list-entry");
    element.dataset.color = state.displayState.color.toString();
    element.style.gridTemplateColumns = this.gridTemplate;
    const icon = document.createElement("div");
    icon.className = "neuroglancer-annotation-icon";
    icon.textContent = annotationTypeHandlers[annotation.type].icon;
    element.appendChild(icon);

    let deleteButton: HTMLElement | undefined;

    const maybeAddDeleteButton = () => {
      if (state.source.readonly) return;
      if (deleteButton !== undefined) return;
      deleteButton = makeDeleteButton({
        title: "Delete annotation",
        onClick: (event) => {
          event.stopPropagation();
          event.preventDefault();
          const ref = state.source.getReference(annotation.id);
          try {
            state.source.delete(ref);
          } finally {
            ref.dispose();
          }
        },
      });
      deleteButton.classList.add("neuroglancer-annotation-list-entry-delete");
      element.appendChild(deleteButton);
    };

    let numRows = 0;
    visitTransformedAnnotationGeometry(
      annotation,
      chunkTransform,
      (layerPosition, isVector) => {
        isVector;
        ++numRows;
        const position = document.createElement("div");
        position.className = "neuroglancer-annotation-position";
        element.appendChild(position);
        let i = 0;
        const addDims = (
          viewDimensionIndices: readonly number[],
          layerDimensionIndices: readonly number[],
        ) => {
          for (const viewDim of viewDimensionIndices) {
            const layerDim = layerDimensionIndices[viewDim];
            if (layerDim !== -1) {
              const coord = Math.floor(layerPosition[layerDim]);
              const coordElement = document.createElement("div");
              const text = coord.toString();
              coordElement.textContent = text;
              coordElement.classList.add("neuroglancer-annotation-coordinate");
              coordElement.style.gridColumn = `dim ${i + 1}`;
              this.setColumnWidth(i, text.length);
              position.appendChild(coordElement);
            }
            ++i;
          }
        };
        addDims(
          this.globalDimensionIndices,
          chunkTransform.modelTransform.globalToRenderLayerDimensions,
        );
        addDims(
          this.localDimensionIndices,
          chunkTransform.modelTransform.localToRenderLayerDimensions,
        );
        maybeAddDeleteButton();
      },
    );
    if (annotation.description) {
      ++numRows;
      const description = document.createElement("div");
      description.classList.add("neuroglancer-annotation-description");
      description.textContent = annotation.description;
      element.appendChild(description);
    }
    icon.style.gridRow = `span ${numRows}`;
    if (deleteButton !== undefined) {
      deleteButton.style.gridRow = `span ${numRows}`;
    }
    element.addEventListener("mouseenter", () => {
      this.displayState.hoverState.value = {
        id: annotation.id,
        partIndex: 0,
        annotationLayerState: state,
      };
      this.layer.selectAnnotation(state, annotation.id, false);
    });
    element.addEventListener("action:select-position", (event) => {
      event.stopPropagation();
      this.layer.selectAnnotation(state, annotation.id, "toggle");
    });

    element.addEventListener("action:pin-annotation", (event) => {
      event.stopPropagation();
      this.layer.selectAnnotation(state, annotation.id, true);
    });

    element.addEventListener("action:move-to-annotation", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const { layerRank } = chunkTransform;
      const chunkPosition = new Float32Array(layerRank);
      const layerPosition = new Float32Array(layerRank);
      getCenterPosition(chunkPosition, annotation);
      matrix.transformPoint(
        layerPosition,
        chunkTransform.chunkToLayerTransform,
        layerRank + 1,
        chunkPosition,
        layerRank,
      );
      setLayerPosition(this.layer, chunkTransform, layerPosition);
    });

    const selectionState = this.selectedAnnotationState.value;
    if (
      selectionState !== undefined &&
      selectionState.annotationLayerState === state &&
      selectionState.annotationId === annotation.id
    ) {
      element.classList.add("neuroglancer-annotation-selected");
    }
    return element;
  }
}

export class AnnotationTab extends Tab {
  private layerView = this.registerDisposer(
    new AnnotationLayerView(this.layer, this.layer.annotationDisplayState),
  );
  constructor(public layer: Borrowed<UserLayerWithAnnotations>) {
    super();
    const { element } = this;
    element.classList.add("neuroglancer-annotations-tab");
    element.appendChild(this.layerView.element);
  }
}

function getSelectedAssociatedSegments(
  annotationLayer: AnnotationLayerState,
  getBase = false,
) {
  const segments: Uint64[][] = [];
  const { relationships } = annotationLayer.source;
  const { relationshipStates } = annotationLayer.displayState;
  for (let i = 0, count = relationships.length; i < count; ++i) {
    const segmentationState = relationshipStates.get(relationships[i])
      .segmentationState.value;
    if (segmentationState != null) {
      if (segmentationState.segmentSelectionState.hasSelectedSegment) {
        segments[i] = [
          segmentationState.segmentSelectionState.selectedSegment.clone(),
        ];
        if (getBase) {
          segments[i] = [
            ...segments[i],
            segmentationState.segmentSelectionState.baseSelectedSegment.clone(),
          ];
        }
        continue;
      }
    }
    segments[i] = [];
  }
  return segments;
}

abstract class PlaceAnnotationTool extends LegacyTool {
  layer: UserLayerWithAnnotations;
  constructor(layer: UserLayerWithAnnotations, options: any) {
    super(layer);
    options;
  }

  get annotationLayer(): AnnotationLayerState | undefined {
    for (const state of this.layer.annotationStates.states) {
      if (!state.source.readonly) return state;
    }
    return undefined;
  }

  /* BRAINSHARE STARTS */
  setActive(_value: boolean) {}

  get color() {
    return this.layer.annotationDisplayState.color.value;
  }
  /* BRAINSHARE ENDS */
}

const ANNOTATE_POINT_TOOL_ID = "annotatePoint";
const ANNOTATE_LINE_TOOL_ID = "annotateLine";
const ANNOTATE_BOUNDING_BOX_TOOL_ID = "annotateBoundingBox";
const ANNOTATE_ELLIPSOID_TOOL_ID = "annotateSphere";
/* BRAINSHARE STARTS */
const ANNOTATE_POLYGON_TOOL_ID = 'annotatePolygon';
const ANNOTATE_VOLUME_TOOL_ID = 'annotateVolume';
/* BRAINSHARE ENDS */

export class PlacePointTool extends PlaceAnnotationTool {
  /* BRAINSHARE STARTS */
  /*
  trigger(mouseState: MouseSelectionState) {
  */
  trigger(mouseState: MouseSelectionState, parentRef?: AnnotationReference) {
  /* BRAINSHARE ENDS */
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }
    if (mouseState.updateUnconditionally()) {
      const point = getMousePositionInAnnotationCoordinates(
        mouseState,
        annotationLayer,
      );
      if (point === undefined) return;
      const annotation: Annotation = {
        id: "",
        description: "",
        relatedSegments: getSelectedAssociatedSegments(annotationLayer),
        point,
        type: AnnotationType.POINT,
        /* BRAINSHARE STARTS */
        // Set default color for points
        /*
        properties: annotationLayer.source.properties.map((x) => x.default),
        */
        properties: annotationLayer.source.properties.map(
          (x) => x.identifier === "color" ? packColor(this.color) : x.default
        ),
        /* BRAINSHARE ENDS */
      };
      const reference = annotationLayer.source.add(
        annotation,
        /*commit=*/ true,
        /* BRAINSHARE STARTS */
        parentRef,
        /* BRAINSHARE ENDS */
      );
      this.layer.selectAnnotation(annotationLayer, reference.id, true);
      reference.dispose();
    }
  }

  get description() {
    return "annotate point";
  }

  toJSON() {
    return ANNOTATE_POINT_TOOL_ID;
  }
}

function getMousePositionInAnnotationCoordinates(
  mouseState: MouseSelectionState,
  annotationLayer: AnnotationLayerState,
): Float32Array | undefined {
  const chunkTransform = annotationLayer.chunkTransform.value;
  if (chunkTransform.error !== undefined) return undefined;
  const chunkPosition = new Float32Array(
    chunkTransform.modelTransform.unpaddedRank,
  );
  if (
    !getChunkPositionFromCombinedGlobalLocalPositions(
      chunkPosition,
      mouseState.unsnappedPosition,
      annotationLayer.localPosition.value,
      chunkTransform.layerRank,
      chunkTransform.combinedGlobalLocalToChunkTransform,
    )
  ) {
    return undefined;
  }
  return chunkPosition;
}

abstract class TwoStepAnnotationTool extends PlaceAnnotationTool {
  inProgressAnnotation: WatchableValue<
    | {
        annotationLayer: AnnotationLayerState;
        reference: AnnotationReference;
        disposer: () => void;
      }
    | undefined
  > = new WatchableValue(undefined);

  abstract getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation;
  abstract getUpdatedAnnotation(
    oldAnnotation: Annotation,
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation;

  /* BRAINSHARE STARTS */
  // trigger(mouseState: MouseSelectionState) {
  trigger(mouseState: MouseSelectionState, parentRef?: AnnotationReference) {
  /* BRAINSHARE ENDS */
    const { annotationLayer, inProgressAnnotation } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }
    if (mouseState.updateUnconditionally()) {
      const updatePointB = () => {
        const state = inProgressAnnotation.value!;
        const reference = state.reference;
        const newAnnotation = this.getUpdatedAnnotation(
          reference.value!,
          mouseState,
          annotationLayer,
        );
        if (
          JSON.stringify(
            annotationToJson(newAnnotation, annotationLayer.source),
          ) ===
          JSON.stringify(
            annotationToJson(reference.value!, annotationLayer.source),
          )
        ) {
          return;
        }
        state.annotationLayer.source.update(reference, newAnnotation);
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
      };

      if (inProgressAnnotation.value === undefined) {
        /* BRAINSHARE STARTS */
        // Inherit properties from parent annotation
        // const reference = annotationLayer.source.add(
        //   this.getInitialAnnotation(mouseState, annotationLayer),
        //   /*commit=*/ false,
        // );
        const initAnn = this.getInitialAnnotation(mouseState, annotationLayer);
        if (parentRef && parentRef.value) {
          initAnn.properties = Object.assign([], parentRef.value.properties);
        }
        const reference = annotationLayer.source.add(
          initAnn, 
          /*commit=*/ false,
          parentRef
        );
        /* BRAINSHARE ENDS */
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
        const mouseDisposer = mouseState.changed.add(updatePointB);
        const disposer = () => {
          mouseDisposer();
          reference.dispose();
        };
        inProgressAnnotation.value = {
          annotationLayer,
          reference,
          disposer,
        };
      } else {
        updatePointB();
        const state = inProgressAnnotation.value;
        state.annotationLayer.source.commit(state.reference);
        state.disposer();
        inProgressAnnotation.value = undefined;
      }
    }
  }

  disposed() {
    this.deactivate();
    super.disposed();
  }

  deactivate() {
    const state = this.inProgressAnnotation.value;
    if (state !== undefined) {
      state.annotationLayer.source.delete(state.reference);
      state.disposer();
      this.inProgressAnnotation.value = undefined;
    }
  }
}

abstract class PlaceTwoCornerAnnotationTool extends TwoStepAnnotationTool {
  annotationType:
    | AnnotationType.LINE
    | AnnotationType.AXIS_ALIGNED_BOUNDING_BOX;

  getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer,
    );
    return <AxisAlignedBoundingBox | Line>{
      id: "",
      type: this.annotationType,
      description: "",
      pointA: point,
      pointB: point,
      /* BRAINSHARE STARTS */
      // Set default color for lines and rectangles
      // properties: annotationLayer.source.properties.map((x) => x.default),
      properties: annotationLayer.source.properties.map(
        (x) => x.identifier === "color" ? packColor(this.color) : x.default
      ),
      /* BRAINSHARE ENDS */
    };
  }

  getUpdatedAnnotation(
    oldAnnotation: AxisAlignedBoundingBox | Line,
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer,
    );
    if (point === undefined) return oldAnnotation;
    return { ...oldAnnotation, pointB: point };
  }
}

export class PlaceBoundingBoxTool extends PlaceTwoCornerAnnotationTool {
  get description() {
    return "annotate bounding box";
  }

  getUpdatedAnnotation(
    oldAnnotation: AxisAlignedBoundingBox,
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ) {
    const result = super.getUpdatedAnnotation(
      oldAnnotation,
      mouseState,
      annotationLayer,
    ) as AxisAlignedBoundingBox;
    const { pointA, pointB } = result;
    const rank = pointA.length;
    for (let i = 0; i < rank; ++i) {
      if (pointA[i] === pointB[i]) {
        pointB[i] += 1;
      }
    }
    return result;
  }

  toJSON() {
    return ANNOTATE_BOUNDING_BOX_TOOL_ID;
  }
}
PlaceBoundingBoxTool.prototype.annotationType =
  AnnotationType.AXIS_ALIGNED_BOUNDING_BOX;

export class PlaceLineTool extends PlaceTwoCornerAnnotationTool {
  getBaseSegment = false;

  get description() {
    return "annotate line";
  }

  private initialRelationships: Uint64[][] | undefined;

  getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation {
    const result = super.getInitialAnnotation(mouseState, annotationLayer);
    this.initialRelationships = result.relatedSegments =
      getSelectedAssociatedSegments(annotationLayer, this.getBaseSegment);
    return result;
  }

  getUpdatedAnnotation(
    oldAnnotation: Line | AxisAlignedBoundingBox,
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ) {
    const result = super.getUpdatedAnnotation(
      oldAnnotation,
      mouseState,
      annotationLayer,
    );
    const initialRelationships = this.initialRelationships;
    const newRelationships = getSelectedAssociatedSegments(
      annotationLayer,
      this.getBaseSegment,
    );
    if (initialRelationships === undefined) {
      result.relatedSegments = newRelationships;
    } else {
      result.relatedSegments = Array.from(
        newRelationships,
        (newSegments, i) => {
          const initialSegments = initialRelationships[i];
          newSegments = newSegments.filter(
            (x) => initialSegments.findIndex((y) => Uint64.equal(x, y)) === -1,
          );
          return [...initialSegments, ...newSegments];
        },
      );
    }
    return result;
  }

  toJSON() {
    return ANNOTATE_LINE_TOOL_ID;
  }
}
PlaceLineTool.prototype.annotationType = AnnotationType.LINE;

class PlaceEllipsoidTool extends TwoStepAnnotationTool {
  getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer,
    );

    return <Ellipsoid>{
      type: AnnotationType.ELLIPSOID,
      id: "",
      description: "",
      segments: getSelectedAssociatedSegments(annotationLayer),
      center: point,
      radii: vec3.fromValues(0, 0, 0),
      /* BRAINSHARE STARTS */
        // Set default color for ellipses
      // properties: annotationLayer.source.properties.map((x) => x.default),
      properties: annotationLayer.source.properties.map(
        (x) => x.identifier === "color" ? packColor(this.color) : x.default
      ),
      /* BRAINSHARE ENDS */
    };
  }

  getUpdatedAnnotation(
    oldAnnotation: Ellipsoid,
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState,
  ) {
    const radii = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer,
    );
    if (radii === undefined) return oldAnnotation;
    const center = oldAnnotation.center;
    const rank = center.length;
    for (let i = 0; i < rank; ++i) {
      radii[i] = Math.abs(center[i] - radii[i]);
    }
    return <Ellipsoid>{
      ...oldAnnotation,
      radii,
    };
  }
  get description() {
    return "annotate ellipsoid";
  }

  toJSON() {
    return ANNOTATE_ELLIPSOID_TOOL_ID;
  }
}

/* BRAINSHARE STARTS */
/**
 * An abstract class to represent any annotation tool with multiple steps to 
 * complete annotation.
 */
export abstract class MultiStepAnnotationTool extends PlaceAnnotationTool {
  inProgressAnnotation: {
    annotationLayer: AnnotationLayerState, 
    reference: AnnotationReference, 
    disposer: () => void
  } | undefined;
  
  abstract getInitialAnnotation(
    mouseState: MouseSelectionState, 
    annotationLayer: AnnotationLayerState
  ): Annotation;
  abstract getUpdatedAnnotation(
    oldAnnotation: Annotation, 
    mouseState: MouseSelectionState, 
    annotationLayer: AnnotationLayerState
  ): Annotation;
  abstract complete() : boolean;
  abstract undo(mouseState: MouseSelectionState) : boolean;

  disposed() {
    this.deactivate();
    super.disposed();
  }

  deactivate() {
    if (this.inProgressAnnotation !== undefined) {
      this.inProgressAnnotation.annotationLayer.source.delete(
        this.inProgressAnnotation.reference
      );
      this.inProgressAnnotation.disposer();
      this.inProgressAnnotation = undefined;
    }
  }
}

/**
 * Abstract class to represent any tool which draws a Collection.
 */
abstract class PlaceCollectionAnnotationTool extends MultiStepAnnotationTool {
  annotationType: AnnotationType.POLYGON | AnnotationType.VOLUME | AnnotationType.CLOUD;

  /**
   * Returns the initial collection annotation based on the mouse location.
   * @param mouseState 
   * @param annotationLayer 
   * @returns newly created annotation.
   */
  getInitialAnnotation(
    mouseState: MouseSelectionState, 
    annotationLayer: AnnotationLayerState
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState, 
      annotationLayer
    );
    return <Polygon | Volume | Cloud> {
      id: '',
      type: this.annotationType,
      description: '',
      source: point,
      centroid: point,
      properties: annotationLayer.source.properties.map(
        (x) => x.identifier === "color" ? packColor(this.color) : x.default
      ),
      childAnnotationIds: [],
      childrenVisible: true,
    };
  }

  /**
   * Get updated annotation based on the source position of the mouse.
   * @param oldAnnotation 
   * @param mouseState 
   * @param annotationLayer 
   * @returns updated annotation.
   */
  getUpdatedAnnotation(
    oldAnnotation: Annotation, 
    mouseState: MouseSelectionState, 
    annotationLayer: AnnotationLayerState
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState, 
      annotationLayer
    );
    if (point == undefined) return oldAnnotation;
    return <Polygon>{...oldAnnotation, source: point};
  }
}

/**
 * This class is used to draw polygon annotations.
 */
export class PlacePolygonTool extends PlaceCollectionAnnotationTool {
  active: boolean;
  childTool: PlaceLineTool;
  bindingsRef: RefCounted | undefined;
  sourcePosition: Float32Array | undefined;
  zCoordinate: number | undefined;

  constructor(public layer: UserLayerWithAnnotations, options: any) {
    super(layer, options);
    this.active = true;
    this.childTool = new PlaceLineTool(layer, {...options, parent: this});
    this.bindingsRef = new RefCounted();
    setPolygonDrawModeInputEventBindings(
      this.bindingsRef, 
      (window as any)['viewer'].inputEventBindings
    );
  }

  /**
   * This function is called when the user tries to draw annotation
   * @param mouseState
   * @param parentRef optional parent reference passed from parent tool.
   * @returns void
   */
  trigger(mouseState: MouseSelectionState, parentRef?: AnnotationReference) {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    if (mouseState.updateUnconditionally()) {
      const point = getMousePositionInAnnotationCoordinates(
        mouseState,
        annotationLayer
      );
      if (point === undefined) return;

      if (this.inProgressAnnotation === undefined) {
        // Check if a polygon already exists on the same section for the volume
        if (parentRef) {
          this.zCoordinate = getZCoordinate(point);
          if (this.zCoordinate === undefined) return;
          if (!isSectionValid(annotationLayer, parentRef.id, this.zCoordinate)) {
            StatusMessage.showTemporaryMessage(
              "A polygon already exists in this section for the volume, \
              only one polygon per section is allowed for a volume."
            );
            return;
          }
        }
        
        this.zCoordinate = getZCoordinate(point);
        this.sourcePosition = getMousePositionInAnnotationCoordinates(
          mouseState, 
          annotationLayer
        );

        const annotation = this.getInitialAnnotation(
          mouseState, 
          annotationLayer
        );
        
        // Copy the volume's properties to this polyon
        if (parentRef && parentRef.value) {
          annotation.properties = Object.assign(
            [], 
            parentRef.value.properties
          );
          annotation.childrenVisible = parentRef.value.childrenVisible;
        }

        const reference = annotationLayer.source.add(
          annotation, 
          /*commit=*/ false, 
          parentRef
        );
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
        this.childTool.trigger(mouseState, reference);

        const disposer = () => reference.dispose();
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };
      } 
      else {
        const reference = this.inProgressAnnotation.reference;
        if(!isPointUniqueInPolygon(
          annotationLayer, 
          <Polygon> reference.value!, 
          point
        )) {
          StatusMessage.showTemporaryMessage(
            "All vertices of polygon must be unique."
          );
          return;
        }

        const newZCoordinate = getZCoordinate(point);
        if (this.zCoordinate === undefined || newZCoordinate === undefined) {
          return;
        }
        if (this.zCoordinate !== newZCoordinate) {
          StatusMessage.showTemporaryMessage(
            "All vertices of polygon must be in the same plane."
          );
          return;
        }

        // Finish the current line
        this.childTool.trigger(mouseState, reference);
        // Start a new line
        this.childTool.trigger(mouseState, reference);
      }
    }
  }

  /**
   * Completes the last edge of polygon to be drawn.
   * @returns true if the operation suceeded otherwise false.
   */
  complete(): boolean {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return false;
    }

    const childInProgressAnn = this.childTool.inProgressAnnotation.value;
    if (
      childInProgressAnn === undefined ||
      this.inProgressAnnotation === undefined
    ) return false;

    const annotation = <Polygon> this.inProgressAnnotation.reference.value;
    
    // There must be at least 3 lines in a polygon
    if (annotation.childAnnotationIds.length < 3) {
      StatusMessage.showTemporaryMessage(
        "There must be at least 3 lines in a polygon"
      );
      return false;
    }

    if (
      childInProgressAnn.reference === undefined ||
      childInProgressAnn.reference.value === undefined
    ) return false;

    // Add last line
    const newChildAnn = <Annotation>{
      ...childInProgressAnn.reference.value,
      pointB: this.sourcePosition
    };
    annotationLayer.source.update(childInProgressAnn.reference, newChildAnn);
    annotationLayer.source.commit(childInProgressAnn.reference);
    this.layer.selectAnnotation(
      annotationLayer, 
      childInProgressAnn.reference.id, 
      true
    );
    childInProgressAnn.disposer();
    this.childTool.inProgressAnnotation.value = undefined;

    // Update polygon
    annotationLayer.source.commit(this.inProgressAnnotation.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      this.inProgressAnnotation.reference.id,
      true
    );
    this.inProgressAnnotation.disposer();
    this.inProgressAnnotation = undefined;
    this.sourcePosition = undefined;
    
    return true;
  }

  /**
   * Undo the last drawn polygon line segment.
   */
  undo(mouseState: MouseSelectionState): boolean {
    const { annotationLayer } = this;
    const state = this.inProgressAnnotation;
    if (annotationLayer === undefined || state === undefined) {
      return false;
    }

    const annotation = <Polygon>state.reference.value;
    if (annotation.childAnnotationIds.length > 0) {
      const id = annotation.childAnnotationIds[
        annotation.childAnnotationIds.length - 1
      ];
      const annotationRef = annotationLayer.source.getReference(id);
      annotationLayer.source.delete(annotationRef);
      annotationRef.dispose();
      this.childTool.inProgressAnnotation.value!.disposer();
      this.childTool.inProgressAnnotation.value = undefined;
    }

    if (annotation.childAnnotationIds.length > 0) {
      const updatePointB = () => {
        const state = this.childTool.inProgressAnnotation.value!;
        const reference = state.reference;
        const newAnnotation = this.childTool.getUpdatedAnnotation(
          <Line>reference.value!, mouseState, annotationLayer
        );
        if (JSON.stringify(annotationToJson(
          newAnnotation, annotationLayer.source
        )) === JSON.stringify(annotationToJson(
          reference.value!, annotationLayer.source)
        )) {
          return;
        }
        state.annotationLayer.source.update(reference, newAnnotation);
        this.childTool.layer.selectAnnotation(
          annotationLayer,
          reference.id,
          true
        );
      };

      const id = annotation.childAnnotationIds[
        annotation.childAnnotationIds.length - 1
      ];
      const reference = annotationLayer.source.getReference(id);
      this.childTool.layer.selectAnnotation(annotationLayer, reference.id, true);
      const mouseDisposer = mouseState.changed.add(updatePointB);
      const disposer = () => {
        mouseDisposer();
        reference.dispose();
      };
      this.childTool.inProgressAnnotation.value = {
        annotationLayer,
        reference,
        disposer,
      };
    } 
    else {
      if (this.inProgressAnnotation) {
        annotationLayer.source.delete(this.inProgressAnnotation.reference);
        this.inProgressAnnotation.disposer();
        this.inProgressAnnotation = undefined;
      }
    }

    return true;
  }

  /**
   * Adds a new vertex to the polygon in edit mode.
   * @param mouseState 
   * @returns 
   */
  addVertexPolygon(mouseState: MouseSelectionState) {
    const selectedAnnotationId = mouseState.pickedAnnotationId;
    const annotationLayer = mouseState.pickedAnnotationLayer;
    const pickedOffset = mouseState.pickedOffset;

    if (
      annotationLayer === undefined || 
      selectedAnnotationId === undefined || 
      isCornerPicked(pickedOffset)
    ) {
      return;
    }

    const annotationRef = annotationLayer.source.getReference(
      selectedAnnotationId
    );
    if (annotationRef.value!.parentAnnotationId === undefined) {
      return;
    }
    const parentAnnotationId = annotationRef.value!.parentAnnotationId;
    const parentAnnotationRef = annotationLayer.source.getReference(
      parentAnnotationId
    );

    const point = getMousePositionInAnnotationCoordinates(
      mouseState, 
      annotationLayer
    );
    if (
      parentAnnotationRef.value!.type !== AnnotationType.POLYGON || 
      annotationRef.value!.type !== AnnotationType.LINE || 
      point === undefined
    ) {
      return;
    }

    const newAnn1 = <Line>{
      id: '',
      type: AnnotationType.LINE,
      description: parentAnnotationRef.value!.description,
      pointA: (<Line>annotationRef.value).pointA,
      pointB: point,
      properties: Object.assign([], parentAnnotationRef.value!.properties),
    };
    const newAnn2 = <Line>{
      id: '',
      type: AnnotationType.LINE,
      description: parentAnnotationRef.value!.description,
      pointA: point,
      pointB: (<Line>annotationRef.value).pointB,
      properties: Object.assign([], parentAnnotationRef.value!.properties),
    };

    let index = (
      <Polygon>parentAnnotationRef.value!
    ).childAnnotationIds.indexOf(annotationRef.id);
    if (index === -1) {
      index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.length;
    }
    const newAnnRef1 = annotationLayer.source.add(
      newAnn1, 
      false, 
      parentAnnotationRef, 
      index
    );
    const newAnnRef2 = annotationLayer.source.add(
      newAnn2, 
      false, 
      parentAnnotationRef, 
      index + 1
    );

    annotationLayer.source.delete(annotationRef);
    annotationLayer.source.commit(newAnnRef1);
    annotationLayer.source.commit(newAnnRef2);
    annotationRef.dispose();
    newAnnRef1.dispose();
    newAnnRef2.dispose();
    parentAnnotationRef.dispose();
  }

  /**
   * Deletes a vertex of the polygon in edit mode.
   * @param mouseState 
   * @returns 
   */
  deleteVertexPolygon(mouseState: MouseSelectionState) {
    const selectedAnnotationId = mouseState.pickedAnnotationId;
    const annotationLayer = mouseState.pickedAnnotationLayer;
    const pickedOffset = mouseState.pickedOffset;
    if (
      annotationLayer === undefined || 
      selectedAnnotationId === undefined || 
      !isCornerPicked(pickedOffset)
    ) {
      return;
    }
    const annotationRef = annotationLayer.source.getReference(
      selectedAnnotationId
    );
    if (annotationRef.value!.parentAnnotationId === undefined) {
      return;
    }
    const parentAnnotationId = annotationRef.value!.parentAnnotationId;
    const parentAnnotationRef = annotationLayer.source.getReference(
      parentAnnotationId
    );
    const point = getEndPointBasedOnPartIndex(
      <Line>annotationRef.value, 
      pickedOffset
    );
    if (
      parentAnnotationRef.value!.type !== AnnotationType.POLYGON || 
      annotationRef.value!.type !== AnnotationType.LINE || 
      point === undefined
    ) {
      return;
    }

    let annotationRef1 : AnnotationReference|undefined = undefined;
    let annotationRef2 : AnnotationReference|undefined = undefined;
    const childAnnotationIds = (
      <Polygon> parentAnnotationRef.value!
    ).childAnnotationIds;
    if (childAnnotationIds.length <= 3) { 
      return;
    }

    childAnnotationIds.forEach((annotationId) => {
      const annRef = annotationLayer.source.getReference(annotationId);
      const ann = <Line>annRef.value;
      if (arraysEqual(ann.pointA, point)) {
        annotationRef2 = <AnnotationReference>annRef;
      } 
      else if (arraysEqual(ann.pointB, point)) {
        annotationRef1 = <AnnotationReference>annRef;
      } 
      else {
        annRef.dispose();
      }
    });

    if(annotationRef1 === undefined || annotationRef2 === undefined) return;

    annotationRef1 = <AnnotationReference>annotationRef1;
    annotationRef2 = <AnnotationReference>annotationRef2;

    const newAnn = <Line>{
      id: '',
      type: AnnotationType.LINE,
      description: parentAnnotationRef.value!.description,
      pointA: (<Line>annotationRef1.value).pointA,
      pointB: (<Line>annotationRef2.value).pointB,
      properties: Object.assign([], parentAnnotationRef.value!.properties),
    };

    let index = (
      <Polygon>parentAnnotationRef.value!
    ).childAnnotationIds.indexOf(annotationRef1.id);
    if (index === -1) 
      index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.length;
    const newAnnRef = annotationLayer.source.add(
      newAnn, 
      false, 
      parentAnnotationRef, 
      index
    );
    annotationLayer.source.delete(annotationRef1);
    annotationLayer.source.delete(annotationRef2);
    annotationLayer.source.commit(newAnnRef);
    annotationRef1.dispose();
    annotationRef2.dispose();
    newAnnRef.dispose();
    parentAnnotationRef.dispose();
  }

  /**
   * Disposes the annotation tool.
   */
  disposed() {
    if (this.childTool) this.childTool.dispose();

    if (this.inProgressAnnotation && this.annotationLayer) {
      this.annotationLayer.source.delete(this.inProgressAnnotation.reference);
      this.inProgressAnnotation.disposer();
      this.inProgressAnnotation = undefined;
    }

    super.disposed();
  }

  /**
   * Activates the annotation tool if value is true.
   * @param _value 
   */
  setActive(_value: boolean) {
    if (this.active !== _value) {
      this.active = _value;
      if (this.active) {
        if (this.bindingsRef) {
          this.bindingsRef.dispose();
          this.bindingsRef = undefined;
        }
        this.bindingsRef = new RefCounted();
        if (this.bindingsRef) {
          //@ts-ignore
          setPolygonDrawModeInputEventBindings(
            this.bindingsRef, 
            (window as any)['viewer'].inputEventBindings
          );
        } 
      }
      this.childTool.setActive(_value);
      super.setActive(_value);
    }
  }

  /**
   * Deactivates the annotation tool.
   */
  deactivate() {
    this.active = false;
    if (this.bindingsRef) this.bindingsRef.dispose();
    this.bindingsRef = undefined;
    this.childTool.deactivate();
    super.deactivate();
  }

  /**
   * Get polygon description to be shown in top corner of annotation tab.
   */
  get description() {
    return `annotate polygon`;
  }

  toJSON() {
    return ANNOTATE_POLYGON_TOOL_ID;
  }
}
PlacePolygonTool.prototype.annotationType = AnnotationType.POLYGON;

export class PlaceVolumeTool extends PlaceCollectionAnnotationTool {
  childTool: PlacePolygonTool;
  active: boolean;

  constructor(
    public layer: UserLayerWithAnnotations, 
    options: any,
    reference?: AnnotationReference, 
  ) {
    super(layer, options);
    this.active = true;
    this.childTool = new PlacePolygonTool(layer, {...options, parent: this});
    if (reference !== undefined) {
      const { annotationLayer } = this;
      if (annotationLayer === undefined) return;
      const disposer = () => reference.dispose();
      this.inProgressAnnotation = {
        annotationLayer,
        reference,
        disposer,
      };
    }
  }

  trigger(mouseState: MouseSelectionState) {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    if (mouseState.updateUnconditionally()) {
      if (this.inProgressAnnotation === undefined) {
        const annotation = this.getInitialAnnotation(
          mouseState, 
          annotationLayer
        );
        const reference = annotationLayer.source.add(
          annotation, 
          /*commit=*/ false, 
        );
        const disposer = () => reference.dispose();
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };

        this.childTool.trigger(mouseState, reference);
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
      } 
      else {
        const reference = this.inProgressAnnotation.reference;
        this.childTool.trigger(mouseState, reference);
      }
    }
  }

  complete(): boolean {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return false;
    }
    const result = this.childTool.complete();
    if (!result || !this.inProgressAnnotation) {
      return false;
    }

    annotationLayer.source.commit(this.inProgressAnnotation.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      this.inProgressAnnotation.reference.id,
      true
    );

    return true;
  }

  undo(mouseState: MouseSelectionState): boolean {
    return this.childTool.undo(mouseState);
  }

  addVertexPolygon(mouseState: MouseSelectionState) {
    return this.childTool.addVertexPolygon(mouseState);
  }

  deleteVertexPolygon(mouseState: MouseSelectionState) {
    return this.childTool.deleteVertexPolygon(mouseState);
  }

  disposed() {
    if (this.childTool) this.childTool.dispose();

    super.dispose();
  }

  setActive(_value: boolean) {
    if (this.active !== _value) {
      this.active = _value;
      this.childTool.setActive(_value);
      super.setActive(_value);
    }
  }

  deactivate() {
    this.active = false;
    this.childTool.deactivate();
    super.deactivate();
  }

  get description() {
    return `annotate volume`;
  }

  toJSON() {
    return ANNOTATE_VOLUME_TOOL_ID;
  }
}
PlaceVolumeTool.prototype.annotationType = AnnotationType.VOLUME;

export class PlaceCloudTool extends PlaceCollectionAnnotationTool {
  childTool: PlacePointTool;
  active: boolean;

  constructor(
    public layer: UserLayerWithAnnotations, 
    options: any,
    reference?: AnnotationReference, 
  ) {
    super(layer, options);
    this.active = true;
    this.childTool = new PlacePointTool(layer, {...options, parent: this});
    if (reference !== undefined) {
      const { annotationLayer } = this;
      if (annotationLayer === undefined) return;
      const disposer = () => reference.dispose();
      this.inProgressAnnotation = {
        annotationLayer,
        reference,
        disposer,
      };
    }
  }

  trigger(mouseState: MouseSelectionState) {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    if (mouseState.updateUnconditionally()) {
      if (this.inProgressAnnotation === undefined) {
        const annotation = this.getInitialAnnotation(
          mouseState, 
          annotationLayer
        );
        console.log(annotation);
        const reference = annotationLayer.source.add(
          annotation, 
          /*commit=*/ false, 
        );
        const disposer = () => reference.dispose();
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };

        this.childTool.trigger(mouseState, reference);
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
      } 
      else {
        const reference = this.inProgressAnnotation.reference;
        this.childTool.trigger(mouseState, reference);
      }
    }
  }

  complete(): boolean {
    return true;
  }

  undo(mouseState: MouseSelectionState): boolean {
    return true
  }

  disposed() {
    if (this.childTool) this.childTool.dispose();

    super.dispose();
  }

  setActive(_value: boolean) {
    if (this.active !== _value) {
      this.active = _value;
      this.childTool.setActive(_value);
      super.setActive(_value);
    }
  }

  deactivate() {
    this.active = false;
    this.childTool.deactivate();
    super.deactivate();
  }

  get description() {
    return `annotate cloud`;
  }

  toJSON() {
    return ANNOTATE_VOLUME_TOOL_ID;
  }
}
PlaceCloudTool.prototype.annotationType = AnnotationType.CLOUD;
/* BRAINSHARE ENDS */

registerLegacyTool(
  ANNOTATE_POINT_TOOL_ID,
  (layer, options) =>
    new PlacePointTool(<UserLayerWithAnnotations>layer, options),
);
registerLegacyTool(
  ANNOTATE_BOUNDING_BOX_TOOL_ID,
  (layer, options) =>
    new PlaceBoundingBoxTool(<UserLayerWithAnnotations>layer, options),
);
registerLegacyTool(
  ANNOTATE_LINE_TOOL_ID,
  (layer, options) =>
    new PlaceLineTool(<UserLayerWithAnnotations>layer, options),
);
registerLegacyTool(
  ANNOTATE_ELLIPSOID_TOOL_ID,
  (layer, options) =>
    new PlaceEllipsoidTool(<UserLayerWithAnnotations>layer, options),
);
/* BRAINSHARE STARTS */
registerLegacyTool(
  ANNOTATE_POLYGON_TOOL_ID,
  (layer, options) => 
    new PlacePolygonTool(<UserLayerWithAnnotations>layer, options)
);
registerLegacyTool(
  ANNOTATE_VOLUME_TOOL_ID,
  (layer, options) => 
    new PlaceVolumeTool(<UserLayerWithAnnotations>layer, options)
);
/* BRAINSHARE ENDS */

const newRelatedSegmentKeyMap = EventActionMap.fromObject({
  enter: { action: "commit" },
  escape: { action: "cancel" },
});

function makeRelatedSegmentList(
  listName: string,
  segments: Uint64[],
  segmentationDisplayState: WatchableValueInterface<
    SegmentationDisplayState | null | undefined
  >,
  mutate?: ((newSegments: Uint64[]) => void) | undefined,
) {
  return new DependentViewWidget(
    segmentationDisplayState,
    (segmentationDisplayState, parent, context) => {
      const listElement = document.createElement("div");
      listElement.classList.add("neuroglancer-related-segment-list");
      if (segmentationDisplayState != null) {
        context.registerDisposer(
          bindSegmentListWidth(segmentationDisplayState, listElement),
        );
      }
      const headerRow = document.createElement("div");
      headerRow.classList.add("neuroglancer-related-segment-list-header");
      const copyButton = makeCopyButton({
        title: "Copy segment IDs",
        onClick: () => {
          setClipboard(segments.map((x) => x.toString()).join(", "));
        },
      });
      headerRow.appendChild(copyButton);
      let headerCheckbox: HTMLInputElement | undefined;
      if (segmentationDisplayState != null) {
        headerCheckbox = document.createElement("input");
        headerCheckbox.type = "checkbox";
        headerCheckbox.addEventListener("change", () => {
          const { visibleSegments } =
            segmentationDisplayState.segmentationGroupState.value;
          const add = segments.some((id) => !visibleSegments.has(id));
          for (const id of segments) {
            visibleSegments.set(id, add);
          }
        });
        headerRow.appendChild(headerCheckbox);
      }
      if (mutate !== undefined) {
        const deleteButton = makeDeleteButton({
          title: "Remove all IDs",
          onClick: () => {
            mutate([]);
          },
        });
        headerRow.appendChild(deleteButton);
      }
      const titleElement = document.createElement("span");
      titleElement.classList.add("neuroglancer-related-segment-list-title");
      titleElement.textContent = listName;
      headerRow.appendChild(titleElement);
      if (mutate !== undefined) {
        const addButton = makeAddButton({
          title: "Add related segment ID",
          onClick: () => {
            const addContext = new RefCounted();
            const addContextDisposer = context.registerDisposer(
              disposableOnce(addContext),
            );
            const newRow = document.createElement("div");
            newRow.classList.add("neuroglancer-segment-list-entry");
            newRow.classList.add("neuroglancer-segment-list-entry-new");
            const copyButton = makeCopyButton({});
            copyButton.classList.add("neuroglancer-segment-list-entry-copy");
            newRow.appendChild(copyButton);
            if (segmentationDisplayState != null) {
              const checkbox = document.createElement("input");
              checkbox.classList.add(
                "neuroglancer-segment-list-entry-visible-checkbox",
              );
              checkbox.type = "checkbox";
              newRow.appendChild(checkbox);
            }
            const deleteButton = makeDeleteButton({
              title: "Cancel adding new segment ID",
              onClick: () => {
                addContextDisposer();
              },
            });
            deleteButton.classList.add(
              "neuroglancer-segment-list-entry-delete",
            );
            newRow.appendChild(deleteButton);
            const idElement = document.createElement("input");
            idElement.autocomplete = "off";
            idElement.spellcheck = false;
            idElement.classList.add("neuroglancer-segment-list-entry-id");
            const keyboardEventBinder = addContext.registerDisposer(
              new KeyboardEventBinder(idElement, newRelatedSegmentKeyMap),
            );
            keyboardEventBinder.allShortcutsAreGlobal = true;
            const validateInput = () => {
              const id = new Uint64();
              if (id.tryParseString(idElement.value)) {
                idElement.dataset.valid = "true";
                return id;
              }
              idElement.dataset.valid = "false";
              return undefined;
            };
            validateInput();
            idElement.addEventListener("input", () => {
              validateInput();
            });
            idElement.addEventListener("blur", () => {
              const id = validateInput();
              if (id !== undefined) {
                mutate([...segments, id]);
              }
              addContextDisposer();
            });
            registerActionListener(idElement, "cancel", addContextDisposer);
            registerActionListener(idElement, "commit", () => {
              const id = validateInput();
              if (id !== undefined) {
                mutate([...segments, id]);
              }
              addContextDisposer();
            });
            newRow.appendChild(idElement);
            listElement.appendChild(newRow);
            idElement.focus();
            addContext.registerDisposer(() => {
              idElement.value = "";
              newRow.remove();
            });
          },
        });
        headerRow.appendChild(addButton);
      }

      listElement.appendChild(headerRow);

      const rows: HTMLElement[] = [];
      const segmentWidgetFactory = SegmentWidgetFactory.make(
        segmentationDisplayState ?? undefined,
        /*includeMapped=*/ false,
      );
      for (const id of segments) {
        const row = segmentWidgetFactory.get(id);
        rows.push(row);
        if (mutate !== undefined) {
          const deleteButton = makeDeleteButton({
            title: "Remove ID",
            onClick: (event) => {
              mutate(segments.filter((x) => !Uint64.equal(x, id)));
              event.stopPropagation();
            },
          });
          deleteButton.classList.add("neuroglancer-segment-list-entry-delete");
          row.children[0].appendChild(deleteButton);
        }
        listElement.appendChild(row);
      }
      if (segmentationDisplayState != null) {
        const updateSegments = context.registerCancellable(
          animationFrameDebounce(() => {
            const { visibleSegments } =
              segmentationDisplayState.segmentationGroupState.value;
            let numVisible = 0;
            for (const id of segments) {
              if (visibleSegments.has(id)) {
                ++numVisible;
              }
            }
            for (const row of rows) {
              segmentWidgetFactory.update(row);
            }
            headerCheckbox!.checked =
              numVisible === segments.length && numVisible > 0;
            headerCheckbox!.indeterminate =
              numVisible > 0 && numVisible < segments.length;
          }),
        );
        updateSegments();
        updateSegments.flush();
        registerCallbackWhenSegmentationDisplayStateChanged(
          segmentationDisplayState,
          context,
          updateSegments,
        );
        context.registerDisposer(
          segmentationDisplayState.segmentationGroupState.changed.add(
            updateSegments,
          ),
        );
      }
      parent.appendChild(listElement);
    },
  );
}

const ANNOTATION_COLOR_JSON_KEY = "annotationColor";
export function UserLayerWithAnnotationsMixin<
  TBase extends { new (...args: any[]): UserLayer },
>(Base: TBase) {
  abstract class C extends Base implements UserLayerWithAnnotations {
    annotationStates = this.registerDisposer(new MergedAnnotationStates());
    annotationDisplayState = new AnnotationDisplayState();
    annotationCrossSectionRenderScaleHistogram = new RenderScaleHistogram();
    annotationCrossSectionRenderScaleTarget = trackableRenderScaleTarget(8);
    annotationProjectionRenderScaleHistogram = new RenderScaleHistogram();
    annotationProjectionRenderScaleTarget = trackableRenderScaleTarget(8);

    constructor(...args: any[]) {
      super(...args);
      this.annotationDisplayState.color.changed.add(
        this.specificationChanged.dispatch,
      );
      this.annotationDisplayState.shader.changed.add(
        this.specificationChanged.dispatch,
      );
      this.annotationDisplayState.shaderControls.changed.add(
        this.specificationChanged.dispatch,
      );
      this.tabs.add("annotations", {
        label: "Annotations",
        order: 10,
        getter: () => new AnnotationTab(this),
      });

      let annotationStateReadyBinding: (() => void) | undefined;

      const updateReadyBinding = () => {
        const isReady = this.isReady;
        if (isReady && annotationStateReadyBinding !== undefined) {
          annotationStateReadyBinding();
          annotationStateReadyBinding = undefined;
        } else if (!isReady && annotationStateReadyBinding === undefined) {
          annotationStateReadyBinding = this.annotationStates.markLoading();
        }
      };
      this.readyStateChanged.add(updateReadyBinding);
      updateReadyBinding();

      const { mouseState } = this.manager.layerSelectedValues;
      this.registerDisposer(
        mouseState.changed.add(() => {
          if (mouseState.active) {
            const { pickedAnnotationLayer } = mouseState;
            if (
              pickedAnnotationLayer !== undefined &&
              this.annotationStates.states.includes(pickedAnnotationLayer)
            ) {
              const existingValue =
                this.annotationDisplayState.hoverState.value;
              /* BRAINSHARE STARTS */
              const reference = 
                pickedAnnotationLayer.source.getNonDummyAnnotationReference(
                  mouseState.pickedAnnotationId!
                );
              if (reference.value === null) return;
              const annotationId = reference.value!.id;
              /* BRAINSHARE ENDS */
              if (
                existingValue === undefined ||
                /* BRAINSHARE STARTS */
                // existingValue.id !== mouseState.pickedAnnotationId! ||
                existingValue.id !== annotationId ||
                /* BRAINSHARE ENDS */
                existingValue.partIndex !== mouseState.pickedOffset ||
                existingValue.annotationLayerState !== pickedAnnotationLayer
              ) {
                this.annotationDisplayState.hoverState.value = {
                  /* BRAINSHARE STARTS */
                  // id: mouseState.pickedAnnotationId!,
                  id: annotationId,
                  /* BRAINSHARE ENDS */
                  partIndex: mouseState.pickedOffset,
                  annotationLayerState: pickedAnnotationLayer,
                };
              }
              /* BRAINSHARE STARTS */
              reference.dispose();
              /* BRAINSHARE ENDS */
              return;
            }
          }
          this.annotationDisplayState.hoverState.value = undefined;
        }),
      );
    }

    initializeAnnotationLayerViewTab(tab: AnnotationLayerView) {
      tab;
    }

    restoreState(specification: any) {
      super.restoreState(specification);
      this.annotationDisplayState.color.restoreState(
        specification[ANNOTATION_COLOR_JSON_KEY],
      );
    }

    captureSelectionState(
      state: this["selectionState"],
      mouseState: MouseSelectionState,
    ) {
      super.captureSelectionState(state, mouseState);
      const annotationLayer = mouseState.pickedAnnotationLayer;
      if (
        annotationLayer === undefined ||
        !this.annotationStates.states.includes(annotationLayer)
      ) {
        return;
      }

      state.annotationId = mouseState.pickedAnnotationId;
      state.annotationType = mouseState.pickedAnnotationType;
      state.annotationBuffer = new Uint8Array(
        mouseState.pickedAnnotationBuffer!,
        mouseState.pickedAnnotationBufferBaseOffset!,
      );
      state.annotationIndex = mouseState.pickedAnnotationIndex!;
      state.annotationCount = mouseState.pickedAnnotationCount!;
      state.annotationPartIndex = mouseState.pickedOffset;
      state.annotationSourceIndex = annotationLayer.sourceIndex;
      state.annotationSubsource = annotationLayer.subsourceId;
    }

    displayAnnotationState(
      state: this["selectionState"],
      parent: HTMLElement,
      context: RefCounted,
    ): boolean {
      if (state.annotationId === undefined) return false;
      const annotationLayer = this.annotationStates.states.find(
        (x) =>
          x.sourceIndex === state.annotationSourceIndex &&
          x.subsubsourceId === state.annotationSubsubsourceId &&
          (state.annotationSubsource === undefined ||
            x.subsourceId === state.annotationSubsource),
      );
      if (annotationLayer === undefined) return false;
      const reference = context.registerDisposer(
        annotationLayer.source.getReference(state.annotationId),
      );
      parent.appendChild(
        context.registerDisposer(
          new DependentViewWidget(
            context.registerDisposer(
              new AggregateWatchableValue(() => ({
                annotation: reference,
                chunkTransform: annotationLayer.chunkTransform,
              })),
            ),
            ({ annotation, chunkTransform }, parent, context) => {
              let statusText: string | undefined;
              if (annotation == null) {
                if (
                  state.annotationType !== undefined &&
                  state.annotationBuffer !== undefined
                ) {
                  const handler = annotationTypeHandlers[state.annotationType];
                  const rank = annotationLayer.source.rank;
                  const numGeometryBytes = handler.serializedBytes(rank);
                  const baseOffset = state.annotationBuffer.byteOffset;
                  const dataView = new DataView(state.annotationBuffer.buffer);
                  const isLittleEndian = Endianness.LITTLE === ENDIANNESS;
                  const { properties } = annotationLayer.source;
                  const annotationPropertySerializer =
                    new AnnotationPropertySerializer(
                      rank,
                      numGeometryBytes,
                      properties,
                    );
                  const annotationIndex = state.annotationIndex!;
                  const annotationCount = state.annotationCount!;
                  annotation = handler.deserialize(
                    dataView,
                    baseOffset +
                      annotationPropertySerializer.propertyGroupBytes[0] *
                        annotationIndex,
                    isLittleEndian,
                    rank,
                    state.annotationId!,
                  );
                  annotationPropertySerializer.deserialize(
                    dataView,
                    baseOffset,
                    annotationIndex,
                    annotationCount,
                    isLittleEndian,
                    (annotation.properties = new Array(properties.length)),
                  );
                  if (annotationLayer.source.hasNonSerializedProperties()) {
                    statusText = "Loading...";
                  }
                } else {
                  statusText =
                    annotation === null ? "Annotation not found" : "Loading...";
                }
              }
              if (annotation != null) {
                const layerRank =
                  chunkTransform.error === undefined
                    ? chunkTransform.layerRank
                    : 0;
                const positionGrid = document.createElement("div");
                positionGrid.classList.add(
                  "neuroglancer-selected-annotation-details-position-grid",
                );
                /* BRAINSHARE STARTS */
                // Restyle annotation detail list
                /*
                positionGrid.style.gridTemplateColumns = `[icon] 0fr [copy] 0fr repeat(${layerRank}, [dim] 0fr [coord] 0fr) [move] 0fr [delete] 0fr`;
                parent.appendChild(positionGrid);

                const handler = annotationTypeHandlers[annotation.type];
                const icon = document.createElement("div");
                icon.className =
                  "neuroglancer-selected-annotation-details-icon";
                icon.textContent = handler.icon;
                positionGrid.appendChild(icon);

                if (layerRank !== 0) {
                  const { layerDimensionNames } = (
                    chunkTransform as ChunkTransformParameters
                  ).modelTransform;
                  for (let i = 0; i < layerRank; ++i) {
                    const dimElement = document.createElement("div");
                    dimElement.classList.add(
                      "neuroglancer-selected-annotation-details-position-dim",
                    );
                    dimElement.textContent = layerDimensionNames[i];
                    dimElement.style.gridColumn = `dim ${i + 1}`;
                    positionGrid.appendChild(dimElement);
                  }
                  visitTransformedAnnotationGeometry(
                    annotation,
                    chunkTransform as ChunkTransformParameters,
                    (layerPosition, isVector) => {
                      const copyButton = makeCopyButton({
                        title: "Copy position",
                        onClick: () => {
                          setClipboard(
                            layerPosition.map((x) => Math.floor(x)).join(", "),
                          );
                        },
                      });
                      copyButton.style.gridColumn = "copy";
                      positionGrid.appendChild(copyButton);
                      for (let layerDim = 0; layerDim < layerRank; ++layerDim) {
                        const coordElement = document.createElement("div");
                        coordElement.classList.add(
                          "neuroglancer-selected-annotation-details-position-coord",
                        );
                        coordElement.style.gridColumn = `coord ${layerDim + 1}`;
                        coordElement.textContent = Math.floor(
                          layerPosition[layerDim],
                        ).toString();
                        positionGrid.appendChild(coordElement);
                      }
                      if (!isVector) {
                        const moveButton = makeMoveToButton({
                          title: "Move to position",
                          onClick: () => {
                            setLayerPosition(
                              this,
                              chunkTransform,
                              layerPosition,
                            );
                          },
                        });
                        moveButton.style.gridColumn = "move";
                        positionGrid.appendChild(moveButton);
                      }
                    },
                  );
                }
                
                if (!annotationLayer.source.readonly) {
                  const button = makeDeleteButton({
                    title: "Delete annotation",
                    onClick: () => {
                      annotationLayer.source.delete(reference);
                    },
                  });
                  button.classList.add(
                    "neuroglancer-selected-annotation-details-delete",
                  );
                  positionGrid.appendChild(button);
                }
                */

                positionGrid.style.gridTemplateColumns = `
                  [icon] 0fr 
                  [copy] 0fr 
                  repeat(${layerRank}, [dim] 0fr [coord] 0fr) 
                  [move] 0fr 
                  [delete] 0fr
                  [show] 0fr
                `;
                parent.appendChild(positionGrid);
                const addListEntry = (
                  grid: HTMLDivElement, 
                  annRef: AnnotationReference,
                ) => {
                  const handler = annotationTypeHandlers[annRef.value!.type];
                  const icon = makeIcon({ 
                    text: handler.icon, 
                    title: "Select annotation",
                    onClick: () => {
                      this.selectAnnotation(
                        annotationLayer, 
                        annRef.value!.id, 
                        true
                      );
                    }
                  });
                  icon.classList.add(
                    "neuroglancer-selected-annotation-details-icon"
                  );
                  grid.appendChild(icon);

                  if (layerRank !== 0) {
                    const { layerDimensionNames } = (
                      chunkTransform as ChunkTransformParameters
                    ).modelTransform;
                    for (let i = 0; i < layerRank; ++i) {
                      const dimElement = document.createElement("div");
                      dimElement.classList.add(
                        "neuroglancer-selected-annotation-details-position-dim",
                      );
                      dimElement.textContent = layerDimensionNames[i];
                      dimElement.style.gridColumn = `dim ${i + 1}`;
                      grid.appendChild(dimElement);
                    }
                    visitTransformedAnnotationGeometry(
                      annRef.value!,
                      chunkTransform as ChunkTransformParameters,
                      (layerPosition, isVector) => {
                        const copyButton = makeCopyButton({
                          title: "Copy position",
                          onClick: () => {
                            const json = annotationToPortableJson(
                              annRef.value!, 
                              annotationLayer.source,
                              this.manager.root.coordinateSpace.value,
                            )
                            setClipboard(JSON.stringify(json));
                          },
                        });
                        copyButton.style.gridColumn = "copy";
                        grid.appendChild(copyButton);
                        for (let i = 0; i < layerRank; ++i) {
                          const coordElement = document.createElement("div");
                          coordElement.classList.add(
                            "neuroglancer-selected-annotation-details-position-coord",
                          );
                          coordElement.style.gridColumn = `coord ${i + 1}`;
                          coordElement.textContent = Math.floor(
                            layerPosition[i],
                          ).toString();
                          grid.appendChild(coordElement);
                        }
                        if (!isVector) {
                          const moveButton = makeMoveToButton({
                            title: "Move to position",
                            onClick: () => {
                              setLayerPosition(
                                this,
                                chunkTransform,
                                layerPosition,
                              );
                            },
                          });
                          moveButton.style.gridColumn = "move";
                          grid.appendChild(moveButton);
                        }
                      },
                    );

                    if (
                      !annotationLayer.source.readonly && 
                      !annRef.value!.parentAnnotationId
                    ) {
                      const deleteButton = makeDeleteButton({
                        title: "Delete annotation",
                        onClick: () => {
                          annotationLayer.source.delete(annRef);
                        },
                      });
                      deleteButton.classList.add(
                        "neuroglancer-selected-annotation-details-delete",
                      );
                      positionGrid.appendChild(deleteButton);
                      
                      const isVisible = annotationLayer.source.getVisibility(
                        annRef.value!.id,
                      ) == 1.0;
                      const hideButton = makeIcon({
                        svg: svg_eye,
                        title: 'Hide annotation',
                        onClick: () => {
                          annotationLayer.source.updateVisibility(annRef, 0.0);
                          hideButton.style.display = 'none';
                          hideButton.style.gridColumn = "";
                          showButton.style.display = '';
                          showButton.style.gridColumn = "visible";
                        }
                      });
                      hideButton.style.display = isVisible ? '' : 'none';
                      const showButton = makeIcon({
                        svg: svg_eye_crossed,
                        title: 'Show annotation',
                        onClick: () => {
                          annotationLayer.source.updateVisibility(annRef, 1.0);
                          showButton.style.display = 'none';
                          showButton.style.gridColumn = "";
                          hideButton.style.display = '';
                          hideButton.style.gridColumn = "visible";
                        }
                      });
                      showButton.style.display = !isVisible ? '' : 'none';
                      positionGrid.appendChild(showButton);
                      positionGrid.appendChild(hideButton);
                    }
                  }
                }
                
                addListEntry(positionGrid, reference);
                if (annotation.childAnnotationIds) {
                  for (const childId of annotation.childAnnotationIds) {
                    const childRef = annotationLayer.source.getReference(
                      childId
                    );
                    addListEntry(positionGrid, childRef);
                  }
                }

                if (
                  reference.value && 
                  reference.value.type === AnnotationType.VOLUME
                ) {
                  const editButton = makeAddButton({
                    title: "Edit annotation",
                    onClick: () => {
                      this.tool.value = new PlaceVolumeTool(
                        this, 
                        {}, 
                        reference
                      );
                    },
                  });
                  editButton.style.gridColumn = "icon";
                  positionGrid.appendChild(editButton);

                  const pasteButton = makeIcon({ 
                    svg: svg_clipBoard,
                    title: "Paste annotation from the system's clipboard",
                    onClick: () => {
                      const coordinateSpace = this.manager.root.coordinateSpace
                        .value;
                      const position = this.manager.root.globalPosition.value;
                      navigator.clipboard.readText().then((text) => {
                        let annotations: Annotation[];
                        try {
                          const json = JSON.parse(text);
                          annotations = portableJsonToAnnotations(
                            json,
                            annotationLayer.source,
                            coordinateSpace,
                          );
                        }
                        catch (e) {
                          StatusMessage.showTemporaryMessage(
                            "The annotation to paste is invalid."
                          );
                          return;
                        }

                        if (annotations[0].type !== AnnotationType.POLYGON) {
                          StatusMessage.showTemporaryMessage(
                            "The annotation to paste is not a polygon."
                          );
                          return;
                        }

                        const center = new Float32Array(position.length);
                        const translations = new Float64Array(position.length);
                        getCenterPosition(center, annotations[0]);
                        vector.subtract(translations, position, center);

                        if (!isSectionValid(
                          annotationLayer, 
                          reference.id, 
                          Math.floor(position[2]),
                        )) {
                          StatusMessage.showTemporaryMessage(
                            "A polygon already exists in this section for the \
                            volume, only one polygon per section is allowed \
                            for a volume."
                          );
                          return;
                        }

                        for (let i = 0; i < annotations.length; i++) {
                          const newAnnotation = translateAnnotationPoints(
                            annotations[i],
                            translations
                          );
                          annotationLayer.source.add(
                            newAnnotation,
                            /*commit=*/ true,
                            i == 0 ? reference : undefined,
                          );
                        }
                      });
                    },
                  });
                  pasteButton.style.gridColumn = "copy";
                  positionGrid.appendChild(pasteButton);
                }
                /* BRAINSHARE ENDS */
                const { relationships, properties } = annotationLayer.source;
                const sourceReadonly = annotationLayer.source.readonly;

                for (let i = 0, count = properties.length; i < count; ++i) {
                  const property = properties[i];
                  const label = document.createElement("label");
                  label.classList.add("neuroglancer-annotation-property");
                  const idElement = document.createElement("span");
                  idElement.classList.add(
                    "neuroglancer-annotation-property-label",
                  );
                  idElement.textContent = property.identifier;
                  label.appendChild(idElement);
                  const { description } = property;
                  if (description !== undefined) {
                    label.title = description;
                  }
                  const value = annotation.properties[i];
                  const valueElement = document.createElement("span");
                  valueElement.classList.add(
                    "neuroglancer-annotation-property-value",
                  );
                  switch (property.type) {
                    case "rgb": {
                      const colorVec = unpackRGB(value);
                      const hex = serializeColor(colorVec);
                      valueElement.textContent = hex;
                      valueElement.style.backgroundColor = hex;
                      valueElement.style.color = useWhiteBackground(colorVec)
                        ? "white"
                        : "black";
                      break;
                    }
                    case "rgba": {
                      const colorVec = unpackRGB(value);
                      valueElement.textContent = serializeColor(
                        unpackRGBA(value),
                      );
                      valueElement.style.backgroundColor = serializeColor(
                        unpackRGB(value),
                      );
                      valueElement.style.color = useWhiteBackground(colorVec)
                        ? "white"
                        : "black";
                      break;
                    }
                    default:
                      valueElement.textContent = formatNumericProperty(
                        property,
                        value,
                      );
                      break;
                  }
                  label.appendChild(valueElement);
                  parent.appendChild(label);
                  /* BRAINSHARE STARTS */
                  // Create a color widget in annotation selection panel.
                  // The button is hidden, but the widget is usable.
                  if (property.identifier === "color") {
                    const colorVec = unpackRGB(annotation.properties[i]);
                    const colorInput = document.createElement("input");
                    colorInput.type = "color";
                    if (reference.value && reference.value.parentAnnotationId) {
                      colorInput.disabled = true;
                    };                          
                    colorInput.value = serializeColor(colorVec);
                    colorInput.style.backgroundColor = serializeColor(colorVec);
                    colorInput.style.width = "0";
                    colorInput.style.height = "0";
                    colorInput.style.border = "0";
                    colorInput.style.padding = "0";
                    colorInput.addEventListener("change", () => {
                      const colorNum = packColor(
                        parseRGBColorSpecification(colorInput.value)
                      )
                      annotationLayer.source.updateColor(reference, colorNum);
                    });
                    label.appendChild(colorInput);
                  }
                  /* BRAINSHARE ENDS */
                }

                const { relatedSegments } = annotation;
                for (let i = 0, count = relationships.length; i < count; ++i) {
                  const related =
                    relatedSegments === undefined ? [] : relatedSegments[i];
                  if (related.length === 0 && sourceReadonly) continue;
                  const relationshipIndex = i;
                  const relationship = relationships[i];
                  parent.appendChild(
                    context.registerDisposer(
                      makeRelatedSegmentList(
                        relationship,
                        related,
                        annotationLayer.displayState.relationshipStates.get(
                          relationship,
                        ).segmentationState,
                        sourceReadonly
                          ? undefined
                          : (newIds) => {
                              const annotation = reference.value;
                              if (annotation == null) {
                                return;
                              }
                              let { relatedSegments } = annotation;
                              if (relatedSegments === undefined) {
                                relatedSegments =
                                  annotationLayer.source.relationships.map(
                                    () => [],
                                  );
                              } else {
                                relatedSegments = relatedSegments.slice();
                              }
                              relatedSegments[relationshipIndex] = newIds;
                              const newAnnotation = {
                                ...annotation,
                                relatedSegments,
                              };
                              annotationLayer.source.update(
                                reference,
                                newAnnotation,
                              );
                              annotationLayer.source.commit(reference);
                            },
                      ),
                    ).element,
                  );
                }

                if (
                  !annotationLayer.source.readonly ||
                  annotation.description
                ) {
                  if (annotationLayer.source.readonly) {
                    const description = document.createElement("div");
                    description.className =
                      "neuroglancer-annotation-details-description";
                    description.textContent = annotation.description || "";
                    parent.appendChild(description);
                  } else {
                    const description = document.createElement("textarea");
                    description.value = annotation.description || "";
                    description.rows = 3;
                    description.className =
                      "neuroglancer-annotation-details-description";
                    description.placeholder = "Description";
                    description.addEventListener("change", () => {
                      const x = description.value;
                      annotationLayer.source.update(reference, {
                        ...annotation!,
                        description: x ? x : undefined,
                      });
                      annotationLayer.source.commit(reference);
                    });
                    parent.appendChild(description);
                  }
                }
              }
              if (statusText !== undefined) {
                const statusMessage = document.createElement("div");
                statusMessage.classList.add(
                  "neuroglancer-selection-annotation-status",
                );
                statusMessage.textContent = statusText;
                parent.appendChild(statusMessage);
              }
            },
          ),
        ).element,
      );
      return true;
    }

    displaySelectionState(
      state: this["selectionState"],
      parent: HTMLElement,
      context: DependentViewContext,
    ): boolean {
      let displayed = this.displayAnnotationState(state, parent, context);
      if (super.displaySelectionState(state, parent, context)) displayed = true;
      return displayed;
    }

    addLocalAnnotations(
      loadedSubsource: LoadedDataSubsource,
      source: AnnotationSource,
      role: RenderLayerRole,
    ) {
      const { subsourceEntry } = loadedSubsource;
      const state = new AnnotationLayerState({
        localPosition: this.localPosition,
        transform: loadedSubsource.getRenderLayerTransform(),
        source,
        displayState: this.annotationDisplayState,
        dataSource: loadedSubsource.loadedDataSource.layerDataSource,
        subsourceIndex: loadedSubsource.subsourceIndex,
        subsourceId: subsourceEntry.id,
        role,
      });
      this.addAnnotationLayerState(state, loadedSubsource);
    }

    addStaticAnnotations(loadedSubsource: LoadedDataSubsource) {
      const { subsourceEntry } = loadedSubsource;
      const { staticAnnotations } = subsourceEntry.subsource;
      if (staticAnnotations === undefined) return false;
      loadedSubsource.activate(() => {
        this.addLocalAnnotations(
          loadedSubsource,
          staticAnnotations,
          RenderLayerRole.DEFAULT_ANNOTATION,
        );
      });
      return true;
    }

    addAnnotationLayerState(
      state: AnnotationLayerState,
      loadedSubsource: LoadedDataSubsource,
    ) {
      const refCounted = loadedSubsource.activated!;
      refCounted.registerDisposer(this.annotationStates.add(state));
      const annotationLayer = new AnnotationLayer(
        this.manager.chunkManager,
        state.addRef(),
      );
      if (annotationLayer.source instanceof MultiscaleAnnotationSource) {
        const crossSectionRenderLayer =
          new SpatiallyIndexedSliceViewAnnotationLayer({
            annotationLayer: annotationLayer.addRef(),
            renderScaleTarget: this.annotationCrossSectionRenderScaleTarget,
            renderScaleHistogram:
              this.annotationCrossSectionRenderScaleHistogram,
          });
        refCounted.registerDisposer(
          loadedSubsource.messages.addChild(crossSectionRenderLayer.messages),
        );

        const projectionRenderLayer =
          new SpatiallyIndexedPerspectiveViewAnnotationLayer({
            annotationLayer: annotationLayer.addRef(),
            renderScaleTarget: this.annotationProjectionRenderScaleTarget,
            renderScaleHistogram: this.annotationProjectionRenderScaleHistogram,
          });
        refCounted.registerDisposer(
          loadedSubsource.messages.addChild(projectionRenderLayer.messages),
        );

        refCounted.registerDisposer(
          registerNested((context, value) => {
            if (value) {
              context.registerDisposer(
                this.addRenderLayer(crossSectionRenderLayer.addRef()),
              );
              context.registerDisposer(
                this.addRenderLayer(projectionRenderLayer.addRef()),
              );
            }
          }, this.annotationDisplayState.displayUnfiltered),
        );
      }
      {
        const renderLayer = new SliceViewAnnotationLayer(
          annotationLayer,
          this.annotationCrossSectionRenderScaleHistogram,
        );
        refCounted.registerDisposer(this.addRenderLayer(renderLayer));
        refCounted.registerDisposer(
          loadedSubsource.messages.addChild(renderLayer.messages),
        );
      }
      {
        const renderLayer = new PerspectiveViewAnnotationLayer(
          annotationLayer.addRef(),
          this.annotationProjectionRenderScaleHistogram,
        );
        refCounted.registerDisposer(this.addRenderLayer(renderLayer));
        refCounted.registerDisposer(
          loadedSubsource.messages.addChild(renderLayer.messages),
        );
      }
    }

    selectAnnotation(
      annotationLayer: Borrowed<AnnotationLayerState>,
      id: string,
      pin: boolean | "toggle",
    ) {
      this.manager.root.selectionState.captureSingleLayerState(
        this,
        (state) => {
          state.annotationId = id;
          state.annotationSourceIndex = annotationLayer.sourceIndex;
          state.annotationSubsource = annotationLayer.subsourceId;
          state.annotationSubsubsourceId = annotationLayer.subsubsourceId;
          return true;
        },
        pin,
      );
    }

    toJSON() {
      const x = super.toJSON();
      x[ANNOTATION_COLOR_JSON_KEY] = this.annotationDisplayState.color.toJSON();
      return x;
    }
  }
  return C;
}

export type UserLayerWithAnnotations = InstanceType<
  ReturnType<typeof UserLayerWithAnnotationsMixin>
>;
