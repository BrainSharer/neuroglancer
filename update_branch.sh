#!/bin/bash

git remote add upstream https://github.com/google/neuroglancer.git
git remote -v
git fetch upstream
git checkout master
git pull
git checkout polygon-tool
git merge master
#nvm install stable
npm i
