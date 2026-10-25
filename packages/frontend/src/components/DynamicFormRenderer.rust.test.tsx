import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, describe, expect, test, vi} from 'vitest'
import type {ServiceSchema} from '@/types/schema'
import {DynamicFormRenderer} from './DynamicFormRenderer'

const {awsServerlessSchema} = await vi.importActual<{awsServerlessSchema: () => ServiceSchema}>(
    '../../../api/src/cloud-spi/serverlessSchema',
)

function schema(): ServiceSchema {
    return JSON.parse(JSON.stringify(awsServerlessSchema())) as ServiceSchema
}

afterEach(() => vi.unstubAllGlobals())

function controlFileReads() {
    const reads: ControlledFileReader[] = []
    class ControlledFileReader {
        result: string | null = null
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        onabort: (() => void) | null = null

        readAsDataURL() {
            reads.push(this)
        }

        succeed(base64: string) {
            this.result = `data:application/zip;base64,${base64}`
            this.onload?.()
        }
    }
    vi.stubGlobal('FileReader', ControlledFileReader)
    return reads
}

function readyRustForm() {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    const {container} = render(<DynamicFormRenderer
        schema={schema()}
        initialValues={{functionName: 'rust-example', role: 'arn:role', runtime: 'provided.al2023'}}
        isSubmitting={false}
        onSubmit={onSubmit}
    />)
    return {user, onSubmit, form: container.querySelector('form')!}
}

function zipFile(name: string) {
    return new File([new Uint8Array([80, 75, 3, 4])], name, {type: 'application/zip'})
}

