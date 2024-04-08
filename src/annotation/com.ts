/**
 * @file Support for com (center of mass) annotations.
 */

import { AnnotationType, Com } from '#/annotation';
import {
  AnnotationRenderContext, 
  AnnotationRenderHelper, 
  AnnotationShaderGetter, 
  registerAnnotationTypeRenderHandler
} from '#/annotation/type_handler';
import {
  defineCircleShader, 
  drawCircles, 
  initializeCircleShader
} from '#/webgl/circles';
import {
  defineLineShader, 
  drawLines, 
  initializeLineShader
} from '#/webgl/lines';
import { ShaderBuilder, ShaderProgram } from '#/webgl/shader';
import { defineVectorArrayVertexShaderInput } from '#/webgl/shader_lib';
import { defineVertexId, VertexIdHelper } from '#/webgl/vertex_id';

class RenderHelper extends AnnotationRenderHelper {
  private defineShaderCommon(builder: ShaderBuilder) {
    const {rank} = this;
    // Position of com in model coordinates.
    defineVectorArrayVertexShaderInput(
        builder, 'float', WebGL2RenderingContext.FLOAT, /*normalized=*/ false, 'VertexPosition',
        rank);
    builder.addVarying('highp vec4', 'vBorderColor');
    builder.addVarying(`highp float`, 'vComOpacity');
    builder.addVarying(`highp float`, 'vVisibility');
    builder.addVertexCode(`
float ng_markerDiameter;
float ng_markerBorderWidth;
float ng_Visibility;
void setComOpacity(float opacity) {
   vComOpacity = opacity;
 }
void setComMarkerSize(float size) {
  ng_markerDiameter = size;
}
void setComMarkerBorderWidth(float size) {
  ng_markerBorderWidth = size;
}
void setComMarkerColor(vec4 color) {
  vColor = color;
}
void setComMarkerBorderColor(vec4 color) {
  vBorderColor = color;
}
void setComVisibility(float visibility) {
  vVisibility = visibility;
  ng_Visibility = visibility;
}
`);
    builder.addVertexMain(`
ng_markerDiameter = 5.0;
ng_markerBorderWidth = 1.0;
vComOpacity = 1.0;
vBorderColor = vec4(0.0, 0.0, 0.0, 1.0);
float modelPosition[${rank}] = getVertexPosition0();
float clipCoefficient = getSubspaceClipCoefficient(modelPosition);
if (clipCoefficient == 0.0) {
  gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
  return;
}
${this.invokeUserMain}
vColor.a *= clipCoefficient;
vBorderColor.a *= clipCoefficient;
${this.setPartIndex(builder)};
`);
  }

  private shaderGetter3d =
      this.getDependentShader('annotation/com:3d', (builder: ShaderBuilder) => {
        defineVertexId(builder);
        defineCircleShader(builder, /*crossSectionFade=*/ this.targetIsSliceView);
        this.defineShaderCommon(builder);
        builder.addVertexMain(`
if (ng_Visibility == 1.0) {
 emitCircle(uModelViewProjection *
             vec4(projectModelVectorToSubspace(modelPosition), 1.0), ng_markerDiameter, ng_markerBorderWidth);
 }
`);
        builder.setFragmentMain(`
vec4 color = getCircleColor(vColor, vBorderColor);
if (vVisibility == 1.0) {
 emitAnnotation(vec4(color.rgb, color.a * vComOpacity));
}
`);
      });

