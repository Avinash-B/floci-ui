import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, test, vi} from 'vitest'
import type {ServiceSchema} from '@/types/schema'
import {DynamicFormRenderer} from './DynamicFormRenderer'

const {awsServerlessSchema} = await vi.importActual<{awsServerlessSchema: () => ServiceSchema}>(
    '../../../api/src/cloud-spi/serverlessSchema',
)

function schema(): ServiceSchema {
    return JSON.parse(JSON.stringify(awsServerlessSchema())) as ServiceSchema
}

describe('Rust Lambda create form', () => {
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
