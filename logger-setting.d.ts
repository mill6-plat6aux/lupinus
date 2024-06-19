/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

export interface LoggerSetting {
    threshold?: "debug"|"info"|"warning"|"error"|"critical";
    output: string;
    errorOutput: string;
    [caller: string]: LoggerSetting;
}