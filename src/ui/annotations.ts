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

import svg_help from "ikonate/icons/help.svg?raw";
import "#src/ui/annotations.css";
import {
  AnnotationDisplayState,
  AnnotationLayerState,
} from "#src/annotation/annotation_layer_state.js";
import { MultiscaleAnnotationSource } from "#src/annotation/frontend_source.js";
import type {
  Annotation,
  AnnotationId,
  AnnotationNumericPropertySpec,
  AnnotationReference,
  AxisAlignedBoundingBox,
  Cloud,
  Ellipsoid,
  Line,
  Polygon
} from "#src/annotation/index.js";
  /* BRAINSHARE STARTS */
import {
  annotationToPortableJson,
  portableJsonToAnnotations,
  translateAnnotationPoints,
} from "#src/annotation/index.js";
/*  BRAINSHARE ENDS */
import {
  AnnotationPropertySerializer,
  AnnotationSource,
  annotationToJson,
  AnnotationType,
  annotationTypeHandlers,
  formatNumericProperty,
} from "#src/annotation/index.js";
import {
  AnnotationLayer,
  PerspectiveViewAnnotationLayer,
  SliceViewAnnotationLayer,
  SpatiallyIndexedPerspectiveViewAnnotationLayer,
  SpatiallyIndexedSliceViewAnnotationLayer,
} from "#src/annotation/renderlayer.js";
/* BRAINSHARE STARTS */
/*
import { CoordinateSpace } from "#/coordinate_transform";
*/
import {
  CoordinateSpace,
  CoordinateTransformSpecification,
} from "#src/coordinate_transform.js";
/* BRAINSHARE ENDS */

import type { MouseSelectionState, UserLayer } from "#src/layer/index.js";
import type { LayerDataSource, LoadedDataSubsource } from "#src/layer/layer_data_source.js";
import type { ChunkTransformParameters } from "#src/render_coordinate_transform.js";
import { getChunkPositionFromCombinedGlobalLocalPositions } from "#src/render_coordinate_transform.js";
import {
  RenderScaleHistogram,
  trackableRenderScaleTarget,
} from "#src/render_scale_statistics.js";
import { RenderLayerRole } from "#src/renderlayer.js";
import type { SegmentationDisplayState } from "#src/segmentation_display_state/frontend.js";
import {
  bindSegmentListWidth,
  registerCallbackWhenSegmentationDisplayStateChanged,
  SegmentWidgetFactory,
} from "#src/segmentation_display_state/frontend.js";
import { ElementVisibilityFromTrackableBoolean } from "#src/trackable_boolean.js";
import type { WatchableValueInterface } from "#src/trackable_value.js";
import {
  AggregateWatchableValue,
  makeCachedLazyDerivedWatchableValue,
  registerNested,
  WatchableValue,
} from "#src/trackable_value.js";
import { getDefaultAnnotationListBindings } from "#src/ui/default_input_event_bindings.js";
import { LegacyTool, registerLegacyTool } from "#src/ui/tool.js";
import { animationFrameDebounce } from "#src/util/animation_frame_debounce.js";
import type { ArraySpliceOp } from "#src/util/array.js";
import { setClipboard } from "#src/util/clipboard.js";
import {
  serializeColor,
  unpackRGB,
  /* BRAINSHARE STARTS */
  /*
  unpackRGBA,
  useWhiteBackground,
  */
  packColor,
  parseRGBColorSpecification,
//  parseRGBColorSpecification,
  /* BRAINSHARE ENDS */
} from "#src/util/color.js";
import type { Borrowed } from "#src/util/disposable.js";
import { disposableOnce, RefCounted } from "#src/util/disposable.js";
import { removeChildren } from "#src/util/dom.js";
import { Endianness, ENDIANNESS } from "#src/util/endian.js";
import type { ValueOrError } from "#src/util/error.js";
import { vec3 } from "#src/util/geom.js";
import { parseUint64 } from "#src/util/json.js";
import {
  EventActionMap,
  KeyboardEventBinder,
  registerActionListener,
} from "#src/util/keyboard_bindings.js";
import * as matrix from "#src/util/matrix.js";
import { MouseEventBinder } from "#src/util/mouse_bindings.js";
import { formatScaleWithUnitAsString } from "#src/util/si_units.js";
import { NullarySignal, Signal } from "#src/util/signal.js";
import * as vector from "#src/util/vector.js";
import { makeAddButton } from "#src/widget/add_button.js";
import { ColorWidget } from "#src/widget/color.js";
import { makeCopyButton } from "#src/widget/copy_button.js";
import { makeDeleteButton } from "#src/widget/delete_button.js";
/* BRAINSHARE STARTS */
  //TODO import { makeSegmentationButton } from "#/widget/segmentation_button";
/* BRAINSHARE ENDS */

import type { DependentViewContext } from "#src/widget/dependent_view_widget.js";
import { DependentViewWidget } from "#src/widget/dependent_view_widget.js";
import { makeIcon } from "#src/widget/icon.js";
import { makeMoveToButton } from "#src/widget/move_to_button.js";
import { Tab } from "#src/widget/tab_view.js";
import type { VirtualListSource } from "#src/widget/virtual_list.js";
import { VirtualList } from "#src/widget/virtual_list.js";
/* BRAINSHARE STARTS */
import { StatusMessage } from '#src/status.js';
import {
  getZCoordinate,
  isPointUniqueInPolygon,
} from '#src/annotation/polygon.js';
// import { getPolygonsByVolumeId, isSectionValid } from '#/annotation/volume';

import {
  AutocompleteTextInput,
  Completer,
  Completion,
  CompletionRequest,
  CompletionResult,
  CompletionWithDescription
} from "#src/widget/multiline_autocomplete.js";
// import { CancellationToken } from "#/util/cancellation";
import { fetchOk } from "#src/util/http_request.js";
import { brainState, userState } from "#src/brainshare/state_utils.js";
import { APIs } from "#src/brainshare/service.js";
import svg_clipBoard from "ikonate/icons/clipboard.svg?raw";

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
    //TODO case AnnotationType.VOLUME:
    case AnnotationType.CLOUD:
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