describe('Rust Lambda create form', () => {
    test('blocks button and form submission until the selected package finishes reading', async () => {
        const reads = controlFileReads()
        const {user, onSubmit, form} = readyRustForm()
        await user.upload(screen.getByLabelText(/Rust deployment ZIP/), zipFile('pending.zip'))

        const pending = screen.getByRole('button', {name: 'Reading package'})
        expect(pending).toBeDisabled()
        await user.click(pending)
        fireEvent.submit(form)
        expect(onSubmit).not.toHaveBeenCalled()

        await act(async () => reads[0].succeed('UEsDBEE='))
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledOnce()
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({zipBase64: 'UEsDBEE='}))
    })

    test.each(['old-first', 'new-first'] as const)('submits only the replacement file when reads complete %s', async (order) => {
        const reads = controlFileReads()
        const {user, onSubmit, form} = readyRustForm()
        const input = screen.getByLabelText(/Rust deployment ZIP/)
        await user.upload(input, zipFile('old.zip'))
        await user.upload(input, zipFile('new.zip'))

        if (order === 'old-first') {
            await act(async () => reads[0].succeed('UEsDBEE='))
            expect(screen.getByRole('button', {name: 'Reading package'})).toBeDisabled()
            fireEvent.submit(form)
            expect(onSubmit).not.toHaveBeenCalled()
            await act(async () => reads[1].succeed('UEsDBEI='))
        } else {
            await act(async () => reads[1].succeed('UEsDBEI='))
            await act(async () => reads[0].succeed('UEsDBEE='))
        }

        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledOnce()
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({zipBase64: 'UEsDBEI='}))
    })

    test('ignores a pending package after leaving Rust, even when returning before it finishes', async () => {
        const reads = controlFileReads()
        const {user, onSubmit} = readyRustForm()
        await user.upload(screen.getByLabelText(/Rust deployment ZIP/), zipFile('old.zip'))
        await user.selectOptions(screen.getByRole('combobox', {name: /Runtime/}), 'python3.12')
        expect(screen.getByRole('button', {name: 'Create'})).toBeEnabled()
        await user.selectOptions(screen.getByRole('combobox', {name: /Runtime/}), 'provided.al2023')
        await act(async () => reads[0].succeed('UEsDBEE='))

        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText('Rust deployment ZIP is required.')).toBeVisible()
        await user.upload(screen.getByLabelText(/Rust deployment ZIP/), zipFile('fresh.zip'))
        await act(async () => reads[1].succeed('UEsDBEI='))
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({zipBase64: 'UEsDBEI='}))
    })

    test.each(['error', 'abort'] as const)('clears a previous package after a read %s and permits recovery', async (event) => {
        const reads = controlFileReads()
        const {user, onSubmit, form} = readyRustForm()
        const input = screen.getByLabelText(/Rust deployment ZIP/)
        await user.upload(input, zipFile('first.zip'))
        await act(async () => reads[0].succeed('UEsDBEE='))
        await user.upload(input, zipFile('broken.zip'))
        await act(async () => {
            if (event === 'error') reads[1].onerror?.()
            else reads[1].onabort?.()
        })

        expect(screen.getByRole('button', {name: 'Create'})).toBeEnabled()
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByText(event === 'error' ? 'Could not read broken.zip. Please select it again.' : 'File reading was cancelled.')).toBeVisible()
        fireEvent.submit(form)
        expect(onSubmit).not.toHaveBeenCalled()

        await user.upload(input, zipFile('recovered.zip'))
        await act(async () => reads[2].succeed('UEsDBEI='))
        expect(input).not.toHaveAttribute('aria-invalid')
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({zipBase64: 'UEsDBEI='}))
    })

    test('ignores an error from a replaced read without clearing the current pending state', async () => {
        const reads = controlFileReads()
        const {user, onSubmit} = readyRustForm()
        const input = screen.getByLabelText(/Rust deployment ZIP/)
        await user.upload(input, zipFile('old.zip'))
        await user.upload(input, zipFile('new.zip'))
        await act(async () => reads[0].onerror?.())
        expect(screen.getByRole('button', {name: 'Reading package'})).toBeDisabled()
        expect(input).not.toHaveAttribute('aria-invalid')
        await act(async () => reads[1].succeed('UEsDBEI='))
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({zipBase64: 'UEsDBEI='}))
    })

    test('uploads binary bytes and submits Rust without requiring an inline handler', async () => {
        const onSubmit = vi.fn()
        const user = userEvent.setup()
        render(<DynamicFormRenderer schema={schema()} isSubmitting={false} onSubmit={onSubmit}/>)
        await user.type(screen.getByPlaceholderText('Function Name'), 'rust-example')
        await user.type(screen.getByPlaceholderText('Execution Role ARN'), 'arn:role')
        await user.selectOptions(screen.getByRole('combobox', {name: /Runtime/}), 'provided.al2023')
        await user.selectOptions(screen.getByRole('combobox', {name: /Architecture/}), 'arm64')
        expect(screen.queryByPlaceholderText('Handler')).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Inline Code')).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText('Rust deployment ZIP is required.')).toBeVisible()

        const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 128])
        await user.upload(screen.getByLabelText(/Rust deployment ZIP/), new File([bytes], 'bootstrap.zip', {type: 'application/zip'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Create'})).toBeEnabled())
        expect(screen.getByText(/Upload the package built with cargo lambda/)).toBeVisible()
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
            runtime: 'provided.al2023', architecture: 'arm64', zipBase64: 'UEsDBAD/gA==',
        }))
    })

    test('rejects an oversized file and restores inline fields when switching back', async () => {
        const currentSchema = schema()
        currentSchema.fields.find((field) => field.name === 'zipBase64')!.maxBytes = 4
        const user = userEvent.setup()
        render(<DynamicFormRenderer schema={currentSchema} isSubmitting={false} onSubmit={vi.fn()}/>)
        await user.selectOptions(screen.getByRole('combobox', {name: /Runtime/}), 'provided.al2023')
        await user.upload(screen.getByLabelText(/Rust deployment ZIP/), new File(['oversize'], 'bootstrap.zip', {type: 'application/zip'}))
        expect(screen.getByText(/must be at most/)).toBeVisible()
        await user.selectOptions(screen.getByRole('combobox', {name: /Runtime/}), 'python3.12')
        expect(screen.queryByLabelText(/Rust deployment ZIP/)).not.toBeInTheDocument()
        expect(screen.getByPlaceholderText('Handler')).toBeVisible()
        expect(screen.getByPlaceholderText('Inline Code')).toBeVisible()
    })
})
