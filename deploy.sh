#!/bin/bash

SERVICE_PATH="./src/brainshare/service.ts"
SERVICE_PRODUCTION=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: 'https://imageserv.dk.ucsd.edu/brainsharer',
  API_ENDPOINT: 'https://www.brainsharer.org/brainsharer',
  GOOGLE_LOGIN: 'https://www.brainsharer.org/brainsharer/accounts/google/login/?next=',
  LOCAL_LOGIN: 'https://www.brainsharer.org/brainsharer/admin/login/?next=',
  LOGOUT: 'https://www.brainsharer.org/brainsharer/local/logout/',
  ADMIN_PORTAL: 'https://www.brainsharer.org/brainsharer/admin/',
  REFRESH_TOKEN: 'https://www.brainsharer.org/brainsharer/api-token-refresh/',
};
EOF
)
SERVICE_DEMO=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: 'https://imageserv.dk.ucsd.edu/brainsharer',
  API_ENDPOINT: 'https://demo.brainsharer.org/brainsharer',
  GOOGLE_LOGIN: 'https://demo.brainsharer.org/brainsharer/accounts/google/login/?next=',
  LOCAL_LOGIN: 'https://demo.brainsharer.org/brainsharer/admin/login/?next=',
  LOGOUT: 'https://demo.brainsharer.org/local/logout',
  ADMIN_PORTAL: 'https://demo.brainsharer.org/brainsharer/admin/',
  REFRESH_TOKEN: 'https://demo.brainsharer.org/brainsharer/api-token-refresh/',
};
EOF
)
SERVICE_LOCAL=$(cat <<'EOF'
export const APIs = {
  IMAGESERVER_API_ENDPOINT: 'https://imageserv.dk.ucsd.edu/brainsharer',
  API_ENDPOINT: 'http://localhost:8000',
  GOOGLE_LOGIN: 'http://localhost:8000/google/',
  LOCAL_LOGIN: 'http://localhost:8000/local/login',
  LOGOUT: 'http://localhost:8000/local/logout',
  ADMIN_PORTAL: 'https://localhost:8000/admin/',
  REFRESH_TOKEN: 'http://localhost:8000/api-token-refresh/',
};
EOF
)

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
    BUILD_INFO="{'tag':'DEMO Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.demo.tar.gz"
    echo "$SERVICE_DEMO" > "$SERVICE_PATH"
fi

if [ "$1" == "production" ]; then
    BUILD_INFO="{'tag':'Production Version $GIT', 'url':'https://github.com/BrainSharer/neuroglancer/commit/$(git rev-parse HEAD)', 'timestamp':'$(date)'}"
    PACKAGE="neuroglancer.production.tar.gz"
    echo "$SERVICE_PRODUCTION" > "$SERVICE_PATH"
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