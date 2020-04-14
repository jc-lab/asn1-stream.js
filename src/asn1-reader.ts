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

import { Int10 } from './int10';

import * as Asn1Js from 'asn1js';
import {LocalBaseBlock} from 'asn1js';

enum ParseStep {
  READ_TAG_BEGIN ,
  READ_TAG_LONG,
  READ_TAG_LENGTH,
  READ_TAG_LENGTH_LONG,
  READ_TAG_CONTENT,
  READ_TAG_CONTENT_FIXED_LENGTH,
  READ_TAG_CONTENT_DONE
}

enum EmitDataType {
  None,
  Current,
  Parent
}

class ParseContext {
  public readonly parent: ParseContext | null = null;
  public readonly depth: number;

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
  public tagTotalLength: number = 0;
  public tagTotalReadLength: number = 0;

  constructor(parent?: ParseContext) {
    this.parent = parent || null;
    if (parent) {
      this.depth = parent.depth + 1;
    } else {
      this.depth = 0;
    }
  }

  public tagIsUniversal(): boolean {
    return this.tagClass === 0x00;
  }
  public tagIsEOC(): boolean {
    return this.tagClass === 0x00 && this.tagNumber === 0x00;
  }

  public decrementTotalRemaining(length: number) {
    if (this.totalRemaining > 0) {
      this.totalRemaining -= length;
    }
    this.tagTotalReadLength += length;
    if (this.parent) {
      this.parent.decrementTotalRemaining(length);
    }
  }
}

export interface IAsn1ReaderOptions {
  /**
     * Outputs the internal item of the sequence as a 'data' event.
     * A 'begin-sequence' event occurs at the beginning of a sequence, and an 'end-sequence' event occurs at the end.
     */
  stripSequence?: boolean;
}

export interface Asn1SequenceResult {
  ber: boolean;
  size: number;
}

export type Asn1ParseResult = { offset: number; result: LocalBaseBlock };
export interface IAsn1Reader {
  on(event: 'begin-sequence', listener: (result: Asn1SequenceResult) => void): this;
  on(event: 'data', listener: (chunk: Buffer | Asn1ParseResult) => void): this;
  on(event: 'end-sequence', listener: (result: Asn1SequenceResult) => void): this;

  emit(event: 'begin-sequence', result: Asn1SequenceResult): boolean;
  emit(event: 'data', chunk: Buffer | Asn1ParseResult): boolean;
  emit(event: 'end-sequence', result: Asn1SequenceResult): boolean;
}
export class Asn1Reader extends streams.Transform implements IAsn1Reader {
  private _opts: IAsn1ReaderOptions;

  private _position: number = 0;

  private _parseContextStack: ParseContext[] = [];
  private _passthrough: boolean = false;

  constructor(options?: IAsn1ReaderOptions) {
    super({
      readableObjectMode: true
    });
    this._opts = options || {};
  }

  public setPassthrough(): void {
    this._passthrough = true;
  }

  private _checkEmitableData(parseContext: ParseContext): boolean {
    if (this._opts.stripSequence) {
      return parseContext.depth === 1;
    } else {
      return parseContext.depth === 0;
    }
  }

  private stepToString(step: ParseStep): string {
    switch (step) {
    case ParseStep.READ_TAG_BEGIN:
      return 'READ_TAG_BEGIN';
    case ParseStep.READ_TAG_LONG:
      return 'READ_TAG_LONG';
    case ParseStep.READ_TAG_LENGTH:
      return 'READ_TAG_LENGTH';
    case ParseStep.READ_TAG_LENGTH_LONG:
      return 'READ_TAG_LENGTH_LONG';
    case ParseStep.READ_TAG_CONTENT:
      return 'READ_TAG_CONTENT';
    case ParseStep.READ_TAG_CONTENT_FIXED_LENGTH:
      return 'READ_TAG_CONTENT_FIXED_LENGTH';
    case ParseStep.READ_TAG_CONTENT_DONE:
      return 'READ_TAG_CONTENT_DONE';
    }
  }

