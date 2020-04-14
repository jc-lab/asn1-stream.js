import {Asn1Reader, Asn1ParseResult, Asn1SequenceResult} from '../src';

// const pkcs8_input = Buffer.from('MIAEBBEiM0QCBl9eELxP8gAA', 'base64');
const pkcs8_input = Buffer.from('MEwEBBERERECBl9eELxP8gQEERERETAUBAQiIiIiAgZfXhC8T_IEBCIiIiIEBAAAAAAwFAQEIiIiIgIGX14QvE_yBAQiIiIiBAQAAAAAMEwEBBERERECBl9eELxP8gQEERERETAUBAQiIiIiAgZfXhC8T_IEBCIiIiIEBAAAAAAwFAQEIiIiIgIGX14QvE_yBAQiIiIiBAQAAAAA', 'base64');
// const pkcs8_input = Buffer.from('MIAEBBERERECBl9eELxP8gQEERERETCABAQiIiIiAgZfXhC8T_IEBCIiIiIAAAQEAAAAADCABAQiIiIiAgZfXhC8T_IEBCIiIiIAAAQEAAAAAAAAMIAEBBERERECBl9eELxP8gQEERERETCABAQiIiIiAgZfXhC8T_IEBCIiIiIAAAQEAAAAADCABAQiIiIiAgZfXhC8T_IEBCIiIiIAAAQEAAAAAAAA', 'base64');

// MEwEBBERERECBl9eELxP8gQEERERETAUBAQiIiIiAgZfXhC8T_IEBCIiIiIEBAAAAAAwFAQEIiIiIgIGX14QvE_yBAQiIiIiBAQAAAAA

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
  if (Buffer.isBuffer(data)) {
    console.log('passthrough data => ', data);
  } else {
    console.log('parsed data => ', data.offset, ':', data.result);
  }
});
reader.write(pkcs8_input);


