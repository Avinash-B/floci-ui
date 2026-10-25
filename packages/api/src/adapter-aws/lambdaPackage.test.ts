import {describe, expect, test} from 'bun:test'
import {decodeLambdaPackage, MAX_LAMBDA_ZIP_BYTES} from './lambdaPackage'
import {createZipArchive} from './zipArchive'

describe('Rust deployment ZIP upload', () => {
    test('preserves executable permissions and binary content in the original archive', () => {
        const zip = Buffer.from(createZipArchive([{name: 'bootstrap', content: new Uint8Array([127, 69, 76, 70, 255, 0, 128])}]))
        const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
        zip.writeUInt32LE(0o100755 * 65536, central + 38)
        expect(Buffer.from(decodeLambdaPackage(zip.toString('base64')))).toEqual(zip)
    })

    test.each(['A===', 'UEsDBA=', 'UEsDBB==', 'AAAA', 'not base64'])('rejects malformed input %s', (encoded) => {
        expect(() => decodeLambdaPackage(encoded)).toThrow()
    })

    test('rejects excessive encoded input before allocating decoded bytes', () => {
        const encoded = 'A'.repeat(4 * Math.ceil(MAX_LAMBDA_ZIP_BYTES / 3) + 4)
        expect(() => decodeLambdaPackage(encoded)).toThrow('at most 50 MiB')
    })
})
