#!/bin/bash

SERVICE_PATH="./src/brainshare/service.ts"
SERVICE_PRODUCTION=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: "https://imageserv.dk.ucsd.edu/brainsharer",
  API_ENDPOINT: "https://brainsharer.org/brainsharer",
  GOOGLE_LOGIN: "https://brainsharer.org/brainsharer/accounts/google/login/?next=",
  LOCAL_LOGIN: "https://brainsharer.org/brainsharer/admin/login/?next=",
  LOGOUT: "https://brainsharer.org/brainsharer/local/logout/",
  ADMIN_PORTAL: "https://brainsharer.org/brainsharer/admin/",
  REFRESH_TOKEN: "https://brainsharer.org/brainsharer/api-token-refresh/",
  GET_SET_STATE: "https://brainsharer.org/brainsharer/neuroglancer/",
  GET_SET_ANNOTATION: "https://brainsharer.org/brainsharer/annotations/api/",
  SEARCH_ANNOTATION: "https://brainsharer.org/brainsharer/annotations/search/",
  GET_ANNOTATION_LABELS: "https://brainsharer.org/brainsharer/annotations/labels/",
};
EOF
)
SERVICE_TOBOR=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: "https://imageserv.dk.ucsd.edu/brainsharer",
  API_ENDPOINT: "https://tobor.eddyod.com/brainsharer",
  GOOGLE_LOGIN: "https://tobor.eddyod.com/brainsharer/accounts/google/login/?next=",
  LOCAL_LOGIN: "https://tobor.eddyod.com/brainsharer/admin/login/?next=",
  LOGOUT: "https://tobor.eddyod.com/brainsharer/local/logout/",
  ADMIN_PORTAL: "https://tobor.eddyod.com/brainsharer/admin/",
  REFRESH_TOKEN: "https://tobor.eddyod.com/brainsharer/api-token-refresh/",
  GET_SET_STATE: "https://tobor.eddyod.com/brainsharer/neuroglancer/",
  GET_SET_ANNOTATION: "https://tobor.eddyod.com/brainsharer/annotations/api/",
  SEARCH_ANNOTATION: "https://tobor.eddyod.com/brainsharer/annotations/search/",
  GET_ANNOTATION_LABELS: "https://tobor.eddyod.com/brainsharer/annotations/labels/",
};
EOF
)
SERVICE_DEMO=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: "https://imageserv.dk.ucsd.edu/brainsharer",
  API_ENDPOINT: "https://demo.brainsharer.org/brainsharer",
  GOOGLE_LOGIN: "https://demo.brainsharer.org/brainsharer/accounts/google/login/?next=",
  LOCAL_LOGIN: "https://demo.brainsharer.org/brainsharer/admin/login/?next=",
  LOGOUT: "https://demo.brainsharer.org/local/logout",
  ADMIN_PORTAL: "https://demo.brainsharer.org/brainsharer/admin/",
  REFRESH_TOKEN: "https://demo.brainsharer.org/brainsharer/api-token-refresh/",
  GET_SET_STATE: "https://demo.brainsharer.org/brainsharer/neuroglancer/",
  GET_SET_ANNOTATION: "https://demo.brainsharer.org/brainsharer/annotations/",
  SEARCH_ANNOTATION: "https://demo.brainsharer.org/brainsharer/annotations/search/",
  GET_ANNOTATION_LABELS: "https://demo.brainsharer.org/brainsharer/annotations/labels/",
};
EOF
)
SERVICE_LOCAL=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: "https://imageserv.dk.ucsd.edu/brainsharer",
  API_ENDPOINT: "http://localhost:8000",
  GOOGLE_LOGIN: "http://localhost:8000/google/",
  LOCAL_LOGIN: "http://localhost:8000/local/login",
  LOGOUT: "http://localhost:8000/local/logout",
  ADMIN_PORTAL: "https://localhost:8000/admin/",
  REFRESH_TOKEN: "http://localhost:8000/api-token-refresh/",
  GET_SET_STATE: "http://localhost:8000/neuroglancer/",
  GET_SET_ANNOTATION: "http://localhost:8000/annotations/api/",
  SEARCH_ANNOTATION: "http://localhost:8000/annotations/search/",
  GET_ANNOTATION_LABELS: "http://localhost:8000/annotations/labels/",
};
EOF
)

if [ "$1" == "" ] || [ $# -gt 1 ]; then
    echo "Enter either 'production' or 'demo' 'tobor' as an argument."
	exit 0
fi

if ! [[ "$1" =~ ^(demo|production|tobor)$ ]]; then
    echo "Enter either 'production' or 'demo' or 'tobor' as an argument."
	exit 0
fi

rm -vf dist/min/*
rm -vf *.tar.gz
GIT=$(git tag --sort=version:refname)

if [ "$1" == "demo" ]; then
    BUILD_INFO="{'tag':'DEMO Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.demo.tar.gz"
    echo "$SERVICE_DEMO" > "$SERVICE_PATH"
fi

if [ "$1" == "production" ]; then
    BUILD_INFO="{'tag':'Production Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.production.tar.gz"
    echo "$SERVICE_PRODUCTION" > "$SERVICE_PATH"
fi

if [ "$1" == "tobor" ]; then
    BUILD_INFO="{'tag':'Tobor Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.tobor.tar.gz"
    echo "$SERVICE_TOBOR" > "$SERVICE_PATH"
fi

if ! command -v npm &> /dev/null
then
    echo "npm could not be found"
    exit 1
fi

echo "$BUILD_INFO"
# exit 0

#npm run build-python -- --no-typecheck --define NEUROGLANCER_BUILD_INFO="${BUILD_INFO}"
npm run build -- --define NEUROGLANCER_BUILD_INFO="${BUILD_INFO}"
cd dist/min/
tar zcvf ../../$PACKAGE *
cd ../../

echo "$SERVICE_LOCAL" > "$SERVICE_PATH"
