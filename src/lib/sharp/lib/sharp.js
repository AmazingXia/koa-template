// Copyright 2013 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0

'use strict';

// Inspects the runtime environment and exports the relevant sharp.node binary

// const { familySync, versionSync } = require('detect-libc');

// const { runtimePlatformArch, isUnsupportedNodeRuntime, prebuiltPlatforms, minimumLibvipsVersion } = require('./libvips');
// const runtimePlatform = runtimePlatformArch();

const paths = [
  '../img/sharp-wasm32/lib/sharp-wasm32.node.js'
];

let sharp;
const errors = [];
for (const path of paths) {
  try {
    sharp = require(path);
    break;
  } catch (err) {
    /* istanbul ignore next */
    errors.push(err);
  }
}

/* istanbul ignore next */
if (sharp) {
  module.exports = sharp;
} else {
  throw new Error('sharp.node not found');
}
