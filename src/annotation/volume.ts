/**
 * @file Support for rendering volume annotations.
 */

import {
  AnnotationType,
  Polygon,
  Volume
} from '#/annotation';
import {
  AnnotationRenderContext,
  AnnotationRenderHelper,
  registerAnnotationTypeRenderHandler
} from '#/annotation/type_handler';
import { AnnotationLayerState } from './annotation_layer_state';
import { getZCoordinate } from './polygon';

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

registerAnnotationTypeRenderHandler<Volume>(AnnotationType.VOLUME, {
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

/**
 * This function takes a volume id as input and finds if there is a polygon 
 * already present at the input zCoordiante, if the polygon is present returns 
 * false
 * @param annotationLayer The annotation layer state object of the layer in 
 * which polygon is drawn.
 * @param id volume id
 * @param zCoordinate z coordinate input.
 * @returns True, if polygon is not present otherwise false.
 */
export function isSectionValid(
  annotationLayer: AnnotationLayerState, 
  id: string, 
  zCoordinate: number
): boolean {
  const reference = annotationLayer.source.getReference(id);
  if (!reference.value || reference.value.type !== AnnotationType.VOLUME) {
    return false;
  }
  const childIds = reference.value.childAnnotationIds;

  for (let idx = 0; idx < childIds.length; idx++) {
    const childId = childIds[idx];
    const childRef = annotationLayer.source.getReference(childId);
    if (!childRef.value) continue;
    const polygon = <Polygon>(childRef.value);
    if (getZCoordinate(polygon.source) === zCoordinate) {
      return false;
    }
  }
  return true;
}