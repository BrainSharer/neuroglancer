/**
 * @license
 * Copyright 2016 Google Inc.
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

import "#src/rendered_data_panel.css";
import "#src/noselect.css";
import { AnnotationType, type Annotation, type AnnotationReference } from "#src/annotation/index.js";
/* BRAINSHARE STARTS */
/*
import { Annotation } from "#/annotation";
*/
import { Line } from "#src/annotation/index.js"; 
/* BRAINSHARE ENDS */
import { getAnnotationTypeRenderHandler } from "#src/annotation/type_handler.js";
import type { DisplayContext } from "#src/display_context.js";
import { RenderedPanel } from "#src/display_context.js";
import type { NavigationState } from "#src/navigation_state.js";
import { PickIDManager } from "#src/object_picking.js";
import {
  displayToLayerCoordinates,
  layerToDisplayCoordinates,
  /* BRAINSHARE STARTS */
  getChunkPositionFromCombinedGlobalLocalPositions,
  /* BRAINSHARE ENDS */
} from "#src/render_coordinate_transform.js";
import { AutomaticallyFocusedElement } from "#src/util/automatic_focus.js";
import type { Borrowed } from "#src/util/disposable.js";
import type {
  ActionEvent,
  EventActionMap,
} from "#src/util/event_action_map.js";
import { registerActionListener } from "#src/util/event_action_map.js";
import { AXES_NAMES, kAxes, mat4, vec2, vec3 } from "#src/util/geom.js";
import { KeyboardEventBinder } from "#src/util/keyboard_bindings.js";
import * as matrix from "#src/util/matrix.js";
import { MouseEventBinder } from "#src/util/mouse_bindings.js";
import { startRelativeMouseDrag } from "#src/util/mouse_drag.js";
import type {
  TouchPinchInfo,
  TouchTranslateInfo,
  /* BRAINSHARE STARTS */
  TouchRotateInfo
  /* BRAINSHARE ENDS */
} from "#src/util/touch_bindings.js";
import { TouchEventBinder } from "#src/util/touch_bindings.js";
import { getWheelZoomAmount } from "#src/util/wheel_zoom.js";
import type { ViewerState } from "#src/viewer_state.js";
/* BRAINSHARE STARTS */
import { 
  PlaceCollectionAnnotationTool, 
  UserLayerWithAnnotations 
} from '#src/ui/annotations.js';
import { 
  getZCoordinate,
  isPointUniqueInPolygon,
  polygonRotateAngle, 
  polygonScalePercentage, 
  rotatePolygon, 
  scalePolygon 
} from '#src/annotation/polygon.js';
import { StatusMessage } from '#src/status.js';
import { isCornerPicked } from "#src/annotation/line.js";
import * as vector from "#src/util/vector.js";
import { getPolygonByZIndex } from "#src/annotation/volume.js";
/* BRAINSHARE ENDS */
declare let NEUROGLANCER_SHOW_OBJECT_SELECTION_TOOLTIP: boolean | undefined;

const tempVec3 = vec3.create();

export interface RenderedDataViewerState extends ViewerState {
  inputEventMap: EventActionMap;
}

export class FramePickingData {
  pickIDs = new PickIDManager();
  viewportWidth = 0;
  viewportHeight = 0;
  invTransform = mat4.create();
  frameNumber = -1;
}

export class PickRequest {
  buffer: WebGLBuffer | null = null;
  glWindowX = 0;
  glWindowY = 0;
  frameNumber: number;
  sync: WebGLSync | null;
}

const pickRequestInterval = 30;

export const pickRadius = 5;
export const pickDiameter = 1 + pickRadius * 2;

/**
 * Sequence of offsets into C order (pickDiamater, pickDiamater) array in order of increasing
 * distance from center.
 */
export const pickOffsetSequence = (() => {
  const maxDist2 = pickRadius ** 2;
  const getDist2 = (x: number, y: number) =>
    (x - pickRadius) ** 2 + (y - pickRadius) ** 2;

  let offsets = new Uint32Array(pickDiameter * pickDiameter);
  let count = 0;
  for (let x = 0; x < pickDiameter; ++x) {
    for (let y = 0; y < pickDiameter; ++y) {
      if (getDist2(x, y) > maxDist2) continue;
      offsets[count++] = y * pickDiameter + x;
    }
  }
  offsets = offsets.subarray(0, count);
  offsets.sort((a, b) => {
    const x1 = a % pickDiameter;
    const y1 = (a - x1) / pickDiameter;
    const x2 = b % pickDiameter;
    const y2 = (b - x2) / pickDiameter;
    return getDist2(x1, y1) - getDist2(x2, y2);
  });

  return offsets;
})();

/**
 * Sets array elements to 0 that would be outside the viewport.
 *
 * @param buffer Array view, which contains a C order (pickDiameter, pickDiameter) array.
 * @param baseOffset Offset into `buffer` corresponding to (0, 0).
 * @param stride Stride between consecutive elements of the array.
 * @param glWindowX Center x position, must be integer.
 * @param glWindowY Center y position, must be integer.
 * @param viewportWidth Width of viewport in pixels.
 * @param viewportHeight Width of viewport in pixels.
 */
export function clearOutOfBoundsPickData(
  buffer: Float32Array,
  baseOffset: number,
  stride: number,
  glWindowX: number,
  glWindowY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const startX = glWindowX - pickRadius;
  const startY = glWindowY - pickRadius;
  if (
    startX >= 0 &&
    startY >= 0 &&
    startX + pickDiameter <= viewportWidth &&
    startY + pickDiameter <= viewportHeight
  ) {
    return;
  }
  for (let relativeY = 0; relativeY < pickDiameter; ++relativeY) {
    for (let relativeX = 0; relativeX < pickDiameter; ++relativeX) {
      const x = startX + relativeX;
      const y = startY + relativeY;
      if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
        buffer[baseOffset + (y * pickDiameter + x) * stride] = 0;
      }
    }
  }
}

export abstract class RenderedDataPanel extends RenderedPanel {
  /**
   * Current mouse position within the viewport, or -1 if the mouse is not in the viewport.
   */
  mouseX = -1;
  mouseY = -1;

  /**
   * If `false`, either the mouse is not within the viewport, or a picking request was already
   * issued for the current mouseX and mouseY after the most recent frame was rendered; when the
   * current pick requests complete, no additional pick requests will be issued.
   *
   * If `true`, a picking request was not issued for the current mouseX and mouseY due to all pick
   * buffers being in use; when a pick buffer becomes available, an additional pick request will be
   * issued.
   */
  pickRequestPending = false;

