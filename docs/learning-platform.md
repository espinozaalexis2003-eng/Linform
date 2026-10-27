# Linform learning platform release

The live website stays a single `index.html`, compatible with the existing restricted S3 upload role. This release preserves the original lessons, completion IDs, contact form, and course colors.

## Included

- 26 lessons total: Linux 8, AWS 5, Azure 4, Terraform 9. Fifteen new lessons introduce all top-level domains for CLF-C02, AZ-900, and Terraform Associate 004. They are introductory coverage, not exhaustive exam preparation.
- 15 original review questions: AWS 4, Azure 3, Terraform 8. Optional one-minute-per-question timing, shuffled choices, explanations, and raw domain counts. These are short reviews, not full-length exam simulations, official exam items, or pass predictions.
- A simplified architecture reasoning exercise. It checks selected design boundaries, not deployed infrastructure.
- A real BusyBox ash shell compiled to WebAssembly, with an in-memory filesystem running in a dedicated Web Worker. Launch is opt-in. The student downloads a pinned binary from jsDelivr; SHA-256 integrity is checked. Lab commands are never sent to Linform's backend or cloud services.
- Prepared AWS Cognito account integration and a CloudFormation backend. Accounts stay unavailable until deployed and configured; follow [account setup](account-setup.md).

## Browser lab limitations

This runtime is a POSIX-style command environment, not a full Linux installation or Bash. `mkdir`, `touch`, `cat`, `printf`, `grep`, pipes, redirection, and many text tools are available. Some commands from the full Linux lessons, including `chmod`, `id`, `whoami`, `df`, `ps`, and services such as systemd, are not included. Students should use WSL or a full Linux environment for those lessons. AWS CLI, Azure CLI, Terraform, real cloud API access, and networking are unavailable in the browser lab.

Each Run begins in `/home/learner`; files persist between runs until Reset, Stop, timeout, or page reload. Shell variables and current-directory changes do not persist across separate runs. Run multiline scripts together. The lab uses 8-second execution, 64 KB output, and 1 MB per-write/file-growth limits. It is designed for small examples, not unrestricted workloads or persistent storage.

Terminal files and quiz answers are not synced. Account sync stores completed lesson IDs only. Lesson completion is self-reported.

## Checks

```bash
node tests/validate-site.mjs
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
