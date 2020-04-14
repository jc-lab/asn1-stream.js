# asn1-stream

ASN1 parser with a stream interface.
asn1-stream use [asn1js](https://www.npmjs.com/package/asn1js).

## Example

```typescript
import { Asn1Reader, Asn1ParseResult, Asn1SequenceResult } from 'asn1-stream';

const pkcs8_input = Buffer.from(
  'MIAEBBERERECBl9eELxP8gQEERERETCABAQiIiIiAgZfXhC8T/IEBCIiIiIAAAQEAAAAADCABAQiIiIiAgZfXhC8T/IEBCIiIiIAAAQEAAAAAAAA' + 
  'MIAEBBERERECBl9eELxP8gQEERERETCABAQiIiIiAgZfXhC8T/IEBCIiIiIAAAQEAAAAADCABAQiIiIiAgZfXhC8T/IEBCIiIiIAAAQEAAAAAAAA'
  , 'base64'
);

const reader = new Asn1Reader({
  stripSequence: true
});
reader.on('begin-sequence', (result: Asn1SequenceResult) => {
  console.log('begin-sequence: ', result);
});
reader.on('end-sequence', (result: Asn1SequenceResult) => {
  console.log('end-sequence: ', result);
});
reader.on('data', (data: Buffer | Asn1ParseResult) => {
    if(Buffer.isBuffer(data)) {
        console.log("passthrough data => ", data);
    }else{
        console.log("parsed data => ", data.offset, ':', data.result);
    }
});
reader.write(pkcs8_input);
```