  private mouseStateForcer = () => this.blockOnPickRequest();
  protected isMovingToMousePosition: boolean = false;

  inputEventMap: EventActionMap;

  abstract navigationState: NavigationState;

  pickingData = [new FramePickingData(), new FramePickingData()];
  pickRequests = [new PickRequest(), new PickRequest()];
  pickBufferContents: Float32Array = new Float32Array(
    2 * 4 * pickDiameter * pickDiameter,
  );

  /**
   * Reads pick data for the current mouse position into the currently-bound pixel pack buffer.
   */
  abstract issuePickRequest(glWindowX: number, glWindowY: number): void;

  /**
   * Timer id for checking if outstanding pick requests have completed.
   */
  private pickTimerId = -1;

  private cancelPickRequests() {
    const { gl } = this;
    for (const request of this.pickRequests) {
      const { sync } = request;
      if (sync !== null) {
        gl.deleteSync(sync);
      }
      request.sync = null;
    }
    clearTimeout(this.pickTimerId);
    this.pickTimerId = -1;
  }

  private issuePickRequestInternal(pickRequest: PickRequest) {
    const { gl } = this;
    let { buffer } = pickRequest;
    if (buffer === null) {
      buffer = pickRequest.buffer = gl.createBuffer();
      gl.bindBuffer(WebGL2RenderingContext.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(
        WebGL2RenderingContext.PIXEL_PACK_BUFFER,
        2 * 4 * 4 * pickDiameter * pickDiameter,
        WebGL2RenderingContext.STREAM_READ,
      );
    } else {
      gl.bindBuffer(WebGL2RenderingContext.PIXEL_PACK_BUFFER, buffer);
    }
    const { renderViewport } = this;
    const glWindowX =
      this.mouseX -
      renderViewport.visibleLeftFraction * renderViewport.logicalWidth;
    const glWindowY =
      renderViewport.height -
      (this.mouseY -
        renderViewport.visibleTopFraction * renderViewport.logicalHeight);
    this.issuePickRequest(glWindowX, glWindowY);
    pickRequest.sync = gl.fenceSync(
      WebGL2RenderingContext.SYNC_GPU_COMMANDS_COMPLETE,
      0,
    );
    pickRequest.frameNumber = this.context.frameNumber;
    pickRequest.glWindowX = glWindowX;
    pickRequest.glWindowY = glWindowY;
    gl.flush();
    // TODO(jbms): maybe call gl.flush to ensure fence is submitted
    gl.bindBuffer(WebGL2RenderingContext.PIXEL_PACK_BUFFER, null);
    if (this.pickTimerId === -1) {
      this.scheduleCheckForPickRequestCompletion();
    }
    this.pickRequestPending = false;
    const { pickRequests } = this;
    if (pickRequest !== pickRequests[0]) {
      pickRequests[1] = pickRequests[0];
      pickRequests[0] = pickRequest;
    }
    this.nextPickRequestTime = Date.now() + pickRequestInterval;
  }

  abstract completePickRequest(
    glWindowX: number,
    glWindowY: number,
    data: Float32Array,
    pickingData: FramePickingData,
  ): void;

  private completePickInternal(pickRequest: PickRequest) {
    const { gl } = this;
    const { pickBufferContents } = this;
    gl.bindBuffer(WebGL2RenderingContext.PIXEL_PACK_BUFFER, pickRequest.buffer);
    gl.getBufferSubData(
      WebGL2RenderingContext.PIXEL_PACK_BUFFER,
      0,
      pickBufferContents,
    );
    gl.bindBuffer(WebGL2RenderingContext.PIXEL_PACK_BUFFER, null);
    const { pickingData } = this;
    const { frameNumber } = pickRequest;
    this.completePickRequest(
      pickRequest.glWindowX,
      pickRequest.glWindowY,
      pickBufferContents,
      pickingData[0].frameNumber === frameNumber
        ? pickingData[0]
        : pickingData[1],
    );
  }

  private scheduleCheckForPickRequestCompletion() {
    this.pickTimerId = window.setTimeout(() => {
      this.pickTimerId = -1;
      this.checkForPickRequestCompletion();
    }, 0);
  }

  private checkForPickRequestCompletion(
    checkingBeforeDraw = false,
    block = false,
  ) {
    let currentFrameNumber = this.context.frameNumber;
    let cancelIfNotReadyFrameNumber = -1;
    if (checkingBeforeDraw) {
      --currentFrameNumber;
      cancelIfNotReadyFrameNumber = currentFrameNumber - 1;
    }
    const { pickRequests } = this;
    const { gl } = this;
    let remaining = false;
    let cancelRemaining = false;
    let available: PickRequest | undefined;
    for (const pickRequest of pickRequests) {
      const { sync } = pickRequest;
      if (sync === null) continue;
      const { frameNumber } = pickRequest;
      if (!cancelRemaining && frameNumber >= currentFrameNumber - 1) {
        if (
          block ||
          gl.getSyncParameter(sync, WebGL2RenderingContext.SYNC_STATUS) ===
            WebGL2RenderingContext.SIGNALED
        ) {
          this.completePickInternal(pickRequest);
          cancelRemaining = true;
        } else if (frameNumber !== cancelIfNotReadyFrameNumber) {
          remaining = true;
          continue;
        }
      }
      gl.deleteSync(sync);
      pickRequest.sync = null;
      available = pickRequest;
    }
    const { pickTimerId } = this;
    if (remaining && pickTimerId === -1) {
      this.scheduleCheckForPickRequestCompletion();
    } else if (!remaining && pickTimerId !== -1) {
      window.clearTimeout(pickTimerId);
      this.pickTimerId = -1;
    }
    if (
      !checkingBeforeDraw &&
      available !== undefined &&
      this.pickRequestPending &&
      this.canIssuePickRequest()
    ) {
      this.issuePickRequestInternal(available);
    }
  }

  private blockOnPickRequest() {
    if (this.pickRequestPending) {
      this.cancelPickRequests();
      this.nextPickRequestTime = 0;
      this.attemptToIssuePickRequest();
    }
    this.checkForPickRequestCompletion(
      /*checkingBeforeDraw=*/ false,
      /*block=*/ true,
    );
  }

  draw() {
    const { width, height } = this.renderViewport;
    this.checkForPickRequestCompletion(true);
    const { pickingData } = this;
    pickingData[0] = pickingData[1];
    const currentFrameNumber = this.context.frameNumber;
    const newPickingData = pickingData[1];
    newPickingData.frameNumber = currentFrameNumber;
    newPickingData.viewportWidth = width;
    newPickingData.viewportHeight = height;
    newPickingData.pickIDs.clear();
    if (!this.drawWithPicking(newPickingData)) {
      newPickingData.frameNumber = -1;
      return;
    }
    // For the new frame, allow new pick requests regardless of interval since last request.
    this.nextPickRequestTime = 0;
    if (this.mouseX >= 0) {
      this.attemptToIssuePickRequest();
    }
  }

  abstract drawWithPicking(pickingData: FramePickingData): boolean;

  private nextPickRequestTime = 0;
  private pendingPickRequestTimerId = -1;

  private pendingPickRequestTimerExpired = () => {
    this.pendingPickRequestTimerId = -1;
    if (!this.pickRequestPending) return;
    this.attemptToIssuePickRequest();
  };

  private canIssuePickRequest(): boolean {
    const time = Date.now();
    const { nextPickRequestTime, pendingPickRequestTimerId } = this;
    if (time < nextPickRequestTime) {
      if (pendingPickRequestTimerId === -1) {
        this.pendingPickRequestTimerId = window.setTimeout(
          this.pendingPickRequestTimerExpired,
          nextPickRequestTime - time,
        );
      }
      return false;
    }
    return true;
  }

  private attemptToIssuePickRequest() {
    if (!this.canIssuePickRequest()) return;
    const currentFrameNumber = this.context.frameNumber;
    const { gl } = this;

    const { pickRequests } = this;

    // Try to find an available PickRequest object.

    for (const pickRequest of pickRequests) {
      const { sync } = pickRequest;
      if (sync !== null) {
        if (pickRequest.frameNumber < currentFrameNumber - 1) {
          gl.deleteSync(sync);
        } else {
          continue;
        }
      }
      this.issuePickRequestInternal(pickRequest);
      return;
    }
  }

  /**
   * Called each time the mouse position relative to the top level of the rendered viewport changes.
   */
  private updateMousePosition(mouseX: number, mouseY: number): void {
    if (mouseX === this.mouseX && mouseY === this.mouseY) {
      return;
    }
    this.mouseX = mouseX;
    this.mouseY = mouseY;
    if (mouseX < 0) {
      // Mouse moved out of the viewport.
      this.pickRequestPending = false;
      this.cancelPickRequests();
      return;
    }
    const currentFrameNumber = this.context.frameNumber;
    const pickingData = this.pickingData[1];
    if (
      pickingData.frameNumber !== currentFrameNumber ||
      this.renderViewport.width !== pickingData.viewportWidth ||
      this.renderViewport.height !== pickingData.viewportHeight
    ) {
      // Viewport size has changed since the last frame, which means a redraw is pending.  Don't
      // issue pick request now.  Once will be issued automatically after the redraw.
      return;
    }
    this.pickRequestPending = true;
    this.attemptToIssuePickRequest();
  }

  protected isMovingToMousePositionOnPick = false;

  constructor(
    context: Borrowed<DisplayContext>,
    element: HTMLElement,
    public viewer: RenderedDataViewerState,
  ) {
    super(context, element, viewer.visibility);
    this.inputEventMap = viewer.inputEventMap;

    element.classList.add("neuroglancer-rendered-data-panel");
    element.classList.add("neuroglancer-panel");
    element.classList.add("neuroglancer-noselect");
    if (
      typeof NEUROGLANCER_SHOW_OBJECT_SELECTION_TOOLTIP !== "undefined" &&
      NEUROGLANCER_SHOW_OBJECT_SELECTION_TOOLTIP === true
    ) {
      element.title =
        "Double click to toggle display of object under mouse pointer.  Control+rightclick to pin/unpin selection.";
    }

    this.registerDisposer(new AutomaticallyFocusedElement(element));
    this.registerDisposer(new KeyboardEventBinder(element, this.inputEventMap));
    this.registerDisposer(
      new MouseEventBinder(element, this.inputEventMap, (event) => {
        this.onMousemove(event);
      }),
    );
    this.registerDisposer(new TouchEventBinder(element, this.inputEventMap));

    this.registerEventListener(
      element,
      "mousemove",
      this.onMousemove.bind(this),
    );
    this.registerEventListener(
      element,
      "touchstart",
      this.onTouchstart.bind(this),
    );
    this.registerEventListener(element, "mouseleave", () => this.onMouseout());
    this.registerEventListener(
      element,
      "mouseover",
      (event) => {
        if (event.target !== element) {
          this.onMouseout();
        }
      },
      /*capture=*/ true,
    );

    registerActionListener(element, "select-position", () => {
      this.viewer.selectionDetailsState.select();
    });

    registerActionListener(element, "snap", () => {
      this.navigationState.pose.snap();
    });

    registerActionListener(element, "zoom-in", () => {
      this.context.flagContinuousCameraMotion();
      this.navigationState.zoomBy(0.5);
    });

    registerActionListener(element, "zoom-out", () => {
      this.context.flagContinuousCameraMotion();
      this.navigationState.zoomBy(2.0);
    });

    registerActionListener(element, "depth-range-decrease", () => {
      this.context.flagContinuousCameraMotion();
      this.navigationState.depthRange.value *= 0.5;
    });

    registerActionListener(element, "depth-range-increase", () => {
      this.context.flagContinuousCameraMotion();
      this.navigationState.depthRange.value *= 2;
    });

    for (let axis = 0; axis < 3; ++axis) {
      const axisName = AXES_NAMES[axis];
      for (const sign of [-1, +1]) {
        const signStr = sign < 0 ? "-" : "+";
        registerActionListener(
          element,
          `rotate-relative-${axisName}${signStr}`,
          () => {
            this.context.flagContinuousCameraMotion();
            this.navigationState.pose.rotateRelative(kAxes[axis], sign * 0.1);
          },
        );
        const tempOffset = vec3.create();
        registerActionListener(element, `${axisName}${signStr}`, () => {
          this.context.flagContinuousCameraMotion();
          const { navigationState } = this;
          const offset = tempOffset;
          offset[0] = 0;
          offset[1] = 0;
          offset[2] = 0;
          offset[axis] = sign;
          navigationState.pose.translateVoxelsRelative(offset);
        });
      }
    }

    registerActionListener(
      element,
      "zoom-via-wheel",
      (event: ActionEvent<WheelEvent>) => {
        this.context.flagContinuousCameraMotion();
        const e = event.detail;
        this.onMousemove(e, false);
        this.zoomByMouse(getWheelZoomAmount(e));
      },
    );

    registerActionListener(
      element,
      "adjust-depth-range-via-wheel",
      (event: ActionEvent<WheelEvent>) => {
        this.context.flagContinuousCameraMotion();
        const e = event.detail;
        this.navigationState.depthRange.value *= getWheelZoomAmount(e);
      },
    );

    registerActionListener(
      element,
      "translate-via-mouse-drag",
      (e: ActionEvent<MouseEvent>) => {
        startRelativeMouseDrag(e.detail, (_event, deltaX, deltaY) => {
          this.context.flagContinuousCameraMotion();
          this.translateByViewportPixels(deltaX, deltaY);
        });
      },
    );

    registerActionListener(
      element,
      "translate-in-plane-via-touchtranslate",
      (e: ActionEvent<TouchTranslateInfo>) => {
        this.context.flagContinuousCameraMotion();
        const { detail } = e;
        this.translateByViewportPixels(detail.deltaX, detail.deltaY);
      },
    );

    registerActionListener(
      element,
      "translate-z-via-touchtranslate",
      (e: ActionEvent<TouchTranslateInfo>) => {
        this.context.flagContinuousCameraMotion();
        const { detail } = e;
        const { navigationState } = this;
        const offset = tempVec3;
        offset[0] = 0;
        offset[1] = 0;
        offset[2] = detail.deltaY + detail.deltaX;
        navigationState.pose.translateVoxelsRelative(offset);
      },
    );

    for (const amount of [1, 10]) {
      registerActionListener(
        element,
        `z+${amount}-via-wheel`,
        (event: ActionEvent<WheelEvent>) => {
          this.context.flagContinuousCameraMotion();
          const e = event.detail;
          const { navigationState } = this;
          const offset = tempVec3;
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          offset[0] = 0;
          offset[1] = 0;
          offset[2] = (delta > 0 ? -1 : 1) * amount;
          navigationState.pose.translateVoxelsRelative(offset);
        },
      );
    }

    registerActionListener(element, "move-to-mouse-position", () => {
      const { mouseState } = this.viewer;
      if (mouseState.updateUnconditionally()) {
        this.navigationState.position.value = mouseState.position;
      }
    });

    registerActionListener(element, "snap", () =>
      this.navigationState.pose.snap(),
    );

    registerActionListener(
      element,
      "move-annotation",
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        if (annotationLayer !== undefined) {
          if (selectedAnnotationId !== undefined) {
            e.stopPropagation();
            const annotationRef =
              annotationLayer.source.getReference(selectedAnnotationId)!;
            const ann = <Annotation>annotationRef.value;

            const handler = getAnnotationTypeRenderHandler(ann.type);
            const pickedOffset = mouseState.pickedOffset;
            const {
              chunkTransform: { value: chunkTransform },
            } = annotationLayer;
            if (chunkTransform.error !== undefined) return;
            const { layerRank } = chunkTransform;
            const repPoint = new Float32Array(layerRank);
            handler.getRepresentativePoint(
              repPoint,
              ann,
              mouseState.pickedOffset,
            );
            /* BRAINSHARE STARTS */
            const pickedAnnotations: { 
              pickedAnnRef: AnnotationReference,
              pickedRepPoint: Float32Array,
              pickedPartIndex: number, 
            }[] = [];
            if (ann.parentAnnotationId === undefined) {
              pickedAnnotations.push({
                pickedAnnRef: annotationRef,
                pickedRepPoint: repPoint,
                pickedPartIndex: pickedOffset, 
              });
            }
            else {
              const parAnn = annotationLayer.source.getReference(
                ann.parentAnnotationId
              ).value;
              if (parAnn) {
                if (parAnn.type === AnnotationType.POLYGON) {
                  const childAnnotationIds = parAnn.childAnnotationIds!;
                  const length = childAnnotationIds.length;

                  let pickedLineIndex = -1;
                  let lineIndex1 = -1;
                  let lineIndex2 = -1;
                  if (isCornerPicked(pickedOffset)) {
                    pickedLineIndex = childAnnotationIds.indexOf(ann.id);
                    if (pickedOffset == 1) {
                      lineIndex1 = pickedLineIndex - 1;
                      lineIndex2 = pickedLineIndex;
                      if (pickedLineIndex === 0) lineIndex1 = length - 1;
                    }
                    else if (pickedOffset == 2) {
                      lineIndex1 = pickedLineIndex;
                      lineIndex2 = pickedLineIndex + 1;
                      if (pickedLineIndex === length - 1) lineIndex2 = 0;
                    }
                    
                    const childAnnRef1 = annotationLayer.source.getReference(
                      childAnnotationIds[lineIndex1],
                    );
                    const childAnn1 = childAnnRef1.value!;

                    const childRepPoint1 = new Float32Array(layerRank)
                    handler.getRepresentativePoint(childRepPoint1, childAnn1, 2);
                    pickedAnnotations.push({
                      pickedAnnRef: childAnnRef1,
                      pickedRepPoint: childRepPoint1,
                      pickedPartIndex: 2,
                    });

                    const childAnnRef2 = annotationLayer.source.getReference(
                      childAnnotationIds[lineIndex2],
                    );
                    const childAnn2 = childAnnRef2.value!;

                    const childRepPoint2 = new Float32Array(layerRank)
                    handler.getRepresentativePoint(childRepPoint2, childAnn2, 1);
                    pickedAnnotations.push({
                      pickedAnnRef: childAnnRef2,
                      pickedRepPoint: childRepPoint2,
                      pickedPartIndex: 1,
                    });
                  }
                }
                else if (parAnn.type === AnnotationType.CLOUD) {
                  pickedAnnotations.push({
                    pickedAnnRef: annotationRef,
                    pickedRepPoint: repPoint,
                    pickedPartIndex: pickedOffset, 
                  });
                }
              }
            }
            /* BRAINSHARE ENDS */
            const totDeltaVec = vec2.set(vec2.create(), 0, 0);
            if (mouseState.updateUnconditionally()) {
              startRelativeMouseDrag(
                e.detail,
                (_event, deltaX, deltaY) => {
                  vec2.add(totDeltaVec, totDeltaVec, [deltaX, deltaY]);
                  const layerPoint = new Float32Array(layerRank);
                  matrix.transformPoint(
                    layerPoint,
                    chunkTransform.chunkToLayerTransform,
                    layerRank + 1,
                    repPoint,
                    layerRank,
                  );
                  const renderPt = tempVec3;
                  const { displayDimensionIndices } =
                    this.navigationState.pose.displayDimensions.value;
                  layerToDisplayCoordinates(
                    renderPt,
                    layerPoint,
                    chunkTransform.modelTransform,
                    displayDimensionIndices,
                  );
                  this.translateDataPointByViewportPixels(
                    renderPt,
                    renderPt,
                    totDeltaVec[0],
                    totDeltaVec[1],
                  );
                  displayToLayerCoordinates(
                    layerPoint,
                    renderPt,
                    chunkTransform.modelTransform,
                    displayDimensionIndices,
                  );
                  const newPoint = new Float32Array(layerRank);
                  matrix.transformPoint(
                    newPoint,
                    chunkTransform.layerToChunkTransform,
                    layerRank + 1,
                    layerPoint,
                    layerRank,
                  );
                  /* BRAINSHARE STARTS */
                  /*
                  const newAnnotation = handler.updateViaRepresentativePoint(
                    ann,
                    newPoint,
                    pickedOffset,
                  );
                  annotationLayer.source.update(annotationRef, newAnnotation);
                  */
                  const diff = new Float32Array(layerRank);
                  vector.subtract(diff, newPoint, repPoint);
                  for (let i = 0; i < pickedAnnotations.length; i++) {
                    const { 
                      pickedAnnRef, 
                      pickedRepPoint,
                      pickedPartIndex,
                    } = pickedAnnotations[i];
                    const childAnn = pickedAnnRef.value!;

                    const childNewPoint = new Float32Array(layerRank);
                    vector.add(childNewPoint, pickedRepPoint, diff);
                    const newAnnotation = handler.updateViaRepresentativePoint(
                      childAnn,
                      childNewPoint,
                      pickedPartIndex,
                    );
                    annotationLayer.source.update(pickedAnnRef, newAnnotation);
                  }
                  /* BRAINSHARE ENDS */
                },
                (_event) => {
                  annotationLayer.source.commit(annotationRef);
                  annotationRef.dispose();
                },
              );
            }
          }
        }
      },
    );

    registerActionListener(element, "delete-annotation", () => {
      const { mouseState } = this.viewer;
      const selectedAnnotationId = mouseState.pickedAnnotationId;
      const annotationLayer = mouseState.pickedAnnotationLayer;
      if (
        annotationLayer !== undefined &&
        !annotationLayer.source.readonly &&
        selectedAnnotationId !== undefined
      ) {
        const ref = annotationLayer.source.getReference(selectedAnnotationId);
        try {
          annotationLayer.source.delete(ref);
        } finally {
          ref.dispose();
        }
      }
    });

    registerActionListener(
      element,
      "zoom-via-touchpinch",
      (e: ActionEvent<TouchPinchInfo>) => {
        this.context.flagContinuousCameraMotion();
        const { detail } = e;
        this.handleMouseMove(detail.centerX, detail.centerY);
        const ratio = detail.prevDistance / detail.distance;
        if (ratio > 0.1 && ratio < 10) {
          this.zoomByMouse(ratio);
        }
      },
    );

    /* BRAINSHARE STARTS */
    registerActionListener(
      element,
      "move-parent-annotation",
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        if (annotationLayer !== undefined) {
          if (selectedAnnotationId !== undefined) {
            e.stopPropagation();
            const annotationRef =
              annotationLayer.source.getReference(selectedAnnotationId)!;
            const ann = <Annotation>annotationRef.value;

            const handler = getAnnotationTypeRenderHandler(ann.type);
            const {
              chunkTransform: { value: chunkTransform },
            } = annotationLayer;
            if (chunkTransform.error !== undefined) return;
            const { layerRank } = chunkTransform;
            const repPoint = new Float32Array(layerRank);
            handler.getRepresentativePoint(
              repPoint,
              ann,
              mouseState.pickedOffset,
            );

            const pickedAnnotations: { 
              pickedAnnRef: AnnotationReference,
              pickedRepPoint: Float32Array,
            }[] = [];
            if (ann.parentAnnotationId === undefined) {
              return;
            }
            else {
              const parAnn = annotationLayer.source.getReference(
                ann.parentAnnotationId
              ).value;
              if (!parAnn) return;

              const childAnnotationIds = parAnn.childAnnotationIds!;
              for (let i = 0; i < childAnnotationIds.length; i++) {
                const childAnnRef = annotationLayer.source.getReference(
                  childAnnotationIds[i],
                );
                const childAnn = childAnnRef.value!;

                const childRepPoint = new Float32Array(layerRank)
                handler.getRepresentativePoint(
                  childRepPoint, 
                  childAnn,
                  0,
                );
                pickedAnnotations.push({
                  pickedAnnRef: childAnnRef,
                  pickedRepPoint: childRepPoint,
                });
              }
            }
            const totDeltaVec = vec2.set(vec2.create(), 0, 0);
            if (mouseState.updateUnconditionally()) {
              startRelativeMouseDrag(
                e.detail,
                (_event, deltaX, deltaY) => {
                  vec2.add(totDeltaVec, totDeltaVec, [deltaX, deltaY]);
                  const layerPoint = new Float32Array(layerRank);
                  matrix.transformPoint(
                    layerPoint,
                    chunkTransform.chunkToLayerTransform,
                    layerRank + 1,
                    repPoint,
                    layerRank,
                  );
                  const renderPt = tempVec3;
                  const { displayDimensionIndices } =
                    this.navigationState.pose.displayDimensions.value;
                  layerToDisplayCoordinates(
                    renderPt,
                    layerPoint,
                    chunkTransform.modelTransform,
                    displayDimensionIndices,
                  );
                  this.translateDataPointByViewportPixels(
                    renderPt,
                    renderPt,
                    totDeltaVec[0],
                    totDeltaVec[1],
                  );
                  displayToLayerCoordinates(
                    layerPoint,
                    renderPt,
                    chunkTransform.modelTransform,
                    displayDimensionIndices,
                  );
                  const newPoint = new Float32Array(layerRank);
                  matrix.transformPoint(
                    newPoint,
                    chunkTransform.layerToChunkTransform,
                    layerRank + 1,
                    layerPoint,
                    layerRank,
                  );
                  const diff = new Float32Array(layerRank);
                  vector.subtract(diff, newPoint, repPoint);
                  for (let i = 0; i < pickedAnnotations.length; i++) {
                    const { 
                      pickedAnnRef, 
                      pickedRepPoint,
                    } = pickedAnnotations[i];
                    const childAnn = pickedAnnRef.value!;

                    const childNewPoint = new Float32Array(layerRank);
                    vector.add(childNewPoint, pickedRepPoint, diff);
                    const newAnnotation = handler.updateViaRepresentativePoint(
                      childAnn,
                      childNewPoint,
                      0
                    );
                    annotationLayer.source.update(pickedAnnRef, newAnnotation);
                  }
                },
                (_event) => {
                  annotationLayer.source.commit(annotationRef);
                  annotationRef.dispose();
                },
              );
            }
          }
        }
      },
    );

