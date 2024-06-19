/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

import { OutgoingHttpHeaders } from "http";

export interface TestSet {
    testCases: Array<TestCase>;
}

export interface TestCase {
    title: string;
    contextPath?: string;
    sequence: Array<Invoke>;
}

export interface Invoke {
    contextPath?: string;
    spec?: string;
    path: string;
    method: "get"|"post"|"patch"|"put"|"delete"|"option"|"head";
    request?: Request;
    response?: Response;
}

export interface InvokeHeaders {
    [key: string]: string;
}

export interface Request {
    headers?: IncomingHttpHeaders;
    body?: any;
}

export interface Response {
    status?: number;
    headers?: OutgoingHttpHeaders | string;
    body?: any;
}