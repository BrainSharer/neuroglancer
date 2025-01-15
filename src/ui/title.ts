/**
 * @license
 * Copyright 2021 Google Inc.
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

import type { WatchableValueInterface } from "#src/trackable_value.js";
import { animationFrameDebounce } from "#src/util/animation_frame_debounce.js";

/* BRAINSHARE STARTS */
declare let NEUROGLANCER_BUILD_INFO:
| { tag: string; url?: string; timestamp?: string };
/* BRAINSHARE ENDS */


export function bindTitle(title: WatchableValueInterface<string | undefined>) {
  const debouncedSetTitle = animationFrameDebounce(() => {
    /* BRAINSHARE STARTS */
    // const value = title.value?.trim();
    let tag_title = NEUROGLANCER_BUILD_INFO.tag;
    let date_title = NEUROGLANCER_BUILD_INFO.timestamp;
    if ((tag_title) && (date_title)) {
      document.title = 'Neuroglancer ' + tag_title + ' built on ' + date_title;
    } else {
      document.title = "Neuroglancer";
    }
    /* BRAINSHARE ENDS */
  });
  const unregisterSignalHandler = title.changed.add(debouncedSetTitle);
  debouncedSetTitle();
  debouncedSetTitle.flush();
  return () => {
    unregisterSignalHandler();
    debouncedSetTitle.cancel();
  };
}
