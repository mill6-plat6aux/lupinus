/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const { readFileSync } = require("fs");
const YAML = require("js-yaml");
const Http = require("./http");
const { Logger, LogLevel } = require("./logger");
const JSONPath = require("jsonpath");
const StandardSpecs = require("./standard-specs");

class Validator {

    /**
     * @type {import("./openapi3.1").OpenAPI}
     */
    spec;

    /**
     * @type {import("./testset").TestSet}
     */
    testSet;

    /**
     * @type {Logger}
     */
    logger;

    /**
     * @type {boolean}
     */
    verbose;

    /**
     * @param {string|import("./openapi3.1").OpenAPI} spec
     * @param {string|import("./testset").TestSet} [testSet]
     * @param {string|import("./logger").LoggerSetting} [logSetting] 
     * @param {boolean} [verboseLog] 
     */
    constructor(spec, testSet, logSetting, verboseLog) {
        if(spec == null) {
            throw new Error("Invalid specFilePath.");
        }
        if(typeof spec == "string") {
            this.spec = this.loadDefinition(spec);
        }else {
            this.spec = spec;
        }
        if(this.spec == null) {
            throw new Error("Invalid specFilePath.");
        }

        if(testSet != null) {
            if(typeof testSet == "string") {
                this.testSet = this.loadDefinition(testSet);
            }else {
                this.testSet = testSet;
            }
            if(this.testSet == null) {
                throw new Error("Invalid testSetFilePath.");
            }
        }

        this.logger = new Logger(undefined, logSetting);
        this.verbose = verboseLog != null ? verboseLog : false;
    }

    /**
     * @param {string} filePath 
     * @returns {object}
     */
    loadDefinition(filePath) {
        let fileData = readFileSync(filePath, "utf8");
        if(fileData == null) {
            return null
        }
        if(filePath.endsWith(".json")) {
            return JSON.parse(fileData);
        }else if(filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
            return /** @type {object} */(YAML.load(fileData));
        }else {
            return null;
        }
    }

    async validate() {
        if(this.spec == null) {
            throw new Error("Invalid specification.");
        }
        if(this.testSet == null || this.testSet.testCases == null || this.testSet.testCases.length == 0) {
            throw new Error("Invalid test set.");
        }
        await this.executeTestCases(this.testSet.testCases, 0);
    }

    /**
     * @param {Array<import("./testset").TestCase>} testCases 
     * @param {number} index 
     */
    async executeTestCases(testCases, index) {
        let testCase = testCases[index];
        if(testCase.sequence == null || testCase.sequence.length == 0) {
            return;
        }
        this.logger.writeLog(`Test [${testCase.title}] is started.`);
        let contextPath = testCase.contextPath;
        if(contextPath == null) {
            contextPath = "";
        }
        try {
            await this.invoke(contextPath, testCase.sequence, 0, []);
        }catch(error) {
            this.logger.writeLog(`\u001b[31mNG\u001b[0m ${error.message}`);
            this.logger.writeLog(error.stack, LogLevel.debug);
        }
        if(index+1 < testCases.length) {
            await this.executeTestCases(testCases, index+1);
        }
    }