    registerActionListener(
      element,
      "complete-annotation",
      (e: ActionEvent<MouseEvent>) => {
        const selectedLayer = this.viewer.selectedLayer.layer;
        if (selectedLayer === undefined) {
          StatusMessage.showTemporaryMessage(
            'The annotate command requires a layer to be selected.'
          );
          return;
        }
        const userLayer = selectedLayer.layer;
        if (userLayer === null || userLayer.tool.value === undefined) {
          StatusMessage.showTemporaryMessage(
            `The selected layer (${ 
              JSON.stringify(selectedLayer.name)
            }) does not have an active annotation tool.`);
          return;
        }
        if(!(userLayer.tool.value instanceof PlaceCollectionAnnotationTool)) {
          StatusMessage.showTemporaryMessage(
            `The selected layer (${
              JSON.stringify(selectedLayer.name)
            }) does not have annotation tool with complete step.`);
          return;
        }

        e.stopPropagation();
        const collectionAnnotationTool = userLayer.tool.value;
        collectionAnnotationTool.complete();
      },
    );

    registerActionListener(
      element,
      "undo-annotation",
      (e: ActionEvent<MouseEvent>) => {
        const selectedLayer = this.viewer.selectedLayer.layer;
        if (selectedLayer === undefined) {
          StatusMessage.showTemporaryMessage(
            'The annotate command requires a layer to be selected.'
          );
          return;
        }
        const userLayer = selectedLayer.layer;
        if (userLayer === null || userLayer.tool.value === undefined) {
          StatusMessage.showTemporaryMessage(`The selected layer (${
            JSON.stringify(selectedLayer.name)
          }) does not have an active annotation tool.`);
          return;
        }
        if(!(userLayer.tool.value instanceof PlaceCollectionAnnotationTool)) {
          StatusMessage.showTemporaryMessage(
            `The selected layer (${
              JSON.stringify(selectedLayer.name)
            }) does not have annotation tool with complete step.`);
          return;
        }

        e.stopPropagation();
        const collectionAnnotationTool = userLayer.tool.value;
        collectionAnnotationTool.undo(this.viewer.mouseState); 
      }
    );
    
