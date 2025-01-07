#!/bin/bash

git remote add upstream https://github.com/google/neuroglancer.git
git remote -v
git fetch upstream
git checkout master
git pull
git checkout polygon-tool
git merge master 
rm -rf node_modules
nvm install stable
npm i
npm install ikonate
npm install --save-dev @types/firebase