    /**
     * @param {string} contextPath
     * @param {Array<import("./testset").Invoke>} sequence 
     * @param {number} index 
     * @param {Array<any>} context
     * @throws {Error}
     */
    async invoke(contextPath, sequence, index, context) {
        let invoke = sequence[index];
        if(invoke.path == null || invoke.method == null) {
            throw new Error(`Invalid invoke.\n${JSON.stringify(invoke, null, 4)}`)
        }

        let requestPath = invoke.path;
        if(!requestPath.startsWith("http")) {
            if(invoke.contextPath != null) {
                requestPath = invoke.contextPath + requestPath;
            }else {
                requestPath = contextPath + requestPath;
            }
        }

        let path = this.spec.paths[invoke.path];
        if(path == null) {
            if(invoke.spec != null) {
                let spec = StandardSpecs.getSpec(invoke.spec);
                if(spec != null) {
                    path = spec;
                }
            }
        }
        if(path == null) {
            throw new Error(`[${invoke.path}] is not found in the specification.`);
        }
        
        let method = invoke.method.toLowerCase();
        if(method != "get" && method != "post" && method != "patch" && method != "put" && method != "delete" && method != "option" && method != "head") {
            throw new Error(`The method [${method}] is invalid.`);
        }

        let requestHeaders;
        if(invoke.request != null) {
            requestHeaders = invoke.request.headers;
        }
        if(requestHeaders != null) {
            if(requestHeaders["authorization"] != null || requestHeaders["Authorization"] != null) {
                let authorization = /** @type {string} */(requestHeaders["authorization"] != null ? requestHeaders["authorization"] : requestHeaders["Authorization"]);
                if(authorization.startsWith("Basic ")) {
                    let credential = authorization.substring("Basic ".length).trim();
                    // If it is not encoded, it is Base64 encoded.
                    if(/^{.+:.+}$/.test(credential)) {
                        credential = Buffer.from(credential.substring(1, credential.length-1)).toString("base64");
                        if(requestHeaders["authorization"] != null) {
                            requestHeaders["authorization"] = authorization.replace(/{.+}/, credential);
                        }else {
                            requestHeaders["Authorization"] = authorization.replace(/{.+}/, credential);
                        }
                    }
                }else if(authorization.startsWith("Bearer ")) {
                    let credential = authorization.substring("Bearer ".length).trim();
                    // Replace context references.
                    if(requestHeaders["authorization"] != null) {
                        requestHeaders["authorization"] = "Bearer " + this.replaceBrackets(credential, context);
                    }else {
                        requestHeaders["authorization"] = "Bearer " + this.replaceBrackets(credential, context);
                    }
                }
            }
        }

        let requestBody;
        if(invoke.request != null) {
            requestBody = invoke.request.body;
        }

        if(path.parameters != null && path.parameters.length > 0) {
            path.parameters.forEach(parameter => {
                if(parameter["$ref"] == null) {
                    parameter = /** @type {import("./openapi3.1").Parameter} */(parameter);
                    if(parameter.in == "path" && parameter.name != null) {
                        if(requestBody != null) {
                            let value = requestBody[parameter.name];
                            if(value !== undefined) {
                                if(typeof value == "string") {
                                    value = this.replaceBrackets(value, context);
                                }
                                if(parameter.schema != null) {
                                    this.validateJson(value, parameter.schema, parameter.name, true);
                                }
                                delete requestBody[parameter.name];
                                requestPath = requestPath.replace("{"+parameter.name+"}", encodeURIComponent(value));
                            }else {
                                if(parameter.required != null && parameter.required) {
                                    throw new Error(`Parameter [${parameter.name}] is required.`);
                                }
                            }
                        }else {
                            if(parameter.required != null && parameter.required) {
                                throw new Error(`Parameter [${parameter.name}] is required.`);
                            }
                        }
                    }
                }else {
                    let component = this.getComponent(parameter["$ref"]);
                    if(requestBody != null && component != null && component.properties != null) {
                        this.validateJson(requestBody, component);
                        Object.keys(component.properties).forEach(key => {
                            let value = requestBody[key];
                            if(value !== undefined) {
                                delete requestBody[key];
                                requestPath = requestPath.replace("{"+key+"}", encodeURIComponent(value));
                            }
                        });
                    }
                }
            });
        }

        /** @type {import("./openapi3.1").Operation} */
        let operation = path[method];
        if(operation.parameters != null && operation.parameters.length > 0) {
            let queryParameters = operation.parameters.map(parameter => {
                if(parameter["$ref"] == null) {
                    parameter = /** @type {import("./openapi3.1").Parameter} */(parameter);
                    if(parameter.in == "query" && parameter.name != null) {
                        if(requestBody != null) {
                            let value = requestBody[parameter.name];
                            if(value !== undefined) {
                                if(typeof value == "string") {
                                    value = this.replaceBrackets(value, context);
                                }
                                if(parameter.schema != null) {
                                    this.validateJson(value, parameter.schema, parameter.name, true);
                                }
                                delete requestBody[parameter.name];
                                return parameter.name + "=" + encodeURIComponent(value);
                            }else {
                                if(parameter.required != null && parameter.required) {
                                    throw new Error(`Parameter [${parameter.name}] is required.`);
                                }
                            }
                        }else {
                            if(parameter.required != null && parameter.required) {
                                throw new Error(`Parameter [${parameter.name}] is required.`);
                            }
                        }
                    }
                }else {
                    let component = this.getComponent(parameter["$ref"]);
                    if(requestBody != null && component != null && component.properties != null) {
                        this.validateJson(requestBody, component);
                        Object.keys(component.properties).forEach(key => {
                            let value = requestBody[key];
                            if(value !== undefined) {
                                delete requestBody[key];
                                return key + "=" + encodeURIComponent(value);
                            }
                        });
                    }
                }
                return null;
            }).filter(parameter => parameter != null).join("&");
            if(queryParameters.length > 0) {
                requestPath = requestPath + "?" + queryParameters;
            }
        }

        if(this.verbose) {
            this.logger.writeLog(`${invoke.method} ${requestPath}`);
            this.logger.writeLog(`REQUEST:`);
            this.logger.writeLog(JSON.stringify(requestHeaders));
            this.logger.writeLog(JSON.stringify(requestBody));
        }

        let response = await Http.request(method, requestPath, requestHeaders, requestBody);

        if(this.verbose) {
            this.logger.writeLog(`RESPONSE:`);
            this.logger.writeLog(`Status: ${response.status}`);
            this.logger.writeLog(JSON.stringify(response.headers));
            this.logger.writeLog(JSON.stringify(response.body));
        }
        
        if(operation.responses != null && response.status != null) {
            let responseSpec = operation.responses[response.status.toString()];
            if(responseSpec == null) {
                responseSpec = operation.responses["default"];
            }
            if(responseSpec != null) {
                if(responseSpec["$ref"] == null) {
                    let responseContentType = response.headers["content-type"];
                    if(responseContentType != null) {
                        let mediaType = responseSpec["content"][responseContentType];
                        if(mediaType != null && mediaType.schema != null) {
                            let schema = mediaType.schema;
                            if(schema["$ref"] != null) {
                                schema = this.getComponent(schema["$ref"]);
                            }
                            if(responseContentType.startsWith("application/json")) {
                                this.validateJson(response.body, schema);
                            }else {
                                throw new Error(`Response content type [${responseContentType}] is not supported.`);
                            }
                        }else {
                            throw new Error(`There is no corresponding definition for the response context type [${responseContentType}].`);
                        }
                    }
                }else {
                    let component = this.getComponent(responseSpec["$ref"]);
                    if(component != null) {
                        this.validateJson(response.body, component);
                    }
                }
            }
        }

        if(invoke.response != null) {
            let testingResponse = invoke.response;
            if(testingResponse.status != null) {
                if(testingResponse.status != response.status) {
                    throw new Error(`Response status [${response.status}] differs from expected value [${testingResponse.status}].\nResponse body:\n${this.stringifyObject(response.body)}`);
                }
            }
            if(testingResponse.headers != null) {
                let expectedHeaders = testingResponse.headers;
                if(typeof expectedHeaders == "string") {
                    if(!this.evalBrackets(expectedHeaders, context, response.headers)) {
                        throw new Error(`Response body differs from expected value.\nResponse headers:\n${this.stringifyObject(response.headers)}\nExpected:\n${expectedHeaders}.`);
                    }
                }else {
                    Object.keys(expectedHeaders).forEach(key => {
                        if(expectedHeaders[key] != response.headers[key]) {
                            throw new Error(`Response header [${response.headers[key]}] differs from expected value [${expectedHeaders[key]}].`);
                        }
                    });
                }
            }
            if(testingResponse.body != null) {
                let expectedBody = testingResponse.body;
                if(!this.evalBrackets(expectedBody, context, response.body)) {
                    throw new Error(`Response body differs from expected value.\nResponse body:\n${this.stringifyObject(response.body)}\nExpected:\n${expectedBody}.`);
                }else if(!/{.+}/.test(expectedBody) && this.stringifyObject(response.body) != this.stringifyObject(expectedBody)) {
                    throw new Error(`Response body differs from expected value.\nResponse body:\n${this.stringifyObject(response.body)}\nExpected:\n${expectedBody}.`);
                }
            }
        }
        this.logger.writeLog(`\u001b[32mPASS\u001b[0m ${invoke.method} ${requestPath}`);
        context.push(response.body);
        if(index+1 < sequence.length) {
            await this.invoke(contextPath, sequence, index+1, context);
        }
    }

