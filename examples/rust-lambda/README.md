# Rust Lambda through the Floci console

Build on macOS, Linux, or Windows using Rust and [Cargo Lambda](https://www.cargo-lambda.info/guide/installation.html):

```sh
cd examples/rust-lambda
cargo lambda build --release --output-format zip --arm64
```

This creates `target/lambda/floci-rust-example/bootstrap.zip` for ARM64.
For x86_64, replace `--arm64` with `--x86-64`.
An ordinary macOS `cargo build` executable cannot run inside Lambda's Linux container.
The project uses AWS's Rust runtime client to poll Floci's Runtime API.

Run Floci with the Docker socket mounted and
`FLOCI_SERVICES_LAMBDA_HONOUR_ARCHITECTURES=true`. Set
`FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK` to the shared Docker network when running
Floci in Docker. Use a native architecture where possible; cross-architecture
execution requires Docker's emulation support.

Create an execution role in the local IAM console, then open AWS Lambda in this
console and choose **Create function**:

1. Enter a function name and the local execution role's ARN.
2. Choose **Rust (Amazon Linux 2023)** and the architecture you built.
3. Upload `bootstrap.zip`, then choose **Create function**.
4. Select the function and enter `{"hello":"world"}` in **Event payload JSON**.
5. Choose **Invoke**. The result contains `Hello from Rust on Floci`, your input,
   a request ID, and an invocation counter. Invoke again to exercise warm reuse.
6. Invoke with `{"fail":true}` to exercise a handler error.

Rust runs under AWS's `provided.al2023` runtime identifier. The console uploads
the original ZIP bytes through the AWS SDK; it does not compile source on the API
server. Keep the executable named `bootstrap` at the ZIP root and preserve its
executable permissions. The direct-upload limit is 50 MiB compressed.

## Live browser verification

Install the workspace dependencies and Playwright's Chromium browser. Start the
API with `pnpm dev:api`, pointed at the local Floci endpoint, and run:

```sh
FLOCI_RUST_ZIP="$PWD/examples/rust-lambda/target/lambda/floci-rust-example/bootstrap.zip" \
FLOCI_RUST_ARCH=arm64 \
FLOCI_RUST_ROLE_ARN=arn:aws:iam::000000000000:role/lambda-role \
pnpm --filter @floci/frontend exec playwright test rust-lambda.live.spec.ts
```

This test uses the real console, API, and Lambda containers. It creates a uniquely
named function through the form, uploads the compiled package, invokes it twice,
checks a handler error, and deletes only its own function afterward. Without
`FLOCI_RUST_ZIP`, the live test is skipped in the ordinary mocked browser suite.
