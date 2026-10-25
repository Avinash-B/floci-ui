import {ValidationError} from '../cloud-spi/errors'

export const MAX_LAMBDA_ZIP_BYTES = 50 * 1024 * 1024

/** Decode without repacking: native executables and ZIP permission bits must survive upload. */
export function decodeLambdaPackage(value: unknown): Uint8Array {
    if (typeof value !== 'string' || !value) {
        throw new ValidationError('Upload a Rust deployment ZIP containing a Linux bootstrap executable at its root.')
    }
    if (value.length > 4 * Math.ceil(MAX_LAMBDA_ZIP_BYTES / 3)) {
        throw new ValidationError('The deployment ZIP must be at most 50 MiB.')
    }
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        throw new ValidationError('The deployment ZIP is not valid base64.')
    }
    const bytes = Buffer.from(value, 'base64')
    if (bytes.toString('base64') !== value) {
        throw new ValidationError('The deployment ZIP is not valid base64.')
    }
    if (bytes.length > MAX_LAMBDA_ZIP_BYTES) {
        throw new ValidationError('The deployment ZIP must be at most 50 MiB.')
    }
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
        throw new ValidationError('Upload a ZIP archive, not Rust source or a raw executable.')
    }
    return bytes
}