    /**
     * @param {string | null} definition 
     * @param {Array<any>} context 
     * @param {Http.HttpResponse} [response] 
     * @returns {string | null}
     */
    replaceBrackets(definition, context, response) {
        if(definition == null) return null;
        definition = definition.replace(/{([^}]+)}/g, (_, target) => {
            target = this.replaceContext(target, context);
            if(response != null) {
                target = this.replaceResponse(target, response);
            }
            return target;
        });
        return definition;
    }

    /**
     * @param {string | null} definition 
     * @param {Array<any>} context 
     * @param {any} response 
     * @returns {boolean}
     */
    evalBrackets(definition, context, response) {
        if(definition == null) return false;
        let results = [];
        definition.replace(/{([^}]+)}/g, (source, target) => {
            let result = true;
            target.replace(/^([a-zA-Z0-9_.*\(\)\[\]@<>=!$]+) ([=><!]+) ([a-zA-Z0-9_.*\(\)\[\]@<>=!$]+)$/, (source, operand1, operator, operand2) => {
                operand1 = this.replaceContext(operand1, context);
                operand1 = this.replaceResponse(operand1, response);
                operand2 = this.replaceContext(operand2, context);
                operand2 = this.replaceResponse(operand2, response);

                if(operator == "=" || operator == "==") {
                    result = this.castAsComparable(operand1) == this.castAsComparable(operand2);
                }else if(operator == "<") {
                    result = this.castAsComparable(operand1) < this.castAsComparable(operand2);
                }else if(operator == "<=") {
                    result = this.castAsComparable(operand1) <= this.castAsComparable(operand2);
                }else if(operator == ">") {
                    result = this.castAsComparable(operand1) > this.castAsComparable(operand2);
                }else if(operator == ">=") {
                    result = this.castAsComparable(operand1) >= this.castAsComparable(operand2);
                }else if(operator == "!=") {
                    result = this.castAsComparable(operand1) != this.castAsComparable(operand2);
                }
                return source;
            });
            results.push(result);
            return source;
        });
        return results.every(entry => entry);
    }

    /**
     * @param {string} definition 
     * @param {Array<any>} context 
     * @returns {string}
     */
    replaceContext(definition, context) {
        return definition.replace(/^context\[([0-9]{1,})\]\.([a-zA-Z0-9_.*\(\)\[\]@<>=!]+)$/, (_, index, target) => {
            let values = JSONPath.query(context[index], target);
            return values.length > 0 ? values[0] : null;
        });
    }

    /**
     * @param {string} definition 
     * @param {any} response 
     * @returns {string}
     */
    replaceResponse(definition, response) {
        let values = JSONPath.query(response, definition);
        return values.length > 0 ? values[0] : definition;
    }

    /**
     * @param {string} data 
     * @returns {any}
     */
    castAsComparable(data) {
        if(/^[0-9.]+$/.test(data)) {
            return Number(data);
        }else if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T|t)[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|z|(\+|-)[0-9]{2}:[0-9]{2})$/.test(data)) {
            return new Date(data).getTime();
        }else if(data == "null") {
            return null;
        }else {
            return data;
        }
    }

    /**
     * @param {any} data 
     * @param {import("./json-schema").JsonSchema} schema 
     * @param {string} [key] 
     * @param {boolean} [enableCast]
     * @throws {Error}
     */
    validateJson(data, schema, key, enableCast) {
        if(schema.oneOf != null) {
            if(schema.oneOf.length == 0) {
                throw new Error(`Schema is invalid.\n${JSON.stringify(schema, null, 4)}`);
            }
            let error;
            let result = schema.oneOf.some(_schema => {
                try {
                    this.validateJson(data, _schema, key);
                }catch(error) {
                    error = error;
                    return false;
                }
                return true;
            });
            if(!result) {
                throw error;
            }
        }else if(schema.anyOf != null) {
            if(schema.anyOf.length == 0) {
                throw new Error(`Schema is invalid.\n${JSON.stringify(schema, null, 4)}`);
            }
            let error;
            let result = schema.anyOf.some(_schema => {
                try {
                    this.validateJson(data, _schema, key);
                }catch(error) {
                    error = error;
                    return false;
                }
                return true;
            });
            if(!result) {
                throw error;
            }
        }else if(schema.allOf != null) {
            if(schema.allOf.length == 0) {
                throw new Error(`Schema is invalid.\n${JSON.stringify(schema, null, 4)}`);
            }
            let error;
            let result = schema.allOf.every(_schema => {
                try {
                    this.validateJson(data, _schema, key);
                }catch(error) {
                    error = error;
                    return false;
                }
                return true;
            });
            if(!result) {
                throw error;
            }
        }

        if(schema["$ref"] != null) {
            let _schema = this.getComponent(schema["$ref"]);
            if(_schema == null) {
                throw new Error(`Schema is invalid.\n${JSON.stringify(schema, null, 4)}`);
            }
            schema = _schema;
        }

        /**
         * 
         * @param {object} schema 
         * @param {any} data 
         * @param {string} message 
         * @param {string} [key] 
         * @returns {Error}
         */
        function ValidationError(schema, data, message, key) {
            return new Error(`Data and schema do not match. ${message}${key != null ? "\nKEY: "+key : ""}\nSCHEMA:\n${JSON.stringify(schema, null, 4)}\nDATA:\n${JSON.stringify(data, null, 4)}`);
        }

        if(schema.type == null) {
            throw new Error(`Schema is invalid.\n${JSON.stringify(schema, null, 4)}`);
        }

        if(schema.type == "array") {
            if(!Array.isArray(data)) {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
            if(schema.maxItems != null) {
                if(data.length > schema.maxItems) {
                    throw ValidationError(schema, data, "The value is above the maximum length.", key);
                }
            }
            if(schema.minItems != null) {
                if(data.length < schema.minItems) {
                    throw ValidationError(schema, data, "The value is below the maximum length.", key);
                }
            }
            if(schema.items != null) {
                let valueSchema = schema.items;
                if(valueSchema["$ref"] != null) {
                    let _valueSchema = this.getComponent(valueSchema["$ref"]);
                    if(_valueSchema != null) {
                        valueSchema = _valueSchema;
                    }
                }
                data.forEach(value => {
                    this.validateJson(value, valueSchema);
                });
            }
        }else if(schema.type == "object") {
            if(data == null || typeof data != "object") {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
            Object.keys(data).forEach(key => {
                if(schema.properties != null) {
                    let value = data[key];
                    let valueSchema = schema.properties[key];
                    if(valueSchema == null) {
                        throw ValidationError(schema, value, "Schema not found.", key);
                    }
                    if(valueSchema["$ref"] != null) {
                        let _valueSchema = this.getComponent(valueSchema["$ref"]);
                        if(_valueSchema != null) {
                            valueSchema = _valueSchema;
                        }
                    }
                    this.validateJson(value, valueSchema, key);
                }
            });
        }else if(schema.type == "string") {
            if(enableCast != undefined && enableCast) {
                data = data.toString();
            }
            if(typeof data != "string") {
                throw ValidationError(schema, data, "Type mismatch", key);
            }
            if(schema.maxLength != null) {
                if(data.length > schema.maxLength) {
                    throw ValidationError(schema, data, "The value is above the maximum length.", key);
                }
            }
            if(schema.minLength != null) {
                if(data.length < schema.minLength) {
                    throw ValidationError(schema, data, "The value is below the minimum length.", key);
                }
            }
            if(schema.enum != null) {
                if(!schema.enum.includes(data)) {
                    throw ValidationError(schema, data, "The value is not included in the available values.", key);
                }
            }
            if(schema.pattern != null) {
                if(!new RegExp(schema.pattern).test(data)) {
                    throw ValidationError(schema, data, "The value does not follow format.", key);
                }
            }
            if(schema.format != null) {
                if(schema.format == "date-time" && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T|t)[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|z|(\+|-)[0-9]{2}:[0-9]{2})$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "date" && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "time" && !/^[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|z|(\+|-)[0-9]{2}:[0-9]{2})$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "duration" && !/^P(([0-9]{1,}[YMD])*T{0,1}([0-9]{1,}[HMS])*|[0-9]{1,}W)*$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "email" && !/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "hostname" && !/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)+([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "ipv4" && !/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "ipv6" && !/^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "uri" && !/^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }else if(schema.format == "uuid" && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data)) {
                    throw ValidationError(schema, data, "Format mismatch.");
                }
            }
        }else if(schema.type == "number") {
            if(enableCast != undefined && enableCast) {
                data = Number(data);
            }
            if(typeof data != "number") {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
            if(schema.maximum != null) {
                if(data > schema.maximum) {
                    throw ValidationError(schema, data, "The value is above the maximum value.", key);
                }
            }
            if(schema.minimum != null) {
                if(data < schema.minimum) {
                    throw ValidationError(schema, data, "The value is below the minimum value.", key);
                }
            }
            if(schema.exclusiveMaximum != null) {
                if(data >= schema.exclusiveMaximum) {
                    throw ValidationError(schema, data, "The value is above the maximum value.", key);
                }
            }
            if(schema.exclusiveMinimum != null) {
                if(data < schema.exclusiveMinimum) {
                    throw ValidationError(schema, data, "The value is below the minimum value.", key);
                }
            }
        }else if(schema.type == "integer") {
            if(typeof data != "number") {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }else if(data.toString().includes(".")) {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
            if(schema.maximum != null) {
                if(data > schema.maximum) {
                    throw ValidationError(schema, data, "The value is above the maximum value.", key);
                }
            }
            if(schema.minimum != null) {
                if(data < schema.minimum) {
                    throw ValidationError(schema, data, "The value is below the minimum value.", key);
                }
            }
            if(schema.exclusiveMaximum != null) {
                if(data >= schema.exclusiveMaximum) {
                    throw ValidationError(schema, data, "The value is above the maximum value.", key);
                }
            }
            if(schema.exclusiveMinimum != null) {
                if(data < schema.exclusiveMinimum) {
                    throw ValidationError(schema, data, "The value is below the minimum value.", key);
                }
            }
        }else if(schema.type == "boolean") {
            if(typeof data != "boolean") {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
        }else if(schema.type == "null") {
            if(data != null) {
                throw ValidationError(schema, data, "Type mismatch.", key);
            }
        }
    }

    /**
     * @param {string} path 
     * @returns {import("./json-schema").JsonSchema|null} 
     */
    getComponent(path) {
        if(this.spec.components == null) {
            return null;
        }
        let components = this.spec.components.schemas;
        if(components == null) {
            return null;
        }
        if(path.startsWith("#/components/schemas/")) {
            let componentName = path.substring("#/components/schemas/".length);
            let _componentNames = Object.keys(components);
            let component = null;
            for(let _componentName of _componentNames) {
                if(componentName == _componentName) {
                    component = components[componentName];
                    break;
                }
            }
            return component;
        }
        return null;
    }

    /**
     * @param {any} object 
     * @returns {string}
     */
    stringifyObject(object) {
        if(object == null) return "";
        if(object instanceof Buffer) {
            return object.toString("utf8");
        }else {
            return JSON.stringify(object);
        }
    }
}
exports.Validator = Validator;