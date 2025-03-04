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

import type { HashTableBase } from "#src/gpu_hash/hash_table.js";
import { NUM_ALTERNATIVES } from "#src/gpu_hash/hash_table.js";
import { DataType } from "#src/util/data_type.js";
import { RefCounted } from "#src/util/disposable.js";
import type { GL } from "#src/webgl/context.js";
import type { ShaderBuilder, ShaderProgram } from "#src/webgl/shader.js";
import { glsl_equalUint64, glsl_uint64 } from "#src/webgl/shader_lib.js";
import {
  computeTextureFormat,
  OneDimensionalTextureAccessHelper,
  setOneDimensionalTextureData,
  TextureFormat,
} from "#src/webgl/texture_access.js";

// MumurHash, excluding the final mixing steps.
export const glsl_hashCombine = [
  glsl_uint64,
  `
highp uint hashCombine(highp uint state, highp uint value) {
  value *= 0xcc9e2d51u;
  value = (value << 15u) | (value >> 17u);
  value *= 0x1b873593u;
  state ^= value;
  state = (state << 13u) | (state >> 19u);
  state = (state * 5u) + 0xe6546b64u;
  return state;
}
highp uint hashCombine(highp uint state, uint64_t x) {
  state = hashCombine(state, x.value[0]);
  return hashCombine(state, x.value[1]);
}
`,
];

const textureFormat = computeTextureFormat(
  new TextureFormat(),
  DataType.UINT64,
  1,
);

export class GPUHashTable<HashTable extends HashTableBase> extends RefCounted {
  generation = -1;
  texture: WebGLTexture | null = null;

  constructor(
    public gl: GL,
    public hashTable: HashTable,
  ) {
    super();
    // createTexture should never actually return null.
    this.texture = gl.createTexture();
  }

  copyToGPU() {
    const { hashTable } = this;
    const { generation } = hashTable;
    if (this.generation === generation) {
      return;
    }
    const { gl, texture } = this;
    this.generation = generation;
    gl.activeTexture(WebGL2RenderingContext.TEXTURE0 + gl.tempTextureUnit);
    gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, texture);
    hashTable.tableWithMungedEmptyKey((table) => {
      setOneDimensionalTextureData(this.gl, textureFormat, table);
    });
    gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);
  }

  disposed() {
    const { gl } = this;
    gl.deleteTexture(this.texture);
    this.texture = null;
    this.gl = <any>undefined;
    this.hashTable = <any>undefined;
    super.disposed();
  }

  static get<HashTable extends HashTableBase>(gl: GL, hashTable: HashTable) {
    return gl.memoize.get(hashTable, () => new GPUHashTable(gl, hashTable));
  }
}

export class HashSetShaderManager {
  textureUnitSymbol: symbol;
  private accessHelper: OneDimensionalTextureAccessHelper;
  samplerName: string;
  hashSeedsName: string;
  hashKeyMask: string;
  readTable: string;

  constructor(
    public prefix: string,
    public numAlternatives = NUM_ALTERNATIVES,
  ) {
    this.textureUnitSymbol = Symbol.for(`gpuhashtable:${this.prefix}`);
    this.accessHelper = new OneDimensionalTextureAccessHelper(
      `gpuhashtable_${this.prefix}`,
    );
    this.samplerName = prefix + "_sampler";
    this.hashSeedsName = prefix + "_seeds";
    this.hashKeyMask = prefix + "_keyMask";
    this.readTable = prefix + "_readTable";
  }

  defineShader(builder: ShaderBuilder) {
    const { hashSeedsName, samplerName, numAlternatives, hashKeyMask } = this;
    builder.addUniform("highp uint", hashSeedsName, numAlternatives);
    builder.addUniform("highp uint", hashKeyMask);
    builder.addTextureSampler(
      "usampler2D",
      samplerName,
      this.textureUnitSymbol,
    );
    builder.addFragmentCode(glsl_hashCombine);
    builder.addFragmentCode(glsl_uint64);
    builder.addFragmentCode(glsl_equalUint64);
    this.accessHelper.defineShader(builder);
    builder.addFragmentCode(
      this.accessHelper.getAccessor(
        this.readTable,
        this.samplerName,
        DataType.UINT64,
        1,
      ),
    );
    let s = "";
    s += `
bool ${this.hasFunctionName}(uint64_t x) {
`;
    for (let alt = 0; alt < numAlternatives; ++alt) {
      s += `
  {
    uint h = hashCombine(${hashSeedsName}[${alt}], x) & ${hashKeyMask};
    uint64_t key = ${this.readTable}(h);
    if (equals(key, x)) {
      return true;
    }
  }
`;
    }
    s += `
  return false;
}
`;
    builder.addFragmentCode(s);
  }

  get hasFunctionName() {
    return `${this.prefix}_has`;
  }

  enable<HashTable extends HashTableBase>(
    gl: GL,
    shader: ShaderProgram,
    hashTable: GPUHashTable<HashTable>,
  ) {
    hashTable.copyToGPU();
    const textureUnit = shader.textureUnit(this.textureUnitSymbol);
    gl.activeTexture(WebGL2RenderingContext.TEXTURE0 + textureUnit);
    gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, hashTable.texture);
    gl.uniform1ui(
      shader.uniform(this.hashKeyMask),
      hashTable.hashTable.tableSize - 1,
    );
    gl.uniform1uiv(
      shader.uniform(this.hashSeedsName),
      hashTable.hashTable.hashSeeds,
    );
  }

  disable(gl: GL, shader: ShaderProgram) {
    const textureUnit = shader.textureUnit(this.textureUnitSymbol);
    gl.activeTexture(WebGL2RenderingContext.TEXTURE0 + textureUnit);
    gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);
  }
}

export class HashMapShaderManager extends HashSetShaderManager {
  defineShader(builder: ShaderBuilder) {
    super.defineShader(builder);
    const { numAlternatives, hashSeedsName, hashKeyMask } = this;
    let s = `
bool ${this.getFunctionName}(uint64_t x, out uint64_t value) {
`;
    for (let alt = 0; alt < numAlternatives; ++alt) {
      s += `
  {
    uint h = hashCombine(${hashSeedsName}[${alt}], x) & ${hashKeyMask};
    uint64_t key = ${this.readTable}(h * 2u);
    if (equals(key, x)) {
      value = ${this.readTable}(h * 2u + 1u);
      return true;
    }
  }
`;
    }
    s += `
  return false;
}
`;
    builder.addFragmentCode(s);
  }

  get getFunctionName() {
    return `${this.prefix}_get`;
  }
}