    registerActionListener(
      element,
      "add-vertex-polygon",
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        if (annotationLayer !== undefined) {
          if (selectedAnnotationId !== undefined) {
            e.stopPropagation();
            const annotationRef =
              annotationLayer.source.getReference(selectedAnnotationId)!;
            const ann = <Annotation>annotationRef.value;
            const pickedOffset = mouseState.pickedOffset;

            if (
              ann.type === AnnotationType.LINE &&
              ann.parentAnnotationId !== undefined
            ) {
              const parentAnnRef = annotationLayer.source.getReference(
                ann.parentAnnotationId
              );
              const parentAnn = parentAnnRef.value;
              if (!parentAnn || parentAnn.type !== AnnotationType.POLYGON) {
                return;
              }
              const childAnnotationIds = parentAnn.childAnnotationIds!;
              if (isCornerPicked(pickedOffset)) return;

              const pickedLineIndex = childAnnotationIds.indexOf(ann.id);
              const pickedLineRef = annotationLayer.source.getReference(
                childAnnotationIds[pickedLineIndex],
              );
              const pickedLine = <Line>pickedLineRef.value;
              if (!pickedLine) return;

              const chunkTransform = annotationLayer.chunkTransform.value;
              if (chunkTransform.error !== undefined) return undefined;
              const newPoint = new Float32Array(
                chunkTransform.modelTransform.unpaddedRank,
              );
              if (
                !getChunkPositionFromCombinedGlobalLocalPositions(
                  newPoint,
                  mouseState.unsnappedPosition,
                  annotationLayer.localPosition.value,
                  chunkTransform.layerRank,
                  chunkTransform.combinedGlobalLocalToChunkTransform,
                )
              ) {
                return;
              }
              if (!isPointUniqueInPolygon(
                annotationLayer, 
                parentAnn, 
                newPoint
              )) {
                StatusMessage.showTemporaryMessage(
                  "All vertices of polygon must be unique."
                )
                return;
              }
              
              const newLine1 = <Line>{
                id: '',
                type: AnnotationType.LINE,
                description: parentAnn.description,
                pointA: pickedLine.pointA,
                pointB: newPoint,
                properties: Object.assign([], parentAnn.properties),
              };
              const newLine2 = <Line>{
                id: '',
                type: AnnotationType.LINE,
                description: parentAnn.description,
                pointA: newPoint,
                pointB: pickedLine.pointB,
                properties: Object.assign([], parentAnn.properties),
              };
              annotationLayer.source.add(
                newLine1, 
                true,
                parentAnnRef,
                pickedLineIndex,
              );
              annotationLayer.source.add(
                newLine2, 
                true,
                parentAnnRef,
                pickedLineIndex + 1,
              );
              annotationLayer.source.delete(pickedLineRef);
            }
          }
        }
      },
    );

    registerActionListener(
      element,
      "delete-vertex-polygon",
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        if (annotationLayer !== undefined) {
          if (selectedAnnotationId !== undefined) {
            e.stopPropagation();
            const annotationRef =
              annotationLayer.source.getReference(selectedAnnotationId)!;
            const ann = <Annotation>annotationRef.value;
            const pickedOffset = mouseState.pickedOffset;

            if (
              ann.type === AnnotationType.LINE &&
              ann.parentAnnotationId !== undefined
            ) {
              const parentAnnRef = annotationLayer.source.getReference(
                ann.parentAnnotationId
              );
              const parentAnn = parentAnnRef.value;
              if (!parentAnn) return;

              const childAnnotationIds = parentAnn.childAnnotationIds!;
              if (childAnnotationIds.length <= 3) {
                StatusMessage.showTemporaryMessage(
                  "There must be at least 3 lines in a polygon"
                );
                return;
              }
              if (!isCornerPicked(pickedOffset)) return;

              const pickedLineIndex = childAnnotationIds.indexOf(ann.id);
              const length = childAnnotationIds.length;

              let lineIndex1 = -1;
              let lineIndex2 = -1;
              if (pickedOffset == 1) {
                lineIndex1 = pickedLineIndex - 1;
                lineIndex2 = pickedLineIndex;
                if (pickedLineIndex === 0) lineIndex1 = length - 1;
              }
              else if (pickedOffset == 2) {
                lineIndex1 = pickedLineIndex;
                lineIndex2 = pickedLineIndex + 1;
                if (pickedLineIndex === length - 1) lineIndex2 = 0;
              }

              const lineRef1 = annotationLayer.source.getReference(
                childAnnotationIds[lineIndex1],
              );
              const lineRef2 = annotationLayer.source.getReference(
                childAnnotationIds[lineIndex2],
              );
              
              const newPointA = (<Line>lineRef1.value!).pointA;
              const newPointB = (<Line>lineRef2.value!).pointB;
              const newLine = <Line>{
                id: '',
                type: AnnotationType.LINE,
                description: parentAnn.description,
                pointA: newPointA,
                pointB: newPointB,
                properties: Object.assign([], parentAnn.properties),
              };

              annotationLayer.source.add(
                newLine, 
                true,
                parentAnnRef,
                lineIndex1,
              );
              annotationLayer.source.delete(lineRef1);
              annotationLayer.source.delete(lineRef2);
            }
          }
        }
      },
    );

    for (const sign of [-1, +1]) {
      let signStr = (sign < 0) ? '-' : '+';
      registerActionListener(element, `rotate-polygon-z${signStr}`, () => {
        const selectionState = this.viewer.selectionDetailsState.value;
        if (!this.viewer.selectionDetailsState.pin.value) return;
        if (selectionState === undefined) return;

        let selectedAnnotationId = undefined;
        let selectedAnnotationLayer = undefined;
        for (let layer of selectionState.layers) {
          if (layer.state.annotationId === undefined) continue;
          const userLayerWithAnnotations = <UserLayerWithAnnotations>layer.layer;
          const annotationLayer = userLayerWithAnnotations
            .annotationStates.states.find(
              x => x.sourceIndex === layer.state.annotationSourceIndex && (
                layer.state.annotationSubsource === undefined || 
                x.subsourceId === layer.state.annotationSubsource
            ));
          if (annotationLayer === undefined) continue;

          selectedAnnotationId = layer.state.annotationId;
          selectedAnnotationLayer = annotationLayer;
          break;
        }
        if (
          selectedAnnotationId === undefined || 
          selectedAnnotationLayer === undefined
        ) return;

        let reference = selectedAnnotationLayer.source.getReference(
          selectedAnnotationId
        );
        if (!reference.value) return;
        if (
          reference.value.type != AnnotationType.POLYGON &&
          reference.value.type != AnnotationType.VOLUME
        ) {
          StatusMessage.showTemporaryMessage(
            "You must select a polygon or a volume"
          );
          return;
        }

        if (reference.value.type === AnnotationType.VOLUME) {
          const selectedLayer = this.viewer.selectedLayer.layer;
          if (!selectedLayer) return;
          const position = selectedLayer.manager.root.globalPosition.value;
          const zIndex = getZCoordinate(position);
          if (zIndex === undefined) return;

          const polygon = getPolygonByZIndex(
            selectedAnnotationLayer.source, 
            reference.value.id, 
            zIndex,
          );
          if (!polygon) return;
          reference = selectedAnnotationLayer.source.getReference(polygon.id);
        }

        const angle = sign * Math.PI * polygonRotateAngle.value / 180.0;
        rotatePolygon(
          this.navigationState, 
          selectedAnnotationLayer, 
          reference, 
          angle
        );
      });
    }

    for (const sign of [-1, +1]) {
      let signStr = (sign < 0) ? 'shrink' : 'enlarge';
      registerActionListener(element, `scale-polygon-${signStr}`, () => {
        const selectionState = this.viewer.selectionDetailsState.value;
        if (!this.viewer.selectionDetailsState.pin.value) return;
        if (selectionState === undefined) return;

        let selectedAnnotationId = undefined;
        let selectedAnnotationLayer = undefined;
        for (let layer of selectionState.layers) {
          if (layer.state.annotationId === undefined) continue;
          const userLayerWithAnnotations = <UserLayerWithAnnotations>layer.layer;
          const annotationLayer = userLayerWithAnnotations
            .annotationStates.states.find(
              x => x.sourceIndex === layer.state.annotationSourceIndex && (
                layer.state.annotationSubsource === undefined || 
                x.subsourceId === layer.state.annotationSubsource
            ));
          if (annotationLayer === undefined) continue;

          selectedAnnotationId = layer.state.annotationId;
          selectedAnnotationLayer = annotationLayer;
          break;
        }
        if (
          selectedAnnotationId === undefined || 
          selectedAnnotationLayer === undefined
        ) return;

        let reference = selectedAnnotationLayer.source.getReference(
          selectedAnnotationId
        );
        if (!reference.value) return;
        if (
          reference.value.type != AnnotationType.POLYGON &&
          reference.value.type != AnnotationType.VOLUME
        ) {
          StatusMessage.showTemporaryMessage(
            "You must select a polygon or a volume"
          );
          return;
        }

        if (reference.value.type === AnnotationType.VOLUME) {
          const selectedLayer = this.viewer.selectedLayer.layer;
          if (!selectedLayer) return;
          const position = selectedLayer.manager.root.globalPosition.value;
          const zIndex = getZCoordinate(position);
          if (zIndex === undefined) return;

          const polygon = getPolygonByZIndex(
            selectedAnnotationLayer.source, 
            reference.value.id, 
            zIndex,
          );
          if (!polygon) return;
          reference = selectedAnnotationLayer.source.getReference(polygon.id);
        }

        const percentage = polygonScalePercentage.value / 100.0;
        const scale = (sign < 0) ? 1 - percentage : 1 + percentage;
        scalePolygon(
          selectedAnnotationLayer, 
          reference, 
          scale
        );
      });
    }

    registerActionListener(
      element, 
      'rotate-polygon-via-touchrotate',
      (e: ActionEvent<TouchRotateInfo>) => {
        const { detail } = e;
        const { mouseState } = this.viewer;
        this.handleMouseMove(detail.centerX, detail.centerY);
        if (mouseState.updateUnconditionally()) {
          const selectionState = this.viewer.selectionDetailsState.value;
          const selectedLayer = this.viewer.selectedLayer.layer;
          if (!this.viewer.selectionDetailsState.pin.value) return;
          if (selectionState === undefined) return;
          let selectedAnnotationId = undefined;
          let selectedAnnotationLayer = undefined;

          for (let layer of selectionState.layers) {
            if (layer.state.annotationId === undefined) continue;
            const userLayerWithAnnotations = <UserLayerWithAnnotations>layer.layer;
            const annotationLayer = userLayerWithAnnotations
              .annotationStates.states.find( 
                x => x.sourceIndex === layer.state.annotationSourceIndex && (
                  layer.state.annotationSubsource === undefined ||
                  x.subsourceId === layer.state.annotationSubsource
                ));
            if (annotationLayer === undefined) continue;

            selectedAnnotationId = layer.state.annotationId;
            selectedAnnotationLayer = annotationLayer;
            break;
          }
          if (
            selectedAnnotationId === undefined || 
            selectedAnnotationLayer === undefined
          ) return;
          if (selectedLayer === undefined) {
            StatusMessage.showTemporaryMessage(
              'The annotate command requires a layer to be selected.'
            );
            return;
          }
          const userLayer = selectedLayer.layer;
          if (userLayer === null || userLayer.tool.value === undefined) {
            StatusMessage.showTemporaryMessage(`The selected layer (${
              JSON.stringify(selectedLayer.name)
            }) does not have an active annotation tool.`);
            return;
          }

          const reference = selectedAnnotationLayer
            .source.getNonDummyAnnotationReference(selectedAnnotationId);
          if (
            !reference.value || 
            reference.value!.type != AnnotationType.POLYGON
          ) return;

          rotatePolygon(
            this.navigationState, 
            selectedAnnotationLayer, 
            reference, 
            -(detail.angle - detail.prevAngle)
          );
        }
      });

    registerActionListener(
      element,
      'zoom-polygon-via-touchpinch',
      (e: ActionEvent<TouchPinchInfo>) => {
        const { detail } = e;
        this.handleMouseMove(detail.centerX, detail.centerY);
        const selectionState = this.viewer.selectionDetailsState.value;
        const selectedLayer = this.viewer.selectedLayer.layer;
        if (!this.viewer.selectionDetailsState.pin.value) return;
        const scale = detail.prevDistance / detail.distance;
        if (scale <= 0.1 || scale >= 10) return;
        if (selectionState === undefined) return;
        let selectedAnnotationId = undefined;
        let selectedAnnotationLayer = undefined;

        for (let layer of selectionState.layers) {
          if (layer.state.annotationId === undefined) continue;
          const userLayerWithAnnotations = <UserLayerWithAnnotations>layer.layer;
          const annotationLayer = userLayerWithAnnotations
            .annotationStates.states.find( 
              x => x.sourceIndex === layer.state.annotationSourceIndex && (
                layer.state.annotationSubsource === undefined || 
                x.subsourceId === layer.state.annotationSubsource
              ));
          if (annotationLayer === undefined) continue;

          selectedAnnotationId = layer.state.annotationId;
          selectedAnnotationLayer = annotationLayer;
          break;
        }
        if (
          selectedAnnotationId === undefined || 
          selectedAnnotationLayer === undefined
        ) return;
        if (selectedLayer === undefined) {
          StatusMessage.showTemporaryMessage(
            'The annotate command requires a layer to be selected.'
          );
          return;
        }
        const userLayer = selectedLayer.layer;
        if (userLayer === null || userLayer.tool.value === undefined) {
          StatusMessage.showTemporaryMessage(`The selected layer (${
            JSON.stringify(selectedLayer.name)
          }) does not have an active annotation tool.`);
          return;
        }

        const reference = selectedAnnotationLayer
          .source.getNonDummyAnnotationReference(selectedAnnotationId);
        if (
          !reference.value || 
          reference.value!.type != AnnotationType.POLYGON
        ) return;

        scalePolygon(
          selectedAnnotationLayer, 
          reference, 
          scale
        );
      });
    /* BRAINSHARE ENDS */
  }

  abstract translateDataPointByViewportPixels(
    out: vec3,
    orig: vec3,
    deltaX: number,
    deltaY: number,
  ): vec3;

  onMouseout() {
    this.updateMousePosition(-1, -1);
    this.viewer.mouseState.setForcer(undefined);
  }

  abstract translateByViewportPixels(deltaX: number, deltaY: number): void;

  handleMouseMove(clientX: number, clientY: number) {
    const { element } = this;
    const bounds = element.getBoundingClientRect();
    const mouseX = clientX - (bounds.left + element.clientLeft);
    const mouseY = clientY - (bounds.top + element.clientTop);
    const { mouseState } = this.viewer;
    mouseState.pageX = clientX + window.scrollX;
    mouseState.pageY = clientY + window.scrollY;
    mouseState.setForcer(this.mouseStateForcer);
    this.updateMousePosition(mouseX, mouseY);
  }

  onMousemove(event: MouseEvent, atOnly = true) {
    const { element } = this;
    if (atOnly && event.target !== element) {
      return;
    }
    this.handleMouseMove(event.clientX, event.clientY);
  }

  onTouchstart(event: TouchEvent) {
    const { element } = this;
    if (event.target !== element || event.targetTouches.length !== 1) {
      return;
    }
    const { clientX, clientY } = event.targetTouches[0];
    this.handleMouseMove(clientX, clientY);
  }

  disposed() {
    const { mouseState } = this.viewer;
    mouseState.removeForcer(this.mouseStateForcer);
    const { gl } = this;
    this.cancelPickRequests();
    const { pendingPickRequestTimerId } = this;
    if (pendingPickRequestTimerId !== -1) {
      window.clearTimeout(pendingPickRequestTimerId);
    }
    for (const request of this.pickRequests) {
      gl.deleteBuffer(request.buffer);
    }
    super.disposed();
  }

  abstract zoomByMouse(factor: number): void;
}
