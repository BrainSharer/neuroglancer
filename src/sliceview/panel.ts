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

import { AxesLineHelper, computeAxisLineMatrix } from "#/axes_lines";
import { DisplayContext } from "#/display_context";
import {
  makeRenderedPanelVisibleLayerTracker,
  VisibleRenderLayerTracker,
} from "#/layer";
import { PickIDManager } from "#/object_picking";
import {
  clearOutOfBoundsPickData,
  FramePickingData,
  pickDiameter,
  pickOffsetSequence,
  pickRadius,
  RenderedDataPanel,
  RenderedDataViewerState,
} from "#/rendered_data_panel";
import { SliceView, SliceViewRenderHelper } from "#/sliceview/frontend";
import {
  SliceViewPanelReadyRenderContext,
  SliceViewPanelRenderContext,
  SliceViewPanelRenderLayer,
} from "#/sliceview/renderlayer";
import { TrackableBoolean } from "#/trackable_boolean";
import { TrackableRGB } from "#/util/color";
import { Borrowed, Owned } from "#/util/disposable";
import { ActionEvent, registerActionListener } from "#/util/event_action_map";
import {
  disableZProjection,
  identityMat4,
  kAxes,
  mat4,
  /* BRAINSHARE STARTS */
  vec2,
  /* BRAINSHARE ENDS */
  vec3,
  vec4,
} from "#/util/geom";
import { startRelativeMouseDrag } from "#/util/mouse_drag";
import { TouchRotateInfo } from "#/util/touch_bindings";
import {
  FramebufferConfiguration,
  OffscreenCopyHelper,
  TextureBuffer,
} from "#/webgl/offscreen";
import { ShaderBuilder } from "#/webgl/shader";
import {
  MultipleScaleBarTextures,
  TrackableScaleBarOptions,
} from "#/widget/scale_bar";
/* BRAINSHARE STARTS */
import { 
  Annotation, 
  AnnotationReference, 
  AnnotationType, 
  Line, 
  Polygon 
} from '#/annotation';
import { getPointPartIndex, isCornerPicked } from '#/annotation/line';
import { getAnnotationTypeRenderHandler } from '#/annotation/type_handler';
import { 
  displayToLayerCoordinates, 
  layerToDisplayCoordinates 
} from '#/render_coordinate_transform';
import * as matrix from '#/util/matrix';
import { StatusMessage } from '../status';
import { checkIfSameZCoordinate, copyZCoordinate } from '../annotation/polygon';
/* BRAINSHARE ENDS */

export interface SliceViewerState extends RenderedDataViewerState {
  showScaleBar: TrackableBoolean;
  wireFrame: TrackableBoolean;
  scaleBarOptions: TrackableScaleBarOptions;
  crossSectionBackgroundColor: TrackableRGB;
}

export enum OffscreenTextures {
  COLOR = 0,
  PICK = 1,
  NUM_TEXTURES = 2,
}

function sliceViewPanelEmitColorAndPickID(builder: ShaderBuilder) {
  builder.addOutputBuffer("vec4", "out_fragColor", 0);
  builder.addOutputBuffer("highp vec4", "out_pickId", 1);
  builder.addFragmentCode(`
void emit(vec4 color, highp uint pickId) {
  out_fragColor = color;
  float pickIdFloat = float(pickId);
  out_pickId = vec4(pickIdFloat, pickIdFloat, pickIdFloat, 1.0);
}
`);
}

function sliceViewPanelEmitColor(builder: ShaderBuilder) {
  builder.addOutputBuffer("vec4", "out_fragColor", null);
  builder.addFragmentCode(`
void emit(vec4 color, highp uint pickId) {
  out_fragColor = color;
}
`);
}

const tempVec3 = vec3.create();
const tempVec3b = vec3.create();
const tempVec4 = vec4.create();

export class SliceViewPanel extends RenderedDataPanel {
  viewer: SliceViewerState;

  private axesLineHelper = this.registerDisposer(AxesLineHelper.get(this.gl));
  private sliceViewRenderHelper = this.registerDisposer(
    SliceViewRenderHelper.get(this.gl, sliceViewPanelEmitColor),
  );
  private colorFactor = vec4.fromValues(1, 1, 1, 1);
  private pickIDs = new PickIDManager();

  flushBackendProjectionParameters() {
    this.sliceView.flushBackendProjectionParameters();
  }

