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

import { requestAsyncComputation } from "#src/async_computation/request.js";
import { parseVTKFromArrayBuffer } from "#src/async_computation/vtk_mesh_request.js";
import { GenericSharedDataSource } from "#src/chunk_manager/generic_file_source.js";
import type { SingleMesh } from "#src/single_mesh/backend.js";
import { registerSingleMeshFactory } from "#src/single_mesh/backend.js";
import { DataType } from "#src/util/data_type.js";

/**
 * This needs to be a global function, because it identifies the instance of GenericSharedDataSource
 * to use.
 */
function parse(buffer: ArrayBuffer, abortSignal: AbortSignal) {
  return requestAsyncComputation(
    parseVTKFromArrayBuffer,
    abortSignal,
    [buffer],
    buffer,
  );
}

registerSingleMeshFactory("vtk", {
  description: "VTK",
  getMesh: (chunkManager, credentialsProvider, url, getPriority, abortSignal) =>
    GenericSharedDataSource.getUrl(
      chunkManager,
      credentialsProvider,
      parse,
      url,
      getPriority,
      abortSignal,
    ).then((mesh) => {
      const result: SingleMesh = {
        info: {
          numTriangles: mesh.numTriangles,
          numVertices: mesh.numVertices,
          vertexAttributes: [],
        },
        indices: mesh.indices,
        vertexPositions: mesh.vertexPositions,
        vertexAttributes: [],
      };
      for (const attribute of mesh.vertexAttributes) {
        result.info.vertexAttributes.push({
          name: attribute.name,
          dataType: DataType.FLOAT32,
          numComponents: attribute.numComponents,
        });
        result.vertexAttributes.push(attribute.data);
      }
      return result;
    }),
});
