import {expect, test} from '@playwright/test'

const zip = process.env.FLOCI_RUST_ZIP

test('deploys and invokes a compiled Rust Lambda through the real console', async ({page, request}, testInfo) => {
    test.skip(!zip, 'Set FLOCI_RUST_ZIP to the compiled example bootstrap.zip and run the real API and Floci.')
    test.setTimeout(180_000)
    page.setDefaultTimeout(120_000)
    const name = `rust-ui-${Date.now()}-${testInfo.workerIndex}`
    const resourcePath = `/api/clouds/aws/services/serverless/resources/${name}`
    let created = false
    try {
        await page.goto('/cloud-explorer/aws/serverless')
        await page.getByRole('button', {name: 'Create function', exact: true}).click()
        await page.getByPlaceholder('Function Name').fill(name)
        await page.getByLabel('Runtime', {exact: false}).selectOption('provided.al2023')
        await page.getByLabel('Architecture', {exact: false}).selectOption(process.env.FLOCI_RUST_ARCH ?? 'arm64')
        await page.getByPlaceholder('Execution Role ARN').fill(
            process.env.FLOCI_RUST_ROLE_ARN ?? 'arn:aws:iam::000000000000:role/lambda-role',
        )
        await page.getByLabel('Rust deployment ZIP', {exact: false}).setInputFiles(zip!)
        await expect(page.locator('form').getByRole('button', {name: 'Create function', exact: true})).toBeEnabled()
        await page.locator('form').screenshot({path: testInfo.outputPath('rust-lambda-create-form.png')})
        const deployment = page.waitForResponse((response) =>
            response.url().endsWith('/api/clouds/aws/services/serverless/resources') && response.request().method() === 'POST',
        )
        await page.locator('form').getByRole('button', {name: 'Create function', exact: true}).click()
        const response = await deployment
        created = response.ok()
        expect(response.ok(), await response.text()).toBe(true)
        const functionRow = page.getByRole('row').filter({has: page.getByRole('cell', {name, exact: true})})
        await expect(functionRow).toContainText('provided.al2023')
        await page.screenshot({path: testInfo.outputPath('rust-lambda-deployed.png'), fullPage: true})
        await functionRow.getByRole('cell', {name, exact: true}).click()
        await page.getByLabel('Event payload JSON').fill('{"hello":"world"}')
        const invoke = async () => {
            const pending = page.waitForResponse((r) => r.url().endsWith(`${resourcePath}/invoke`) && r.request().method() === 'POST')
            await page.getByRole('button', {name: 'Invoke', exact: true}).click()
            const result = await pending
            expect(result.ok(), await result.text()).toBe(true)
            return result.json() as Promise<{statusCode: number; payload: string; functionError?: string}>
        }
        const first = await invoke()
        expect(first.statusCode).toBe(200)
        expect(first.functionError).toBeUndefined()
        expect(JSON.parse(first.payload)).toMatchObject({message: 'Hello from Rust on Floci', event: {hello: 'world'}, invocation: 1})
        await expect(page.locator('.invoke-result')).toContainText('Hello from Rust on Floci')
        const second = await invoke()
        expect(second.statusCode).toBe(200)
        expect(second.functionError).toBeUndefined()
        expect(JSON.parse(second.payload).invocation).toBe(2)
        expect(JSON.parse(first.payload).requestId).toEqual(expect.any(String))
        expect(JSON.parse(second.payload).requestId).not.toBe(JSON.parse(first.payload).requestId)
        await expect(page.locator('.invoke-result')).toContainText('"invocation": 2')
        await page.locator('.invoke-result').screenshot({path: testInfo.outputPath('rust-lambda-result.png')})
        await page.screenshot({path: testInfo.outputPath('rust-lambda-invoked.png'), fullPage: true})
        await testInfo.attach('rust-invocations.json', {
            body: JSON.stringify({first, second}, null, 2), contentType: 'application/json',
        })
        await page.getByLabel('Event payload JSON').fill('{"fail":true}')
        const failed = await invoke()
        expect(failed.functionError).toBe('Unhandled')
        await expect(page.locator('.invoke-result')).toContainText('Requested Rust handler failure')
        await page.screenshot({path: testInfo.outputPath('rust-lambda-handler-error.png'), fullPage: true})
    } finally {
        if (created) {
            const deleted = await request.delete(resourcePath)
            expect(deleted.ok(), await deleted.text()).toBe(true)
        }
    }
})
