# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab,
choose **Report a vulnerability**, and describe the problem. Include the affected commit or file, the steps to
reproduce it, and the impact as you understand it. Only the maintainers can see the report until it is resolved.

We aim to acknowledge a report within a few working days and to keep the reporter informed until a fix ships.

## Secrets and personal files

CI scans every push to `main` and every pull request with gitleaks (configuration in `.gitleaks.toml`) and
fails when a secret is found. CI also fails when git tracks an owner profile file, an env file other than
`.env.example`, or a personal document outside `test/e2e/fixtures/`. If you find a real credential or personal
file in this repository, report it through the private channel above; do not paste the value into an issue or
a pull request.
