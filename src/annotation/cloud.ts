/**
 * @file Support for rendering volume annotations.
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

/**
  * RenderHelper class is used for rendering the polygon annotation. Polygons 
  * are internally rendered as line annotations. This class is for format 
  * purposes only.
  */
class RenderHelper extends AnnotationRenderHelper {
  draw(context: AnnotationRenderContext) {
    context;
  }
}

registerAnnotationTypeRenderHandler<Cloud>(AnnotationType.VOLUME, {
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
    out.set(ann.source);
  },
  updateViaRepresentativePoint(oldAnnotation, position) {
    return { ...oldAnnotation, source: new Float32Array(position) };
  }
});