  private visibleLayerTracker: VisibleRenderLayerTracker<
    SliceViewPanel,
    SliceViewPanelRenderLayer
  >;

  get displayDimensionRenderInfo() {
    return this.navigationState.displayDimensionRenderInfo;
  }

  // FIXME: use separate backend object for the panel
  get rpc() {
    return this.sliceView.rpc!;
  }
  get rpcId() {
    return this.sliceView.rpcId!;
  }

  private offscreenFramebuffer = this.registerDisposer(
    new FramebufferConfiguration(this.gl, {
      colorBuffers: [
        new TextureBuffer(
          this.gl,
          WebGL2RenderingContext.RGBA8,
          WebGL2RenderingContext.RGBA,
          WebGL2RenderingContext.UNSIGNED_BYTE,
        ),
        new TextureBuffer(
          this.gl,
          WebGL2RenderingContext.R32F,
          WebGL2RenderingContext.RED,
          WebGL2RenderingContext.FLOAT,
        ),
      ],
    }),
  );

  private offscreenCopyHelper = this.registerDisposer(
    OffscreenCopyHelper.get(this.gl),
  );
  private scaleBars = this.registerDisposer(
    new MultipleScaleBarTextures(this.gl),
  );

  get navigationState() {
    return this.sliceView.navigationState;
  }

  constructor(
    context: Borrowed<DisplayContext>,
    element: HTMLElement,
    public sliceView: Owned<SliceView>,
    viewer: SliceViewerState,
  ) {
    super(context, element, viewer);
    viewer.wireFrame.changed.add(() => this.scheduleRedraw());
    registerActionListener(
      element,
      "rotate-via-mouse-drag",
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        if (mouseState.updateUnconditionally()) {
          const initialPosition = Float32Array.from(mouseState.position);
          startRelativeMouseDrag(e.detail, (_event, deltaX, deltaY) => {
            const { pose } = this.navigationState;
            const xAxis = vec3.transformQuat(
              tempVec3,
              kAxes[0],
              pose.orientation.orientation,
            );
            const yAxis = vec3.transformQuat(
              tempVec3b,
              kAxes[1],
              pose.orientation.orientation,
            );
            this.viewer.navigationState.pose.rotateAbsolute(
              yAxis,
              ((-deltaX / 4.0) * Math.PI) / 180.0,
              initialPosition,
            );
            this.viewer.navigationState.pose.rotateAbsolute(
              xAxis,
              ((-deltaY / 4.0) * Math.PI) / 180.0,
              initialPosition,
            );
          });
        }
      },
    );

    registerActionListener(
      element,
      "rotate-in-plane-via-touchrotate",
      (e: ActionEvent<TouchRotateInfo>) => {
        const { detail } = e;
        const { mouseState } = this.viewer;
        this.handleMouseMove(detail.centerX, detail.centerY);
        if (mouseState.updateUnconditionally()) {
          this.navigationState.pose.rotateAbsolute(
            this.sliceView.projectionParameters.value
              .viewportNormalInCanonicalCoordinates,
            detail.angle - detail.prevAngle,
            mouseState.position,
          );
        }
      },
    );