  private _parse(readBuffer: ReadBuffer) {
    while (readBuffer.remaining !== 0) {
      if (this._passthrough) {
        this.push(readBuffer.readRemainingBuffer());
        return ;
      }

      if (this._parseContextStack.length === 0) {
        this._parseContextStack.push(new ParseContext());
      }

      const parseContext = this._parseContextStack[this._parseContextStack.length - 1];

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
        } else {
          break;
        }

      case ParseStep.READ_TAG_LONG:
        if (readBuffer.remaining > 0) {
          let buf: number;
          do {
            buf = readBuffer.readUInt8();
            parseContext.tagBuffer.push(buf);
            parseContext.tagTempInt10.mulAdd(128, buf & 0x7F);
          } while ((readBuffer.remaining > 0) && (buf & 0x80));
          if ((buf & 0x80) === 0) {
            parseContext.tagNumber = parseContext.tagTempInt10.simplify() as number;
            parseContext.step++;
          } else {
            break;
          }
        } else {
          break;
        }

      case ParseStep.READ_TAG_LENGTH:
        if (readBuffer.remaining > 0) {
          const buf = readBuffer.readUInt8();
          const len = buf & 0x7F;

          parseContext.tagBuffer.push(buf);

          if (parseContext.tagNumber === 0 && len === 0) {
            this._tagReadDone(parseContext);
            break;
          }

          if (buf === len) {
            if (parseContext.depth === 0 && this._opts.stripSequence) {
              parseContext.step = ParseStep.READ_TAG_CONTENT;
            } else {
              parseContext.step = ParseStep.READ_TAG_CONTENT_FIXED_LENGTH;
            }
            parseContext.tagLength = len;
            parseContext.totalRemaining = parseContext.tagLength;
            this._tagReadPrepare(parseContext.depth, parseContext);
            break;
          }
          if (len > 6) {
            throw new Error('Length over 48 bits not supported at position ' + this._position);
          }
          if (len === 0) {
            parseContext.tagLenSize = -1;
            parseContext.tagLenRemaining = -1;
            parseContext.step = ParseStep.READ_TAG_CONTENT;
            this._tagReadPrepare(parseContext.depth, parseContext);
            break;
          }
          parseContext.tagLenRemaining = len;
          parseContext.tagTempInt10 = new Int10(0);
          parseContext.step++;

        } else {
          break;
        }

      case ParseStep.READ_TAG_LENGTH_LONG:
        if (readBuffer.remaining > 0) {
          while ((readBuffer.remaining > 0) && (parseContext.tagLenRemaining > 0)) {
            const buf = readBuffer.readUInt8();
            parseContext.tagBuffer.push(buf);
            parseContext.tagTempInt10.mulAdd(256, buf);
            parseContext.tagLenRemaining--;
          }
          if (parseContext.tagLenRemaining === 0) {
            parseContext.tagLength = parseContext.tagTempInt10.simplify() as number;
            parseContext.tagTotalLength = parseContext.tagTotalReadLength + parseContext.tagLength;
            parseContext.totalRemaining = parseContext.tagLength;
            parseContext.step = ParseStep.READ_TAG_CONTENT_FIXED_LENGTH;
            this._tagReadPrepare(parseContext.depth, parseContext);
          }
        }
        break;

      case ParseStep.READ_TAG_CONTENT:
        if (parseContext.tagConstructed)
        {
          const subParseContext = new ParseContext(parseContext);
          this._parseContextStack.push(subParseContext);
        }
        else if (parseContext.tagIsUniversal() && ((parseContext.tagNumber == 0x03) || (parseContext.tagNumber == 0x04)))
        {
          const subParseContext = new ParseContext(parseContext);
          this._parseContextStack.push(subParseContext);
        }
        break;

      case ParseStep.READ_TAG_CONTENT_FIXED_LENGTH:
        if (readBuffer.remaining > 0) {
          let remainTagContent = parseContext.tagLength - parseContext.tagWrittenLength;
          let avail = readBuffer.remaining < remainTagContent ? readBuffer.remaining : remainTagContent;
          readBuffer.readBufferTo(parseContext.tagBuffer, avail);
          parseContext.tagWrittenLength += avail;
          if (parseContext.tagWrittenLength == parseContext.tagLength) {
            this._tagReadDone(parseContext);
          }
        }
        break;

      case ParseStep.READ_TAG_CONTENT_DONE:
        this._tagReadDone(parseContext);
        break;
      }

    }
  }

  private _onTagRead(parseContext: ParseContext) {
    const ber = Uint8Array.from(parseContext.tagBuffer).buffer;
    const data = Asn1Js.fromBER(ber);
    this.push(data);
  }

  private _tagReadPrepare(parseDepth: number, parseContext: ParseContext): void {
    if (this._opts.stripSequence && parseDepth == 0) {
      const result: Asn1SequenceResult = {
        ber: parseContext.tagLength === 0,
        size: (parseContext.tagLength > 0) ? (parseContext.tagTotalReadLength + parseContext.tagLength) : 0
      };
      this.emit('begin-sequence', result);
    }
  }

  private _tagReadDone(parseContext: ParseContext): void {
    parseContext.step = ParseStep.READ_TAG_BEGIN;
    if (this._checkEmitableData(parseContext) && (parseContext.tagNumber !== 0)) {
      this._onTagRead(parseContext);
    }
    if (parseContext.depth === 0) {
      if (this._opts.stripSequence) {
        const parseContext = this._parseContextStack[0];
        const result: Asn1SequenceResult = {
          ber: parseContext.tagLength === 0,
          size: parseContext.tagTotalReadLength
        };
        this.emit('end-sequence', result);
      }
    }
    this._parseContextStack.pop();
    if (parseContext.tagIsEOC()) {
      if (parseContext.parent) {
        this._tagReadDone(parseContext.parent);
      }
    }

    if (
      parseContext.depth === 1 && parseContext.parent &&
            parseContext.parent.totalRemaining == 0
    ) {
      this._tagReadDone(parseContext.parent as ParseContext);
    }
  }

  _write(chunk: any, encoding: string, callback: (error?: (Error | null)) => void): void {
    const readBuffer = new ReadBuffer({
      buffer: chunk,
      afterReadHandler: (v) => {
        this._position += v;
        const currentParseContext = this._parseContextStack[this._parseContextStack.length - 1];
        currentParseContext.decrementTotalRemaining(v);
      }
    });
    if (this._passthrough) {
      this.push(chunk, encoding);
    } else {
      this._parse(readBuffer);
    }
    callback();
  }
}
