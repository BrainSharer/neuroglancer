#!/bin/bash

if (($# < 2))
then
    echo "Enter dir1 dir2 where dir1 is the main branch and dir2 is the branch you want to compare."
    exit 1
fi
        
MAIN="$1/src/neuroglancer"
CMP="$2/src/neuroglancer"

diff -rq \
    --exclude="*~" \
    --exclude="services" \
    --exclude="fetch_annotation.css" \
    --exclude="fetch_annotation.ts" \
    --exclude="fetch_transformation.ts" \
    --exclude="histogram.css" \
    --exclude="histogram.ts" \
    --exclude="invlerp.ts" \
    --exclude="shader_controls.css" \
    $MAIN $CMP