    /* BRAINSHARE STARTS */
    registerActionListener(
      element, 
      'move-polygon-annotation', 
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        const selectedLayer = this.viewer.selectedLayer.layer;

        if (selectedAnnotationId === undefined 
          || annotationLayer === undefined) return;
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
        // if (userLayer.tool.value instanceof PlaceVolumeTool) {
        //   const volumeTool = <PlaceVolumeTool>userLayer.tool.value;
        //   if (!volumeTool.validateSession(selectedAnnotationId, annotationLayer)) 
        //     return;
        // }

        let selectedAnnotationRef = annotationLayer.source.getReference(
          selectedAnnotationId
        )!;
        let selectedAnn = <Annotation>selectedAnnotationRef.value;
        if (selectedAnn.parentAnnotationId === undefined) return;
        let parAnnotationRef = annotationLayer.source.getReference(
          selectedAnn.parentAnnotationId
        )!;
        let parAnn = <Annotation>parAnnotationRef.value;
        if (parAnn.type !== AnnotationType.POLYGON) return;
        const { chunkTransform: { value: chunkTransform } } = annotationLayer;
        if (chunkTransform.error !== undefined) return;

        const handler = getAnnotationTypeRenderHandler(parAnn.type);
        const pickedOffset = mouseState.pickedOffset;
        const { layerRank } = chunkTransform;
        const repPoint = new Float32Array(layerRank);
        handler.getRepresentativePoint(
          repPoint, 
          parAnn, 
          mouseState.pickedOffset
        );
        const childAnnotationRefs: AnnotationReference[] = [];
        parAnn.childAnnotationIds.forEach((childAnnotationId) => {
          childAnnotationRefs.push(
            annotationLayer.source.getReference(childAnnotationId)
          );
        });

        let totDeltaVec = vec2.set(vec2.create(), 0, 0);
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
                layerRank);
              const renderPt = tempVec3;
              const { displayDimensionIndices } =
                this.navigationState.pose.displayDimensions.value;
              layerToDisplayCoordinates(
                renderPt, 
                layerPoint, 
                chunkTransform.modelTransform, 
                displayDimensionIndices
              );
              this.translateDataPointByViewportPixels(
                renderPt, 
                renderPt, 
                totDeltaVec[0], 
                totDeltaVec[1]
              );
              displayToLayerCoordinates(
                layerPoint, 
                renderPt, 
                chunkTransform.modelTransform, 
                displayDimensionIndices
              );
              const newPoint = new Float32Array(layerRank);
              matrix.transformPoint(
                newPoint, 
                chunkTransform.layerToChunkTransform, 
                layerRank + 1, 
                layerPoint,
                layerRank
              );
              const oldPoint = new Float32Array(
                (<Polygon>parAnnotationRef.value!).source.length
              );
              for (let i = 0; i < oldPoint.length; ++i) {
                oldPoint[i] = (<Polygon>parAnnotationRef.value!).source[i];
              }
              let newAnnotation =
                handler.updateViaRepresentativePoint(
                  parAnn, 
                  newPoint, 
                  pickedOffset
                );
              annotationLayer.source.update(parAnnotationRef, newAnnotation);
              childAnnotationRefs.forEach((childAnnotationRef) => {
                const childAnn = <Line>childAnnotationRef.value;
                const newPointA = new Float32Array(oldPoint.length);
                const newPointB = new Float32Array(oldPoint.length);
                for (let i = 0; i < oldPoint.length; ++i) {
                  newPointA[i] = newPoint[i] - oldPoint[i] + childAnn.pointA[i];
                  newPointB[i] = newPoint[i] - oldPoint[i] + childAnn.pointB[i];
                }
                const newChildAnnotation = { 
                  ...childAnn, 
                  pointA: newPointA, 
                  pointB: newPointB 
                };
                annotationLayer.source.update(
                  childAnnotationRef, 
                  newChildAnnotation
                );
              });
            },
            (_event) => {
              childAnnotationRefs.forEach((
                childAnnotationRef) => annotationLayer.source.commit(
                  childAnnotationRef
                )
              );
              annotationLayer.source.commit(parAnnotationRef);
              childAnnotationRefs.forEach(
                (childAnnotationRef) => childAnnotationRef.dispose()
              );
              parAnnotationRef.dispose();
            });
        }
      });

    // registerActionListener(element, 'move-point-annotation', (e: ActionEvent<MouseEvent>) => {
    //   const { mouseState } = this.viewer;
    //   const selectedLayer = this.viewer.selectedLayer.layer;
    //   const selectedAnnotationId = mouseState.pickedAnnotationId;
    //   const annotationLayer = mouseState.pickedAnnotationLayer;
    //   if (selectedLayer === undefined) {
    //     StatusMessage.showTemporaryMessage('The annotate command requires a layer to be selected.');
    //     return;
    //   }
    //   const userLayer = selectedLayer.layer;
    //   if (userLayer === null || userLayer.tool.value === undefined) {
    //     StatusMessage.showTemporaryMessage(`The selected layer (${JSON.stringify(selectedLayer.name)}) does not have an active annotation tool.`);
    //     return;
    //   }
    //   if (userLayer.tool.value instanceof PlaceCellTool) {
    //     const cellTool = <PlaceCellTool>userLayer.tool.value;
    //     if (!cellTool.validateSession(selectedAnnotationId, annotationLayer)) return;
    //   } else if (userLayer.tool.value instanceof PlaceComTool) {
    //     const comTool = <PlaceComTool>userLayer.tool.value;
    //     if (!comTool.validateSession(selectedAnnotationId, annotationLayer)) return;
    //   } else {
    //     return;
    //   }
    //   if (annotationLayer !== undefined) {
    //     if (selectedAnnotationId !== undefined) {
    //       e.stopPropagation();
    //       let annotationRef = annotationLayer.source.getReference(selectedAnnotationId)!;
    //       let ann = <Annotation>annotationRef.value;
    //       if (ann.parentAnnotationId) {
    //         annotationRef.dispose();
    //         return;
    //       }
    //       const handler = getAnnotationTypeRenderHandler(ann.type);
    //       const pickedOffset = mouseState.pickedOffset;
    //       const { chunkTransform: { value: chunkTransform } } = annotationLayer;
    //       if (chunkTransform.error !== undefined) return;
    //       const { layerRank } = chunkTransform;
    //       const repPoint = new Float32Array(layerRank);
    //       handler.getRepresentativePoint(repPoint, ann, mouseState.pickedOffset);
    //       let totDeltaVec = vec2.set(vec2.create(), 0, 0);
    //       if (mouseState.updateUnconditionally()) {
    //         startRelativeMouseDrag(
    //           e.detail,
    //           (_event, deltaX, deltaY) => {
    //             vec2.add(totDeltaVec, totDeltaVec, [deltaX, deltaY]);
    //             const layerPoint = new Float32Array(layerRank);
    //             matrix.transformPoint(
    //               layerPoint, chunkTransform.chunkToLayerTransform, layerRank + 1, repPoint,
    //               layerRank);
    //             const renderPt = tempVec3;
    //             const { displayDimensionIndices } =
    //               this.navigationState.pose.displayDimensions.value;
    //             layerToDisplayCoordinates(
    //               renderPt, layerPoint, chunkTransform.modelTransform, displayDimensionIndices);
    //             this.translateDataPointByViewportPixels(
    //               renderPt, renderPt, totDeltaVec[0], totDeltaVec[1]);
    //             displayToLayerCoordinates(
    //               layerPoint, renderPt, chunkTransform.modelTransform, displayDimensionIndices);
    //             const newPoint = new Float32Array(layerRank);
    //             matrix.transformPoint(
    //               newPoint, chunkTransform.layerToChunkTransform, layerRank + 1, layerPoint,
    //               layerRank);
    //             let newAnnotation =
    //               handler.updateViaRepresentativePoint(ann, newPoint, pickedOffset);
    //             annotationLayer.source.update(annotationRef, newAnnotation);
    //           },
    //           (_event) => {
    //             annotationLayer.source.commit(annotationRef);
    //             annotationRef.dispose();
    //           });
    //       }
    //     }
    //   }
    // });

    registerActionListener(
      element, 
      'move-polygon-vertex', 
      (e: ActionEvent<MouseEvent>) => {
        const { mouseState } = this.viewer;
        const selectedLayer = this.viewer.selectedLayer.layer;
        const selectedAnnotationId = mouseState.pickedAnnotationId;
        const annotationLayer = mouseState.pickedAnnotationLayer;
        if (
          annotationLayer === undefined || 
          selectedAnnotationId === undefined
        ) return;
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
            }) does not have an active annotation tool.`
          );
          return;
        }
        // if (userLayer.tool.value instanceof PlaceVolumeTool) {
        //   const volumeTool = <PlaceVolumeTool>userLayer.tool.value;
        //   if (!volumeTool.validateSession(selectedAnnotationId, annotationLayer)) 
        //     return;
        // }
        e.stopPropagation();

        const annotationRef = annotationLayer.source.getReference(
          selectedAnnotationId
        )!;
        const ann = <Annotation>annotationRef.value;
        if (!ann.parentAnnotationId) return;
        const parAnnotationRef = annotationLayer.source.getReference(
          ann.parentAnnotationId
        )!;
        const parAnn = <Annotation>parAnnotationRef.value;
        if (
          parAnn.type === AnnotationType.POLYGON && 
          isCornerPicked(mouseState.pickedOffset)
        ) {
          const handler = getAnnotationTypeRenderHandler(ann.type);
          const { chunkTransform: { value: chunkTransform } } = annotationLayer;
          if (chunkTransform.error !== undefined) return;
          const { layerRank } = chunkTransform;
          const repPoint = new Float32Array(layerRank);
          handler.getRepresentativePoint(
            repPoint, 
            ann, 
            mouseState.pickedOffset
          );

          const childAnnotationIds = (<Polygon>parAnn).childAnnotationIds;
          const pickedAnnotations: { 
            partIndex: number, 
            annotationRef: AnnotationReference 
          }[] = [];
          childAnnotationIds.forEach((childAnnotationId) => {
            const childAnnotationRef = annotationLayer.source.getReference(
              childAnnotationId
            );
            const childAnn = <Line>childAnnotationRef.value;
            
            const partIndex = getPointPartIndex(<Line>childAnn, repPoint);
            if (partIndex > -1) {
              pickedAnnotations.push({
                partIndex: getPointPartIndex(<Line>childAnn, repPoint),
                annotationRef: childAnnotationRef
              });
            }
          });

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
                  layerRank
                );
                const renderPt = tempVec3;
                const { displayDimensionIndices } =
                  this.navigationState.pose.displayDimensions.value;
                layerToDisplayCoordinates(
                  renderPt, 
                  layerPoint, 
                  chunkTransform.modelTransform, 
                  displayDimensionIndices
                );
                this.translateDataPointByViewportPixels(
                  renderPt, 
                  renderPt, 
                  totDeltaVec[0], 
                  totDeltaVec[1]
                );
                displayToLayerCoordinates(
                  layerPoint, 
                  renderPt, 
                  chunkTransform.modelTransform, 
                  displayDimensionIndices
                );
                const newPoint = new Float32Array(layerRank);
                matrix.transformPoint(
                  newPoint, 
                  chunkTransform.layerToChunkTransform, 
                  layerRank + 1, 
                  layerPoint,
                  layerRank
                );
                copyZCoordinate((<Polygon>parAnn).source, newPoint);
                pickedAnnotations.forEach((pickedAnnotation) => {
                  const newAnnotation = handler.updateViaRepresentativePoint(
                    pickedAnnotation.annotationRef.value!,
                    newPoint, pickedAnnotation.partIndex
                  );
                  const newLineAnn = <Line>newAnnotation;
                  if (checkIfSameZCoordinate(
                    newLineAnn.pointA, 
                    newLineAnn.pointB
                  )) {
                    annotationLayer.source.update(
                      pickedAnnotation.annotationRef, 
                      newAnnotation
                    );
                  }
                });
              },
              (_event) => {
                pickedAnnotations.forEach((pickedAnnotation) => {
                  annotationLayer.source.commit(pickedAnnotation.annotationRef);
                  pickedAnnotation.annotationRef.dispose();
                });
              });
          }
        }
      });
      /* BRAINSHARE ENDS */

    this.registerDisposer(sliceView);
    // Create visible layer tracker after registering SliceView, to ensure it is destroyed before
    // SliceView backend is destroyed.
    this.visibleLayerTracker = makeRenderedPanelVisibleLayerTracker(
      this.viewer.layerManager,
      SliceViewPanelRenderLayer,
      this.viewer.visibleLayerRoles,
      this,
    );

    this.registerDisposer(
      viewer.crossSectionBackgroundColor.changed.add(() =>
        this.scheduleRedraw(),
      ),
    );
    this.registerDisposer(sliceView.visibility.add(this.visibility));
    this.registerDisposer(
      sliceView.viewChanged.add(() => {
        if (this.visible) {
          context.scheduleRedraw();
        }
      }),
    );
    this.registerDisposer(
      viewer.showAxisLines.changed.add(() => {
        if (this.visible) {
          this.scheduleRedraw();
        }
      }),
    );

    this.registerDisposer(
      viewer.showScaleBar.changed.add(() => {
        if (this.visible) {
          this.context.scheduleRedraw();
        }
      }),
    );
    this.registerDisposer(
      viewer.scaleBarOptions.changed.add(() => {
        if (this.visible) {
          this.context.scheduleRedraw();
        }
      }),
    );
  }

  translateByViewportPixels(deltaX: number, deltaY: number): void {
    const { pose } = this.viewer.navigationState;
    pose.updateDisplayPosition((pos) => {
      vec3.set(pos, -deltaX, -deltaY, 0);
      vec3.transformMat4(
        pos,
        pos,
        this.sliceView.projectionParameters.value.invViewMatrix,
      );
    });
  }

  translateDataPointByViewportPixels(
    out: vec3,
    orig: vec3,
    deltaX: number,
    deltaY: number,
  ): vec3 {
    const projectionParameters = this.sliceView.projectionParameters.value;
    vec3.transformMat4(out, orig, projectionParameters.viewMatrix);
    vec3.set(out, out[0] + deltaX, out[1] + deltaY, out[2]);
    vec3.transformMat4(out, out, projectionParameters.invViewMatrix);
    return out;
  }

  isReady() {
    if (!this.visible) {
      return false;
    }

    const { sliceView } = this;

    this.ensureBoundsUpdated();

    if (!sliceView.isReady()) {
      return false;
    }

    const renderContext: SliceViewPanelReadyRenderContext = {
      projectionParameters: sliceView.projectionParameters.value,
      sliceView,
    };

    for (const [renderLayer, attachment] of this.visibleLayerTracker
      .visibleLayers) {
      if (!renderLayer.isReady(renderContext, attachment)) {
        return false;
      }
    }
    return true;
  }

  drawWithPicking(pickingData: FramePickingData): boolean {
    const { sliceView } = this;
    if (!sliceView.valid) {
      return false;
    }
    sliceView.updateRendering();
    const projectionParameters = sliceView.projectionParameters.value;
    const { width, height, invViewProjectionMat } = projectionParameters;
    mat4.copy(pickingData.invTransform, invViewProjectionMat);
    const { gl } = this;

    this.offscreenFramebuffer.bind(width, height);
    gl.disable(WebGL2RenderingContext.SCISSOR_TEST);
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT);

    const backgroundColor = tempVec4;
    const crossSectionBackgroundColor =
      this.viewer.crossSectionBackgroundColor.value;
    backgroundColor[0] = crossSectionBackgroundColor[0];
    backgroundColor[1] = crossSectionBackgroundColor[1];
    backgroundColor[2] = crossSectionBackgroundColor[2];
    backgroundColor[3] = 1;

    this.offscreenFramebuffer.bindSingle(OffscreenTextures.COLOR);
    this.sliceViewRenderHelper.draw(
      sliceView.offscreenFramebuffer.colorBuffers[0].texture,
      identityMat4,
      this.colorFactor,
      backgroundColor,
      0,
      0,
      1,
      1,
    );

    const { visibleLayers } = this.visibleLayerTracker;
    const { pickIDs } = this;
    pickIDs.clear();

    const bindFramebuffer = () => {
      gl.disable(WebGL2RenderingContext.SCISSOR_TEST);
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.blendFunc(
        WebGL2RenderingContext.SRC_ALPHA,
        WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA,
      );
      this.offscreenFramebuffer.bind(width, height);
    };

    bindFramebuffer();

    const renderContext: SliceViewPanelRenderContext = {
      wireFrame: this.viewer.wireFrame.value,
      projectionParameters,
      pickIDs: pickIDs,
      emitter: sliceViewPanelEmitColorAndPickID,
      emitColor: true,
      emitPickID: true,
      sliceView,
      bindFramebuffer,
      frameNumber: this.context.frameNumber,
    };
    for (const [renderLayer, attachment] of visibleLayers) {
      renderLayer.draw(renderContext, attachment);
    }
    gl.disable(WebGL2RenderingContext.BLEND);
    if (this.viewer.showAxisLines.value || this.viewer.showScaleBar.value) {
      this.offscreenFramebuffer.bindSingle(OffscreenTextures.COLOR);
      if (this.viewer.showAxisLines.value) {
        const axisLength =
          (Math.min(
            projectionParameters.logicalWidth,
            projectionParameters.logicalHeight,
          ) /
            4) *
          1.5;
        const {
          zoomFactor: { value: zoom },
        } = this.viewer.navigationState;
        this.axesLineHelper.draw(
          disableZProjection(
            computeAxisLineMatrix(projectionParameters, axisLength * zoom),
          ),
        );
      }
      if (this.viewer.showScaleBar.value) {
        gl.enable(WebGL2RenderingContext.BLEND);
        gl.blendFunc(
          WebGL2RenderingContext.SRC_ALPHA,
          WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA,
        );
        this.scaleBars.draw(
          projectionParameters,
          this.navigationState.displayDimensionRenderInfo.value,
          this.navigationState.relativeDisplayScales.value,
          this.navigationState.zoomFactor.value,
          this.viewer.scaleBarOptions.value,
        );
        gl.disable(WebGL2RenderingContext.BLEND);
      }
    }

    this.offscreenFramebuffer.unbind();

    // Draw the texture over the whole viewport.
    this.setGLClippedViewport();
    this.offscreenCopyHelper.draw(
      this.offscreenFramebuffer.colorBuffers[OffscreenTextures.COLOR].texture,
    );
    return true;
  }

  ensureBoundsUpdated() {
    super.ensureBoundsUpdated();
    this.sliceView.projectionParameters.setViewport(this.renderViewport);
  }

  issuePickRequest(glWindowX: number, glWindowY: number) {
    const { offscreenFramebuffer } = this;
    offscreenFramebuffer.readPixelFloat32IntoBuffer(
      OffscreenTextures.PICK,
      glWindowX - pickRadius,
      glWindowY - pickRadius,
      0,
      pickDiameter,
      pickDiameter,
    );
  }

  completePickRequest(
    glWindowX: number,
    glWindowY: number,
    data: Float32Array,
    pickingData: FramePickingData,
  ) {
    const { mouseState } = this.viewer;
    mouseState.pickedRenderLayer = null;
    clearOutOfBoundsPickData(
      data,
      0,
      4,
      glWindowX,
      glWindowY,
      pickingData.viewportWidth,
      pickingData.viewportHeight,
    );
    const { viewportWidth, viewportHeight } = pickingData;
    const numOffsets = pickOffsetSequence.length;
    const { value: voxelCoordinates } = this.navigationState.position;
    const rank = voxelCoordinates.length;
    const displayDimensions = this.navigationState.pose.displayDimensions.value;
    const { displayRank, displayDimensionIndices } = displayDimensions;

    const setPosition = (
      xOffset: number,
      yOffset: number,
      position: Float32Array,
    ) => {
      const x = glWindowX + xOffset;
      const y = glWindowY + yOffset;
      tempVec3[0] = (2.0 * x) / viewportWidth - 1.0;
      tempVec3[1] = (2.0 * y) / viewportHeight - 1.0;
      tempVec3[2] = 0;
      vec3.transformMat4(tempVec3, tempVec3, pickingData.invTransform);
      position.set(voxelCoordinates);
      for (let i = 0; i < displayRank; ++i) {
        position[displayDimensionIndices[i]] = tempVec3[i];
      }
    };

    let { unsnappedPosition } = mouseState;
    if (unsnappedPosition.length !== rank) {
      unsnappedPosition = mouseState.unsnappedPosition = new Float32Array(rank);
    }
    mouseState.coordinateSpace = this.navigationState.coordinateSpace.value;
    mouseState.displayDimensions = displayDimensions;

    setPosition(0, 0, unsnappedPosition);

    const setStateFromRelative = (
      relativeX: number,
      relativeY: number,
      pickId: number,
    ) => {
      let { position: mousePosition } = mouseState;
      if (mousePosition.length !== rank) {
        mousePosition = mouseState.position = new Float32Array(rank);
      }
      setPosition(
        relativeX - pickRadius,
        relativeY - pickRadius,
        mousePosition,
      );
      this.pickIDs.setMouseState(mouseState, pickId);
      mouseState.setActive(true);
    };
    for (let i = 0; i < numOffsets; ++i) {
      const offset = pickOffsetSequence[i];
      const pickId = data[4 * i];
      if (pickId === 0) continue;
      const relativeX = offset % pickDiameter;
      const relativeY = (offset - relativeX) / pickDiameter;
      setStateFromRelative(relativeX, relativeY, pickId);
      return;
    }
    setStateFromRelative(pickRadius, pickRadius, 0);
  }

  /**
   * Zooms by the specified factor, maintaining the data position that projects to the current mouse
   * position.
   */
  zoomByMouse(factor: number) {
    const { navigationState } = this;
    if (!navigationState.valid) {
      return;
    }
    const { sliceView } = this;
    const {
      width,
      height,
      invViewMatrix,
      displayDimensionRenderInfo: { displayDimensionIndices, displayRank },
    } = sliceView.projectionParameters.value;
    let { mouseX, mouseY } = this;
    mouseX -= width / 2;
    mouseY -= height / 2;
    // Desired invariance:
    //
    // invViewMatrixLinear * [mouseX, mouseY, 0]^T + [oldX, oldY, oldZ]^T =
    // invViewMatrixLinear * factor * [mouseX, mouseY, 0]^T + [newX, newY, newZ]^T

    const position = this.navigationState.position.value;
    for (let i = 0; i < displayRank; ++i) {
      const dim = displayDimensionIndices[i];
      const f = invViewMatrix[i] * mouseX + invViewMatrix[4 + i] * mouseY;
      position[dim] += f * (1 - factor);
    }
    this.navigationState.position.changed.dispatch();
    navigationState.zoomBy(factor);
  }
}
