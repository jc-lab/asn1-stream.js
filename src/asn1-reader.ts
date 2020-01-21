/*! *****************************************************************************
Copyright (c) JC-Lab. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

import * as streams from 'stream';
import ReadBuffer from './read-buffer';

import { Int10 } from './int10'

import { ASN1 } from '@fidm/asn1';

enum ParseStep {
    READ_TAG_BEGIN ,
    READ_TAG_LONG,
    READ_TAG_LENGTH,
    READ_TAG_LENGTH_LONG,
    READ_TAG_CONTENT,
    READ_TAG_CONTENT_FIXED_LENGTH,
}

class ParseContext {
    public totalRemaining: number = -1;

    public step: ParseStep = ParseStep.READ_TAG_BEGIN;

    public tagClass: number = 0;
    public tagConstructed: boolean = false;
    public tagNumber: number = 0;
    public tagLength: number = 0;
    public tagTempInt10: Int10 = new Int10(0);
    public tagLenSize: number = 0;
    public tagLenRemaining: number = 0;
    public tagBuffer: number[] = [];
    public tagWrittenLength: number = 0;

    public tagIsUniversal(): boolean {
        return this.tagClass === 0x00;
    }
    public tagIsEOC(): boolean {
        return this.tagClass === 0x00 && this.tagNumber === 0x00;
    }
}

export interface IAsn1Reader {
    on(event: "data", listener: (chunk: Buffer | ASN1) => void): this;
}
export class Asn1Reader extends streams.Transform implements IAsn1Reader {
    private _position: number = 0;

    private _parseContextStack: ParseContext[] = [new ParseContext()];
    private _passthrough: boolean = false;

    constructor() {
        super({
            readableObjectMode: true
        });
    }

    public setPassthrough(): void {
        this._passthrough = true;
    }

    private _parse(readBuffer: ReadBuffer) {
        while(readBuffer.remaining !== 0) {
            if(this._passthrough) {
                this.push(readBuffer.readRemainingBuffer());
                return ;
            }

            const parseDepth = this._parseContextStack.length - 1;
            const parseContext = this._parseContextStack[parseDepth];
            switch (parseContext.step) {
                case ParseStep.READ_TAG_BEGIN:
                    if (readBuffer.remaining >= 1) {
                        let buf = readBuffer.readUInt8();
                        parseContext.tagBuffer = [buf];
                        parseContext.tagClass = buf >> 6;
                        parseContext.tagConstructed = ((buf & 0x20) !== 0);
                        parseContext.tagNumber = buf & 0x1F;
                        parseContext.tagTempInt10 = new Int10(0);
                        parseContext.tagWrittenLength = 0;
                        if (parseContext.tagNumber == 0x1F) {
                            parseContext.step++;
                        } else {
                            parseContext.step = ParseStep.READ_TAG_LENGTH;
                            break;
                        }
                    }else{
                        break;
                    }

                case ParseStep.READ_TAG_LONG:
                    if(readBuffer.remaining > 0) {
                        let buf: number;
                        do {
                            buf = readBuffer.readUInt8();
                            parseContext.tagBuffer.push(buf);
                            parseContext.tagTempInt10.mulAdd(128, buf & 0x7F);
                        } while((readBuffer.remaining > 0) && (buf & 0x80));
                        if((buf & 0x80) === 0) {
                            parseContext.tagNumber = parseContext.tagTempInt10.simplify() as number;
                            parseContext.step++;
                        }else{
                            break;
                        }
                    }else{
                        break;
                    }

                case ParseStep.READ_TAG_LENGTH:
                    if(readBuffer.remaining > 0) {
                        const buf = readBuffer.readUInt8();
                        const len = buf & 0x7F;
                        parseContext.tagBuffer.push(buf);
                        if(buf == len) {
                            parseContext.step = ParseStep.READ_TAG_CONTENT_FIXED_LENGTH;
                            parseContext.tagLength = len;
                            break;
                        }
                        if (len > 6) {
                            throw new Error("Length over 48 bits not supported at position " + this._position);
                        }
                        if (len === 0) {
                            parseContext.tagLenSize = -1;
                            parseContext.tagLenRemaining = -1;
                            parseContext.step = ParseStep.READ_TAG_CONTENT;
                            break;
                        }
                        parseContext.tagLenRemaining = len;
                        parseContext.tagTempInt10 = new Int10(0);
                        parseContext.step++;
                    }else{
                        break;
                    }

                case ParseStep.READ_TAG_LENGTH_LONG:
                    if(readBuffer.remaining > 0) {
                        while((readBuffer.remaining > 0) && (parseContext.tagLenRemaining > 0)) {
                            const buf = readBuffer.readUInt8();
                            parseContext.tagBuffer.push(buf);
                            parseContext.tagTempInt10.mulAdd(256, buf);
                            parseContext.tagLenRemaining--;
                        }
                        if(parseContext.tagLenRemaining === 0) {
                            parseContext.tagLength = parseContext.tagTempInt10.simplify() as number;
                            parseContext.step = ParseStep.READ_TAG_CONTENT_FIXED_LENGTH;
                        }
                    }
                    break;

                case ParseStep.READ_TAG_CONTENT:
                    if(parseContext.tagConstructed)
                    {
                        const subParseContext = new ParseContext();
                        subParseContext.totalRemaining = parseContext.tagLength;
                        this._parseContextStack.push(subParseContext);
                    }
                    else if(parseContext.tagIsUniversal() && ((parseContext.tagNumber == 0x03) || (parseContext.tagNumber == 0x04)))
                    {
                        const subParseContext = new ParseContext();
                        subParseContext.totalRemaining = parseContext.tagLength;
                        this._parseContextStack.push(subParseContext);
                    }
                    break;

                case ParseStep.READ_TAG_CONTENT_FIXED_LENGTH:
                    if(readBuffer.remaining > 0) {
                        let remainTagContent = parseContext.tagLength - parseContext.tagWrittenLength;
                        let avail = readBuffer.remaining < remainTagContent ? readBuffer.remaining : remainTagContent;
                        readBuffer.readBufferTo(parseContext.tagBuffer, avail);
                        parseContext.tagWrittenLength += avail;
                        if(parseContext.tagWrittenLength == parseContext.tagLength) {
                            if(parseDepth > 0) {
                                const parent = this._parseContextStack[parseDepth - 1];
                                parent.tagBuffer.push(...parseContext.tagBuffer);
                                if(parseContext.totalRemaining === 0) {
                                    this._parseContextStack.unshift();
                                }else if(parseContext.tagIsEOC()){
                                    this._parseContextStack.unshift();
                                }
                            }else{
                                this._onTagRead();
                            }
                            parseContext.step = ParseStep.READ_TAG_BEGIN;
                        }
                    }
                    break;
            }
        }
    }

    private _onTagRead() {
        const buffer = Buffer.from(Uint8Array.from(this._parseContextStack[0].tagBuffer));
        const asn1 = ASN1.fromDER(buffer, true);
        this.push(asn1);
    }

    _write(chunk: any, encoding: string, callback: (error?: (Error | null)) => void): void {
        const readBuffer = new ReadBuffer({
            buffer: chunk,
            afterReadHandler: (v) => {
                this._position += v;
                const currentParseContext = this._parseContextStack[this._parseContextStack.length - 1];
                if(currentParseContext.totalRemaining > 0) {
                    currentParseContext.totalRemaining -= v;
                }
            }
        });
        if(this._passthrough) {
            this.push(chunk, encoding);
        } else {
            this._parse(readBuffer);
        }
        callback();
    }
}
