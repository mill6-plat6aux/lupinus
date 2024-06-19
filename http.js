/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const querystring = require("node:querystring");

/**
 * @typedef {object} HttpResponse
 * @property {number|undefined} status
 * @property {import("node:http").IncomingHttpHeaders} headers
 * @property {object} body
 */

/**
 * @param {"get"|"post"|"patch"|"put"|"delete"|"option"|"head"} method 
 * @param {string} requestPath 
 * @param {import("node:http").IncomingHttpHeaders} [requestHeader] 
 * @param {object} [requestBody] 
 * @returns {Promise<HttpResponse>}
 */
exports.request = async function(method, requestPath, requestHeader, requestBody) {
    return new Promise((resolve, reject) => {
        const Http = requestPath.startsWith("https") ? require("https") : require("http");
        let connection = Http.request(requestPath, {
            method: method,
            headers: requestHeader
        }, response => {
            let contentType = response.headers["content-type"];
            let status = response.statusCode;
            let buffer;
            response.on("data", chunk => {
                if(buffer == null) buffer = chunk;
                else buffer = Buffer.concat([buffer, chunk]);
            });
            response.on("end", () => {
                let result = buffer;
                if(result != null) {
                    if(contentType != null) {
                        if(contentType.startsWith("application/json")) {
                            result = result.toString("utf8");
                            try {
                                result = JSON.parse(result);
                            }catch(error) {
                                console.error(error);
                            }
                        }
                    }
                }
                resolve({status: status, headers: response.headers, body: result});
            });
        });
        connection.on("error", error => {
            reject(error);
        });
        if(requestBody != null) {
            if(requestHeader != null) {
                let contentType = requestHeader["content-type"];
                if(contentType != null) {
                    if(contentType.startsWith("application/json")) {
                        requestBody = JSON.stringify(requestBody);
                    }else if(contentType.startsWith("application/x-www-form-urlencoded")) {
                        requestBody = querystring.stringify(requestBody);
                    }else if(contentType.startsWith("application/cloudevents+json")) {
                        requestBody = JSON.stringify(requestBody);
                    }
                    connection.write(requestBody);
                }
            }
        }
        connection.end();
    });
}