#!/usr/bin/env node
// Validate the OpenAPI spec using @apidevtools/swagger-parser.
import SwaggerParser from '@apidevtools/swagger-parser';
import { openapiDocument } from '../src/openapi.ts';

// We import the TS source directly via ts-node/esm loaded in package.json scripts.
SwaggerParser.validate(structuredClone(openapiDocument))
  .then(api => {
    const pathCount = Object.keys(api.paths ?? {}).length;
    console.log(`✅ OpenAPI spec is valid (openapi: ${api.openapi}, paths: ${pathCount})`);
    if (pathCount < 50) {
      console.error(`❌ Expected ≥ 50 paths, got ${pathCount}`);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('❌ OpenAPI validation failed:', err.message);
    process.exit(1);
  });
