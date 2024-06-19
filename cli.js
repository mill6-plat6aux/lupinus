#!/usr/bin/env node

/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

let { Validator } = require("./validator");

let specFilePath;
let testSetFilePath;
let logSettingFilePath;
let verboseLog = false;

if(process.argv.length > 2) {
    let arguments = process.argv;
    for(let i=2; i<arguments.length; i++) {
        let argument = arguments[i];
        if(argument.startsWith("--") && argument.length > 1) {
            let key = argument.substring(2);
            if(key == "verbose") {
                verboseLog = true;
                continue;
            }
            let value;
            if(i<arguments.length-1) {
                value = arguments[i+1];
                i++;
            }
            if(value == null) continue;
            if(key == "spec") {
                specFilePath = value;
            }else if(key == "testcase") {
                testSetFilePath = value;
            }else if(key == "log") {
                logSettingFilePath = value;
            } 
        }
    }
}

if(specFilePath == null || testSetFilePath == null) {
    console.log("npx lupinus --spec <SPEC_FILE> --testset <TESTSET_FILE> --log <LOG_SETTING_FILE> --verbose");
    process.exit(0);
}

let validator = new Validator(specFilePath, testSetFilePath, logSettingFilePath, verboseLog);
validator.validate();