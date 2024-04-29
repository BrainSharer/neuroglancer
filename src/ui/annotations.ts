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
import { ElementVisibilityFromTrackableBoolean } from "#/trackable_boolean";
import {
  AggregateWatchableValue,
  makeCachedLazyDerivedWatchableValue,
  registerNested,
  WatchableValue,
  WatchableValueInterface,
} from "#/trackable_value";
/* BRAINSHARE STARTS */
// import { getDefaultAnnotationListBindings } from "#/ui/default_input_event_bindings";
import {
  getDefaultAnnotationListBindings, 
  // setPointDrawModeInputEventBindings, 
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
  // parseRGBAColorSpecification, 
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
import { removeFromParent } from "#/util/dom";
import { StatusMessage } from '#/status';
import { getZCoordinate, isPointUniqueInPolygon } from '#/annotation/polygon';
import { isSectionValid } from '#/annotation/volume';
import { getEndPointBasedOnPartIndex, isCornerPicked } from '../annotation/line';
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
  /* BRAINSHARE STARTS */
  idToLevel: Map<AnnotationId, number>;
  /* BRAINSHARE ENDS */
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
  /* BRAINSHARE STARTS */
  private annotationColorPicker: AnnotationColorWidget | undefined = undefined;
  /* BRAINSHARE ENDS */

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
  /* BRAINSHARE STARTS */
  // volumeSession = document.createElement('div');
  // cellSession = document.createElement('div');
  // comSession = document.createElement('div');
  // volumeButton: HTMLElement;
  // cellButton: HTMLElement;
  // comButton: HTMLElement;
  /* BRAINSHARE ENDS */

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
        /* BRAINSHARE STARTS */
        idToLevel: new Map(),
        /* BRAINSHARE ENDS */
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
    const colorPicker = this.registerDisposer(
      new ColorWidget(this.displayState.color),
    );
    colorPicker.element.title = "Change annotation display color";
    this.registerDisposer(
      new ElementVisibilityFromTrackableBoolean(
        makeCachedLazyDerivedWatchableValue(
          (shader) => shader.match(/\bdefaultColor\b/) !== null,
          displayState.shaderControls.processedFragmentMain,
        ),
        colorPicker.element,
      ),
    );
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
        this.layer.tool.value = new PlacePolygonTool(this.layer, undefined);
      },
    });
    mutableControls.appendChild(polygonButton);
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
    // console.log("AnnotationLayerView > updatedSelectionView");
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
    // console.log("AnnotationLayerView > updatedHoverView");
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
    // console.log("AnnotationLayerView > render");
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
    // console.log("AnnotationLayerView > updateView");
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
      const annotations = Array.from(source);
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
    // console.log("AnnotationLayerView > updateListLength");
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
    // console.log("AnnotationLayerView > addAnnotationElement");
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
    console.log("AnnotationLayerView > updateAnnotationElement");
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
    // console.log("AnnotationLayerView > deleteAnnotationElement");
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
    // console.log("AnnotationLayerView > makeAnnotationListElement");
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

/* BRAINSHARE STARTS */
/**
 * AnnotationColorWidget creates an color HTML element for 
 * selecting the color while annotating.
 */
export class AnnotationColorWidget extends RefCounted {
  element = document.createElement('input');

