/**
 * @file Support for rendering cloud annotations.
 */

import {
  AnnotationType,
  Cloud,
} from '#/annotation';
import {
  AnnotationRenderContext,
  AnnotationRenderHelper,
  registerAnnotationTypeRenderHandler
} from '#/annotation/type_handler';

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