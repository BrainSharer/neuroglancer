#!/bin/bash

if [ "$1" == "" ] || [ $# -gt 1 ]; then
    echo "Enter either 'production' or 'demo' as an argument."
	exit 0
fi

if ! [[ "$1" =~ ^(demo|production)$ ]]; then
    echo "Enter either 'production' or 'demo' as an argument."
	exit 0
fi

rm -vf dist/min/*
rm -vf *.tar.gz
GIT=$(git tag --sort=version:refname)

if [ "$1" == "demo" ]; then
    BUILD="build-demo"
    BUILD_INFO="{'tag':'DEMO Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.demo.tar.gz"
fi

if [ "$1" == "production" ]; then
    BUILD="build-min"
    BUILD_INFO="{'tag':'Production Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.production.tar.gz"
fi

if ! command -v npm &> /dev/null
then
    echo "npm could not be found"
    exit 1
fi

echo $BUILD
echo "$BUILD_INFO"
# exit 0

#npm run build-python -- --no-typecheck --define NEUROGLANCER_BUILD_INFO="${BUILD_INFO}"
npm run $BUILD -- --define NEUROGLANCER_BUILD_INFO="${BUILD_INFO}"
cd dist/min/
tar zcvf ../../$PACKAGE *
cd ../../
