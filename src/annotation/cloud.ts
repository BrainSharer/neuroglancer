/**
 * @file Support for rendering cloud annotations.
 */

import type {
  Cloud} from '#src/annotation/index.js';
import {
  AnnotationType
} from '#src/annotation/index.js';
import type {
  AnnotationRenderContext} from '#src/annotation/type_handler.js';
import {
  AnnotationRenderHelper,
  registerAnnotationTypeRenderHandler
} from '#src/annotation/type_handler.js';

class RenderHelper extends AnnotationRenderHelper {
  draw(context: AnnotationRenderContext) {
    context;
  }
}

registerAnnotationTypeRenderHandler<Cloud>(AnnotationType.CLOUD, {
  sliceViewRenderHelper: RenderHelper,
  perspectiveViewRenderHelper: RenderHelper,
  defineShaderNoOpSetters(builder) {
    builder;
  },
  pickIdsPerInstance: 1,
  snapPosition(position, data, offset) {
    position.set(new Float32Array(data, offset, position.length));
  },
  getRepresentativePoint(out, ann) {
    out.set(ann.centroid);
  },
  updateViaRepresentativePoint(oldAnnotation, position) {
    return { ...oldAnnotation, source: new Float32Array(position) };
  }
});