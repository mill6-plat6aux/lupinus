/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const Http = require("./http");

class StandardSpecs {

    /**
     * @param {string} key 
     * @returns {import("./openapi3.1").PathItem | null}
     */
    static getSpec(key) {
        if(key == "oauth2.ClientCredentials") {
            return {
                post: {
                    requestBody: {
                        content: {
                            "application/x-www-form-urlencoded": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        "grant_type": {
                                            type: "string",
                                            enum: [
                                                "client_credentials"
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        "200": {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            access_token: {
                                                type: "string"
                                            },
                                            token_type: {
                                                type: "string"
                                            },
                                            expires_in: {
                                                type: "number",
                                                minimum: 0
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };
        }
        return null;
    }

}
module.exports = StandardSpecs;