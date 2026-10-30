# Linform learning platform release

The live website stays a single `index.html`, compatible with the existing restricted S3 upload role. This release preserves the original lessons, completion IDs, contact form, and course colors.

## Included

- 26 lessons total: Linux 8, AWS 5, Azure 4, Terraform 9. Fifteen new lessons introduce all top-level domains for CLF-C02, AZ-900, and Terraform Associate 004. They are introductory coverage, not exhaustive exam preparation.
- 15 original review questions: AWS 4, Azure 3, Terraform 8. Optional one-minute-per-question timing, shuffled choices, explanations, and raw domain counts. These are short reviews, not full-length exam simulations, official exam items, or pass predictions.
- A simplified architecture reasoning exercise. It checks selected design boundaries, not deployed infrastructure.
- A real BusyBox ash shell compiled to WebAssembly, with an in-memory filesystem running in a dedicated Web Worker. Launch is opt-in. The student downloads a pinned binary from jsDelivr; SHA-256 integrity is checked. Lab commands are never sent to Linform's backend or cloud services.
- Prepared AWS Cognito account integration and a CloudFormation backend. Accounts stay unavailable until deployed and configured; follow [account setup](account-setup.md).

## Browser terminal

Practice uses a CloudShell-style terminal interface: Enter runs a command, output streams into a transcript, and the prompt reflects the current directory. Up/Down recall command history; Tab completes command names; Shift+Enter supports multiline scripts. Clear keeps files. Expand enlarges the terminal. A guide and file-based challenge checks sit alongside it.

The runtime is real BusyBox ash compiled to WebAssembly, not a full Linux installation or AWS CloudShell. Files, directories, exported environment variables and the previous exit status persist between submissions. Ordinary unexported variables, functions, shell options and interactive programs do not persist or behave as a full TTY. Tools such as chmod, whoami, id, df, ps, Bash, systemd, package managers, AWS/Azure CLI and Terraform are unavailable. Use WSL or a full Linux environment for those lessons.

Stop, Ctrl+C, or an 8-second execution timeout restarts the worker from its last completed-command snapshot. A partly completed command may lose its own changes, while the earlier workspace is restored. Reset files or page reload clears the session. Output is limited to 64 KB per command, files to 1 MB, and saved snapshots to 8 MB / 512 entries. The UI retains recent transcript entries and up to 100 commands of history in this tab.

Lab files and terminal history stay in browser memory and do not sync to student accounts. Lesson-completion syncing is separate and unchanged. Starting a session downloads the pinned integrity-checked WASM binary; commands have no cloud credentials or network socket bridge.

## Checks

```bash
node tests/validate-site.mjs
node --test tests/account-progress.mjs
node --test tests/terminal.mjs
python -m unittest discover -s infra -p 'test_*.py' -v
```

Before deployment, the release was exercised in a browser for loading the WASM shell, executing commands, creating files, checking challenges, opening lessons, completing a review quiz, and preserving guest progress. Live Cognito creation and cross-device sync require the AWS stack and remain separate acceptance checks.

## Official sources

Reviewed October 27, 2026:

- [AWS CLF-C02 guide](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/)
- [Microsoft AZ-900 guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-900)
- [HashiCorp Terraform Associate 004 objectives](https://developer.hashicorp.com/terraform/tutorials/certification-004/associate-review-004)

## Runtime credits

The embedded JS runtime is wasi-sh 0.11.0, ISC, copyright Alexandre Gomes Gaigalas. Its complete ISC notice is preserved with the embedded worker source in index.html. Runtime source: https://www.npmjs.com/package/wasi-sh/v/0.11.0 and https://github.com/alganet/wasi-sh.

The BusyBox binary is downloaded by the browser from the pinned npm package on jsDelivr, not included in this repository. BusyBox is GPL-2.0. The package includes build scripts and patches; see its source and https://busybox.net/ for upstream licensing and source.

Pinned binary SHA-256: `195b770af8fad458de09144abd3cc3e688a9a83907ca90f7938a253253dfb9b3`.

## Deployment

GitHub Actions validates the HTML/curriculum and backend tests, then uploads only index.html and invalidates CloudFront. Infrastructure changes are not automatically applied and the website deploy role receives no new AWS permissions.

## Terminal regression checks

Six real-WASM tests cover current-directory persistence, files, exported variables, previous exit codes, stdout/stderr, missing commands, pipes, challenge checks, workspace recovery and reset. The test downloads the same pinned binary as the application and checks SHA-256. To run offline, set LINFORM_WASM_PATH to a local copy of that exact binary.

Readable worker source is in scripts/terminal-worker.mjs; the deployed bundle is embedded in index.html under linform-lab-worker. It was bundled with esbuild 0.25.12 against wasi-sh 0.11.0. Preserve the ISC license notice and the pinned binary integrity when updating the bundle. The deployment continues to upload only index.html and requires no AWS IAM or infrastructure changes.
