import { Asn1Reader } from '../src';
import { Any } from 'asn1js';

const pkcs8_input = Buffer.from('MIICXAIBAAKBgQC0TSukVPNfOto1DjbuGsBd5rFaveJegO3im8leZYFqMDlQo+ogGqX1DIjomqNQDJrJi6ISmfj5LISvJ2vL/zU2hWsqZlAC3gBFjG7CwEzIHFA7YnYrhedW80WCE9CqwcfomLObPftEtA8xn0qPpENFWUbPtLSCJ/o/6xFK+eNexwIDAQABAoGBAJZ+K0U5GwKLrwLF4JeRgKtgGPzyrXXQC78v5T6DXyfxJIXoq00ssQT+92+fU11HiBNeF2OLXUMuI3nHX7SgShrWtwOb3wWuyQmMQGCQewCM8l3emMviGWWlr1roIBIxQGDA9mlW9P459kbHSRYHNWAGgzYZkCdxd8huTmVxq7UhAkEA45KQJXH3jOVLXDa2zc/YYMUCjJl1KjRg6Y5JepFbgXTdr45RlqbgCTkipUm37VNe9mJt70RWcsQXSQOmBXSWjwJBAMrS8p16y4Cov6oyPWG2bczO8huzr6I4HWZ1EpTfJ6JnMbqabwCQgXaFmSEb86vDqOSVy0ymEbLgDvCf/tPMkEkCQE+b380Zly20sK4rfbt1sA36HTAuJqyC8jwByHaWDtq0lTBqquP2sHzJffMwXKUq+xdZy3deApfXPQYPvq494MUCQA/dLAjRP/WSPVuMjmyEHlZ0oU81YLlpdjM7WPa39ZuoQqV7ys7afqXMkUubqhV3OlCWvs4B90Rsbf64JPBgAbECQBVLTPNuw1e9xY4sG52+FN3YLYij6fXKTT6RXnwJYD73z5Iu+kkQmEtbdVeDhsfHIfjEa9y/1+s6/5MzVhd4prc=', 'base64');

const reader = new Asn1Reader();
reader.on('data', (data: Buffer | Any) => {
    console.log("data => ", data);
});
reader.write(pkcs8_input);