/* BRAINSHARE STARTS */
function pasteAnnotation(
  json: any,
  annotationSource: AnnotationSource | MultiscaleAnnotationSource,
  transform: CoordinateTransformSpecification,
  position?: Float32Array,
  parentRef?: AnnotationReference,
): Annotation[] | undefined {
  let { outputSpace, inputSpace } = transform;
  if (inputSpace === undefined) inputSpace = outputSpace;

  let annotations: Annotation[];
  try {
    annotations = portableJsonToAnnotations(
      json,
      annotationSource,
      inputSpace,
    );
    if (annotations.length == 0) {
      throw new Error("No annotation found in pasted JSON");
    }
  }
  catch (e) {
    console.log(e);
    StatusMessage.showTemporaryMessage(
      "The annotation to paste is invalid. Please see console for details.",
      5000,
    );
    return undefined;
  }
  
  //TODO delete annotations[0].parentAnnotationId;

  if (parentRef && parentRef.value) {
    if ((
        parentRef.value.type === AnnotationType.CLOUD &&
        annotations[0].type !== AnnotationType.POINT
      )) {
      StatusMessage.showTemporaryMessage(
        `The annotation to paste (${
          AnnotationType[annotations[0].type].toLowerCase()
        }) can not be a child of the selected annotation (${
          AnnotationType[parentRef.value.type].toLowerCase()
        }).`,
        5000,
      );
      return undefined;
    }
  }
  /*TODO
  if (parentRef && parentRef.value) {
    if ((
      parentRef.value.type === AnnotationType.VOLUME &&
      annotations[0].type !== AnnotationType.POLYGON
    ) || (
        parentRef.value.type === AnnotationType.CLOUD &&
        annotations[0].type !== AnnotationType.POINT
      )) {
      StatusMessage.showTemporaryMessage(
        `The annotation to paste (${
          AnnotationType[annotations[0].type].toLowerCase()
        }) can not be a child of the selected annotation (${
          AnnotationType[parentRef.value.type].toLowerCase()
        }).`,
        5000,
      );
      return undefined;
    }
  }
  */

  const newAnnotations: Annotation[] = [];
  if (position === undefined) {
    for (let i = 0; i < annotations.length; i++) {
      newAnnotations.push(annotations[i]);
    }
  }
  else {
    if (parentRef && parentRef.value) {
      /*TODO
      if (parentRef.value.type === AnnotationType.VOLUME) {
        if (!isSectionValid(
          annotationSource,
          parentRef.id,
          Math.floor(position[2]),
        )) {
          StatusMessage.showTemporaryMessage(
            "A polygon already exists in this section for the volume, only one \
            polygon per section is allowed for a volume.",
            5000,
          );
          return;
        }
      }
      */
    }

    const positionInputSpace = new Float64Array(position);
    if (inputSpace !== outputSpace) {
      vector.multiply(
        positionInputSpace, 
        positionInputSpace, 
        outputSpace.scales
      );
      vector.divide(positionInputSpace, positionInputSpace, inputSpace.scales);
    }
    const center = new Float32Array(positionInputSpace.length);
    const translations = new Float64Array(positionInputSpace.length);
    getCenterPosition(center, annotations[0]);
    vector.subtract(translations, positionInputSpace, center);

    for (let i = 0; i < annotations.length; i++) {
      newAnnotations.push(translateAnnotationPoints(
        annotations[i],
        translations
      ));
    }
  }

  for (let i = 0; i < newAnnotations.length; i++) {
    annotationSource.add(
      newAnnotations[i],
      //commit= 
      true,
      //TODO i == 0 ? parentRef : undefined,
    );
  }

  return newAnnotations;
}

// The autocomplete search box for importing annotations
const statusStrings = new Set(["", "No result", "Searching..."]);

//TODO I am taking out the CancellationToken
class AnnotationSearchBar extends AutocompleteTextInput {
  private completions: Completion[] = [];
  private _selectCompletion: (completion: Completion) => void;

  constructor(
    config: {
      completer: Completer,
      selectCompletion: (completion: Completion) => void,
      placeHolder: string,
    }
  ) {
    super({
      completer: (request) => {
        this.setHintValue("Searching...");

        // Provide dummy AbortSignal and ProgressListener if not available
        const completerPromise = config.completer(request, undefined as any, undefined as any);
        if (completerPromise === null) return null;

        return completerPromise.then((completionResult: CompletionResult) => {
          this.completions = completionResult.completions;
          if (this.completions.length === 0) this.setHintValue("No result");
          else this.setHintValue("");

          return completionResult;
        });
      },
      delay: 100,
    });

    this._selectCompletion = config.selectCompletion;
    this.placeholder = config.placeHolder;

    // Making the hint string right aligned
    this.hintElement.style.position = "absolute";
    this.hintElement.style.right = "0";

    // Fix the bug that the dropdown menu is not always on top
    this.element.style.zIndex = "1";
  }

  /**
   * The hint string is repurposed to show the searching status.
   * @param hintValue: string for searching status.
   */
  setHintValue(hintValue: string): void {
    if (!statusStrings.has(hintValue)) return;

    const { hintElement } = this;
    removeChildren(hintElement);
    const node = document.createTextNode(hintValue);
    hintElement.appendChild(node);
  }

  selectCompletion(index: number): void {
    const completion = this.completions[index];
    this._selectCompletion(completion);
  }

  cancel() {
    this.inputElement.textContent = "";
    this.hideCompletions();
    return true;
  }
}

export interface CompletionWithDescTime extends CompletionWithDescription {
  timestamp?: string;
}

function makeAnnotationCompletionElement(
  completion: CompletionWithDescTime
): HTMLElement {
  const completionDiv = document.createElement("div");

  const valueDiv = document.createElement("div");
  valueDiv.textContent = `Id: ${completion.value}`;
  completionDiv.appendChild(valueDiv);

  if (completion.description) {
    const desclDiv = document.createElement("div");
    desclDiv.textContent = `Desc: ${completion.description}`;
    completionDiv.appendChild(desclDiv);
  }

  if (completion.timestamp) {
    const desclDiv = document.createElement("div");
    desclDiv.textContent = `Updated: ${completion.timestamp}`;
    completionDiv.appendChild(desclDiv);
  }

  return completionDiv;
}

export function binarySearchInsert<T>(
  haystack: ArrayLike<T>,
  needle: T,
  compare: (a: T, b: T) => number,
  low = 0,
  high = haystack.length,
) {
  while (low < high) {
    const mid = (low + high - 1) >> 1;
    const compareResult = compare(needle, haystack[mid]);
    if (compareResult > 0) {
      low = mid + 1;
    } else if (compareResult < 0) {
      high = mid;
    } else {
      return mid;
    }
  }
  return low;
}