  private makeShaderGetter2d = (extraDim: number) =>
      this.getDependentShader(`annotation/com:2d:${extraDim}`, (builder: ShaderBuilder) => {
        defineVertexId(builder);
        defineLineShader(builder, /*rounded=*/ true);
        this.defineShaderCommon(builder);
        builder.addVertexMain(`
vec3 subspacePositionA = projectModelVectorToSubspace(modelPosition);
vec3 subspacePositionB = subspacePositionA;
vec4 baseProjection = uModelViewProjection * vec4(subspacePositionA, 1.0);
vec4 zCoeffs = uModelViewProjection[${extraDim}];
float minZ = 1e30;
float maxZ = -1e30;
for (int i = 0; i < 3; ++i) {
  // Want: baseProjection[i] + z * zCoeffs[i] = -2.0 * (baseProjection.w - z * zCoeffs.w)
  //  i.e. baseProjection[i] + 2.0 * baseProjection.w < -z * (2.0 * zCoeffs.w + zCoeffs[i])
  //  i.e. baseProjection[i] + 2.0 * baseProjection.w < -z * k1
  float k1 = 2.0 * zCoeffs.w + zCoeffs[i];
  float q1 = -(baseProjection[i] + 2.0 * baseProjection.w) / k1;
  if (k1 != 0.0) {
    minZ = min(minZ, q1);
    maxZ = max(maxZ, q1);
  }
  // Want: baseProjection[i] + z * zCoeffs[i] = 2.0 * (baseProjection.w + z * zCoeffs.w)
  //  i.e. baseProjection[i] - 2.0 * baseProjection.w > z * (2.0 * zCoeffs.w - zCoeffs[i])
  //  i.e. baseProjection[i] - 2.0 * baseProjection.w > z * k2
  float k2 = 2.0 * zCoeffs.w - zCoeffs[i];
  float q2 = (baseProjection[i] - 2.0 * baseProjection.w) / k2;
  if (k2 != 0.0) {
    minZ = min(minZ, q2);
    maxZ = max(maxZ, q2);
  }
}
if (minZ > maxZ) minZ = maxZ = 0.0;
subspacePositionA[${extraDim}] = minZ;
subspacePositionB[${extraDim}] = maxZ;
if (ng_Visibility == 1.0) {
 emitLine(uModelViewProjection, subspacePositionA, subspacePositionB, ng_markerDiameter, ng_markerBorderWidth);
}
`);
        builder.setFragmentMain(`
vec4 color = getRoundedLineColor(vColor, vBorderColor);
if (vVisibility == 1.0) {
 emitAnnotation(vec4(color.rgb, color.a * ${this.getCrossSectionFadeFactor()} * vComOpacity));
}
`);
      });

  private shaderGetter2d = this.makeShaderGetter2d(2);

  // TODO(jbms): This rendering for the 1d case is not correct except for cross-section/orthographic
  // projection views where the "z" dimension is orthogonal to the single annotation chunk
  // dimension.
  private shaderGetter1d = this.makeShaderGetter2d(1);

  private vertexIdHelper = this.registerDisposer(VertexIdHelper.get(this.gl));

  enable(
      shaderGetter: AnnotationShaderGetter, context: AnnotationRenderContext,
      callback: (shader: ShaderProgram) => void) {
    super.enable(shaderGetter, context, shader => {
      const binder = shader.vertexShaderInputBinders['VertexPosition'];
      binder.enable(1);
      this.gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, context.buffer.buffer);
      binder.bind(this.serializedBytesPerAnnotation, context.bufferOffset);
      const {vertexIdHelper} = this;
      vertexIdHelper.enable();
      callback(shader);
      vertexIdHelper.disable();
      binder.disable();
    });
  }

  draw(context: AnnotationRenderContext) {
    const {numChunkDisplayDims} = context.chunkDisplayTransform;
    switch (numChunkDisplayDims) {
      case 3:
        this.enable(this.shaderGetter3d, context, shader => {
          initializeCircleShader(
              shader, context.renderContext.projectionParameters, {featherWidthInPixels: 1});
          drawCircles(shader.gl, 1, context.count);
        });
        break;
      case 2:
      case 1:
        this.enable(
            numChunkDisplayDims === 2 ? this.shaderGetter2d : this.shaderGetter1d, context,
            shader => {
              initializeLineShader(
                  shader, context.renderContext.projectionParameters, /*featherWidthInPixels=*/ 1);
              drawLines(shader.gl, 1, context.count);
            });
        break;
    }
  }
}

registerAnnotationTypeRenderHandler<Com>(AnnotationType.COM, {
  sliceViewRenderHelper: RenderHelper,
  perspectiveViewRenderHelper: RenderHelper,
  defineShaderNoOpSetters(builder) {
    builder.addVertexCode(`
void setComMarkerSize(float size) {}
void setComMarkerBorderWidth(float size) {}
void setComMarkerColor(vec4 color) {}
void setComMarkerBorderColor(vec4 color) {}
void setComOpacity(float opacity) {}
void setComVisibility(float visibility) {}
`);
  },
  pickIdsPerInstance: 1,
  snapPosition(position, data, offset) {
    position.set(new Float32Array(data, offset, position.length));
  },
  getRepresentativePoint(out, ann) {
    out.set(ann.point);
  },
  updateViaRepresentativePoint(oldAnnotation, position) {
    return {...oldAnnotation, point: new Float32Array(position)};
  }
});