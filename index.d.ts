/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

import { OpenAPI } from "./openapi3.1";
import { TestSet } from "./testset";
import { LoggerSetting } from "./logger";
import { JsonSchema } from "./json-schema";

export class Validator {
    
    /**
     * 
     * @param specFilePath Path to the Open API definition file
     * @param testSetFilePath Path to the test case file
     * @param logSettingFilePath Path to the log setting file
     * @param verboseLog Output detailed logs.
     */
    constructor(spec: string|OpenAPI, testSet?: string|TestSet, logSetting?: string|LoggerSetting, verboseLog?: boolean);

    /**
     * Call the API server according to the test case and verify the returned value.
     */
    async validate(): void;

    validateJson(data: any, schema: JsonSchema): void;

    getComponent(path: string): JsonSchema | null;
}