export function uploadAnnotation(
  annRef: AnnotationReference,
  dataSource: LayerDataSource,
  annotationLayer: AnnotationLayerState,
  save: Boolean,
): Promise<void> | undefined {
  const transform = dataSource.spec.transform;
  if (transform === undefined) return;
  let inputCoordinateSpace = transform.inputSpace;
  if (inputCoordinateSpace === undefined) {
    inputCoordinateSpace = transform.outputSpace;
  }
  const ann = annRef.value!;
  console.log('ann to upload');
  console.log(ann);
  const annJson = annotationToPortableJson(
    ann,
    annotationLayer.source,
    inputCoordinateSpace,
  )
  console.log('annJson');
  console.log(annJson);

  if (
    !brainState.value ||
    !userState.value ||
    !annRef.value!.description ||
    !brainState.value.animal
  ) {
    console.log("Brain or user state is not defined.");
    StatusMessage.showTemporaryMessage("Cannot create annotation, animal or annotation description missing.", 5000);
    return;
  }

  const labels = annRef.value!.description.split("\n");
  if (!labels[0]) return;

  const jsonBody = {
    id: save ? ann.sessionID : undefined,
    annotation: annJson,
    animal: brainState.value.animal,
    annotator: userState.value.id,
    label: labels[0],
  }
  console.log('json body for annotations')
  console.log(jsonBody);
  StatusMessage.showTemporaryMessage("Uploading annotation...", 5000);
  return fetchOk(
    `${APIs.GET_SET_ANNOTATION}${save ? ann.sessionID : ""}`, { 
    method: save ? "PUT" : "POST",
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(jsonBody, null, 0),
  }).then(
    response => response.json()
  ).then(json => {
    if (!json.id) throw new Error("No session ID is returned!");

    StatusMessage.showTemporaryMessage(
      json.id !== ann.sessionID ? 
      `A new annotation is created with id ${json.id}.` 
      :
      `The annotation with id ${json.id} is updated.`,
      5000,
    );

    ann.sessionID = json.id;
    annotationLayer.source.update(annRef, ann);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage(
      "There is an error in uploading the annotation.\
      Please see console for details.",
      5000,
    );
  })
}
/* BRAINSHARE ENDS */


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
  /* BRAINSHARE STARTS */
  private searchAnnotations: AnnotationSearchBar;
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
    this.localDimensionIndices = localDimensionIndices;
    this.globalDimensionIndices = globalDimensionIndices;
    ++this.curCoordinateSpaceGeneration;
  }

  constructor(
    public layer: Borrowed<UserLayerWithAnnotations>,
    public displayState: AnnotationDisplayState,
  ) {
    super();
    this.element.classList.add("neuroglancer-annotation-layer-view");
    this.selectedAnnotationState = makeCachedLazyDerivedWatchableValue(
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
      layer.manager.root.selectionState,
      layer.manager.root.selectionState.pin,
    );

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

    const annotationColorPickerEnabled = (
      layer.constructor as unknown as UserLayerWithAnnotationsClass
    ).supportColorPickerInAnnotationTab;
    if (annotationColorPickerEnabled) {
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
    }

    const { mutableControls } = this;
    /* BRAINSHARE STARTS */
    // Add paste annotation button
    const pasteButton = makeIcon({
      svg: svg_clipBoard,
      title: "Paste an annotation from the clipboard",
      onClick: () => {
        let annotationLayerState: AnnotationLayerState | undefined = undefined;
        for (const state of this.layer.annotationStates.states) {
          if (!state.source.readonly) {
            annotationLayerState = state;
            break;
          }
        }

        const dataSource = this.layer.dataSources[0];
        if (dataSource === undefined) return;
        const transform = dataSource.spec.transform;
        if (transform === undefined) return;
        navigator.clipboard.readText().then((text) => {
          if (annotationLayerState !== undefined) {
            const annotations = pasteAnnotation(
              JSON.parse(text),
              annotationLayerState.source,
              transform,
              this.layer.manager.root.globalPosition.value,
            );
            if (annotations !== undefined && annotations[0] !== undefined) {
              this.layer.selectAnnotation(
                annotationLayerState,
                annotations[0].id,
                true
              );
            }
          }
        });
      },
    });
    mutableControls.appendChild(pasteButton);
    /* BRAINSHARE ENDS */

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

    /*TODO
    const volumeButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.VOLUME].icon,
      title: 'Annotate volume',
      onClick: () => {
        this.layer.tool.value = new PlaceVolumeTool(this.layer, {});
      },
    });
    mutableControls.appendChild(volumeButton);
    */
    const cloudButton = makeIcon({
      text: annotationTypeHandlers[AnnotationType.CLOUD].icon,
      title: 'Annotate cloud',
      onClick: () => {
        this.layer.tool.value = new PlaceCloudTool(this.layer, {});
      },
    });
    mutableControls.appendChild(cloudButton);
    
    if (userState.value && userState.value.id !== 0) {
      this.searchAnnotations = new AnnotationSearchBar({
        completer: (request: CompletionRequest, _signal: AbortSignal) => {
          const defaultCompletionResult = {
            completions: [],
            offset: 0,
            showSingleResult: false,
            selectSingleResult: false,
            makeElement: makeAnnotationCompletionElement,
          }

          return fetchOk(
            APIs.SEARCH_ANNOTATION + request.value,
            { method: "GET" },
          ).then(
            response => response.json()
          ).then(json => {
            if (!Array.isArray(json)) throw new Error("JSON is not an array");

            return {
              ...defaultCompletionResult,
              completions: json.map((annotation: any) => ({
                value: annotation.id.toString(),
                description: annotation.animal_abbreviation_username,
                timestamp: annotation.updated,
              })),
            };
          }).catch(err => {
            console.log(err);
            StatusMessage.showTemporaryMessage(
              "There is an error in searching annotations. \
              Please see console for details.",
              5000,
            );
            return defaultCompletionResult;
          })
        },
        selectCompletion: (completion) => {
          const annotationId = completion.value;

          StatusMessage.showTemporaryMessage(
            "Downloading the selected annotation to clipboard...",
            5000,
          );
          fetchOk(
            APIs.GET_SET_ANNOTATION + annotationId,
            { method: "GET" },
          ).then(
            response => response.json()
          ).then(json => {
            // StatusMessage.showTemporaryMessage(
            //   "Annotation copied to clipboard.",
            //   5000,
            // );
            // const annotation = json.annotation;
            // if (!annotation) throw new Error(
            //   "JSON does not have an annotation"
            // );

            // annotation["sessionID"] = json.id;
            // setClipboard(JSON.stringify(annotation));
            
            const annotationSessionId = json["id"];
            const annotationPortableJson = json["annotation"];
            if (annotationSessionId === undefined) {
              throw new Error("No annotation id found in returned JSON.");
            }
            if (annotationPortableJson === undefined) {
              throw new Error("No annotation found in returned JSON.");
            }
            annotationPortableJson["sessionID"] = annotationSessionId;
            
            let annotationLayerState: AnnotationLayerState | undefined;
            for (const state of this.layer.annotationStates.states) {
              if (!state.source.readonly) {
                annotationLayerState = state;
                break;
              }
            }
            const dataSource = this.layer.dataSources[0];
            if (dataSource === undefined) return;
            const transform = dataSource.spec.transform;
            if (transform === undefined) return;

            if (annotationLayerState !== undefined) {
              const annotations = pasteAnnotation(
                annotationPortableJson,
                annotationLayerState.source,
                transform,
              );
              if (annotations !== undefined && annotations[0] !== undefined) {
                this.layer.selectAnnotation(
                  annotationLayerState,
                  annotations[0].id,
                  true
                );
              }
              StatusMessage.showTemporaryMessage(
                "Annotation downloaded.",
                5000,
              );
            }
          }).catch(err => {
            console.log(err);
            StatusMessage.showTemporaryMessage(
              "There is an error in downloading the selected annotation. \
              Please see console for details.",
              5000,
            );
          })
        },

        placeHolder: "Search for annotations"
      });
      this.element.appendChild(this.searchAnnotations.element);
    }
    /* BRAINSHARE ENDS */














    const helpIcon = makeIcon({
      title:
        "The left icons allow you to select the type of the anotation. Color and other display settings are available in the 'Rendering' tab.",
      svg: svg_help,
      clickable: false,
    });
    helpIcon.style.marginLeft = "auto";
    mutableControls.appendChild(helpIcon);

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

  private selectedAnnotationState;

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
      const annotations = Array.from(source).filter(annotation => {
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
    /* BRAINSHARE STARTS */
    if (this.searchAnnotations) {
      this.searchAnnotations.element.style.display = isMutable ? "block" : "none";
    }
    /* BRAINSHARE ENDS */
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
    // Do not add to list if annotation is a child annotation
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

        /* BRAINSHARE STARTS */

    /*TODO segmentation button is for volumes
    let segmentationButton: HTMLElement | undefined;

    const maybeAddSegmentationButton = () => {
      if (state.source.readonly) return;
      if (segmentationButton !== undefined) return;
      if ((userState === undefined) || (userState.value?.id === 0)) return;
      if ((annotation.type !== AnnotationType.VOLUME) || (annotation.sessionID === undefined)) {
        return;
      }
      segmentationButton = makeSegmentationButton({
        title: "Create 3D Mesh",
        onClick: (event) => {
          event.stopPropagation();
          event.preventDefault();
          const ref = state.source.getReference(annotation.id);
          try {
            StatusMessage.showTemporaryMessage("Creating 3D mesh ...", 15000);

            return fetchOk(
              `${APIs.API_ENDPOINT + "/annotations/segmentation/"}${annotation.sessionID}`, 
              { method: "GET"},
            ).then(
              response => response.json()
            ).then(json => {
              const manager = this.layer.manager;
              const segmentationLayer = makeLayer(manager, json.name, {type: 'segmentation', 'source': json.url});
              manager.add(segmentationLayer);              
              StatusMessage.showTemporaryMessage(
                "The 3D mesh has been created.",
                5000,
              );
            }).catch(err => {
              console.log(err);
              StatusMessage.showTemporaryMessage(
                "There is an error in creating the mesh.\
                Please see console for details.",
                15000,
              );
            })

          } finally {
            ref.dispose();
          }
        },
      });
      segmentationButton.classList.add("neuroglancer-annotation-list-entry-delete");
      element.appendChild(segmentationButton);
    };
    */
    /* BRAINSHARE ENDS */


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
  private layerView: AnnotationLayerView;
  constructor(public layer: Borrowed<UserLayerWithAnnotations>) {
    super();
    this.layerView = this.registerDisposer(
      new AnnotationLayerView(layer, layer.annotationDisplayState),
    );

    const { element } = this;
    element.classList.add("neuroglancer-annotations-tab");
    element.appendChild(this.layerView.element);
  }
}

function getSelectedAssociatedSegments(
  annotationLayer: AnnotationLayerState,
  getBase = false,
): BigUint64Array[] {
  const segments: bigint[][] = [];
  const { relationships } = annotationLayer.source;
  const { relationshipStates } = annotationLayer.displayState;
  for (let i = 0, count = relationships.length; i < count; ++i) {
    const segmentationState = relationshipStates.get(relationships[i])
      .segmentationState.value;
    if (segmentationState != null) {
      if (segmentationState.segmentSelectionState.hasSelectedSegment) {
        segments[i] = [segmentationState.segmentSelectionState.selectedSegment];
        if (getBase) {
          segments[i] = [
            ...segments[i],
            segmentationState.segmentSelectionState.baseSelectedSegment,
          ];
        }
        continue;
      }
    }
    segments[i] = [];
  }
  return segments.map((x) => BigUint64Array.from(x));
}

abstract class PlaceAnnotationTool extends LegacyTool {
  declare layer: UserLayerWithAnnotations;
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
//TODO const ANNOTATE_VOLUME_TOOL_ID = 'annotateVolume';
const ANNOTATE_CLOUD_TOOL_ID = 'annotateCloud';
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
      /* BRAINSHARE STARTS */
      if (parentRef && parentRef.value) {
        annotation.properties = Object.assign([], parentRef.value.properties);
      }
      /* BRAINSHARE ENDS */

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
  declare annotationType:
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

  private initialRelationships: BigUint64Array[] | undefined;

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
          newSegments = newSegments.filter((x) => !initialSegments.includes(x));
          return BigUint64Array.from([...initialSegments, ...newSegments]);
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
 * Abstract class to represent any tool which draws a Collection.
 */
export abstract class PlaceCollectionAnnotationTool extends PlaceAnnotationTool {
  childTool: PlaceAnnotationTool;
  inProgressAnnotation: {
    annotationLayer: AnnotationLayerState,
    reference: AnnotationReference,
    disposer: () => void
  } | undefined;

  abstract getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState
  ): Annotation;
  abstract complete(): boolean;
  abstract undo(mouseState: MouseSelectionState): boolean;

  disposed() {
    this.deactivate();
    super.disposed();
  }

  deactivate() {
    if (this.childTool !== undefined) this.childTool.deactivate();
  }
}

/* TODO
export class PlaceVolumeTool extends PlaceCollectionAnnotationTool {
  constructor(
    public layer: UserLayerWithAnnotations,
    options: any,
    reference?: AnnotationReference,
  ) {
    super(layer, options);

    this.childTool = new PlacePolygonTool(layer, { ...options, parent: this });
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

  getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer
    );
    return <Volume>{
      id: '',
      type: AnnotationType.VOLUME,
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

  trigger(mouseState: MouseSelectionState) {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    const childTool = <PlacePolygonTool>this.childTool;
    if (mouseState.updateUnconditionally()) {
      if (this.inProgressAnnotation === undefined) {
        const annotation = this.getInitialAnnotation(
          mouseState,
          annotationLayer
        );
        const reference = annotationLayer.source.add(
          annotation,
          //commit= 
          false,
        );
        const disposer = () => reference.dispose();
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };

        childTool.trigger(mouseState, reference);
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
      }
      else {
        const reference = this.inProgressAnnotation.reference;
        childTool.trigger(mouseState, reference);
      }
    }
  }

  complete(): boolean {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return false;
    }

    const childTool = <PlacePolygonTool>this.childTool;
    const result = childTool.complete();
    if (!result) return false;

    if (!this.inProgressAnnotation) return false;
    annotationLayer.source.commit(this.inProgressAnnotation.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      this.inProgressAnnotation.reference.id,
      true
    );

    return true;
  }

  undo(mouseState: MouseSelectionState): boolean {
    const childTool = <PlacePolygonTool>this.childTool;
    return childTool.undo(mouseState);
  }

  get description() {
    let description = `annotate volume ${this.inProgressAnnotation === undefined ? "(new)" : "(edit)"
      }`;

    const placePolygonTool = <PlacePolygonTool>this.childTool
    if (placePolygonTool.inProgressAnnotation !== undefined) {
      description += ` > ${placePolygonTool.description}`;
    }

    return description;
  }

  toJSON() {
    return ANNOTATE_VOLUME_TOOL_ID;
  }
}
*/
export class PlaceCloudTool extends PlaceCollectionAnnotationTool {
  constructor(
    public layer: UserLayerWithAnnotations,
    options: any,
    reference?: AnnotationReference,
  ) {
    super(layer, options);

    this.childTool = new PlacePointTool(layer, { ...options, parent: this });
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

  getInitialAnnotation(
    mouseState: MouseSelectionState,
    annotationLayer: AnnotationLayerState
  ): Annotation {
    const point = getMousePositionInAnnotationCoordinates(
      mouseState,
      annotationLayer
    );
    return <Cloud>{
      id: '',
      type: AnnotationType.CLOUD,
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

  trigger(mouseState: MouseSelectionState) {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return;
    }

    const childTool = <PlacePointTool>this.childTool;
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

        childTool.trigger(mouseState, reference);
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
      }
      else {
        const reference = this.inProgressAnnotation.reference;
        childTool.trigger(mouseState, reference);
      }
      this.complete();
    }
  }

  complete(): boolean {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return false;
    }

    if (!this.inProgressAnnotation) return false;
    annotationLayer.source.commit(this.inProgressAnnotation.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      this.inProgressAnnotation.reference.id,
      true
    );

    return true;
  }

  undo(): boolean {
    const { annotationLayer } = this;
    if (annotationLayer === undefined) {
      // Not yet ready.
      return false;
    }

    if (!this.inProgressAnnotation) return false;
    const cloud = <Cloud>this.inProgressAnnotation.reference.value!
    const childIds = cloud.childAnnotationIds;
    if (childIds.length > 0) {
      const lastChild = annotationLayer.source.getReference(
        childIds[childIds.length - 1]
      );
      annotationLayer.source.delete(lastChild);
    }

    return true
  }

  get description() {
    return `annotate cloud ${this.inProgressAnnotation === undefined ? "(new)" : "(edit)"
      }`;
  }

  toJSON() {
    return ANNOTATE_CLOUD_TOOL_ID;
  }
}

/**
 * An abstract class to represent any annotation tool with multiple steps to 
 * complete annotation.
 */
export abstract class MultiStepAnnotationTool extends PlaceCollectionAnnotationTool {

}

/**
 * This class is used to draw polygon annotations.
 */
export class PlacePolygonTool extends MultiStepAnnotationTool {
  constructor(public layer: UserLayerWithAnnotations, options: any) {
    super(layer, options);
    this.childTool = new PlaceLineTool(layer, { ...options, parent: this });
  }

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
    return <Polygon>{
      id: '',
      type: AnnotationType.POLYGON,
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

      const childTool = <PlaceLineTool>this.childTool;
      if (this.inProgressAnnotation === undefined) {
        const annotation = this.getInitialAnnotation(
          mouseState,
          annotationLayer
        );

        let index = undefined;
        if (parentRef && parentRef.value) {
          // Check if a polygon already exists on the same section
          const zCoord = getZCoordinate(point);
          if (zCoord === undefined) return;

          /* TODO
          if (!isSectionValid(annotationLayer.source, parentRef.id, zCoord)) {
            StatusMessage.showTemporaryMessage(
              "A polygon already exists in this section for the volume, \
              only one polygon per section is allowed for a volume.",
              5000,
            );
            return;
          }
          */

          // Copy the properties
          annotation.properties = Object.assign(
            [],
            parentRef.value.properties
          );

          // Calculate the insertion index for in parent's child ID list
          /* TODO
          const polygons = getPolygonsByVolumeId(
            annotationLayer.source,
            parentRef.id
          )
          if (polygons) {
            const polygonZCoods = polygons.map(
              (polygon) => getZCoordinate(polygon.centroid)
            ).map(
              (zIndex) => zIndex === undefined ? -1 : zIndex
            );
            index = binarySearchInsert(polygonZCoods, zCoord, (a, b) => a - b)
          }
          */
        }

        const reference = annotationLayer.source.add(
          annotation,
          /*commit=*/ false,
          parentRef,
          index,
        );
        this.layer.selectAnnotation(annotationLayer, reference.id, true);
        childTool.trigger(mouseState, reference);

        const disposer = () => reference.dispose();
        this.inProgressAnnotation = {
          annotationLayer,
          reference,
          disposer,
        };
      }
      else {
        const reference = this.inProgressAnnotation.reference;
        const polygon = <Polygon>reference.value!;
        if (!isPointUniqueInPolygon(annotationLayer, polygon, point)) {
          StatusMessage.showTemporaryMessage(
            "All vertices of polygon must be unique.",
            5000,
          );
          return;
        }

        const curZCood = getZCoordinate(polygon.source);
        const newZCoord = getZCoordinate(point);
        if (curZCood === undefined || newZCoord === undefined) return;
        if (curZCood !== newZCoord) {
          StatusMessage.showTemporaryMessage(
            "All vertices of polygon must be in the same plane.",
            5000,
          );
          return;
        }

        // Finish the current line
        childTool.trigger(mouseState, reference);
        // Start a new line
        childTool.trigger(mouseState, reference);
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

    const childTool = <PlaceLineTool>this.childTool;
    const childInProgressAnn = childTool.inProgressAnnotation.value;
    if (
      childInProgressAnn === undefined ||
      this.inProgressAnnotation === undefined
    ) return false;

    const annotation = <Polygon>this.inProgressAnnotation.reference.value;

    // There must be at least 3 lines in a polygon
    if (annotation.childAnnotationIds.length < 3) {
      StatusMessage.showTemporaryMessage(
        "There must be at least 3 lines in a polygon",
        5000,
      );
      return false;
    }

    if (
      childInProgressAnn.reference === undefined ||
      childInProgressAnn.reference.value === undefined
    ) {
      return false;
    }

    // Add last line
    const newChildAnn = <Annotation>{
      ...childInProgressAnn.reference.value,
      pointB: annotation.source,
    };
    annotationLayer.source.update(childInProgressAnn.reference, newChildAnn);
    annotationLayer.source.commit(childInProgressAnn.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      childInProgressAnn.reference.id,
      true
    );
    childInProgressAnn.disposer();
    childTool.inProgressAnnotation.value = undefined;

    // Update polygon
    annotationLayer.source.commit(this.inProgressAnnotation.reference);
    this.layer.selectAnnotation(
      annotationLayer,
      this.inProgressAnnotation.reference.id,
      true
    );
    this.inProgressAnnotation.disposer();
    this.inProgressAnnotation = undefined;

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

    const childTool = <PlaceLineTool>this.childTool;
    const annotation = <Polygon>state.reference.value;
    if (annotation.childAnnotationIds.length > 0) {
      const id = annotation.childAnnotationIds[
        annotation.childAnnotationIds.length - 1
      ];
      const annotationRef = annotationLayer.source.getReference(id);
      annotationLayer.source.delete(annotationRef);
      annotationRef.dispose();
      childTool.inProgressAnnotation.value!.disposer();
      childTool.inProgressAnnotation.value = undefined;
    }

    if (annotation.childAnnotationIds.length > 0) {
      const updatePointB = () => {
        const state = childTool.inProgressAnnotation.value!;
        const reference = state.reference;
        const newAnnotation = childTool.getUpdatedAnnotation(
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
        childTool.layer.selectAnnotation(
          annotationLayer,
          reference.id,
          true
        );
      };

      const id = annotation.childAnnotationIds[
        annotation.childAnnotationIds.length - 1
      ];
      const reference = annotationLayer.source.getReference(id);
      childTool.layer.selectAnnotation(annotationLayer, reference.id, true);
      const mouseDisposer = mouseState.changed.add(updatePointB);
      const disposer = () => {
        mouseDisposer();
        reference.dispose();
      };
      childTool.inProgressAnnotation.value = {
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

  deactivate() {
    super.deactivate();
    if (this.inProgressAnnotation !== undefined) {
      this.inProgressAnnotation.annotationLayer.source.delete(
        this.inProgressAnnotation.reference
      );
      this.inProgressAnnotation.disposer();
      this.inProgressAnnotation = undefined;
    }
  }

  get description() {
    return `annotate polygon`;
  }

  toJSON() {
    return ANNOTATE_POLYGON_TOOL_ID;
  }
}
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
/* TODO
registerLegacyTool(
  ANNOTATE_VOLUME_TOOL_ID,
  (layer, options) =>
    new PlaceVolumeTool(<UserLayerWithAnnotations>layer, options)
);
*/
registerLegacyTool(
  ANNOTATE_CLOUD_TOOL_ID,
  (layer, options) =>
    new PlaceCloudTool(<UserLayerWithAnnotations>layer, options)
);
/* BRAINSHARE ENDS */


const newRelatedSegmentKeyMap = EventActionMap.fromObject({
  enter: { action: "commit" },
  escape: { action: "cancel" },
});


function makeRelatedSegmentList(
  listName: string,
  segments: BigUint64Array,
  segmentationDisplayState: WatchableValueInterface<
    SegmentationDisplayState | null | undefined
  >,
  mutate?: ((newSegments: BigUint64Array) => void) | undefined,
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
          setClipboard(Array.from(segments, (x) => x.toString()).join(", "));
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
            mutate(new BigUint64Array(0));
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
              try {
                const id = parseUint64(idElement.value);
                idElement.dataset.valid = "true";
                return id;
              } catch {
                idElement.dataset.valid = "false";
                return undefined;
              }
            };
            validateInput();
            idElement.addEventListener("input", () => {
              validateInput();
            });
            idElement.addEventListener("blur", () => {
              const id = validateInput();
              if (id !== undefined) {
                mutate(BigUint64Array.from([...segments, id]));
              }
              addContextDisposer();
            });
            registerActionListener(idElement, "cancel", addContextDisposer);
            registerActionListener(idElement, "commit", () => {
              const id = validateInput();
              if (id !== undefined) {
                mutate(BigUint64Array.from([...segments, id]));
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
              mutate(segments.filter((x) => x !== id));
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
    static supportColorPickerInAnnotationTab = true;

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
                /* BRAINSHARE STARTS */
                // Rewrite annotation detail list
                const addPositionGrid = () => {
                  const positionGrid = document.createElement("div");
                  positionGrid.classList.add(
                    "neuroglancer-selected-annotation-details-position-grid",
                  );
                  positionGrid.style.gridTemplateColumns = `
                    [icon] 0fr 
                    [copy] 0fr 
                    repeat(${layerRank}, [dim] 0fr [coord] 0fr) 
                    [move] 0fr 
                    [delete] 0fr
                    [show] 0fr
                  `;
                  parent.appendChild(positionGrid);

                  return positionGrid;
                }

                const addListEntry = (
                  div: HTMLDivElement,
                  annRef: AnnotationReference,
                ) => {
                  if (annRef.value === null) return;
                  const annType = AnnotationType[annRef.value!.type];
                  const handler = annotationTypeHandlers[annRef.value!.type];
                  const icon = makeIcon({
                    text: handler.icon,
                    title: `Select the annotation ${annType}`,
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
                  div.appendChild(icon);

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
                      div.appendChild(dimElement);
                    }
                    visitTransformedAnnotationGeometry(
                      annRef.value!,
                      chunkTransform as ChunkTransformParameters,
                      (layerPosition, isVector) => {
                        const copyButton = makeCopyButton({
                          title: `Copy the annotation ${annType} to clipboard`,
                          onClick: () => {
                            const dataSource = this.dataSources[0];
                            if (dataSource === undefined) return;
                            const transform = dataSource.spec.transform;
                            if (transform === undefined) return;
                            let inputCoordinateSpace = transform.inputSpace;
                            if (inputCoordinateSpace === undefined) {
                              inputCoordinateSpace = transform.outputSpace;
                            }
                            const json = annotationToPortableJson(
                              annRef.value!,
                              annotationLayer.source,
                              inputCoordinateSpace,
                            )
                            setClipboard(JSON.stringify(json));
                            StatusMessage.showTemporaryMessage(
                              `Annotation ${annType} copied to clipboard.`,
                              5000,
                            );
                          },
                        });
                        copyButton.style.gridColumn = "copy";
                        div.appendChild(copyButton);
                        for (let i = 0; i < layerRank; ++i) {
                          const coordElement = document.createElement("div");
                          coordElement.classList.add(
                            "neuroglancer-selected-annotation-details-position-coord",
                          );
                          coordElement.style.gridColumn = `coord ${i + 1}`;
                          coordElement.textContent = Math.floor(
                            layerPosition[i],
                          ).toString();
                          div.appendChild(coordElement);
                        }
                        if (!isVector) {
                          const moveButton = makeMoveToButton({
                            title: `Move to the annotation ${annType}`,
                            onClick: () => {
                              setLayerPosition(
                                this,
                                chunkTransform,
                                layerPosition,
                              );
                            },
                          });
                          moveButton.style.gridColumn = "move";
                          div.appendChild(moveButton);
                        }
                      },
                    );

                    const deleteButton = makeDeleteButton({
                      title: `Delete the annotation ${annType}`,
                      onClick: () => {
                        annotationLayer.source.delete(annRef);
                      },
                    });
                    deleteButton.classList.add(
                      "neuroglancer-selected-annotation-details-delete",
                    );
                    div.appendChild(deleteButton);
                  }
                }

                const annotationGrid = addPositionGrid();
                addListEntry(annotationGrid, reference);

                if (
                  !annotationLayer.source.readonly &&
                  !reference.value!.parentAnnotationId &&
                  brainState.value && 
                  userState.value  &&
                  userState.value.id  &&
                  reference.value!.description
                ) {
                  const sessionIdDiv = document.createElement("div");
                  sessionIdDiv.classList.add(
                    "neuroglancer-annotation-session-id"
                  );
                  parent.appendChild(sessionIdDiv);
                  const idTextDiv = document.createElement("div");
                  const sessionID = reference.value!.sessionID;
                  idTextDiv.textContent = !sessionID ? "No annotation ID" : 
                    `Annotation ID: ${sessionID}`;
                  sessionIdDiv.appendChild(idTextDiv);
                  const saveNewDiv = document.createElement("div");
                  sessionIdDiv.appendChild(saveNewDiv);

                  const newButton = makeIcon({
                    text: "new",
                    title: "Export this annotation to the database",
                    onClick: () => {
                      console.log("Exporting annotation to the database");
                      console.log('this datasource', this.dataSources[0]);
                      uploadAnnotation(
                        reference, 
                        this.dataSources[0], 
                        annotationLayer,
                        false,
                      );
                    },
                  });

                  saveNewDiv.appendChild(newButton);

                  if (sessionID) {
                    const saveButton = makeIcon({
                      text: "save",
                      title: "Save the annotation in database",
                      onClick: () => {
                      uploadAnnotation(
                        reference, 
                        this.dataSources[0], 
                        annotationLayer,
                        true,
                      );
                      },
                    });
                    saveNewDiv.appendChild(saveButton);
                  }
                }


                // Annotation labels (description)
                const labelsDiv = document.createElement("div");
                labelsDiv.style.display = "flex";
                labelsDiv.style.flexDirection = "column";
                parent.appendChild(labelsDiv);

                if (annotation.description) {
                  const labels = annotation.description.split("\n").filter(
                    x => x !== ""
                  );
                  for (let i = 0; i < labels.length; i++) {
                    const labelDiv = document.createElement("div");
                    labelDiv.style.display = "flex";
                    labelDiv.style.flexDirection = "row";
                    labelDiv.style.justifyContent = "space-between";
                    labelsDiv.appendChild(labelDiv);

                    const labelTextDiv = document.createElement("div");
                    labelTextDiv.className =
                      "neuroglancer-annotation-details-description";
                    labelTextDiv.textContent = labels[i] || "";
                    labelDiv.appendChild(labelTextDiv);

                    const labelDeleteButton = makeDeleteButton({
                      title: "Delete annotation label",
                      onClick: () => {
                        labels.splice(i, 1);
                        const description = labels.join("\n");
                        annotationLayer.source.update(reference, {
                          ...annotation!,
                          description: description ? description : undefined,
                        });
                      },
                    })
                    labelDiv.appendChild(labelDeleteButton);
                  }
                }

                const addLabelToDescription = (label: string) => {
                  if (!annotation) return;
                  
                  let newDescription = annotation.description;
                  if (newDescription) newDescription += "\n" + label;
                  else newDescription = label;

                  annotationLayer.source.update(reference, {
                    ...annotation!,
                    description: newDescription,
                  });
                }

                //TODO removing the cancellation token
                if (userState.value && userState.value.id !== 0) {
                  const searchAnnotationLabels = new AnnotationSearchBar({
                    completer: (
                      request: CompletionRequest,
                      _signal: AbortSignal
                    ) => {
                      const defaultCompletionResult = {
                        completions: [],
                        offset: 0,
                        showSingleResult: false,
                        selectSingleResult: false,
                        makeElement: makeAnnotationCompletionElement,
                      }

                      return fetchOk(
                        APIs.GET_ANNOTATION_LABELS + request.value,
                        { method: "GET" },
                      ).then(
                        response => response.json()
                      ).then(json => {
                        if (!Array.isArray(json)) throw new Error(
                          "JSON is not an array"
                        );

                        return {
                          ...defaultCompletionResult,
                          completions: json.map((label: any) => ({
                            value: label.label,
                            description: label.label_type,
                          })),
                        };
                      }).catch(err => {
                        console.log(err);
                        StatusMessage.showTemporaryMessage(
                          "There is an error in searching annotations labels.\
                          Please see console for details.",
                          5000,
                        );
                        return defaultCompletionResult;
                      })
                    },
                    selectCompletion: (completion) => {
                      addLabelToDescription(completion.value);
                    },
                    placeHolder: "Add annotation labels"
                  });
                  labelsDiv.appendChild(searchAnnotationLabels.element);
                }

                // Rewrite annotation property list
                const { relationships, properties } = annotationLayer.source;
                const sourceReadonly = annotationLayer.source.readonly;
                if (!annotation.parentAnnotationId) {
                  for (let i = 0, count = properties.length; i < count; ++i) {
                    const property = properties[i];
                    const { identifier, description, type } = property;
                    const propertyDiv = document.createElement("div");
                    propertyDiv.classList.add(
                      "neuroglancer-annotation-property"
                    );

                    const idDiv = document.createElement("div");
                    idDiv.textContent = identifier.replace(/_/g, " ");
                    if (description !== undefined) idDiv.title = description;
                    propertyDiv.appendChild(idDiv);

                    let valueInput: HTMLInputElement;
                    const value = annotation.properties[i];
                    if (type === "rgb" || type === "rgba") {
                      const colorVec = unpackRGB(annotation.properties[i]);
                      valueInput = document.createElement("input");
                      valueInput.classList.add(
                        "neuroglancer-annotation-property-color-input"
                      );
                      valueInput.type = "color";
                      valueInput.value = serializeColor(colorVec);
                      valueInput.style.color = serializeColor(colorVec);
                      valueInput.style.backgroundColor = serializeColor(colorVec);
                      valueInput.addEventListener("change", () => {
                        const colorNum = packColor(
                          parseRGBColorSpecification(valueInput.value)
                        )
                        annotationLayer.source.updateColor(reference, colorNum);
                      });
                    }
                    else {
                      const { min, max, step } = (
                        <AnnotationNumericPropertySpec>property
                      )
                      valueInput = document.createElement("input");
                      valueInput.classList.add(
                        "neuroglancer-annotation-property-value-input"
                      );
                      valueInput.type = "number";
                      valueInput.value = formatNumericProperty(
                        <AnnotationNumericPropertySpec>property,
                        value,
                      );
                      if (min !== undefined) valueInput.min = min.toString();
                      if (max !== undefined) valueInput.max = max.toString();
                      if (step !== undefined) valueInput.step = step.toString();

                      valueInput.addEventListener("change", () => {
                        let newValue = parseFloat(valueInput.value);
                        if (Number.isNaN(newValue)) newValue = value
                        if (min !== undefined && newValue < min) newValue = min;
                        if (max !== undefined && newValue > max) newValue = max;

                        if (step !== undefined) {
                          newValue = Math.floor(newValue / step) * step;
                        }

                        annotationLayer.source.updateProperty(
                          reference,
                          identifier,
                          newValue,
                        );
                        valueInput.value = formatNumericProperty(
                          <AnnotationNumericPropertySpec>property,
                          value,
                        );
                      });
                    }

                    if (reference.value && reference.value.parentAnnotationId) {
                      valueInput.disabled = true;
                    };
                    propertyDiv.appendChild(valueInput);
                    parent.appendChild(propertyDiv);
                  }
                }

                const { relatedSegments } = annotation;
                for (let i = 0, count = relationships.length; i < count; ++i) {
                  const related = relatedSegments === undefined ? new BigUint64Array(0) : relatedSegments[i];
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
                                  () => new BigUint64Array(0),
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

                // Remove description input

                // Add parent annotation 
                if (annotation.parentAnnotationId) {
                  const parentAnnotationTitleDiv = document.createElement("div");
                  parentAnnotationTitleDiv.classList.add(
                    "neuroglancer-selection-details-layer-title"
                  );
                  parentAnnotationTitleDiv.textContent = "parent annotation";
                  parent.appendChild(parentAnnotationTitleDiv);

                  const parentGrid = addPositionGrid();
                  const parentRef = annotationLayer.source.getReference(
                    annotation.parentAnnotationId
                  );
                  addListEntry(parentGrid, parentRef);
                }

                // Add child annotation section
                if (annotation.childAnnotationIds) {
                  const childAnnotationTitleDiv = document.createElement("div");
                  childAnnotationTitleDiv.classList.add(
                    "neuroglancer-selection-details-layer-title"
                  );
                  childAnnotationTitleDiv.textContent = "child annotations";
                  parent.appendChild(childAnnotationTitleDiv);

                  if (
                    //TODO annotation.type === AnnotationType.VOLUME ||
                    annotation.type === AnnotationType.CLOUD
                  ) {
                    const editPasteDiv = document.createElement("div");
                    editPasteDiv.style.display = "flex";
                    editPasteDiv.style.alignItems = "center";

                    parent.appendChild(editPasteDiv);

                    const editButton = makeAddButton({
                      title: "Add a child annotation",
                      onClick: () => {
                        if (!annotation) return;
                        /*TODO
                        if (annotation.type === AnnotationType.VOLUME) {
                          this.tool.value = new PlaceVolumeTool(
                            this,
                            {},
                            reference
                          );
                        }
                        else
                        */ 
                        if (annotation.type === AnnotationType.CLOUD) {
                          this.tool.value = new PlaceCloudTool(
                            this,
                            {},
                            reference
                          );
                        }
                      },
                    });
                    editButton.style.gridColumn = "icon";
                    editPasteDiv.appendChild(editButton);

                    const pasteButton = makeIcon({
                      svg: svg_clipBoard,
                      title: "Paste a child annotation from the clipboard",
                      onClick: () => {
                        const dataSource = this.dataSources[0];
                        if (dataSource === undefined) return;
                        const transform = dataSource.spec.transform;
                        if (transform === undefined) return;
                        navigator.clipboard.readText().then((json) => {
                          pasteAnnotation(
                            JSON.parse(json),
                            annotationLayer.source,
                            transform,
                            this.manager.root.globalPosition.value,
                            reference,
                          );
                        });
                      },
                    });
                    pasteButton.style.gridColumn = "copy";
                    editPasteDiv.appendChild(pasteButton);
                  }

                  const childrenGrid = addPositionGrid();
                  for (const childId of annotation.childAnnotationIds) {
                    const childRef = annotationLayer.source.getReference(
                      childId
                    );
                    addListEntry(childrenGrid, childRef);
                  }
                }

                /* BRAINSHARE ENDS */
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
      this.annotationDisplayState.annotationProperties.value = [];
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

type UserLayerWithAnnotationsClass = ReturnType<
  typeof UserLayerWithAnnotationsMixin
>;

export type UserLayerWithAnnotations =
  InstanceType<UserLayerWithAnnotationsClass>;
