/**
 * @file Support for rendering volume annotations.
 */

import {
  AnnotationReference,
  AnnotationSource,
  AnnotationType,
  Polygon,
  Volume
} from '#src/annotation/index.js';
import {
  AnnotationRenderContext,
  AnnotationRenderHelper,
  registerAnnotationTypeRenderHandler
} from '#src/annotation/type_handler.js';
import { MultiscaleAnnotationSource } from '#src/annotation/frontend_source.js';
import { getZCoordinate } from '#src/annotation/polygon.js';

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
 * This function takes a volume id as input and returns child polygons
 * @param annotationSource The annotation source object of the volume
 * @param id volume id
 * @returns If success, returns he array of child polygons. 
 */
export function getPolygonsByVolumeId(
  annotationSource: AnnotationSource | MultiscaleAnnotationSource,
  id: string, 
): Polygon[] | undefined {
  const reference = annotationSource.getReference(id);
  if (!reference.value || reference.value.type !== AnnotationType.VOLUME) {
    return undefined;
  }
  const childIds = reference.value.childAnnotationIds;

  const polygons: Polygon[] = [];
  for (let i = 0; i < childIds.length; i++) {
    const childId = childIds[i];
    const childRef = annotationSource.getReference(childId);
    if (!childRef.value) continue;
    polygons.push(<Polygon>(childRef.value));
  }

  return polygons;
}

/**
 * This function takes a volume id as input and finds if there is a polygon 
 * already present at the input zCoordiante, if the polygon is present returns 
 * false
 * @param annotationSource The annotation source object of the volume
 * @param id volume id
 * @param zCoordinate z coordinate input.
 * @returns True, if polygon is not present otherwise false.
 */
export function isSectionValid(
  annotationSource: AnnotationSource | MultiscaleAnnotationSource,
  id: string, 
  zCoordinate: number
): boolean {
  const polygons = getPolygonsByVolumeId(annotationSource, id);
  if (!polygons) return true;

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (getZCoordinate(polygon.source) === zCoordinate) {
      return false;
    }
  }
  return true;
}

/**
 * Takes a list of polygons as input and returns the centroid of middle polygon 
 * in terms of the z-coordinate.
 * @param annotationRefs List of polygon references
 * @returns centroid in a float array format.
 */
export function getCentroidVolume(
  annotationRefs: AnnotationReference[]
): Float32Array {
  const centroids = annotationRefs.map(
    annotationRef => (<Polygon> annotationRef.value).centroid
  );
  centroids.sort((a, b) => {
    const z0 = getZCoordinate(a);
    const z1 = getZCoordinate(b);
    if (z0 == undefined) return -1;
    if (z1 == undefined) return 1;
    return z1 - z0;
  });
  const centroid = centroids[Math.floor(centroids.length / 2)]

  return centroid;
}

export function getPolygonByZIndex(
  annotationSource: AnnotationSource | MultiscaleAnnotationSource,
  id: string,
  zIndex: number,
): Polygon | undefined {
  const polygons = getPolygonsByVolumeId(annotationSource, id);
  if (!polygons) return undefined;
  
  for (let i = 0; i < polygons.length; i++) {
    if (getZCoordinate(polygons[i].centroid) == zIndex) {
      return polygons[i];
    }
  }
  
  return undefined;
}