  constructor() {
    super();
    const {element} = this;
    element.classList.add('neuroglancer-color-widget');
    element.type = 'color';
  }
  /**
   * Sets the color of the widget element
   * @param color input color to be set
   */
  setColor(color: string) {
    this.element.value = color;
  }
  /**
   * 
   * @returns returns the element color
   */
  getColor() {
    return this.element.value;
  }
  /**
   * Delets the element from the HTML element it was embedded in.
   */
  disposed() {
    removeFromParent(this.element);
    super.disposed();
  }
}
/* BRAINSHARE ENDS */

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
  setActive(_value: boolean): void {}

  get annotationColorPicker(): AnnotationColorWidget | undefined {
    return this.layer.annotationColorPicker;
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
// const ANNOTATE_CELL_TOOL_ID = 'annotateCell';
// const ANNOTATE_COM_TOOL_ID = 'annotateCom';
/* BRAINSHARE ENDS */

export class PlacePointTool extends PlaceAnnotationTool {
  trigger(mouseState: MouseSelectionState) {
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
        properties: annotationLayer.source.properties.map((x) => x.default),
      };
      const reference = annotationLayer.source.add(
        annotation,
        /*commit=*/ true,
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
  trigger(
    mouseState: MouseSelectionState,
    parentRef?: AnnotationReference
  ) {
  /* BRAINSHARE ENDS */
    console.log("TwoStepAnnotationTool > trigger")
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
        // const reference = annotationLayer.source.add(
        //   this.getInitialAnnotation(mouseState, annotationLayer),
        //   /*commit=*/ false,
        // );
        const initAnn = this.getInitialAnnotation(mouseState, annotationLayer);
        if (parentRef) {
          initAnn.description = parentRef.value!.description;
          initAnn.properties = Object.assign([], parentRef.value!.properties);
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
      properties: annotationLayer.source.properties.map((x) => x.default),
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
      properties: annotationLayer.source.properties.map((x) => x.default),
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
  annotationType: AnnotationType.POLYGON | AnnotationType.VOLUME;

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
    const { annotationColorPicker } = this;

    return <Polygon | Volume> {
      id: '',
      type: this.annotationType,
      description: '',
      source: point,
      properties: annotationLayer.source.properties.map(x => {
        if (x.identifier !== 'color') 
          return x.default;
        if (x.identifier === 'color' && annotationColorPicker === undefined) 
          return x.default;
        const colorInNum = packColor(parseRGBColorSpecification(
          annotationColorPicker!.getColor()
        ));
        return colorInNum;
      }),
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

let volume_tool_used: boolean = false;
let last_location = new Float32Array(3);
let source_location = new Float32Array(3);
let inProgressAnnotation = false;
let global_sourceMouseState: MouseSelectionState;
//@ts-ignore
let global_childAnnotationIds: string[];
//let global_annotation;
//@ts-ignore
let polygon_id;
//@ts-ignore
let global_mouseState;
//@ts-ignore
let global_parentRef;

export function clearVolumeToolState() {
  inProgressAnnotation = false;
  global_childAnnotationIds = [];
  polygon_id = undefined;
}

export function getInProgressAnnotation() {
  return inProgressAnnotation;
}

export function setInProgressAnnotation(value: boolean) {
  inProgressAnnotation = value;
}

export function getVolumeToolUsed() {
  return volume_tool_used;
}

export function clearVolumeToolUsed() {
  volume_tool_used = false;
}

/**
 * This class is used to draw polygon annotations.
 */
export class PlacePolygonTool extends PlaceCollectionAnnotationTool {
  childTool: PlaceLineTool;
  sourceMouseState: MouseSelectionState;
  sourcePosition: Float32Array|undefined;
  bindingsRef: RefCounted|undefined;
  active: boolean;
  zCoordinate: number|undefined;

  constructor(public layer: UserLayerWithAnnotations, options: any) {
    console.log("PlacePolygonTool > constructor")
    super(layer, options);
    this.active = true;
    this.childTool = new PlaceLineTool(layer, {...options, parent: this});
    this.bindingsRef = new RefCounted();
    setPolygonDrawModeInputEventBindings(
      this.bindingsRef, 
      (window as any)['viewer'].inputEventBindings
    );
  }

  restore_multi_user_drawing() {
    const {annotationLayer} = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    if(
      inProgressAnnotation && 
      // urlParams.multiUserMode && 
      this.inProgressAnnotation === undefined
    ) {
      this.sourceMouseState = <MouseSelectionState>{...global_sourceMouseState};
      this.sourcePosition = getMousePositionInAnnotationCoordinates(
        this.sourceMouseState, 
        annotationLayer
      );

      // Restore state of polygon tool
      //@ts-ignore
      this.zCoordinate = getZCoordinate(this.sourcePosition);
      //@ts-ignore
      let reference = annotationLayer.source.getReference(polygon_id);
      this.layer.selectAnnotation(annotationLayer, reference.id, true);
      //@ts-ignore
      global_mouseState.unsnappedPosition = new Float32Array(last_location);
      //@ts-ignore
      reference.value!.childAnnotationIds = global_childAnnotationIds;
      //@ts-ignore
      reference.value!.childAnnotationIds.pop();
      //@ts-ignore
      this.childTool.trigger(global_mouseState, reference);

      const disposer = () => {
        reference.dispose();
      };
      this.inProgressAnnotation = {
        //@ts-ignore
        annotationLayer,
        reference,
        disposer,
      };

      //@ts-ignore
      global_childAnnotationIds = this.inProgressAnnotation.reference.value.childAnnotationIds;
    }
  }

  /**
   * This function is called when the user tries to draw annotation
   * @param mouseState
   * @param parentRef optional parent reference passed from parent tool.
   * @returns void
   */
  trigger(mouseState: MouseSelectionState, parentRef?: AnnotationReference) {
    console.log("PlacePolygonTool > trigger")
    volume_tool_used = true;
    global_mouseState = mouseState;
    const {annotationLayer} = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    if (mouseState.updateUnconditionally()) {
      if (this.inProgressAnnotation === undefined) {
        if (parentRef) {
          const point = getMousePositionInAnnotationCoordinates(
            mouseState, 
            annotationLayer
          );
          if (point === undefined) return;
          this.zCoordinate = getZCoordinate(point);
          if (this.zCoordinate === undefined) return;
          if (!isSectionValid(annotationLayer, parentRef.id, this.zCoordinate)) {
            StatusMessage.showTemporaryMessage(
              "A polygon already exists in this section for the volume, \
              only one polygon per section is allowed for a volume"
            );
            return;
          }
        }

        global_sourceMouseState = <MouseSelectionState>{...mouseState};
        this.sourceMouseState = <MouseSelectionState>{...mouseState};
        
        this.sourcePosition = getMousePositionInAnnotationCoordinates(
          mouseState, 
          annotationLayer
        );

        source_location = new Float32Array(mouseState.unsnappedPosition);
        const annotation = this.getInitialAnnotation(
          mouseState, 
          annotationLayer
        );
        if (parentRef) {
          //annotation.description = parentRef.value!.description;
          annotation.properties = Object.assign([], parentRef.value!.properties);
        }
        const reference = annotationLayer.source.add(
          annotation, 
          /*commit=*/ false, 
          parentRef
        );
        reference.value;
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
        polygon_id = reference.id;
        last_location = new Float32Array(mouseState.unsnappedPosition);
        this.childTool.trigger(mouseState, reference);
        const disposer = () => {
          reference.dispose();
        };
        inProgressAnnotation = true;
        //@ts-ignore
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };
        //@ts-ignore
        global_childAnnotationIds = this.inProgressAnnotation.reference.value.childAnnotationIds;
      } 
      else {
        const point = getMousePositionInAnnotationCoordinates(
          mouseState, 
          annotationLayer
        );

        if (point === undefined) return;
        if(!isPointUniqueInPolygon(
          annotationLayer, 
          <Polygon>(this.inProgressAnnotation.reference.value!), point)
        ) {
          StatusMessage.showTemporaryMessage(
            "All vertices of polygon must be unique"
          );
          return;
        }

        if (parentRef) {
          const {zCoordinate} = this;
          // const point = getMousePositionInAnnotationCoordinates(mouseState, annotationLayer);
          // if (point === undefined) return;
          const newZCoordinate = getZCoordinate(point);
          if (zCoordinate === undefined || newZCoordinate === undefined) return;
          if (zCoordinate !== newZCoordinate) {
            StatusMessage.showTemporaryMessage(
              "All vertices of polygon must be in same plane"
            );
            return;
          }
        }
        last_location = new Float32Array(mouseState.unsnappedPosition);
        this.childTool.trigger(mouseState, this.inProgressAnnotation.reference);
        //start new annotation
        this.childTool.trigger(mouseState, this.inProgressAnnotation.reference);
        //@ts-ignore
        global_childAnnotationIds = this.inProgressAnnotation.reference.value.childAnnotationIds;
      }
    }
  }

  /**
   * Disposes the annotation tool.
   */
  dispose() {
    if(this.bindingsRef) this.bindingsRef.dispose();
    this.bindingsRef = undefined;
    if (this.childTool) {
      this.childTool.dispose();
    }
    // completely delete the annotation
    this.disposeAnnotation();
    super.dispose();
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
   * Completes the last edge of polygon to be drawn.
   * @returns true if the operation suceeded otherwise false.
   */
  complete(): boolean {
    volume_tool_used = true;
    const {annotationLayer} = this;

    if(
      inProgressAnnotation && 
      // urlParams.multiUserMode && 
      this.inProgressAnnotation === undefined && 
      annotationLayer != undefined
    ) {
      global_sourceMouseState.unsnappedPosition = source_location;
      this.sourceMouseState = global_sourceMouseState;
      this.sourcePosition = getMousePositionInAnnotationCoordinates(
        this.sourceMouseState, 
        annotationLayer
      );
      this.sourcePosition = source_location;

      // Restore state of polygon tool
      //@ts-ignore
      this.zCoordinate = getZCoordinate(this.sourcePosition);
      //@ts-ignore
      let reference = annotationLayer.source.getReference(polygon_id);
      this.layer.selectAnnotation(annotationLayer, reference.id, true);
      //@ts-ignore
      reference.value!.childAnnotationIds = global_childAnnotationIds;
      //@ts-ignore
      reference.value!.childAnnotationIds.pop();
      //@ts-ignore
      global_mouseState.unsnappedPosition = new Float32Array(last_location);
      
      //@ts-ignore
      this.childTool.trigger(global_mouseState, reference);

      const disposer = () => {
        reference.dispose();
      };
      this.inProgressAnnotation = {
        //@ts-ignore
        annotationLayer,
        reference,
        disposer,
      };

      //@ts-ignore
      global_childAnnotationIds = this.inProgressAnnotation.reference.value.childAnnotationIds;
    }
    this.sourcePosition = source_location;
    inProgressAnnotation = false;
    const state = this.inProgressAnnotation;
    if(annotationLayer === undefined || state === undefined) {
      return false;
    }

    if(this.completeLastLine()) {
      annotationLayer.source.commit(this.inProgressAnnotation!.reference);
      this.layer.selectAnnotation(
        annotationLayer, 
        this.inProgressAnnotation!.
        reference.id, 
        true
      );
      this.inProgressAnnotation!.disposer();
      inProgressAnnotation = false;
      this.inProgressAnnotation = undefined;
      this.sourcePosition = undefined;
      global_childAnnotationIds = [];
      polygon_id = undefined;
      return true;
    }

    return false;
  }

  /**
   * Dispose current active annotation.
   */
  private disposeAnnotation() {
    if (this.inProgressAnnotation && this.annotationLayer) {
      this.annotationLayer.source.delete(this.inProgressAnnotation.reference);
      this.inProgressAnnotation.disposer();
      this.inProgressAnnotation = undefined;
    }
  }

  /**
   * Undo the last drawn polygon line segment.
   */
  undo(mouseState: MouseSelectionState): boolean {
    const {annotationLayer} = this;
    const state = this.inProgressAnnotation;
    
    if(annotationLayer === undefined || state === undefined) {
      return false;
    }

    const annotation = <Polygon>state.reference.value;
    if (annotation.childAnnotationIds.length > 0) {
      const id = annotation.childAnnotationIds[
        annotation.childAnnotationIds.length - 1
      ];
      const annotationRef = annotationLayer.source.getReference(id);
      annotationLayer.source.delete(annotationRef, true);
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
    } else {
      this.disposeAnnotation();
    }

    return true;
  }

  /**
   * Completes the last line of the polygon.
   * @returns true if last line was succesfully completed otherwise false.
   */
  private completeLastLine(): boolean {
    const {annotationLayer} = this;
    const {childTool} = this;
    const childState = childTool.inProgressAnnotation.value;
    const state = this.inProgressAnnotation;

    if(
      annotationLayer === undefined || 
      childTool === undefined || 
      childState === undefined || 
      state === undefined
    ) {
      return false;
    }

    const annotation = <Polygon>state.reference.value;
    if(annotation.childAnnotationIds.length < 3) return false; //min 3 sides in polygon

    if (
      childState.reference !== undefined && 
      childState.reference.value !== undefined
    ) {
      const newAnnotation = <Annotation>{
        ...childState.reference.value, 
        pointB: this.sourcePosition
      };
      annotationLayer.source.update(childState.reference, newAnnotation);
      this.layer.selectAnnotation(annotationLayer, childState.reference.id, true);
      annotationLayer.source.commit(childState.reference);
      this.childTool.inProgressAnnotation.value!.disposer();
      this.childTool.inProgressAnnotation.value = undefined;

      return true;
    }

    return false;
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
    let index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.indexOf(annotationRef.id);
    if (index === -1) index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.length;
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
    annotationLayer.source.delete(annotationRef, true);
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
    const childAnnotationIds = (<Polygon>(parentAnnotationRef.value!)).childAnnotationIds;
    if (childAnnotationIds.length <= 3) { // minimum 3 sides should be there
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

    let index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.indexOf(annotationRef1.id);
    if (index === -1) index = (<Polygon>parentAnnotationRef.value!).childAnnotationIds.length;
    const newAnnRef = annotationLayer.source.add(
      newAnn, 
      false, 
      parentAnnotationRef, 
      index
    );
    annotationLayer.source.delete(annotationRef1, true);
    annotationLayer.source.delete(annotationRef2, true);
    annotationLayer.source.commit(newAnnRef);
    annotationRef1.dispose();
    annotationRef2.dispose();
    newAnnRef.dispose();
    parentAnnotationRef.dispose();
  }

  /**
   * Get polygon description to be shown in top corner of annotation tab.
   */
  get description() {
    return `annotate polygon (draw mode)`;
  }

  toJSON() {
    return ANNOTATE_POLYGON_TOOL_ID;
  }
}
PlacePolygonTool.prototype.annotationType = AnnotationType.POLYGON;

export interface VolumeSession {
  reference: AnnotationReference;
}

export interface COMSession {
  label: string|undefined;
  color: string|undefined;
}

export interface CellSession {
  label: string|undefined;
  color: string|undefined;
  category: string|undefined;
}

let has_volume_tool: boolean = false;

export function updateHasVolumeTool(value: boolean = true) {
  has_volume_tool = value;
}

let volume_ref_id: string|undefined = undefined;

export function updateVolumeRef(ref_id: string) {
  volume_ref_id = ref_id;
}

export function getVolumeRef() {
  return volume_ref_id;
}

/**
 * This class is used to create the Volume annotation tool.
 */
export class PlaceVolumeTool extends PlaceCollectionAnnotationTool {
  /** Volume tool utilises the polygon tool to draw annotations. */
  childTool: PlacePolygonTool | undefined;
  sourceMouseState: MouseSelectionState;
  sourcePosition: any;
  active: boolean;
  session: WatchableValue<VolumeSession | undefined> = new WatchableValue(undefined);
  sessionWidget: RefCounted | undefined;
  sessionWidgetDiv: HTMLElement | undefined;
  icon: WatchableValue<HTMLElement | undefined> = new WatchableValue(undefined);

  constructor(
    public layer: UserLayerWithAnnotations, 
    options: any, 
    session: VolumeSession | undefined = undefined,
    sessionDiv: HTMLElement | undefined = undefined,
    iconDiv: HTMLElement|undefined = undefined, 
    restore_from_firebase: boolean = false) {
    super(layer, options);
    const func = this.displayVolumeSession.bind(this);
    this.sessionWidgetDiv = sessionDiv;
    this.session.changed.add(() => func());
    this.session.value = session;
    this.active = true;

    // if(urlParams.multiUserMode) {
      // has_volume_tool = true;
    // }

    this.childTool = new PlacePolygonTool(layer, {...options, parent: this});

    this.icon.changed.add(this.setIconColor.bind(this));
    this.icon.value = iconDiv;
    this.registerDisposer(() => {
      const iconDiv = this.icon.value;
      if (iconDiv === undefined) return;
      iconDiv.style.backgroundColor = '';
      this.icon.value = undefined;
    });

    // if(this.session.value === undefined && urlParams.multiUserMode) {
    //   // @ts-ignore
    //   if(!this.annotationLayer || !this.annotationLayer.source || !this.annotationLayer.source.annotationMap) {
    //     return
    //   }

    //   if(restore_from_firebase) {
    //     volume_ref_id = getVolumeRef();
    //   }

    //   //@ts-ignore
    //   let volume_annotation = this.annotationLayer.source.annotationMap.get(volume_ref_id);

    //   if(volume_annotation) {
    //     this.session.value = <VolumeSession>{reference: this.annotationLayer.source.getReference(volume_ref_id!)};
    //     if(this.childTool) {
    //       this.childTool.restore_multi_user_drawing();
    //     }
    //   }
    // }

  }

  /** Sets the icon color of the volume tool based on the type of mode */
  setIconColor() {
    const iconDiv = this.icon.value;
    if (iconDiv === undefined) return;
    iconDiv.style.backgroundColor = 'green';
  }
  /**
   * This function is called when the user tries to draw annotation
   * @param mouseState
   * @returns void
   */
  trigger(mouseState: MouseSelectionState) {
    console.log("PlaceVolumeTool > trigger");
    const {annotationLayer} = this;
    const {session} = this;

    console.log(mouseState);
    console.log(annotationLayer);
    console.log(session);
    // if (annotationLayer === undefined || session.value === undefined || this.childTool === undefined) {
    //   // Not yet ready.
    //   return;
    // }
    // if (!session.value.reference.value) return;
    
    // if (mouseState.updateUnconditionally()) {
    //   this.childTool.trigger(mouseState, session.value.reference);
    // }

    if (this.childTool !== undefined) {
      this.childTool.trigger(mouseState, undefined);
    }
  }

  /**
   * Takes description and color and creates a new volume annotation.
   * @param description 
   * @param color 
   * @returns 
   */
  createNewVolumeAnn(description: string|undefined, color: string|undefined) : AnnotationReference | undefined {
    const {annotationLayer} = this;
    if (annotationLayer === undefined) return undefined;
    //@ts-ignore
    const collection = <Collection>this.getInitialAnnotation(window['viewer'].mouseState, annotationLayer);
    collection.childrenVisible = true;
    if (description) collection.description = description;
    if (color) {
      for(let idx = 0; idx < annotationLayer.source.properties.length; idx++) {
        if (annotationLayer.source.properties[idx].identifier === 'color' && collection.properties.length > idx) {
          collection.properties[idx] = packColor(parseRGBColorSpecification(color));
          break;
        }
      }
    }
    // if(id) collection.id = id;
    const reference = annotationLayer.source.add(<Annotation>collection, true, undefined, undefined);
    this.layer.selectAnnotation(annotationLayer, reference.id, true);

    return reference;
  }

  /**
   * Disposes the annotation tool.
   */
  dispose() {
    console.log("running volume tool disposer");
    if (this.childTool) {
      this.childTool.dispose();
    }
    // completely delete the session
    this.disposeSession();
    super.dispose();
  }
  
  /**
   * Activates the annotation tool if value is true.
   * @param _value 
   */
  setActive(_value: boolean) {
    if (this.active !== _value) {
      this.active = _value;
      if (this.childTool) {
        this.childTool.setActive(_value);
      }
      super.setActive(_value);
    }
  }
  
  /**
   * Deactivates the annotation tool.
   */
  deactivate() {
    this.active = false;
    if (this.childTool) this.childTool.deactivate();
    super.deactivate();
  }

  /**
   * Completes the last edge of polygon to be drawn.
   * @returns true if the operation suceeded otherwise false.
   */
  complete(): boolean {
    const {annotationLayer} = this;
    const {session} = this;

    if (annotationLayer === undefined || session.value === undefined) {
      return false;
    }
    if (!session.value.reference.value) return false;

    global_parentRef = session.value.reference;
    if(this.childTool && this.childTool.complete()) {
      //this.layer.selectAnnotation(annotationLayer, session.value.reference.id, true);
      return true;
    }

    return false;
  }

  /**
   * Deletes the current active session
   */
  private disposeSession() {
    const {session} = this;
    if (session.value) session.value.reference.dispose();
    this.session.value = undefined;
    if (this.sessionWidget) this.sessionWidget.dispose();
    this.sessionWidget = undefined;
  }

  /**
   * Undo the last drawn polygon line segment.
   */
  undo(mouseState: MouseSelectionState): boolean {
    const {session} = this;
    if (session.value === undefined || !session.value.reference.value || this.childTool === undefined) return false;
    
    return this.childTool.undo(mouseState);
  }

  /**
   * Adds a new vertex to the polygon in edit mode.
   * @param mouseState 
   * @returns 
   */
  addVertexPolygon(mouseState: MouseSelectionState) {
    if (!this.validateSession(mouseState.pickedAnnotationId, mouseState.pickedAnnotationLayer)) return;
    if (this.childTool) this.childTool.addVertexPolygon(mouseState);
  }

  /**
   * Deletes a vertex of the polygon in edit mode.
   * @param mouseState 
   * @returns 
   */
  deleteVertexPolygon(mouseState: MouseSelectionState) {
    if (!this.validateSession(mouseState.pickedAnnotationId, mouseState.pickedAnnotationLayer)) return;
    if (this.childTool) this.childTool.deleteVertexPolygon(mouseState);
  }

  /**
   * Valides the session, that is if the volume id edited is the current active session or not.
   * @param annotationId 
   * @param annotationLayer 
   * @returns 
   */
  validateSession(annotationId: string|undefined, annotationLayer: AnnotationLayerState|undefined) : boolean {
    if (this.session.value === undefined || annotationId === undefined || annotationLayer === undefined) return false;
    if (this.session.value.reference === undefined || !this.session.value.reference.value) return false;
    if (!this.active) return false;
    const reference = annotationLayer.source.getTopMostAnnotationReference(annotationId);
    if (!reference.value) return false;
    const annotation = reference.value;
    if (annotation.id !== this.session.value.reference.value.id) return false;
    return true;
  }

  /**
   * This function is used to display the Volume session data in the annotation tabs
   * while the user is annotating.
   */
  displayVolumeSession() {
    const {annotationLayer, session, sessionWidgetDiv} = this;
    if (this.sessionWidget) this.sessionWidget.dispose();
    this.sessionWidget = new RefCounted();
    const {sessionWidget} = this; 
    if (annotationLayer === undefined || session.value === undefined || sessionWidgetDiv === undefined) return;

    const reference = session.value.reference;
    sessionWidgetDiv.appendChild(
      this.sessionWidget.registerDisposer(new DependentViewWidget(
        this.sessionWidget.registerDisposer(
                    new AggregateWatchableValue(() => ({
                                                  annotation: reference,
                                                  chunkTransform: annotationLayer.chunkTransform
                                                }))),
                                                //@ts-ignore
                ({annotation, chunkTransform}, parent, context) => {
                  if (annotation == null) {
                    const statusMessage = document.createElement('div');
                    statusMessage.classList.add('neuroglancer-selection-annotation-status');
                    statusMessage.textContent =
                        (annotation === null) ? 'Annotation not found' : 'Loading...';
                    parent.appendChild(statusMessage);
                    return;
                  }

                  const sessionTitle = document.createElement('div');
                  sessionTitle.classList.add('volume-session-display-title');
                  sessionTitle.textContent = "Volume session";

                  const sessionBody = document.createElement('div');
                  sessionBody.classList.add('volume-session-display-body');

                  const {properties} = annotationLayer.source;

                  for (let i = 0, count = properties.length; i < count; ++i) {
                    const property = properties[i];
                    if (property.identifier === 'visibility') {
                      continue;
                    }
                    const label = document.createElement('label');
                    label.classList.add('neuroglancer-annotation-property');
                    const idElement = document.createElement('span');
                    idElement.classList.add('neuroglancer-annotation-property-label');
                    idElement.textContent = property.identifier;
                    label.appendChild(idElement);
                    const {description} = property;
                    if (description !== undefined) {
                      label.title = description;
                    }
                    let valueElement: HTMLSpanElement;
                    let colorElement : HTMLInputElement;
                    const value = annotation.properties[i];
                    switch (property.type) {
                      case 'float32':
                        valueElement = document.createElement('span');
                        valueElement.classList.add('neuroglancer-annotation-property-value');
                        valueElement.textContent = value.toPrecision(6);
                        label.appendChild(valueElement);
                        break;
                      case 'rgb': {
                        colorElement = document.createElement('input');
                        if (reference.value && reference.value.parentAnnotationId) {
                          colorElement.disabled = true;
                        };
                        colorElement.type = 'color';
                        const colorVec = unpackRGB(value);
                        const hex = serializeColor(colorVec);
                        colorElement.value = hex;
                        colorElement.style.backgroundColor =
                            useWhiteBackground(colorVec) ? 'white' : 'black';
                        colorElement.disabled = true;
                        // colorElement.addEventListener('change', () => {
                        //   const colorInNum = packColor(parseRGBColorSpecification(colorElement.value));
                          // annotationLayer.source.updateColor(reference, colorInNum);
                        // });
                        label.appendChild(colorElement);
                        break;
                      }
                      case 'rgba': {
                        valueElement = document.createElement('span');
                        valueElement.classList.add('neuroglancer-annotation-property-value');
                        const colorVec = unpackRGB(value >>> 8);
                        valueElement.textContent = serializeColor(unpackRGBA(value));
                        valueElement.style.backgroundColor =
                            serializeColor(unpackRGB(value >>> 8));
                        valueElement.style.color =
                            useWhiteBackground(colorVec) ? 'white' : 'black';
                        label.appendChild(valueElement);
                        break;
                      }
                      default:
                        valueElement = document.createElement('span');
                        valueElement.classList.add('neuroglancer-annotation-property-value');
                        valueElement.textContent = value.toString();
                        label.appendChild(valueElement);
                        break;
                    }
                    
                    sessionBody.appendChild(label);
                  }

                  if (annotation.description && annotation.description.length > 0) {
                    // console.log('annotations.ts line=2504 desc=' + annotation.description);
                    // console.log('annotations.ts line=2505 length=' + annotation.description.length);
                    const label = document.createElement('label');
                    label.classList.add('neuroglancer-annotation-property');
                    const idElement = document.createElement('span');
                    idElement.classList.add('neuroglancer-annotation-property-label');
                    idElement.textContent = "Description";
                    label.appendChild(idElement);
                    const valueElement = document.createElement('span');
                    valueElement.classList.add('neuroglancer-annotation-property-description');
                    valueElement.textContent = annotation.description || '';
                    label.appendChild(valueElement);
                    sessionBody.appendChild(label);
                  }
                  parent.appendChild(sessionTitle);
                  parent.appendChild(sessionBody);
                  
                  sessionWidget.registerDisposer(() => {
                    try {
                      sessionWidgetDiv.removeChild(parent);
                    }
                    catch (e) {
                      //ignore errors
                    }
                  });
                }))
            .element);
    return;
  }

  get description() {
    return `volume session (draw mode)`;
  }

  toJSON() {
    return ANNOTATE_VOLUME_TOOL_ID;
  }
}

PlaceVolumeTool.prototype.annotationType = AnnotationType.VOLUME;
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
    /* BRAINSHARE STARTS */
    annotationColorPicker : AnnotationColorWidget|undefined = undefined;
    /* BRAINSHARE ENDS */

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

    /* BRAINSHARE STARTS */
    /**
     * Sets the annotation picker color based on the annotation property value.
     */
    setAnnotationColorPicker() {
      for (const state of this.annotationStates.states) {
        if (!state.source.readonly) {
          const colorProperties = state.source.properties.filter(
            x => x.identifier === 'color'
          );
          if (colorProperties.length === 0) continue;
          const defaultColor = serializeColor(unpackRGB(
            colorProperties[0].default
          ));
          this.annotationColorPicker = this.registerDisposer(
            new AnnotationColorWidget()
          );
          this.annotationColorPicker.element.title = 'Pick color to draw annotation';
          this.annotationColorPicker.setColor(defaultColor);
          break;
        }
      }
    }
    /* BRAINSHARE ENDS */

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
